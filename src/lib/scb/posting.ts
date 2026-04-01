import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDepositSnapshotNote } from "@/lib/deposit-ledger";
import { resolveBusinessDate } from "@/lib/folio-fees";
import { insertScbNotification } from "@/lib/scb/notifications";
import type { ScbNormalizedTransaction, ScbStoredRequest } from "@/lib/scb/types";

function buildScbPaymentNote(request: ScbStoredRequest, transaction: ScbNormalizedTransaction): string {
  const fragments = [
    `SCB Mae Manee TXN ${transaction.transactionId}`,
    transaction.payerName ? `Payer ${transaction.payerName}` : null,
    `Ref ${request.partner_reference_no}`,
  ].filter(Boolean);
  return fragments.join(" · ");
}

async function applyDepositSnapshotLines(params: {
  supabase: SupabaseClient;
  reservationId: string;
  lines: Array<{ method: string; amount: number; note?: string | null }>;
  generalNote: string | null;
  cashierName: string;
}) {
  const { supabase, reservationId, lines, generalNote, cashierName } = params;
  const businessDate = await resolveBusinessDate(supabase as any);

  const wrapped = await supabase.rpc("apply_deposit_snapshot_lines_v2", {
    p_reservation_id: reservationId,
    p_lines: lines,
    p_general_note: generalNote,
    p_cashier_name: cashierName,
    p_paid_date: businessDate,
  });
  if (!wrapped.error) return wrapped.data;

  const retry = await supabase.rpc("apply_deposit_snapshot_lines", {
    p_reservation_id: reservationId,
    p_lines: lines,
    p_general_note: generalNote,
    p_cashier_name: cashierName,
    p_paid_date: businessDate,
  });
  if (!retry.error) return retry.data;

  const legacy = await supabase.rpc("apply_deposit_snapshot_lines", {
    p_reservation_id: reservationId,
    p_lines: lines,
    p_general_note: generalNote,
    p_cashier_name: cashierName,
  });
  if (legacy.error) throw legacy.error;
  return legacy.data;
}

async function postReservationTransfer(
  supabase: SupabaseClient,
  request: ScbStoredRequest,
  transaction: ScbNormalizedTransaction
): Promise<void> {
  const reservationId = request.target_id;
  const note = buildScbPaymentNote(request, transaction);
  const businessDate = await resolveBusinessDate(supabase as any);
  const paidAt = transaction.paidAt ?? new Date().toISOString();

  if (request.room_amount > 0) {
    const { error } = await supabase.from("folio_payments").insert({
      reservation_id: reservationId,
      tx_type: "payment",
      method: "transfer",
      amount: request.room_amount,
      note,
      paid_at: paidAt,
      paid_date: businessDate,
      revenue_category: "room_revenue",
    });
    if (error) throw new Error(error.message);
  }

  if (request.deposit_amount > 0) {
    const { data: reservation, error } = await supabase
      .from("reservations")
      .select("deposit_note")
      .eq("id", reservationId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const parsed = parseDepositSnapshotNote(reservation?.deposit_note);
    const nextLines = [
      ...parsed.lines.map((line) => ({ method: line.method, amount: line.amount, note: line.note })),
      { method: "transfer", amount: request.deposit_amount, note },
    ];

    await applyDepositSnapshotLines({
      supabase,
      reservationId,
      lines: nextLines,
      generalNote: parsed.generalNote,
      cashierName: "SCB",
    });
  }
}

async function postPosTransfer(
  supabase: SupabaseClient,
  request: ScbStoredRequest,
  transaction: ScbNormalizedTransaction
): Promise<void> {
  const note = buildScbPaymentNote(request, transaction);
  const { error } = await supabase
    .from("pos_orders")
    .update({
      payment_method: "transfer",
      status: "completed",
      note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.target_id);
  if (error) throw new Error(error.message);
}

function getTargetCodeForNotification(request: ScbStoredRequest): string {
  const payload = (request.request_payload ?? {}) as Record<string, unknown>;
  const partnerMetaData = (payload.partnerMetaData ?? {}) as Record<string, unknown>;
  if (request.target_type === "reservation") {
    return String(partnerMetaData.bookingCode ?? request.target_id).trim();
  }
  return String(partnerMetaData.orderNumber ?? request.target_id).trim();
}

export async function processMatchedScbTransaction(
  supabase: SupabaseClient,
  request: ScbStoredRequest,
  transaction: ScbNormalizedTransaction,
  transactionRowId?: string | null
): Promise<void> {
  const expected = Number(request.request_amount_total ?? 0);
  const actual = Number(transaction.amount ?? 0);
  if (Math.abs(expected - actual) > 0.009) {
    await supabase
      .from("scb_payment_requests")
      .update({ status: "unmatched", updated_at: new Date().toISOString(), error_message: `Amount mismatch: expected ${expected}, got ${actual}` })
      .eq("id", request.id);
    if (transactionRowId) {
      await supabase
        .from("scb_payment_transactions")
        .update({ match_status: "unmatched", processed_at: new Date().toISOString() })
        .eq("id", transactionRowId);
    }
    return;
  }

  if (request.target_type === "reservation") {
    await postReservationTransfer(supabase, request, transaction);
  } else {
    await postPosTransfer(supabase, request, transaction);
  }

  await supabase
    .from("scb_payment_requests")
    .update({
      status: "paid",
      paid_transaction_id: transactionRowId ?? null,
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", request.id);

  if (transactionRowId) {
    await supabase
      .from("scb_payment_transactions")
      .update({
        request_id: request.id,
        match_status: "matched",
        processed_at: new Date().toISOString(),
      })
      .eq("id", transactionRowId);
  }

  if (transactionRowId) {
    const title = `ยอดโอนเข้า ฿${Number(actual).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const targetTypeLabel = request.target_type === "reservation" ? "Res" : "POS";
    const targetCode = getTargetCodeForNotification(request);
    const body = `${transaction.payerName || "ไม่ทราบชื่อ"} → ${targetTypeLabel} #${targetCode}`;
    try {
      await insertScbNotification({
        supabase,
        transactionId: transactionRowId,
        targetType: request.target_type,
        targetId: request.target_id,
        title,
        body,
      });
    } catch (error) {
      console.error("Failed to insert SCB payment notification", error);
    }
  }
}
