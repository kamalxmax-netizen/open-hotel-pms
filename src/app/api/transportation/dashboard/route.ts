import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  date: z.string().regex(dateRegex, "date must be YYYY-MM-DD").optional(),
});

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pickupDateInBangkok(pickupIso: string): string {
  const date = new Date(pickupIso);
  if (Number.isNaN(date.getTime())) return pickupIso.slice(0, 10);
  return toBangkokDateString(date);
}

type ReservationNightRoom = {
  stay_date: string;
  room_number: string | null;
};

function resolveRoomNumberForDate(
  nights: ReservationNightRoom[] | undefined,
  targetDate: string
): string | null {
  if (!nights || nights.length === 0) return null;

  let exact: string | null = null;
  let latest: ReservationNightRoom | null = null;

  for (const night of nights) {
    if (night.stay_date === targetDate && night.room_number) {
      exact = night.room_number;
      break;
    }
    if (night.stay_date <= targetDate) {
      if (!latest || night.stay_date > latest.stay_date) {
        latest = night;
      }
    }
  }

  if (exact) return exact;
  return latest?.room_number ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      date: request.nextUrl.searchParams.get("date") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const date = parsedQuery.data.date ?? toBangkokDateString();
    const nextDate = addDays(date, 1);
    const supabase = createServerSupabaseClient();
    const { data: closedSnapshot, error: closedSnapshotError } = await supabase
      .from("daily_snapshots")
      .select("business_date")
      .gte("business_date", date)
      .order("business_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (closedSnapshotError) {
      return NextResponse.json({ success: false, error: closedSnapshotError.message }, { status: 500 });
    }
    const isBusinessDayClosed = Boolean(closedSnapshot?.business_date);

    const { data: transfers, error } = await supabase
      .from("transfers")
      .select(`
        id,
        reservation_id,
        guest_name,
        guest_phone,
        transfer_type,
        service_mode,
        pickup_datetime,
        pickup_location,
        dropoff_location,
        pax,
        luggage_count,
        driver_id,
        vehicle_id,
        boat_company_id,
        selling_price,
        cost_price,
        actual_price,
        net_commission,
        payment_status,
        payment_method,
        status,
        staff_note,
        guest_note
      `)
      .gte("pickup_datetime", `${date}T00:00:00+07:00`)
      .lt("pickup_datetime", `${nextDate}T00:00:00+07:00`)
      .order("pickup_datetime", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const all = (transfers ?? []) as any[];
    const summary = {
      total: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      confirmed: all.filter((t) => t.status === "confirmed").length,
      driver_assigned: all.filter((t) => t.status === "driver_assigned").length,
      in_progress: all.filter((t) => t.status === "in_progress").length,
      completed: all.filter((t) => t.status === "completed").length,
      cancelled: all.filter((t) => t.status === "cancelled").length,
      no_show: all.filter((t) => t.status === "no_show").length,
    };

    const activeTransfers = all.filter((t) => t.status !== "cancelled");
    const revenue = {
      total_selling: activeTransfers.reduce((sum, t) => sum + Number(t.selling_price ?? 0), 0),
      total_cost: activeTransfers.reduce((sum, t) => sum + Number(t.cost_price ?? 0), 0),
      total_commission: activeTransfers.reduce((sum, t) => sum + Number(t.net_commission ?? 0), 0),
    };

    const driverIds = Array.from(new Set(all.map((t) => t.driver_id).filter((id): id is string => Boolean(id))));
    const companyIds = Array.from(new Set(all.map((t) => t.boat_company_id).filter((id): id is string => Boolean(id))));
    const reservationIds = Array.from(new Set(all.map((t) => t.reservation_id).filter((id): id is string => Boolean(id))));

    const driverMap = new Map<string, { name: string; phone: string | null }>();
    const companyMap = new Map<string, string>();
    const bookingCodeMap = new Map<string, string>();
    const reservationNightsByReservation = new Map<string, ReservationNightRoom[]>();

    if (driverIds.length > 0) {
      const { data: drivers, error: driversError } = await supabase
        .from("drivers")
        .select("id, name, phone")
        .in("id", driverIds);
      if (driversError) return NextResponse.json({ success: false, error: driversError.message }, { status: 500 });
      for (const row of drivers ?? []) {
        driverMap.set(String(row.id), { name: String(row.name), phone: row.phone ?? null });
      }
    }

    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await supabase
        .from("boat_companies")
        .select("id, name")
        .in("id", companyIds);
      if (companiesError) return NextResponse.json({ success: false, error: companiesError.message }, { status: 500 });
      for (const row of companies ?? []) {
        companyMap.set(String(row.id), String(row.name));
      }
    }

    if (reservationIds.length > 0) {
      const { data: reservations, error: reservationsError } = await supabase
        .from("reservations")
        .select("id, booking_code")
        .in("id", reservationIds);
      if (reservationsError) {
        return NextResponse.json({ success: false, error: reservationsError.message }, { status: 500 });
      }
      for (const row of reservations ?? []) {
        bookingCodeMap.set(String(row.id), String(row.booking_code));
      }

      const { data: nights, error: nightsError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, stay_date, rooms:room_id(room_number)")
        .in("reservation_id", reservationIds)
        .lte("stay_date", date)
        .is("cancelled_at", null);
      if (nightsError) {
        return NextResponse.json({ success: false, error: nightsError.message }, { status: 500 });
      }
      for (const row of (nights ?? []) as any[]) {
        const reservationId = String(row.reservation_id);
        const roomRef = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
        const entry: ReservationNightRoom = {
          stay_date: String(row.stay_date),
          room_number: roomRef?.room_number ? String(roomRef.room_number) : null,
        };
        const existing = reservationNightsByReservation.get(reservationId);
        if (existing) existing.push(entry);
        else reservationNightsByReservation.set(reservationId, [entry]);
      }
    }

    const enriched = all.map((transfer) => {
      const driver = transfer.driver_id ? driverMap.get(String(transfer.driver_id)) : null;
      const pickupDate = pickupDateInBangkok(String(transfer.pickup_datetime));
      return {
        ...transfer,
        driver_name: driver?.name ?? null,
        driver_phone: driver?.phone ?? null,
        boat_company_name: transfer.boat_company_id ? (companyMap.get(String(transfer.boat_company_id)) ?? null) : null,
        booking_code: bookingCodeMap.get(String(transfer.reservation_id)) ?? null,
        is_business_day_closed: isBusinessDayClosed,
        room_number: resolveRoomNumberForDate(
          reservationNightsByReservation.get(String(transfer.reservation_id)),
          pickupDate
        ),
      };
    });

    return NextResponse.json({
      success: true,
      date,
      summary,
      revenue,
      transfers: enriched,
    });
  } catch (err) {
    console.error("transportation/dashboard GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
