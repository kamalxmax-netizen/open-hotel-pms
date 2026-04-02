import {
  allocateMasterLineByRemaining,
  pickBusinessDate,
  toRoundedMoney,
} from "@/lib/group-checkin-wizard";
import {
  getBusinessDate,
  getGroupReservationLines,
  getSelectedReservationIdsFromDraft,
} from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const PAYMENT_METHODS = new Set(["cash", "transfer", "credit_card"]);

function distributeEvenly(totalAmount: number, reservationIds: string[]) {
  const ids = reservationIds.filter(Boolean);
  const allocation = new Map<string, number>();
  if (ids.length === 0) return allocation;

  const totalSatang = Math.max(0, Math.round(totalAmount * 100));
  const base = Math.floor(totalSatang / ids.length);
  let remainder = totalSatang - base * ids.length;

  ids.forEach((id) => {
    const satang = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    allocation.set(id, satang / 100);
  });

  return allocation;
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
    const supabase = createServerSupabaseClient();
    const fallbackBusinessDate = await getBusinessDate(supabase, null);
    const businessDate = pickBusinessDate(body?.business_date, fallbackBusinessDate);

    const selectedFromBody = Array.isArray(body?.selected_reservation_ids)
      ? body.selected_reservation_ids.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [];

    const selectedReservationIds = selectedFromBody.length > 0
      ? selectedFromBody
      : await getSelectedReservationIdsFromDraft(supabase, groupId, businessDate);

    if (selectedReservationIds.length === 0) {
      return NextResponse.json({ success: false, error: "No selected reservations found." }, { status: 400 });
    }

    const lines = await getGroupReservationLines(supabase, groupId, businessDate);
    const scoped = lines.filter((line) => selectedReservationIds.includes(line.reservation_id));

    const roomRows = scoped.map((line) => ({
      reservation_id: line.reservation_id,
      booking_code: line.booking_code,
      guest_name: line.guest_name,
      total_price: toRoundedMoney(line.total_price),
      deposit_received: toRoundedMoney(line.deposit_received),
      payment_received: toRoundedMoney(line.payment_received),
      remaining_balance: toRoundedMoney(line.remaining_balance),
    }));

    const grandTotal = roomRows.reduce((sum, row) => sum + row.total_price, 0);
    const paymentReceived = roomRows.reduce((sum, row) => sum + row.payment_received, 0);
    const depositReceived = roomRows.reduce((sum, row) => sum + row.deposit_received, 0);
    const remainingBalance = roomRows.reduce((sum, row) => sum + row.remaining_balance, 0);

    const paymentMode = body?.payment_mode === "master" ? "master" : "split";
    const splitPaymentPlan = Array.isArray(body?.split_payment_plan)
      ? body.split_payment_plan
      : Array.isArray(body?.payment_plan?.split_payment_plan)
        ? body.payment_plan.split_payment_plan
        : [];
    const masterPaymentPlan = Array.isArray(body?.master_payment_plan) ? body.master_payment_plan : [];
    const masterDepositPlan = body?.master_deposit && typeof body.master_deposit === "object"
      ? body.master_deposit
      : {};

    const validationErrors: string[] = [];
    const allocationPreview: Array<{
      line_index: number;
      method: string;
      amount: number;
      allocations: Array<{ reservation_id: string; booking_code: string; allocated_amount: number }>;
    }> = [];
    const plannedPaymentByReservation = new Map<string, number>();

    const pushPlanned = (reservationId: string, amount: number) => {
      const current = plannedPaymentByReservation.get(reservationId) ?? 0;
      plannedPaymentByReservation.set(reservationId, toRoundedMoney(current + amount));
    };

    if (paymentMode === "split") {
      const splitByReservation = new Map<string, any>();
      splitPaymentPlan.forEach((row: any) => {
        const reservationId = String(row?.reservation_id ?? "").trim();
        if (reservationId) splitByReservation.set(reservationId, row);
      });

      roomRows.forEach((row, idx) => {
        const plan = splitByReservation.get(row.reservation_id);
        if (!plan) return;
        const payments = Array.isArray(plan?.payments) ? plan.payments : [];
        const depositAmount = toRoundedMoney(plan?.deposit_amount ?? 0);
        let roomPlanned = 0;
        payments.forEach((payment: any, paymentIdx: number) => {
          const method = String(payment?.method ?? "");
          const amount = toRoundedMoney(payment?.amount ?? 0);
          if (!PAYMENT_METHODS.has(method)) {
            validationErrors.push(
              `split_payment_plan[${idx}].payments[${paymentIdx}].method is invalid.`
            );
            return;
          }
          if (amount <= 0) return;
          roomPlanned += amount;
        });

        const plannedTotal = toRoundedMoney(roomPlanned + depositAmount);
        pushPlanned(row.reservation_id, plannedTotal);
      });
    }

    if (paymentMode === "master") {
      masterPaymentPlan.forEach((line: any, idx: number) => {
        const method = String(line?.method ?? "");
        const amount = toRoundedMoney(line?.amount ?? 0);
        if (!PAYMENT_METHODS.has(method)) {
          validationErrors.push(`master_payment_plan[${idx}].method is invalid.`);
        }
        if (amount <= 0) {
          validationErrors.push(`master_payment_plan[${idx}].amount must be > 0.`);
          return;
        }

        const allocation = allocateMasterLineByRemaining({
          totalAmount: amount,
          reservations: roomRows.map((row) => ({
            reservation_id: row.reservation_id,
            booking_code: row.booking_code,
            remaining_balance: row.remaining_balance,
          })),
        });

        allocationPreview.push({
          line_index: idx,
          method,
          amount,
          allocations: roomRows.map((row) => ({
            reservation_id: row.reservation_id,
            booking_code: row.booking_code,
            allocated_amount: toRoundedMoney(allocation.get(row.reservation_id) ?? 0),
          })),
        });

        roomRows.forEach((row) => {
          const allocated = toRoundedMoney(allocation.get(row.reservation_id) ?? 0);
          if (allocated > 0) pushPlanned(row.reservation_id, allocated);
        });
      });

      const masterDepositAmount = toRoundedMoney(masterDepositPlan?.amount ?? 0);
      const masterDepositMethod = String(masterDepositPlan?.method ?? "cash");
      const defaultDepositTotal = toRoundedMoney(roomRows.length * 200);
      if (masterDepositAmount > 0) {
        if (!PAYMENT_METHODS.has(masterDepositMethod)) {
          validationErrors.push("master_deposit.method is invalid.");
        }
        const depositAllocation = distributeEvenly(
          masterDepositAmount,
          roomRows.map((row) => row.reservation_id)
        );
        roomRows.forEach((row) => {
          const allocated = toRoundedMoney(depositAllocation.get(row.reservation_id) ?? 0);
          if (allocated > 0) pushPlanned(row.reservation_id, allocated);
        });
      }
      if (
        masterDepositAmount > 0 &&
        masterDepositAmount + 0.0001 < defaultDepositTotal &&
        !String(masterDepositPlan?.note ?? "").trim()
      ) {
        validationErrors.push("Master deposit note is required when collected deposit is below default.");
      }
    }

    const enhancedRoomRows = roomRows.map((row) => {
      const plannedPayment = toRoundedMoney(plannedPaymentByReservation.get(row.reservation_id) ?? 0);
      const projectedRemaining = toRoundedMoney(Math.max(0, row.remaining_balance - plannedPayment));
      return {
        ...row,
        planned_payment: plannedPayment,
        projected_remaining: projectedRemaining,
      };
    });

    const totalCurrentDue = toRoundedMoney(
      roomRows.reduce((sum, row) => sum + row.remaining_balance, 0) +
      splitPaymentPlan.reduce((sum: number, row: any) => {
        if (paymentMode !== "split") return sum;
        return sum + toRoundedMoney(row?.deposit_amount ?? 0);
      }, 0) +
      (paymentMode === "master" ? toRoundedMoney(masterDepositPlan?.amount ?? 0) : 0)
    );

    const submittedPaymentTotal = toRoundedMoney(
      enhancedRoomRows.reduce((sum, row) => sum + row.planned_payment, 0)
    );
    const projectedRemainingBalance = toRoundedMoney(
      Math.max(0, totalCurrentDue - submittedPaymentTotal)
    );
    const overpaymentAmount = toRoundedMoney(
      Math.max(0, submittedPaymentTotal - totalCurrentDue)
    );

    if (overpaymentAmount > 0) {
      validationErrors.push(
        `Planned payment exceeds remaining balance by ${overpaymentAmount.toFixed(2)}.`
      );
    }

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      payment_mode: paymentMode,
      grand_total: toRoundedMoney(grandTotal),
      payment_received: toRoundedMoney(paymentReceived),
      deposit_received: toRoundedMoney(depositReceived),
      remaining_balance: paymentMode === "split" ? totalCurrentDue : toRoundedMoney(remainingBalance),
      submitted_payment_total: submittedPaymentTotal,
      projected_remaining_balance: projectedRemainingBalance,
      overpayment_amount: overpaymentAmount,
      room_rows: enhancedRoomRows,
      allocation_preview: allocationPreview,
      validation_errors: validationErrors,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
