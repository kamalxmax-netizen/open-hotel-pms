import {
  assertBusinessDayOpen,
  computeFeeSummary,
  fetchExtraFeeTemplate,
  insertExtraFeePayment,
  normalizeOperatorPaymentMethod,
  resolveBusinessDate,
} from "@/lib/folio-fees";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type RouteParams = { params: { id: string } };

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function isMissingRpc(error: { code?: string | null; message?: string | null } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42883" ||
    message.includes("could not find the function") ||
    message.includes("schema cache")
  );
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  noStore();
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, total_price, deposit_amount")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("folio_payments")
      .select(`
        id,
        tx_type,
        method,
        amount,
        note,
        paid_at,
        paid_date,
        created_at,
        revenue_category,
        fee_template_code,
        is_record_only,
        extra_fee_templates(code, name, icon, category)
      `)
      .eq("reservation_id", reservationId)
      .eq("revenue_category", "extra_charge")
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const charges = data ?? [];
    const { data: allPaymentRows, error: allPaymentsError } = await supabase
      .from("folio_payments")
      .select(`
        id,
        tx_type,
        method,
        amount,
        note,
        paid_at,
        paid_date,
        created_at,
        revenue_category,
        fee_template_code,
        is_record_only,
        extra_fee_templates(code, name, icon, category)
      `)
      .eq("reservation_id", reservationId)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (allPaymentsError) {
      return NextResponse.json({ error: allPaymentsError.message }, { status: 500 });
    }

    const summary = computeFeeSummary(
      Number(reservation.total_price ?? 0),
      Number(reservation.deposit_amount ?? 0),
      (allPaymentRows ?? []) as any[]
    );

    return NextResponse.json({
      success: true,
      reservation_id: reservationId,
      charges,
      summary,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const reservationId = params.id;
    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const feeTemplateCode = String(body.fee_template_code ?? "").trim().toUpperCase();
    const amount = toNumber(body.amount);
    const paymentMethodRaw = String(body.payment_method ?? "").trim().toLowerCase();
    const isDepositMethod = paymentMethodRaw === "deposit";
    const method = normalizeOperatorPaymentMethod(paymentMethodRaw);
    const note = typeof body.note === "string" ? body.note : null;

    if (!feeTemplateCode) {
      return NextResponse.json({ error: "fee_template_code is required." }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be > 0." }, { status: 400 });
    }
    if (!isDepositMethod && !method) {
      return NextResponse.json({ error: "Invalid payment_method." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, total_price, deposit_amount")
      .eq("id", reservationId)
      .maybeSingle();

    if (reservationError) {
      return NextResponse.json({ error: reservationError.message }, { status: 500 });
    }
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const template = await fetchExtraFeeTemplate(supabase, feeTemplateCode);
    if (!template) {
      return NextResponse.json({ error: "Fee template not found." }, { status: 404 });
    }
    if (!template.is_active) {
      return NextResponse.json({ error: "Fee template is inactive." }, { status: 409 });
    }

    const businessDate = await resolveBusinessDate(supabase);
    try {
      await assertBusinessDayOpen(supabase, businessDate);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Business day already closed.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    let payment: unknown = null;
    let depositSettlement: unknown = null;
    if (isDepositMethod) {
      const { data: rpcData, error: rpcError } = await supabase.rpc("post_extra_charge_with_deposit_v1", {
        p_reservation_id: reservationId,
        p_fee_template_code: template.code,
        p_amount: amount,
        p_note: note?.trim() || null,
        p_cashier_name: "FO",
      });

      if (rpcError) {
        if (isMissingRpc(rpcError)) {
          return NextResponse.json(
            {
              error:
                "Run migration 20260313_phase29_extra_charge_deposit_settlement.sql before using Deposit in Post Charge.",
            },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: rpcError.message || "Failed to apply deposit settlement." }, { status: 500 });
      }

      depositSettlement = rpcData ?? null;
    } else {
      const operatorMethod = method as "cash" | "transfer" | "credit_card";
      payment = await insertExtraFeePayment(supabase, {
        reservationId,
        feeTemplateCode: template.code,
        amount,
        method: operatorMethod,
        note,
        paidDate: businessDate,
      });
    }

    const { data: paymentRows, error: paymentsError } = await supabase
      .from("folio_payments")
      .select(`
        id,
        tx_type,
        method,
        amount,
        note,
        paid_at,
        paid_date,
        created_at,
        revenue_category,
        fee_template_code,
        is_record_only,
        extra_fee_templates(code, name, icon, category)
      `)
      .eq("reservation_id", reservationId)
      .order("paid_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (paymentsError) {
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    const refreshedReservation = await supabase
      .from("reservations")
      .select("total_price, deposit_amount")
      .eq("id", reservationId)
      .maybeSingle();

    const summary = computeFeeSummary(
      Number(refreshedReservation.data?.total_price ?? reservation.total_price ?? 0),
      Number(refreshedReservation.data?.deposit_amount ?? reservation.deposit_amount ?? 0),
      (paymentRows ?? []) as any[]
    );

    return NextResponse.json({
      success: true,
      charge: payment,
      deposit_settlement: depositSettlement,
      summary,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
