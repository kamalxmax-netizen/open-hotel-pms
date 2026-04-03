import {
  getBusinessDate,
  getGroupReservationLines,
  getSelectedReservationIdsFromDraft,
} from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

type DistributionState = {
  reservation_id: string;
  booking_code: string;
  guest_name: string | null;
  room_capacity: number;
  primary_guest_profile_id: string | null;
  accompanying_guest_profile_ids: string[];
  expected_primary_guest_profile_id: string | null;
  name_match_status: "matched_by_name" | "matched_by_existing_profile" | "fallback_assigned" | "no_pool_match";
  name_match_score: number | null;
};

type PoolGuest = {
  id: string;
  display_name: string;
};

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9ก-๙\s]/g, " ")
    .replace(/\s+/g, " ");
}

function splitNameTokens(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function calculateNameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = splitNameTokens(left);
  const rightTokens = splitNameTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return left === right ? 1 : 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  const tokenScore = intersection / union;

  const leftLast = leftTokens[leftTokens.length - 1] ?? "";
  const rightLast = rightTokens[rightTokens.length - 1] ?? "";
  const lastNameBonus = leftLast && rightLast && leftLast === rightLast ? 0.35 : 0;

  const containsBonus =
    left.includes(right) || right.includes(left)
      ? 0.15
      : 0;

  return Math.min(1, tokenScore + lastNameBonus + containsBonus);
}

function buildDisplayName(firstName: unknown, lastName: unknown, fallbackId: string): string {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();
  const full = `${first} ${last}`.trim();
  return full || fallbackId;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await context.params;
    if (!groupId) {
      return NextResponse.json({ success: false, error: "Missing group ID." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const rawStrategy = String(body?.strategy ?? "match_main_then_equal_split");
    const strategy =
      rawStrategy === "fill_primary_then_accompanying" ? "match_main_then_equal_split" : rawStrategy;
    if (strategy !== "match_main_then_equal_split") {
      return NextResponse.json({ success: false, error: "Unsupported strategy." }, { status: 400 });
    }

    const guestProfileIds: string[] = Array.isArray(body?.guest_profile_ids)
      ? body.guest_profile_ids
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value: string) => value.length > 0)
      : [];
    if (guestProfileIds.length === 0) {
      return NextResponse.json({ success: false, error: "guest_profile_ids is required." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const businessDate = await getBusinessDate(supabase, body?.business_date ?? null);

    const selectedFromBody: string[] = Array.isArray(body?.selected_reservation_ids)
      ? body.selected_reservation_ids
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value: string) => value.length > 0)
      : [];

    const selectedReservationIds = selectedFromBody.length > 0
      ? selectedFromBody
      : await getSelectedReservationIdsFromDraft(supabase, groupId, businessDate);

    if (selectedReservationIds.length === 0) {
      return NextResponse.json({ success: false, error: "No selected reservations found for distribution." }, { status: 400 });
    }

    const reservationLines = await getGroupReservationLines(supabase, groupId, businessDate);
    const selectedIdSet = new Set(selectedReservationIds);
    const inGroup = reservationLines
      .filter((row) => selectedIdSet.has(row.reservation_id))
      .map((row) => ({
        reservation_id: row.reservation_id,
        booking_code: row.booking_code,
        guest_name: row.guest_name,
        fallback_primary_guest_profile_id: row.primary_guest_profile_id,
        room_capacity: Math.max(1, Number(row.room_type_max_guests ?? 2) || 2),
      }))
      .sort((a, b) => a.booking_code.localeCompare(b.booking_code));

    if (inGroup.length === 0) {
      return NextResponse.json({ success: false, error: "No valid reservations in this group." }, { status: 404 });
    }

    const state: DistributionState[] = inGroup.map((reservation) => {
      const expectedPrimary = reservation.fallback_primary_guest_profile_id ?? null;

      return {
        reservation_id: reservation.reservation_id,
        booking_code: reservation.booking_code,
        guest_name: reservation.guest_name,
        room_capacity: reservation.room_capacity,
        primary_guest_profile_id: null,
        accompanying_guest_profile_ids: [],
        expected_primary_guest_profile_id: expectedPrimary,
        name_match_status: "no_pool_match",
        name_match_score: null,
      };
    });

    const warnings: string[] = [];
    const unassignedPool: string[] = [];
    const scannedPool: string[] = [];
    const seenGuestIds = new Set<string>();
    for (const id of guestProfileIds) {
      if (seenGuestIds.has(id)) {
        warnings.push(`Duplicate guest_profile_id ignored: ${id}`);
        continue;
      }
      seenGuestIds.add(id);
      scannedPool.push(id);
    }

    const { data: poolProfiles, error: poolProfilesError } = scannedPool.length > 0
      ? await supabase
        .from("guest_profiles")
        .select("id, first_name, last_name")
        .in("id", scannedPool)
      : { data: [], error: null as any };
    if (poolProfilesError) {
      return NextResponse.json({ success: false, error: poolProfilesError.message }, { status: 500 });
    }

    const poolGuestById = new Map<string, PoolGuest>();
    (poolProfiles ?? []).forEach((row: any) => {
      const id = String(row?.id ?? "");
      if (!id) return;
      poolGuestById.set(id, {
        id,
        display_name: buildDisplayName(row?.first_name, row?.last_name, id),
      });
    });

    const assignedGuestIds = new Set<string>();
    let matchedMainCount = 0;

    // Pass A: name-match by reservation.guest_name with fuzzy threshold >= 0.50.
    for (const row of state) {
      const bookerName = row.guest_name ? normalizeName(row.guest_name) : "";
      if (!bookerName) continue;

      let bestCandidateId: string | null = null;
      let bestScore = 0;
      for (const guestId of scannedPool) {
        if (assignedGuestIds.has(guestId)) continue;
        const poolGuest = poolGuestById.get(guestId);
        if (!poolGuest) continue;
        const score = calculateNameSimilarity(bookerName, poolGuest.display_name);
        if (score > bestScore) {
          bestScore = score;
          bestCandidateId = guestId;
        }
      }

      if (bestCandidateId && bestScore >= 0.5) {
        row.primary_guest_profile_id = bestCandidateId;
        row.name_match_status = "matched_by_name";
        row.name_match_score = Number(bestScore.toFixed(2));
        assignedGuestIds.add(bestCandidateId);
        matchedMainCount += 1;
      }
    }

    // Pass A2: if not name-matched, try match by expected primary profile id.
    for (const row of state) {
      if (row.primary_guest_profile_id) continue;
      const expected = row.expected_primary_guest_profile_id;
      if (!expected) continue;
      if (!seenGuestIds.has(expected)) continue;
      if (assignedGuestIds.has(expected)) continue;
      row.primary_guest_profile_id = expected;
      row.name_match_status = "matched_by_existing_profile";
      row.name_match_score = null;
      assignedGuestIds.add(expected);
      matchedMainCount += 1;
    }

    const remainingGuests: string[] = scannedPool.filter((id) => !assignedGuestIds.has(id));

    // Pass B: fill empty primaries from remaining pool order.
    for (const row of state) {
      if (row.primary_guest_profile_id) continue;
      const next = remainingGuests.shift();
      if (!next) continue;
      row.primary_guest_profile_id = next;
      row.name_match_status = row.guest_name ? "fallback_assigned" : "no_pool_match";
      row.name_match_score = null;
      assignedGuestIds.add(next);
    }

    // Pass C: balanced fill by actual room capacity.
    // Each room gets 1 primary first, then we add guest #2 to every eligible room,
    // then guest #3 to rooms that support 3, and so on.
    const maxCapacity = state.reduce((highest, row) => Math.max(highest, row.room_capacity), 1);
    for (let targetOccupancy = 2; targetOccupancy <= maxCapacity; targetOccupancy += 1) {
      for (const row of state) {
        if (remainingGuests.length === 0) break;
        if (!row.primary_guest_profile_id) continue;
        if (row.room_capacity < targetOccupancy) continue;
        while (remainingGuests.length > 0 && (1 + row.accompanying_guest_profile_ids.length) < targetOccupancy) {
          const next = remainingGuests.shift();
          if (!next) break;
          row.accompanying_guest_profile_ids.push(next);
          assignedGuestIds.add(next);
        }
      }
    }

    unassignedPool.push(...remainingGuests);
    if (unassignedPool.length > 0) {
      warnings.push(`${unassignedPool.length} guest(s) exceed room capacity or available slots.`);
    }
    if (state.some((row) => !row.primary_guest_profile_id)) {
      warnings.push("Some rooms still have no primary guest after distribution.");
    }

    const poolDisplayNames = scannedPool.map((id) => poolGuestById.get(id)?.display_name || id);

    return NextResponse.json({
      success: true,
      strategy,
      reservation_order: state.map((row) => ({ reservation_id: row.reservation_id, booking_code: row.booking_code })),
      distribution_preview: state.map((row) => ({
        reservation_id: row.reservation_id,
        booking_code: row.booking_code,
        previous_guest_name: row.guest_name,
        primary_guest_profile_id: row.primary_guest_profile_id,
        primary_guest_display_name: row.primary_guest_profile_id
          ? (poolGuestById.get(row.primary_guest_profile_id)?.display_name || row.primary_guest_profile_id)
          : null,
        accompanying_guest_profile_ids: row.accompanying_guest_profile_ids,
        name_match_status: row.name_match_status,
        name_match_score: row.name_match_score,
        suggested_note_line:
          row.name_match_status === "fallback_assigned" && row.guest_name && row.primary_guest_profile_id
            ? `[GROUP CI AUTO-REPLACE] Booker "${row.guest_name}" not found in scan pool. Replaced main guest with "${poolGuestById.get(row.primary_guest_profile_id)?.display_name || row.primary_guest_profile_id}". Pool: ${poolDisplayNames.join(", ")}`
            : null,
      })),
      unassigned_pool: unassignedPool,
      warnings,
      distribution_stats: {
        rooms: state.length,
        guests: scannedPool.length,
        matched_main_count: matchedMainCount,
        target_split: state.map((row) => 1 + row.accompanying_guest_profile_ids.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
