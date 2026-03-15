import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function toLocalDate(date: Date, tz = "Asia/Bangkok"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

const METHODS = ["cash", "transfer", "credit_card", "other"] as const;
const CATEGORIES = [
  "room_revenue",
  "pos_revenue",
  "extra_charge",
  "deposit",
  "no_show_fee",
  "dayuse_revenue",
] as const;

type Method = (typeof METHODS)[number];
type Category = (typeof CATEGORIES)[number];

function normalizeMethod(raw: unknown): Method {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "other";
  if (value === "cash") return "cash";
  if (value === "transfer") return "transfer";
  if (value === "credit_card") return "credit_card";
  if (value === "other") return "other";
  if (value.includes("promptpay")) return "transfer";
  if (value.includes("bank transfer")) return "transfer";
  if (value.includes("transfer")) return "transfer";
  if (value.includes("credit")) return "credit_card";
  if (value.includes("card")) return "credit_card";
  if (value.includes("cash")) return "cash";
  return "other";
}

function isDepositRefundNote(rawNote: unknown): boolean {
  const note = String(rawNote ?? "").toLowerCase();
  return note.includes("deposit") && note.includes("refund");
}

export async function GET(request: NextRequest) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const { searchParams } = new URL(request.url);

    const { data: settings } = await supabase
      .from("hotel_settings")
      .select("hotel_timezone")
      .eq("id", 1)
      .maybeSingle();

    const tz = (settings?.hotel_timezone as string) ?? "Asia/Bangkok";
    const today = toLocalDate(new Date(), tz);

    const startDate = searchParams.get("start") ?? today;
    const endDate = searchParams.get("end") ?? today;

    const { data: rows, error } = await supabase
      .from("folio_payments")
      .select("id, reservation_id, paid_date, paid_at, method, tx_type, amount, note, revenue_category, cashier_name")
      .gte("paid_date", startDate)
      .lte("paid_date", endDate)
      .order("paid_date", { ascending: true })
      .order("paid_at", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const byMethod: Record<
      Method,
      { method: Method; total: number; deposits: number; refunds: number; net: number; count: number }
    > = {
      cash: { method: "cash", total: 0, deposits: 0, refunds: 0, net: 0, count: 0 },
      transfer: { method: "transfer", total: 0, deposits: 0, refunds: 0, net: 0, count: 0 },
      credit_card: { method: "credit_card", total: 0, deposits: 0, refunds: 0, net: 0, count: 0 },
      other: { method: "other", total: 0, deposits: 0, refunds: 0, net: 0, count: 0 },
    };

    const byCategory: Record<Category, { category: Category; inflow: number; refunds: number; net: number }> = {
      room_revenue: { category: "room_revenue", inflow: 0, refunds: 0, net: 0 },
      pos_revenue: { category: "pos_revenue", inflow: 0, refunds: 0, net: 0 },
      extra_charge: { category: "extra_charge", inflow: 0, refunds: 0, net: 0 },
      deposit: { category: "deposit", inflow: 0, refunds: 0, net: 0 },
      no_show_fee: { category: "no_show_fee", inflow: 0, refunds: 0, net: 0 },
      dayuse_revenue: { category: "dayuse_revenue", inflow: 0, refunds: 0, net: 0 },
    };

    const byDayMap: Record<
      string,
      {
        date: string;
        cash: number;
        transfer: number;
        credit_card: number;
        other: number;
        total_inflow: number;
        refunds: number;
        net: number;
        tx_count: number;
      }
    > = {};

    let grandTotal = 0;
    let grandRefunds = 0;

    const depositRowsByReservation = new Map<
      string,
      Array<{ method: Method; amount: number; tx_type: string; paid_date: string }>
    >();
    function ensureDay(date: string) {
      if (!byDayMap[date]) {
        byDayMap[date] = {
          date,
          cash: 0,
          transfer: 0,
          credit_card: 0,
          other: 0,
          total_inflow: 0,
          refunds: 0,
          net: 0,
          tx_count: 0,
        };
      }
      return byDayMap[date];
    }

    function applyMovement(params: {
      method: Method;
      category: Category;
      txType: string;
      amount: number;
      date: string;
      reservationId?: string | null;
    }) {
      const { method, category, txType, amount, date, reservationId } = params;
      const day = ensureDay(date);

      byMethod[method].count += 1;
      day.tx_count += 1;

      if (txType === "refund") {
        byMethod[method].refunds += amount;
        byCategory[category].refunds += amount;
        day.refunds += amount;
        day.net -= amount;
        grandRefunds += amount;
      } else if (txType === "deposit") {
        byMethod[method].deposits += amount;
        byCategory[category].inflow += amount;
        day[method] += amount;
        day.total_inflow += amount;
        day.net += amount;
        grandTotal += amount;
      } else {
        byMethod[method].total += amount;
        byCategory[category].inflow += amount;
        day[method] += amount;
        day.total_inflow += amount;
        day.net += amount;
        grandTotal += amount;
      }

      if (category === "deposit" && reservationId) {
        const current = depositRowsByReservation.get(reservationId) ?? [];
        current.push({
          method,
          amount,
          tx_type: txType,
          paid_date: date,
        });
        depositRowsByReservation.set(reservationId, current);
      }
    }

    for (const row of rows ?? []) {
      const method = normalizeMethod(row.method);
      const txType = String(row.tx_type ?? "payment");
      const amount = Number(row.amount ?? 0);
      const date = String(row.paid_date ?? startDate);
      const reservationId = row.reservation_id ? String(row.reservation_id) : null;

      let category: Category = CATEGORIES.includes(row.revenue_category as Category)
        ? (row.revenue_category as Category)
        : "room_revenue";
      if (txType === "refund" && category !== "deposit" && isDepositRefundNote(row.note)) {
        category = "deposit";
      }

      applyMovement({
        method,
        category,
        txType,
        amount,
        date,
        reservationId,
      });
    }

    for (const method of METHODS) {
      byMethod[method].net = Number((byMethod[method].total + byMethod[method].deposits - byMethod[method].refunds).toFixed(2));
    }
    for (const category of CATEGORIES) {
      byCategory[category].net = Number((byCategory[category].inflow - byCategory[category].refunds).toFixed(2));
    }

    const byDay = Object.values(byDayMap)
      .map((row) => ({
        ...row,
        cash: Number(row.cash.toFixed(2)),
        transfer: Number(row.transfer.toFixed(2)),
        credit_card: Number(row.credit_card.toFixed(2)),
        other: Number(row.other.toFixed(2)),
        total_inflow: Number(row.total_inflow.toFixed(2)),
        refunds: Number(row.refunds.toFixed(2)),
        net: Number(row.net.toFixed(2)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const byMethodSummary = METHODS.map((method) => {
      const row = byMethod[method];
      const gross = row.total + row.deposits;
      const sharePct = grandTotal > 0 ? Number(((gross / grandTotal) * 100).toFixed(1)) : 0;
      return {
        ...row,
        total: Number(row.total.toFixed(2)),
        deposits: Number(row.deposits.toFixed(2)),
        refunds: Number(row.refunds.toFixed(2)),
        net: Number(row.net.toFixed(2)),
        share_pct: sharePct,
      };
    });

    const byCategorySummary = CATEGORIES.map((category) => {
      const row = byCategory[category];
      return {
        category,
        inflow: Number(row.inflow.toFixed(2)),
        refunds: Number(row.refunds.toFixed(2)),
        net: Number(row.net.toFixed(2)),
      };
    });

    const depositMethodMismatches: Array<{
      reservation_id: string;
      deposit_method: string;
      refund_method: string;
      deposit_amount: number;
      refund_amount: number;
      deposit_date: string;
      refund_date: string;
      note: string;
    }> = [];

    for (const [reservationId, items] of depositRowsByReservation.entries()) {
      const deposits = items.filter((item) => item.tx_type === "deposit");
      const refunds = items.filter((item) => item.tx_type === "refund");
      for (const deposit of deposits) {
        for (const refund of refunds) {
          if (deposit.method === refund.method) continue;
          depositMethodMismatches.push({
            reservation_id: reservationId,
            deposit_method: deposit.method,
            refund_method: refund.method,
            deposit_amount: Number(deposit.amount.toFixed(2)),
            refund_amount: Number(refund.amount.toFixed(2)),
            deposit_date: deposit.paid_date,
            refund_date: refund.paid_date,
            note: `Deposit via ${deposit.method} but refunded via ${refund.method}`,
          });
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        start_date: startDate,
        end_date: endDate,
        summary: {
          grand_total: Number(grandTotal.toFixed(2)),
          grand_refunds: Number(grandRefunds.toFixed(2)),
          net_total: Number((grandTotal - grandRefunds).toFixed(2)),
          tx_count: (rows ?? []).length,
        },
        by_method: byMethodSummary,
        by_category: byCategorySummary,
        by_day: byDay,
        deposit_method_mismatches: depositMethodMismatches,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("api/payments/report GET failed", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
