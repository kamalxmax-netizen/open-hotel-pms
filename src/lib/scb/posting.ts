import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDepositSnapshotNote } from "@/lib/deposit-ledger";
import { resolveBusinessDate } from "@/lib/folio-fees";
import { insertScbNotification } from "@/lib/scb/notifications";
import type { ScbNormalizedTransaction, ScbStoredRequest } from "@/lib/scb/types";

function formatBangkokDateTimeParts(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${lookup("day")}/${lookup("month")}/${lookup("year")}`,
    time: `${lookup("hour")}:${lookup("minute")}`,
  };
}

function maskScbReference(ref: string | null | undefined) {
  const value = String(ref ?? "").trim();
  if (!value) return "—";
  return value.slice(-5);
}

function buildScbPaymentNote(request: ScbStoredRequest, transaction: ScbNormalizedTransaction): string {
  const { date, time } = formatBangkokDateTimeParts(transaction.paidAt);
  const payerName = String(transaction.payerName ?? "Unknown").trim() || "Unknown";
  const amount = Number(transaction.amount ?? request.request_amount_total ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const refTail = maskScbReference(request.partner_reference_no);
  return `SCB Mae Manee: ${payerName}, ฿${amount}, ${date}, ${time}, Ref ${refTail}`;
}

async function hasExistingReservationTransfer(params: {
  supabase: SupabaseClient;
  reservationId: string;
  amount: number;
  note: string;
  paidAt: string;
  revenueCategory: string;
}) {
  const { supabase, reservationId, amount, note, paidAt, revenueCategory } = params;
  const { data, error } = await supabase
    .from("folio_payments")
    .select("id")
    .eq("reservation_id", reservationId)
    .eq("tx_type", "payment")
    .eq("method", "transfer")
    .eq("amount", amount)
    .eq("note", note)
    .eq("paid_at", paidAt)
    .eq("revenue_category", revenueCategory)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
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
    const exists = await hasExistingReservationTransfer({
      supabase,
      reservationId,
      amount: request.room_amount,
      note,
      paidAt,
      revenueCategory: "room_revenue",
    });
    if (!exists) {
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
  }

  if (request.deposit_amount > 0) {
    const { data: reservation, error } = await supabase
      .from("reservations")
      .select("deposit_note")
      .eq("id", reservationId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const parsed = parseDepositSnapshotNote(reservation?.deposit_note);
    const hasDepositLine = parsed.lines.some((line) =>
      String(line.method ?? "").trim().toLowerCase() === "transfer"
      && Math.abs(Number(line.amount ?? 0) - Number(request.deposit_amount)) <= 0.009
      && String(line.note ?? "").trim() === note
    );
    const nextLines = [
      ...parsed.lines.map((line) => ({ method: line.method, amount: line.amount, note: line.note })),
      ...(hasDepositLine ? [] : [{ method: "transfer", amount: request.deposit_amount, note }]),
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
  const { data: currentRequest, error: currentRequestError } = await supabase
    .from("scb_payment_requests")
    .select("id, status, paid_transaction_id")
    .eq("id", request.id)
    .maybeSingle();
  if (currentRequestError) {
    throw new Error(currentRequestError.message);
  }

  if (
    currentRequest
    && String(currentRequest.status ?? "") === "paid"
    && (
      !transactionRowId
      || String(currentRequest.paid_transaction_id ?? "") === String(transactionRowId)
    )
  ) {
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
    return;
  }

  const expected = Number(request.request_amount_total ?? 0);
  const actual = Number(transaction.amount ?? 0);
  if (Math.abs(expected - actual) > 0.009) {
    const { error: requestUpdateError } = await supabase
      .from("scb_payment_requests")
      .update({ status: "unmatched", updated_at: new Date().toISOString(), error_message: `Amount mismatch: expected ${expected}, got ${actual}` })
      .eq("id", request.id);
    if (requestUpdateError) {
      throw new Error(requestUpdateError.message);
    }
    if (transactionRowId) {
      const { error: transactionUpdateError } = await supabase
        .from("scb_payment_transactions")
        .update({ match_status: "unmatched", processed_at: new Date().toISOString() })
        .eq("id", transactionRowId);
      if (transactionUpdateError) {
        throw new Error(transactionUpdateError.message);
      }
    }
    return;
  }

  if (request.target_type === "reservation") {
    await postReservationTransfer(supabase, request, transaction);
  } else {
    await postPosTransfer(supabase, request, transaction);
  }

  const { error: requestPaidError } = await supabase
    .from("scb_payment_requests")
    .update({
      status: "paid",
      paid_transaction_id: transactionRowId ?? null,
      updated_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", request.id);
  if (requestPaidError) {
    throw new Error(requestPaidError.message);
  }

  if (transactionRowId) {
    const { error: transactionMatchedError } = await supabase
      .from("scb_payment_transactions")
      .update({
        request_id: request.id,
        match_status: "matched",
        processed_at: new Date().toISOString(),
      })
      .eq("id", transactionRowId);
    if (transactionMatchedError) {
      throw new Error(transactionMatchedError.message);
    }
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
