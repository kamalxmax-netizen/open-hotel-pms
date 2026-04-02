import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { GuestHistoryResponse, GuestHistoryStay } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { z } from "zod";

type RouteParams = { params: { id: string } };
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const idSchema = z.string().uuid("Invalid guest profile id");

type ReservationSnapshot = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  source: string | null;
  created_at: string | null;
  guest_profile_id: string | null;
  total_price: number | null;
  is_dayuse: boolean | null;
};

type LegacyStayRow = {
  id: string;
  date_in: string | null;
  date_out: string | null;
  nights: number | null;
  room_number: string | null;
  source_file: string | null;
  notes: string | null;
  created_at: string | null;
};

function fullNameFromProfile(profile: any) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "Unknown";
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function sortByCheckinDesc<T extends { checkin_date: string | null; created_at?: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const left = String(b.checkin_date ?? b.created_at ?? "");
    const right = String(a.checkin_date ?? a.created_at ?? "");
    return left.localeCompare(right);
  });
}

function countCompletedStayNights(
  rows: Array<{ status: string | null; checkin_date: string | null; checkout_date: string | null }>
) {
  return rows.reduce((sum, row) => {
    if (row.status !== "checked_out") return sum;
    const checkin = String(row.checkin_date ?? "").trim();
    const checkout = String(row.checkout_date ?? "").trim();
    if (!checkin || !checkout) return sum;
    const checkinMs = new Date(`${checkin}T00:00:00`).getTime();
    const checkoutMs = new Date(`${checkout}T00:00:00`).getTime();
    if (!Number.isFinite(checkinMs) || !Number.isFinite(checkoutMs)) return sum;
    const nights = Math.max(1, Math.round((checkoutMs - checkinMs) / 86400000));
    return sum + nights;
  }, 0);
}

function isMissingRelationError(error: unknown, relationName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: string; message?: string };
  if (anyError.code === "42P01") return true;
  const message = String(anyError.message ?? "").toLowerCase();
  return message.includes(relationName.toLowerCase()) && message.includes("does not exist");
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  noStore();
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }

    const guestProfileId = parsedId.data;
    const supabase = createServerSupabaseClient();

    const reservationSelect =
      "id, booking_code, guest_name, status, checkin_date, checkout_date, checked_in_at, source, created_at, guest_profile_id, total_price, is_dayuse";

    const [
      { data: guest, error: guestError },
      { data: primaryReservations, error: primaryError },
      { data: accompanyingLinks, error: accompanyingError },
      { data: legacyStaysData, error: legacyStaysError },
    ] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select(
          "id, first_name, last_name, email, phone, nationality, stay_count, night_count, main_stay_count, main_night_count, accompanying_stay_count, accompanying_night_count, legacy_night_count"
        )
        .eq("id", guestProfileId)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select(reservationSelect)
        .eq("guest_profile_id", guestProfileId)
        .order("checkin_date", { ascending: false }),
      supabase
        .from("reservation_guests")
        .select(
          `reservation_id, role, display_order, created_at, reservations!inner(${reservationSelect})`
        )
        .eq("guest_profile_id", guestProfileId)
        .eq("role", "accompanying")
        .order("created_at", { ascending: false }),
      supabase
        .from("legacy_stays")
        .select("id, date_in, date_out, nights, room_number, source_file, notes, created_at")
        .eq("guest_profile_id", guestProfileId)
        .order("date_in", { ascending: false }),
    ]);

    if (guestError) {
      return NextResponse.json({ success: false, error: guestError.message }, { status: 500 });
    }
    if (!guest) {
      return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
    }
    if (primaryError) {
      return NextResponse.json({ success: false, error: primaryError.message }, { status: 500 });
    }
    if (accompanyingError) {
      return NextResponse.json({ success: false, error: accompanyingError.message }, { status: 500 });
    }
    if (legacyStaysError && !isMissingRelationError(legacyStaysError, "legacy_stays")) {
      return NextResponse.json({ success: false, error: legacyStaysError.message }, { status: 500 });
    }

    const reservationSnapshotMap = new Map<string, ReservationSnapshot>();
    for (const row of (primaryReservations ?? []) as any[]) {
      reservationSnapshotMap.set(String(row.id), {
        ...(row as any),
        id: String(row.id),
        total_price: Number(row.total_price ?? 0),
      });
    }

    const accompanyingRows = (accompanyingLinks ?? [])
      .map((row: any) => {
        const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
        if (!reservation?.id) return null;
        const normalized = {
          ...(reservation as any),
          id: String(reservation.id),
          total_price: Number(reservation.total_price ?? 0),
        } as ReservationSnapshot;
        if (!reservationSnapshotMap.has(normalized.id)) {
          reservationSnapshotMap.set(normalized.id, normalized);
        }
        return {
          reservation_id: normalized.id,
          role: row.role,
          display_order: Number(row.display_order ?? 0),
          created_at: row.created_at ?? null,
        };
      })
      .filter(Boolean) as Array<{
      reservation_id: string;
      role: string;
      display_order: number;
      created_at: string | null;
    }>;

    const reservationIds = Array.from(reservationSnapshotMap.keys());

    const [nightsRes, transferRes, tipRes, posRes, partyRes] = await Promise.all([
      reservationIds.length > 0
        ? supabase
            .from("reservation_nights")
            .select("reservation_id, stay_date, rooms:room_id(room_number)")
            .in("reservation_id", reservationIds)
            .is("cancelled_at", null)
        : Promise.resolve({ data: [], error: null } as any),
      reservationIds.length > 0
        ? supabase
            .from("transfer_transactions")
            .select("reservation_id, tx_type, amount")
            .in("reservation_id", reservationIds)
        : Promise.resolve({ data: [], error: null } as any),
      reservationIds.length > 0
        ? supabase
            .from("tip_ledger")
            .select("reservation_id, amount, status")
            .in("reservation_id", reservationIds)
        : Promise.resolve({ data: [], error: null } as any),
      reservationIds.length > 0
        ? supabase
            .from("pos_orders")
            .select("reservation_id, total, status")
            .in("reservation_id", reservationIds)
        : Promise.resolve({ data: [], error: null } as any),
      reservationIds.length > 0
        ? supabase
            .from("reservation_guests")
            .select(
              `
                reservation_id,
                guest_profile_id,
                role,
                display_order,
                guest_profiles(
                  id,
                  first_name,
                  last_name,
                  profile_status
                )
              `
            )
            .in("reservation_id", reservationIds)
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (nightsRes.error) {
      return NextResponse.json({ success: false, error: nightsRes.error.message }, { status: 500 });
    }
    if (transferRes.error) {
      return NextResponse.json({ success: false, error: transferRes.error.message }, { status: 500 });
    }
    if (tipRes.error) {
      return NextResponse.json({ success: false, error: tipRes.error.message }, { status: 500 });
    }
    if (posRes.error) {
      return NextResponse.json({ success: false, error: posRes.error.message }, { status: 500 });
    }
    if (partyRes.error) {
      return NextResponse.json({ success: false, error: partyRes.error.message }, { status: 500 });
    }

    const roomByReservation = new Map<string, string | null>();
    for (const row of (nightsRes.data ?? []) as any[]) {
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId || roomByReservation.has(reservationId)) continue;
      const room = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
      roomByReservation.set(reservationId, room?.room_number ? String(room.room_number) : null);
    }

    const transferByReservation = new Map<string, number>();
    for (const row of (transferRes.data ?? []) as any[]) {
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId) continue;
      const amount = Number(row.amount ?? 0);
      const signedAmount = row.tx_type === "refund" ? -amount : amount;
      transferByReservation.set(
        reservationId,
        round2((transferByReservation.get(reservationId) ?? 0) + signedAmount)
      );
    }

    const tipByReservation = new Map<string, number>();
    for (const row of (tipRes.data ?? []) as any[]) {
      if (row.status === "reversed") continue;
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId) continue;
      tipByReservation.set(
        reservationId,
        round2((tipByReservation.get(reservationId) ?? 0) + Number(row.amount ?? 0))
      );
    }

    const posByReservation = new Map<string, number>();
    for (const row of (posRes.data ?? []) as any[]) {
      if (row.status === "voided") continue;
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId) continue;
      posByReservation.set(
        reservationId,
        round2((posByReservation.get(reservationId) ?? 0) + Number(row.total ?? 0))
      );
    }

    const partyByReservation = new Map<string, Array<{
      guest_profile_id: string;
      full_name: string;
      role: "primary" | "accompanying";
      display_order: number;
      profile_status: string | null;
    }>>();

    for (const row of (partyRes.data ?? []) as any[]) {
      const reservationId = String(row.reservation_id ?? "");
      if (!reservationId) continue;
      const profile = Array.isArray(row.guest_profiles) ? row.guest_profiles[0] : row.guest_profiles;
      const current = partyByReservation.get(reservationId) ?? [];
      current.push({
        guest_profile_id: String(row.guest_profile_id),
        full_name: fullNameFromProfile(profile),
        role: row.role === "primary" ? "primary" : "accompanying",
        display_order: Number(row.display_order ?? 0),
        profile_status: profile?.profile_status ?? null,
      });
      partyByReservation.set(reservationId, current);
    }

    for (const [reservationId, snapshot] of reservationSnapshotMap.entries()) {
      if (!snapshot.guest_profile_id) continue;
      const current = partyByReservation.get(reservationId) ?? [];
      if (!current.some((member) => member.role === "primary")) {
        current.unshift({
          guest_profile_id: String(snapshot.guest_profile_id),
          full_name: String(snapshot.guest_name ?? "Unknown"),
          role: "primary",
          display_order: 1,
          profile_status: null,
        });
        partyByReservation.set(reservationId, current);
      }
    }

    const buildStay = (
      snapshot: ReservationSnapshot,
      role: "primary" | "accompanying",
      displayOrder: number
    ): GuestHistoryStay => {
      const reservationId = snapshot.id;
      const visibleTotal = round2(
        Number(snapshot.total_price ?? 0) +
          (transferByReservation.get(reservationId) ?? 0) +
          (tipByReservation.get(reservationId) ?? 0) +
          (posByReservation.get(reservationId) ?? 0)
      );

      return {
        reservation_id: reservationId,
        booking_code: snapshot.booking_code ?? null,
        guest_name: snapshot.guest_name ?? null,
        room_number: roomByReservation.get(reservationId) ?? null,
        status: snapshot.status ?? null,
        checkin_date: snapshot.checkin_date ?? null,
        checkout_date: snapshot.checkout_date ?? null,
        checked_in_at: snapshot.checked_in_at ?? null,
        checked_out_at: null,
        source: snapshot.source ?? null,
        created_at: snapshot.created_at ?? null,
        total_price: visibleTotal,
        role,
        display_order: displayOrder,
      };
    };

    const primaryStays = sortByCheckinDesc(
      ((primaryReservations ?? []) as any[]).map((row) =>
        buildStay(
          {
            ...(row as any),
            id: String(row.id),
            total_price: Number(row.total_price ?? 0),
          },
          "primary",
          1
        )
      )
    );

    const accompanyingStays = sortByCheckinDesc(
      accompanyingRows
        .map((row) => {
          const snapshot = reservationSnapshotMap.get(row.reservation_id);
          if (!snapshot) return null;
          return buildStay(snapshot, "accompanying", row.display_order);
        })
        .filter(Boolean) as GuestHistoryStay[]
    );

    const travelPartyHistory = sortByCheckinDesc(
      reservationIds
        .map((reservationId) => {
          const snapshot = reservationSnapshotMap.get(reservationId);
          if (!snapshot) return null;

          return {
            reservation_id: reservationId,
            booking_code: snapshot.booking_code ?? null,
            checkin_date: snapshot.checkin_date ?? null,
            checkout_date: snapshot.checkout_date ?? null,
            role: primaryStays.some((row) => row.reservation_id === reservationId)
              ? "primary"
              : "accompanying",
            party: (partyByReservation.get(reservationId) ?? []).sort(
              (a, b) => a.display_order - b.display_order
            ),
          };
        })
        .filter(Boolean) as any[]
    );

    const completedPrimaryStays = primaryStays.filter((row) => row.status === "checked_out");
    const completedAccompanyingStays = accompanyingStays.filter((row) => row.status === "checked_out");

    const totalTransferSpend = round2(
      Array.from(transferByReservation.values()).reduce((sum, value) => sum + value, 0)
    );
    const totalTips = round2(Array.from(tipByReservation.values()).reduce((sum, value) => sum + value, 0));

    const pmsStayMap = new Map<
      string,
      {
        id: string;
        source: "pms";
        date_in: string;
        date_out: string;
        nights: number;
        room_number: string | null;
        status: string;
        notes: string | null;
        source_file: null;
      }
    >();

    for (const row of [...primaryStays, ...accompanyingStays]) {
      if (row.status !== "checked_out") continue;
      if (!row.checkin_date || !row.checkout_date) continue;
      if (pmsStayMap.has(row.reservation_id)) continue;

      const nights =
        typeof row.checkin_date === "string" && typeof row.checkout_date === "string"
          ? Math.max(
              1,
              Math.round(
                (new Date(`${row.checkout_date}T00:00:00Z`).getTime() -
                  new Date(`${row.checkin_date}T00:00:00Z`).getTime()) /
                  (24 * 60 * 60 * 1000)
              )
            )
          : 1;

      pmsStayMap.set(row.reservation_id, {
        id: row.reservation_id,
        source: "pms",
        date_in: row.checkin_date,
        date_out: row.checkout_date,
        nights,
        room_number: row.room_number ?? null,
        status: "checked_out",
        notes: null,
        source_file: null,
      });
    }

    const legacyStays = ((legacyStaysData ?? []) as LegacyStayRow[])
      .filter((row) => !!row.date_in && !!row.date_out)
      .map((row) => ({
        id: String(row.id),
        source: "legacy" as const,
        date_in: String(row.date_in),
        date_out: String(row.date_out),
        nights: Number(row.nights ?? 1),
        room_number: row.room_number ? String(row.room_number) : null,
        status: undefined,
        notes: row.notes ? String(row.notes) : null,
        source_file: row.source_file ? String(row.source_file) : null,
      }));

    const stays = [...Array.from(pmsStayMap.values()), ...legacyStays].sort((a, b) =>
      String(b.date_in).localeCompare(String(a.date_in))
    );
    const totalStays = stays.length;
    const totalNights = stays.reduce((sum, row) => sum + Math.max(0, Number(row.nights || 0)), 0);

    const summaryPrimaryStays = Math.max(
      completedPrimaryStays.length + legacyStays.length,
      Number(guest.stay_count ?? 0),
      Number(guest.main_stay_count ?? 0)
    );
    const summaryPrimaryNights = Math.max(
      totalNights,
      Number(guest.night_count ?? 0),
      Number(guest.main_night_count ?? 0)
    );
    const summaryAccompanyingStays = Math.max(
      completedAccompanyingStays.length,
      Number(guest.accompanying_stay_count ?? 0)
    );
    const summaryAccompanyingNights = Math.max(
      countCompletedStayNights(accompanyingStays),
      Number(guest.accompanying_night_count ?? 0)
    );
    const summaryLegacyNights = Math.max(
      legacyStays.reduce((sum, s) => sum + Math.max(0, Number(s.nights || 0)), 0),
      Number(guest.legacy_night_count ?? 0)
    );

    return NextResponse.json({
      success: true,
      stays,
      total_stays: totalStays,
      total_nights: totalNights,
      guest,
      summary: {
        total_stays: summaryPrimaryStays + summaryAccompanyingStays,
        primary_stay_count: summaryPrimaryStays,
        primary_night_count: summaryPrimaryNights,
        accompanying_stay_count: summaryAccompanyingStays,
        accompanying_night_count: summaryAccompanyingNights,
        legacy_stay_count: legacyStays.length,
        legacy_night_count: summaryLegacyNights,
        total_transfer_spend: totalTransferSpend,
        total_tips: totalTips,
      },
      primary_stays: primaryStays,
      accompanying_stays: accompanyingStays,
      travel_party_history: travelPartyHistory,
      timeline: [],
      unlinked: {
        transfer_transactions: [],
        tips: [],
        commissions: [],
      },
    } satisfies GuestHistoryResponse & {
      guest: typeof guest;
      stays: Array<{
        id: string;
        source: "pms" | "legacy";
        date_in: string;
        date_out: string;
        nights: number;
        room_number: string | null;
        status?: string;
        notes?: string | null;
        source_file?: string | null;
      }>;
      total_stays: number;
      total_nights: number;
      timeline: [];
      unlinked: { transfer_transactions: []; tips: []; commissions: [] };
    });
  } catch (err) {
    console.error("guests/:id/history GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
