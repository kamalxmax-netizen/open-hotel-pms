import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { GuestHistoryResponse, GuestHistoryStay } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

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

export async function GET(_request: NextRequest, { params }: RouteParams) {
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
    ] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select("id, first_name, last_name, email, phone, nationality")
        .eq("id", guestProfileId)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select(reservationSelect)
        .eq("guest_profile_id", guestProfileId)
        .in("status", ["checked_out", "cancelled"])
        .order("checkin_date", { ascending: false }),
      supabase
        .from("reservation_guests")
        .select(
          `reservation_id, role, display_order, created_at, reservations!inner(${reservationSelect})`
        )
        .eq("guest_profile_id", guestProfileId)
        .eq("role", "accompanying")
        .in("reservations.status", ["checked_out", "cancelled"])
        .order("created_at", { ascending: false }),
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

    return NextResponse.json({
      success: true,
      guest,
      summary: {
        total_stays: completedPrimaryStays.length,
        primary_stay_count: completedPrimaryStays.length,
        accompanying_stay_count: completedAccompanyingStays.length,
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
      timeline: [];
      unlinked: { transfer_transactions: []; tips: []; commissions: [] };
    });
  } catch (err) {
    console.error("guests/:id/history GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
