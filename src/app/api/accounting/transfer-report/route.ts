import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  date_from: z.string().regex(dateRegex, "date_from must be YYYY-MM-DD").optional(),
  date_to: z.string().regex(dateRegex, "date_to must be YYYY-MM-DD").optional(),
  route_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  driver_name: z.string().trim().max(120).optional(),
  payment_status: z.enum(["unpaid", "paid_to_hotel", "paid_to_driver", "settled"]).optional(),
});

type ReservationNightRoom = {
  stay_date: string;
  room_number: string | null;
};

type LedgerAgg = {
  selling: number;
  cost: number;
  margin: number;
};

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

function resolveRoomNumberForDate(nights: ReservationNightRoom[] | undefined, targetDate: string): string | null {
  if (!nights || nights.length === 0) return null;
  const exact = nights.find((night) => night.stay_date === targetDate && night.room_number);
  if (exact?.room_number) return exact.room_number;

  let latest: ReservationNightRoom | null = null;
  for (const night of nights) {
    if (night.stay_date <= targetDate && (!latest || night.stay_date > latest.stay_date)) {
      latest = night;
    }
  }
  return latest?.room_number ?? null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      route_id: request.nextUrl.searchParams.get("route_id") ?? undefined,
      company_id: request.nextUrl.searchParams.get("company_id") ?? undefined,
      driver_name: request.nextUrl.searchParams.get("driver_name") ?? undefined,
      payment_status: request.nextUrl.searchParams.get("payment_status") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;
    const today = toBangkokDateString();
    const dateFrom = parsed.data.date_from ?? today;
    const dateTo = parsed.data.date_to ?? today;

    let query = supabase
      .from("transfers")
      .select("*")
      .gte("pickup_datetime", `${dateFrom}T00:00:00+07:00`)
      .lt("pickup_datetime", `${addDays(dateTo, 1)}T00:00:00+07:00`)
      .order("pickup_datetime", { ascending: true });

    if (parsed.data.route_id) query = query.eq("boat_route_id", parsed.data.route_id);
    if (parsed.data.company_id) query = query.eq("boat_company_id", parsed.data.company_id);
    if (parsed.data.payment_status) query = query.eq("payment_status", parsed.data.payment_status);

    const { data: transferRows, error: transferError } = await query;
    if (transferError) {
      return NextResponse.json({ success: false, error: transferError.message }, { status: 500 });
    }

    const transfers = (transferRows ?? []) as Array<Record<string, unknown>>;
    if (transfers.length === 0) {
      return NextResponse.json({
        success: true,
        kpis: {
          gross_sell: 0,
          total_cost: 0,
          gross_margin: 0,
          commission_payable: 0,
          net_margin: 0,
        },
        transfers: [],
      });
    }

    const transferIds = transfers.map((row) => String(row.id));
    const reservationIds = Array.from(
      new Set(transfers.map((row) => String(row.reservation_id ?? "")).filter(Boolean))
    );
    const driverIds = Array.from(new Set(transfers.map((row) => String(row.driver_id ?? "")).filter(Boolean)));

    const bookingCodeByReservation = new Map<string, string>();
    if (reservationIds.length > 0) {
      const { data: reservations, error: reservationError } = await supabase
        .from("reservations")
        .select("id, booking_code")
        .in("id", reservationIds);
      if (reservationError) {
        return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
      }
      for (const row of reservations ?? []) {
        bookingCodeByReservation.set(String(row.id), String(row.booking_code ?? ""));
      }
    }

    const nightsByReservation = new Map<string, ReservationNightRoom[]>();
    if (reservationIds.length > 0) {
      const { data: nights, error: nightsError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, stay_date, rooms:room_id(room_number)")
        .in("reservation_id", reservationIds)
        .lte("stay_date", dateTo)
        .is("cancelled_at", null);
      if (nightsError) {
        return NextResponse.json({ success: false, error: nightsError.message }, { status: 500 });
      }

      for (const row of (nights ?? []) as any[]) {
        const reservationId = String(row.reservation_id ?? "");
        if (!reservationId) continue;
        const roomRef = Array.isArray(row.rooms) ? row.rooms[0] : row.rooms;
        const next: ReservationNightRoom = {
          stay_date: String(row.stay_date ?? ""),
          room_number: roomRef?.room_number ? String(roomRef.room_number) : null,
        };
        const current = nightsByReservation.get(reservationId);
        if (current) current.push(next);
        else nightsByReservation.set(reservationId, [next]);
      }
    }

    const driverById = new Map<string, string>();
    if (driverIds.length > 0) {
      const { data: drivers, error: driverError } = await supabase
        .from("drivers")
        .select("id, name")
        .in("id", driverIds);
      if (driverError) {
        return NextResponse.json({ success: false, error: driverError.message }, { status: 500 });
      }
      for (const row of drivers ?? []) {
        driverById.set(String(row.id), String(row.name ?? ""));
      }
    }

    const commissionByTransfer = new Map<string, { amount: number; status: string }>();
    if (transferIds.length > 0) {
      const { data: commissions, error: commissionError } = await supabase
        .from("commission_ledger")
        .select("transfer_id, commission_amount, status")
        .in("transfer_id", transferIds);
      if (commissionError) {
        return NextResponse.json({ success: false, error: commissionError.message }, { status: 500 });
      }
      for (const row of commissions ?? []) {
        commissionByTransfer.set(String(row.transfer_id), {
          amount: Number(row.commission_amount ?? 0),
          status: String(row.status ?? "pending"),
        });
      }
    }

    const transferLedger = new Map<string, LedgerAgg>();
    if (transferIds.length > 0) {
      const { data: txRows, error: txError } = await supabase
        .from("transfer_transactions")
        .select("transfer_id, tx_type, amount, selling_price, cost_price, margin")
        .in("transfer_id", transferIds);
      if (txError) {
        return NextResponse.json({ success: false, error: txError.message }, { status: 500 });
      }
      for (const row of txRows ?? []) {
        const transferId = String(row.transfer_id ?? "");
        if (!transferId) continue;
        const sign = row.tx_type === "refund" ? -1 : 1;
        const amount = Number(row.amount ?? 0);
        const selling = Number(row.selling_price ?? amount);
        const cost = Number(row.cost_price ?? 0);
        const margin = Number(row.margin ?? (selling - cost));
        const existing = transferLedger.get(transferId) ?? { selling: 0, cost: 0, margin: 0 };
        existing.selling += sign * selling;
        existing.cost += sign * cost;
        existing.margin += sign * margin;
        transferLedger.set(transferId, existing);
      }
    }

    const requestedDriverName = parsed.data.driver_name?.toLowerCase() ?? null;
    const list = transfers
      .map((row) => {
        const transferId = String(row.id);
        const reservationId = String(row.reservation_id ?? "");
        const pickupDate = pickupDateInBangkok(String(row.pickup_datetime ?? ""));
        const ledger = transferLedger.get(transferId) ?? { selling: 0, cost: 0, margin: 0 };
        const sellingPrice = roundMoney(ledger.selling);
        const costPrice = roundMoney(ledger.cost);
        const margin = roundMoney(ledger.margin);
        const commission = commissionByTransfer.get(transferId);
        const commissionAmount = commission && commission.status !== "reversed" ? Number(commission.amount) : 0;
        const net = roundMoney(margin - commissionAmount);
        const driverName = row.driver_id ? driverById.get(String(row.driver_id)) ?? null : null;

        return {
          transfer_id: transferId,
          guest_name: String(row.guest_name ?? ""),
          booking_code: bookingCodeByReservation.get(reservationId) ?? null,
          room_number: resolveRoomNumberForDate(nightsByReservation.get(reservationId), pickupDate),
          route: `${String(row.pickup_location ?? "")} → ${String(row.dropoff_location ?? "")}`,
          selling_price: sellingPrice,
          cost_price: costPrice,
          margin,
          commission: roundMoney(commissionAmount),
          net,
          status: String(row.status ?? ""),
          payment_status: String(row.payment_status ?? ""),
          date: pickupDate,
          driver_name: driverName,
        };
      })
      .filter((item) => {
        if (!requestedDriverName) return true;
        return String(item.driver_name ?? "").toLowerCase().includes(requestedDriverName);
      });

    const grossSell = list.reduce((sum, row) => sum + row.selling_price, 0);
    const totalCost = list.reduce((sum, row) => sum + row.cost_price, 0);
    const grossMargin = roundMoney(grossSell - totalCost);
    const commissionPayable = list.reduce((sum, row) => sum + row.commission, 0);
    const netMargin = roundMoney(grossMargin - commissionPayable);

    return NextResponse.json({
      success: true,
      kpis: {
        gross_sell: roundMoney(grossSell),
        total_cost: roundMoney(totalCost),
        gross_margin: grossMargin,
        commission_payable: roundMoney(commissionPayable),
        net_margin: netMargin,
      },
      transfers: list,
    });
  } catch (err) {
    console.error("api/accounting/transfer-report GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
