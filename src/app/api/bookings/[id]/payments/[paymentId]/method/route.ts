import { assertBusinessDayOpen, normalizeOperatorPaymentMethod, resolveBusinessDate } from "@/lib/folio-fees";
import { requireStaffAuth } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RouteParams = { params: { id: string; paymentId: string } };

const bodySchema = z.object({
  method: z.enum(["cash", "transfer", "credit_card"]),
  reason: z.string().trim().min(3).max(240),
  reference_note: z.string().trim().max(240).optional().nullable(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const reservationId = String(params.id ?? "").trim();
    const paymentId = String(params.paymentId ?? "").trim();
    if (!reservationId || !paymentId) {
      return NextResponse.json({ success: false, error: "Missing reservation or payment id." }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid payload." }, { status: 400 });
    }

    const nextMethod = normalizeOperatorPaymentMethod(parsed.data.method);
    if (!nextMethod) {
      return NextResponse.json({ success: false, error: "Invalid method." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: ["admin", "supervisor", "frontdesk"],
    });
    if (auth.error) return auth.error;

    const businessDate = await resolveBusinessDate(supabase);
    try {
      await assertBusinessDayOpen(supabase, businessDate);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Business day already closed.";
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabase
      .from("folio_payments")
      .select(`
        id,
        reservation_id,
        tx_type,
        method,
        amount,
        note,
        paid_date,
        paid_at,
        revenue_category,
        cashier_name,
        is_record_only,
        is_void_reversal,
        void_of,
        is_correction,
        correction_ref,
        correction_reason
      `)
      .eq("id", paymentId)
      .eq("reservation_id", reservationId)
      .maybeSingle();

    if (rowError) {
      return NextResponse.json({ success: false, error: rowError.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ success: false, error: "Payment row not found." }, { status: 404 });
    }

    if (String(row.paid_date ?? "") !== businessDate) {
      return NextResponse.json(
        { success: false, error: "Only current business date payments can be edited." },
        { status: 409 }
      );
    }

    const txType = String(row.tx_type ?? "");
    if (txType !== "payment" && txType !== "deposit") {
      return NextResponse.json(
        { success: false, error: "Only payment or deposit method can be edited from folio." },
        { status: 409 }
      );
    }

    if (
      row.is_record_only === true ||
      row.is_void_reversal === true ||
      row.is_correction === true ||
      row.void_of ||
      row.correction_ref
    ) {
      return NextResponse.json(
        { success: false, error: "This payment row cannot be edited. Use correction workflow." },
        { status: 409 }
      );
    }

    const previousMethod = normalizeOperatorPaymentMethod(row.method);
    if (!previousMethod) {
      return NextResponse.json(
        { success: false, error: "Existing payment method is not editable from folio." },
        { status: 409 }
      );
    }

    const referenceNoteProvided = parsed.data.reference_note !== undefined;
    const previousNote = typeof row.note === "string" && row.note.trim()
      ? row.note.trim()
      : null;
    const nextNote = referenceNoteProvided && typeof parsed.data.reference_note === "string" && parsed.data.reference_note.trim()
      ? parsed.data.reference_note.trim()
      : referenceNoteProvided
        ? null
        : previousNote;
    const methodChanged = previousMethod !== nextMethod;
    const noteChanged = referenceNoteProvided && previousNote !== nextNote;

    if (!methodChanged && !noteChanged) {
      return NextResponse.json({
        success: true,
        payment_id: paymentId,
        reservation_id: reservationId,
        method: nextMethod,
        note: previousNote,
        unchanged: true,
      });
    }

    const updatePayload: { method?: "cash" | "transfer" | "credit_card"; note?: string | null } = {};
    if (methodChanged) updatePayload.method = nextMethod;
    if (noteChanged) updatePayload.note = nextNote;

    const { data: updated, error: updateError } = await supabase
      .from("folio_payments")
      .update(updatePayload)
      .eq("id", paymentId)
      .eq("reservation_id", reservationId)
      .eq("method", previousMethod)
      .select("id, reservation_id, tx_type, method, amount, note, paid_date, paid_at")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Payment row changed while editing. Please refresh and try again." },
        { status: 409 }
      );
    }

    const auditPayload = {
      actor_user_id: auth.user?.id ?? null,
      action: "payment_method_updated",
      entity_type: "folio_payment",
      entity_id: paymentId,
      before_json: {
        reservation_id: reservationId,
        method: previousMethod,
        tx_type: row.tx_type,
        amount: row.amount,
        paid_date: row.paid_date,
        paid_at: row.paid_at,
        note: row.note,
      },
      after_json: {
        reservation_id: reservationId,
        method: nextMethod,
        tx_type: updated.tx_type,
        amount: updated.amount,
        paid_date: updated.paid_date,
        paid_at: updated.paid_at,
        note: updated.note,
        reason: parsed.data.reason,
        reference_note: referenceNoteProvided ? nextNote : null,
        source: "reservation_folio",
        business_date: businessDate,
      },
      business_date: businessDate,
      source: "manual",
      note: parsed.data.reason,
    };

    const { error: auditError } = await supabase.from("audit_logs").insert(auditPayload);
    if (auditError) {
      return NextResponse.json({ success: false, error: auditError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      payment_id: paymentId,
      reservation_id: reservationId,
      method: nextMethod,
      previous_method: previousMethod,
      note: updated.note ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
