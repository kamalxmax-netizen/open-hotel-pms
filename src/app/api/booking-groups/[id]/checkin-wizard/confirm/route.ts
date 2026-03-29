import {
  allocateMasterLineByRemaining,
  mapMassCheckinCodeToWizardCodes,
  mergeDraftJson,
  pickBusinessDate,
  toRoundedMoney,
  type WizardRoomResult,
  type WizardFailCode,
} from "@/lib/group-checkin-wizard";
import {
  ensureHousekeepingReadyForCheckin,
  ensureRoomVacantForCheckin,
  runGroupMassCheckin,
} from "@/lib/group-checkin-service";
import {
  getBusinessDate,
  getGroupReservationLines,
  getSelectedReservationIdsFromDraft,
  getWizardDraft,
  upsertWizardDraft,
} from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const PAYMENT_METHODS = new Set(["cash", "transfer", "credit_card"]);

function pushCode(codes: WizardFailCode[], code: WizardFailCode) {
  if (!codes.includes(code)) codes.push(code);
}

function parsePaymentMode(body: any): "split" | "master" {
  if (body?.payment_mode === "master") return "master";
  if (body?.payment_plan?.payment_mode === "master") return "master";
  return "split";
}

async function attachGroupPassportScansToReservations(params: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  groupId: string;
  successfulLines: Array<{ reservation_id: string; primary_guest_profile_id: string | null }>;
}): Promise<string[]> {
  const warnings: string[] = [];
  const { supabase, groupId, successfulLines } = params;

  for (const line of successfulLines) {
    const reservationId = String(line.reservation_id ?? "").trim();
    const guestProfileId = String(line.primary_guest_profile_id ?? "").trim();
    if (!reservationId || !guestProfileId) continue;

    const { data: scanRow, error: scanReadError } = await supabase
      .from("passport_scans")
      .select("id, reservation_id, pool_status")
      .eq("booking_group_id", groupId)
      .eq("guest_profile_id", guestProfileId)
      .not("pool_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (scanReadError) {
      warnings.push(`scan-link read failed for reservation ${reservationId}: ${scanReadError.message}`);
      continue;
    }
    if (!scanRow?.id) continue;

    const linkedReservationId = String((scanRow as any).reservation_id ?? "").trim();
    if (linkedReservationId && linkedReservationId !== reservationId) {
      warnings.push(`scan ${scanRow.id} already linked to another reservation.`);
      continue;
    }
    if (linkedReservationId === reservationId) continue;

    const { error: scanUpdateError } = await supabase
      .from("passport_scans")
      .update({
        reservation_id: reservationId,
        matched_reservation_id: reservationId,
        pool_status: "assigned",
      })
      .eq("id", String(scanRow.id));

    if (scanUpdateError) {
      warnings.push(`scan-link update failed for reservation ${reservationId}: ${scanUpdateError.message}`);
    }
  }

  return warnings;
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
    const strictDueIn = body?.strict_due_in !== false;

    const selectedFromBody: string[] = Array.isArray(body?.selected_reservation_ids)
      ? body.selected_reservation_ids
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value: string) => value.length > 0)
      : [];

    const selectedReservationIds = selectedFromBody.length > 0
      ? selectedFromBody
      : await getSelectedReservationIdsFromDraft(supabase, groupId, businessDate);

    if (selectedReservationIds.length === 0) {
      return NextResponse.json({ success: false, error: "No selected reservations found." }, { status: 400 });
    }

    const lines = await getGroupReservationLines(supabase, groupId, businessDate);
    const lineByReservationId = new Map(lines.map((line) => [line.reservation_id, line]));

    const scopedLines = selectedReservationIds
      .map((reservationId: string) => lineByReservationId.get(reservationId) ?? null)
      .filter(Boolean) as typeof lines;

    if (scopedLines.length === 0) {
      return NextResponse.json({ success: false, error: "Selected reservations are not in this group." }, { status: 404 });
    }

    const prevalidatedResults = new Map<string, WizardRoomResult>();
    const readyForCheckin: Array<typeof scopedLines[number]> = [];

    for (const line of scopedLines) {
      const codes: WizardFailCode[] = [];
      const missingFields: string[] = [];

      if (line.is_checked_in) {
        prevalidatedResults.set(line.reservation_id, {
          reservation_id: line.reservation_id,
          booking_code: line.booking_code,
          guest_name: line.guest_name,
          status: "skipped",
          codes: ["already_checked_in"],
        });
        continue;
      }

      if (!line.has_assigned_room || !line.room_id) {
        pushCode(codes, "room_not_assigned");
      }

      if (strictDueIn && line.checkin_date !== businessDate) {
        pushCode(codes, "runtime_error");
      }

      if (line.room_id) {
        const roomVacant = await ensureRoomVacantForCheckin(
          supabase,
          line.room_id,
          businessDate,
          line.reservation_id
        );
        if (!roomVacant.ok) {
          pushCode(codes, "room_occupied");
        }

        const hkReady = await ensureHousekeepingReadyForCheckin(supabase, line.room_id, businessDate);
        if (!hkReady.ok) {
          pushCode(codes, "hk_not_ready");
        }
      }

      if (!line.profile_completeness.is_complete) {
        pushCode(codes, "profile_incomplete");
        missingFields.push(...line.profile_completeness.missing_fields);
      }

      if (codes.length > 0) {
        prevalidatedResults.set(line.reservation_id, {
          reservation_id: line.reservation_id,
          booking_code: line.booking_code,
          guest_name: line.guest_name,
          status: "failed",
          codes,
          missing_fields: missingFields.length > 0 ? Array.from(new Set(missingFields)) : undefined,
          error: strictDueIn && line.checkin_date !== businessDate
            ? `Reservation is not due-in on business date ${businessDate}.`
            : undefined,
        });
        continue;
      }

      readyForCheckin.push(line);
    }

    const paymentMode = parsePaymentMode(body);
    const splitPaymentPlan = Array.isArray(body?.split_payment_plan)
      ? body.split_payment_plan
      : Array.isArray(body?.payment_plan?.split_payment_plan)
        ? body.payment_plan.split_payment_plan
        : [];
    const masterPaymentPlan = Array.isArray(body?.master_payment_plan)
      ? body.master_payment_plan
      : Array.isArray(body?.payment_plan?.master_payment_plan)
        ? body.payment_plan.master_payment_plan
        : [];

    const massItemsByReservation = new Map<string, any>();
    readyForCheckin.forEach((line) => {
      massItemsByReservation.set(line.reservation_id, {
        reservation_id: line.reservation_id,
        deposit_policy: "keep",
        deposit_amount: 0,
        payments: [] as Array<{ method: string; amount: number; note?: string | null }>,
      });
    });

    for (const row of splitPaymentPlan) {
      const reservationId = String(row?.reservation_id ?? "").trim();
      if (!reservationId || !massItemsByReservation.has(reservationId)) continue;

      const target = massItemsByReservation.get(reservationId)!;
      target.deposit_policy = row?.deposit_policy === "set" ? "set" : "keep";
      target.deposit_amount = toRoundedMoney(row?.deposit_amount ?? 0);
      target.deposit_note = typeof row?.deposit_note === "string" ? row.deposit_note : null;

      if (paymentMode !== "split") continue;

      const payments = Array.isArray(row?.payments) ? row.payments : [];
      target.payments = payments
        .map((payment: any) => ({
          method: String(payment?.method ?? ""),
          amount: toRoundedMoney(payment?.amount ?? 0),
          note: typeof payment?.note === "string" ? payment.note : null,
        }))
        .filter((payment: any) => payment.amount > 0);

      for (const payment of target.payments) {
        if (!PAYMENT_METHODS.has(payment.method)) {
          return NextResponse.json({ success: false, error: `Invalid payment method (${payment.method}) in split plan.` }, { status: 400 });
        }
      }
    }

    if (paymentMode === "master" && readyForCheckin.length > 0) {
      const remainingRows = readyForCheckin.map((line) => ({
        reservation_id: line.reservation_id,
        booking_code: line.booking_code,
        remaining_balance: line.remaining_balance,
      }));

      for (const line of masterPaymentPlan) {
        const method = String(line?.method ?? "");
        const amount = toRoundedMoney(line?.amount ?? 0);
        const note = typeof line?.note === "string" ? line.note : null;

        if (!PAYMENT_METHODS.has(method)) {
          return NextResponse.json({ success: false, error: `Invalid payment method (${method}) in master plan.` }, { status: 400 });
        }
        if (amount <= 0) continue;

        const allocation = allocateMasterLineByRemaining({
          totalAmount: amount,
          reservations: remainingRows,
        });

        readyForCheckin.forEach((row) => {
          const allocatedAmount = toRoundedMoney(allocation.get(row.reservation_id) ?? 0);
          if (allocatedAmount <= 0) return;
          const target = massItemsByReservation.get(row.reservation_id);
          if (!target) return;
          target.payments.push({ method, amount: allocatedAmount, note });
        });
      }
    }

    let massResultByReservation = new Map<string, any>();
    if (readyForCheckin.length > 0) {
      const rawItems = readyForCheckin
        .map((line) => massItemsByReservation.get(line.reservation_id))
        .filter(Boolean);

      const massResult = await runGroupMassCheckin({
        supabase,
        groupId,
        rawItems,
        strictDueIn,
        todayOverride: businessDate,
      });

      if (!massResult.ok) {
        return NextResponse.json({ success: false, error: massResult.error }, { status: massResult.status });
      }

      massResultByReservation = new Map(
        massResult.data.results.map((row) => [String(row.reservation_id), row])
      );
    }

    const finalResults: WizardRoomResult[] = [];

    for (const line of scopedLines) {
      const prevalidated = prevalidatedResults.get(line.reservation_id);
      if (prevalidated) {
        finalResults.push(prevalidated);
        continue;
      }

      const runtime = massResultByReservation.get(line.reservation_id);
      if (!runtime) {
        finalResults.push({
          reservation_id: line.reservation_id,
          booking_code: line.booking_code,
          guest_name: line.guest_name,
          status: "failed",
          codes: ["runtime_error"],
          error: "Missing runtime check-in result.",
        });
        continue;
      }

      if (runtime.ok) {
        finalResults.push({
          reservation_id: line.reservation_id,
          booking_code: line.booking_code,
          guest_name: line.guest_name,
          status: "ok",
          codes: [],
          checked_in_at: runtime.checked_in_at,
          checkin_time: runtime.checkin_time,
          payments_recorded: runtime.payments_recorded,
          payment_amount: runtime.payment_amount,
        });
      } else {
        finalResults.push({
          reservation_id: line.reservation_id,
          booking_code: line.booking_code,
          guest_name: line.guest_name,
          status: "failed",
          codes: mapMassCheckinCodeToWizardCodes(runtime.code, runtime.error),
          error: runtime.error,
        });
      }
    }

    const successCount = finalResults.filter((row) => row.status === "ok").length;
    const failedCount = finalResults.filter((row) => row.status === "failed").length;
    const skippedCount = finalResults.filter((row) => row.status === "skipped").length;
    const successfulLinesForScanLink = scopedLines
      .filter((line) => finalResults.some((row) => row.reservation_id === line.reservation_id && row.status === "ok"))
      .map((line) => ({
        reservation_id: line.reservation_id,
        primary_guest_profile_id: line.primary_guest_profile_id ?? null,
      }));

    const scanLinkWarnings = await attachGroupPassportScansToReservations({
      supabase,
      groupId,
      successfulLines: successfulLinesForScanLink,
    });

    const existingDraft = await getWizardDraft(supabase, groupId, businessDate);
    const nextDraftJson = mergeDraftJson(
      (existingDraft?.draft_json as Record<string, unknown>) ?? {},
      {
        step4: {
          selected_reservation_ids: selectedReservationIds,
        },
      }
    );

    const draftStatus = failedCount === 0 ? "completed" : "draft";
    const draft = await upsertWizardDraft({
      supabase,
      groupId,
      businessDate,
      status: draftStatus,
      currentStep: 4,
      draftJson: nextDraftJson,
      touchCommittedAt: true,
    });

    return NextResponse.json({
      success: failedCount === 0,
      business_date: businessDate,
      summary: {
        selected: scopedLines.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      results: finalResults,
      warnings: scanLinkWarnings,
      draft,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
