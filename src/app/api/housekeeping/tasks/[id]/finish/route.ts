import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { backfillReturnableAmenityLedgerIfMissing } from "@/lib/hk-returnable-stock";
import { getAmenityLabelFromValues, isReturnableAmenity } from "@/lib/maid-amenities";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { restoreLoanItemStock } from "@/lib/loan-item-stock";
import { NextResponse } from "next/server";
import { z } from "zod";

const finishSchema = z.object({
  checklist: z
    .array(
      z.object({
        item: z.string(),
        quantity: z.number(),
        used: z.number().optional().default(0),
        checked: z.boolean().optional().default(false),
        category: z.string().optional().default("General"),
        product_id: z.string().uuid().optional().nullable(),
      })
    )
    .optional(),
  maid_name: z.string().optional(),
  note: z.string().optional(),
  auto_approve: z.boolean().optional().default(false),
  approved_by: z.string().optional(),
  maintenance_assignment_ids: z.array(z.string().uuid()).optional(),
  maintenance_note: z.string().optional(),
  maintenance_checklist: z
    .array(
      z.object({
        assignment_id: z.string().uuid(),
        items: z
          .array(
            z.object({
              item: z.string().trim().min(1),
              checked: z.boolean().optional().default(false),
              note: z.string().optional(),
            })
          )
          .optional()
          .default([]),
      })
    )
    .optional(),
  collected_loan_trace_ids: z.array(z.string().uuid()).optional(),
  returned_stock: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().min(1),
      })
    )
    .optional(),
});

type FinishPayload = z.infer<typeof finishSchema>;
type StockChecklistItem = { product_id: string; used: number };
type StockReturnItem = { product_id: string; quantity: number };
type TaskRoomContext = {
  room_id: string | null;
  room_number: string | null;
  floor_number: number | null;
  stay_date?: string | null;
};

type TaskReservationContext = {
  reservation_id: string;
  room_id: string;
  room_number: string;
  floor_number: number;
  stay_date: string;
  status: string;
  checkin_date: string | null;
  checkout_date: string | null;
};

function getStayNightCount(checkinDate: string | null | undefined, checkoutDate: string | null | undefined): number {
  if (!checkinDate || !checkoutDate) return 0;
  const checkin = new Date(`${checkinDate}T00:00:00.000Z`);
  const checkout = new Date(`${checkoutDate}T00:00:00.000Z`);
  if (Number.isNaN(checkin.getTime()) || Number.isNaN(checkout.getTime())) return 0;
  return Math.max(Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000), 0);
}

function shouldFallbackToLegacy(errorMessage: string): boolean {
  const normalized = String(errorMessage).toLowerCase();
  return (
    normalized.includes("could not find the function") ||
    normalized.includes("hk_finish_task_with_maintenance") ||
    normalized.includes("schema cache")
  );
}

function normalizeStockChecklistItems(payload: FinishPayload): StockChecklistItem[] {
  const list = payload.checklist ?? [];
  return list
    .map((item) => {
      const used = Math.max(Number(item.used ?? 0), 0);
      const productId = typeof item.product_id === "string" ? item.product_id : null;
      if (!productId || used <= 0) return null;
      return {
        product_id: productId,
        used,
      };
    })
    .filter((item): item is StockChecklistItem => Boolean(item));
}

function normalizeReturnStockItems(payload: FinishPayload): StockReturnItem[] {
  return (payload.returned_stock ?? [])
    .map((item) => ({
      product_id: String(item.product_id ?? ""),
      quantity: Math.max(Number(item.quantity ?? 0), 0),
    }))
    .filter((item) => Boolean(item.product_id) && item.quantity > 0);
}

function deriveFloorNumber(context: TaskRoomContext): number | null {
  if (typeof context.floor_number === "number" && Number.isFinite(context.floor_number)) {
    return context.floor_number;
  }
  const roomNumber = context.room_number?.trim() ?? "";
  const firstDigit = roomNumber.slice(0, 1);
  const value = Number(firstDigit);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

async function applyStockDeductionNonBlocking(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  taskId: string,
  payload: FinishPayload,
  context: TaskRoomContext
): Promise<{
  attempted: boolean;
  mode: "atomic_rpc" | "skipped";
  processed?: number;
  oversell?: number;
}> {
  const stockItems = normalizeStockChecklistItems(payload);
  if (stockItems.length === 0) {
    return { attempted: false, mode: "skipped" };
  }

  const floorNumber = deriveFloorNumber(context);
  const roomNumber = context.room_number?.trim() ?? "";
  if (!floorNumber || roomNumber.length === 0) {
    return { attempted: false, mode: "skipped" };
  }

  try {
    const { data, error } = await supabase.rpc("hk_deduct_floor_stock", {
      p_task_id: taskId,
      p_room_number: roomNumber,
      p_floor_number: floorNumber,
      p_maid_name: payload.maid_name ?? null,
      p_items: stockItems,
    });

    if (error) {
      console.error("hk_finish stock deduction RPC failed (non-blocking):", error.message);
      return { attempted: true, mode: "skipped" };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      attempted: true,
      mode: "atomic_rpc",
      processed: Number(row?.processed ?? 0),
      oversell: Number(row?.oversell ?? 0),
    };
  } catch (err) {
    console.error("hk_finish stock deduction unexpected error (non-blocking):", err);
    return { attempted: true, mode: "skipped" };
  }
}

async function resolveTaskReservationContext(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  context: TaskRoomContext
): Promise<TaskReservationContext | null> {
  if (!context.room_id || !context.stay_date || !context.room_number) return null;
  const floorNumber = deriveFloorNumber(context);
  if (!floorNumber) return null;

  const { data: activeNightRows, error: activeNightError } = await supabase
    .from("reservation_nights")
    .select("reservation_id, stay_date")
    .eq("room_id", context.room_id)
    .eq("stay_date", context.stay_date)
    .is("cancelled_at", null)
    .limit(10);

  if (activeNightError) {
    throw new Error(`Failed to resolve stay context: ${activeNightError.message}`);
  }

  const activeReservationIds = Array.from(
    new Set((activeNightRows ?? []).map((row: any) => String(row.reservation_id ?? "")).filter(Boolean))
  );

  if (activeReservationIds.length > 0) {
    const { data: activeReservations, error: activeReservationError } = await supabase
      .from("reservations")
      .select("id, status, checkin_date, checkout_date")
      .in("id", activeReservationIds);

    if (activeReservationError) {
      throw new Error(`Failed to resolve active reservation: ${activeReservationError.message}`);
    }

    const activeReservation = (activeReservations ?? []).find((row: any) => row.status === "active");
    if (activeReservation) {
      return {
        reservation_id: String(activeReservation.id),
        room_id: context.room_id,
        room_number: context.room_number,
        floor_number: floorNumber,
        stay_date: context.stay_date,
        status: String(activeReservation.status ?? "active"),
        checkin_date: activeReservation.checkin_date ?? null,
        checkout_date: activeReservation.checkout_date ?? null,
      };
    }
  }

  const { data: checkedOutReservations, error: checkedOutError } = await supabase
    .from("reservations")
    .select("id, status, checkin_date, checkout_date, reservation_nights(room_id, stay_date, cancelled_at)")
    .eq("status", "checked_out")
    .eq("checkout_date", context.stay_date);

  if (checkedOutError) {
    throw new Error(`Failed to resolve checked-out reservation: ${checkedOutError.message}`);
  }

  for (const reservation of checkedOutReservations ?? []) {
    const activeNights = Array.isArray((reservation as any).reservation_nights)
      ? (((reservation as any).reservation_nights ?? []) as Array<{
          room_id?: string | null;
          stay_date?: string | null;
          cancelled_at?: string | null;
        }>)
          .filter((night) => !night?.cancelled_at && night?.room_id)
          .sort((left, right) => String(right?.stay_date ?? "").localeCompare(String(left?.stay_date ?? "")))
      : [];
    const latestRoomId = String(activeNights[0]?.room_id ?? "");
    if (latestRoomId === context.room_id) {
      return {
        reservation_id: String((reservation as any).id ?? ""),
        room_id: context.room_id,
        room_number: context.room_number,
        floor_number: floorNumber,
        stay_date: context.stay_date,
        status: String((reservation as any).status ?? "checked_out"),
        checkin_date: (reservation as any).checkin_date ?? null,
        checkout_date: (reservation as any).checkout_date ?? null,
      };
    }
  }

  return null;
}

async function validateReturnStockPayload(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  reservationContext: TaskReservationContext | null,
  payload: FinishPayload
): Promise<{ valid: true } | { valid: false; error: string }> {
  const returnedItems = normalizeReturnStockItems(payload);
  if (returnedItems.length === 0) return { valid: true };

  if (!reservationContext) {
    return { valid: false, error: "ไม่พบข้อมูลการเข้าพักสำหรับคืนของเข้าชั้น" };
  }

  if (reservationContext.status !== "checked_out") {
    return { valid: false, error: "คืนของเข้าชั้นได้เฉพาะห้องที่เช็กเอาต์แล้วเท่านั้น" };
  }

  if (getStayNightCount(reservationContext.checkin_date, reservationContext.checkout_date) <= 1) {
    return { valid: false, error: "คืนของเข้าชั้นได้เฉพาะห้องที่พักมากกว่า 1 คืน" };
  }

  const productIds = returnedItems.map((item) => item.product_id);
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("housekeeping_amenity_ledger")
    .select("product_id, action, quantity")
    .eq("reservation_id", reservationContext.reservation_id)
    .eq("room_id", reservationContext.room_id)
    .in("product_id", productIds);

  if (ledgerError) {
    const message = String(ledgerError.message ?? "").toLowerCase();
    if (message.includes("housekeeping_amenity_ledger") || message.includes("does not exist")) {
      return { valid: false, error: "ต้องอัปเดตฐานข้อมูลก่อนใช้ฟีเจอร์คืนของเข้าชั้น" };
    }
    return { valid: false, error: ledgerError.message };
  }

  const availabilityByProductId = new Map<string, number>();
  for (const row of ledgerRows ?? []) {
    const productId = String((row as any).product_id ?? "");
    const quantity = Math.max(Number((row as any).quantity ?? 0), 0);
    if (!productId || quantity <= 0) continue;
    const delta = String((row as any).action ?? "") === "return" ? -quantity : quantity;
    availabilityByProductId.set(productId, (availabilityByProductId.get(productId) ?? 0) + delta);
  }

  for (const item of returnedItems) {
    const available = Math.max(availabilityByProductId.get(item.product_id) ?? 0, 0);
    if (item.quantity > available) {
      return { valid: false, error: "จำนวนคืนของเกินยอดค้างในห้อง" };
    }
  }

  return { valid: true };
}

async function recordAmenityDeliveries(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  taskId: string,
  payload: FinishPayload,
  reservationContext: TaskReservationContext | null
): Promise<{ attempted: boolean; inserted: number; error: string | null }> {
  if (!reservationContext) return { attempted: false, inserted: 0, error: null };

  const rows = (payload.checklist ?? [])
    .filter((item) => isReturnableAmenity(item))
    .map((item) => {
      const used = Math.max(Number(item.used ?? 0), 0);
      const productId = typeof item.product_id === "string" ? item.product_id : null;
      if (!productId || used <= 0) return null;
      return {
        reservation_id: reservationContext.reservation_id,
        room_id: reservationContext.room_id,
        task_id: taskId,
        stay_date: reservationContext.stay_date,
        room_number: reservationContext.room_number,
        floor_number: reservationContext.floor_number,
        product_id: productId,
        item_name: getAmenityLabelFromValues(item.item, productId),
        action: "deliver",
        quantity: used,
        performed_by: payload.maid_name ?? null,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return { attempted: false, inserted: 0, error: null };
  }

  const { error } = await supabase.from("housekeeping_amenity_ledger").insert(rows as any[]);
  if (error) {
    return { attempted: true, inserted: 0, error: error.message };
  }

  return { attempted: true, inserted: rows.length, error: null };
}

async function applyStockReturn(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  taskId: string,
  payload: FinishPayload,
  reservationContext: TaskReservationContext | null
): Promise<{
  attempted: boolean;
  processed: number;
  error: string | null;
}> {
  const returnedItems = normalizeReturnStockItems(payload);
  if (returnedItems.length === 0) {
    return { attempted: false, processed: 0, error: null };
  }

  if (!reservationContext) {
    return { attempted: true, processed: 0, error: "ไม่พบข้อมูลห้องสำหรับคืนของเข้าชั้น" };
  }

  const { data, error } = await supabase.rpc("hk_return_floor_stock", {
    p_task_id: taskId,
    p_reservation_id: reservationContext.reservation_id,
    p_room_id: reservationContext.room_id,
    p_room_number: reservationContext.room_number,
    p_floor_number: reservationContext.floor_number,
    p_maid_name: payload.maid_name ?? null,
    p_items: returnedItems,
  });

  if (error) {
    return { attempted: true, processed: 0, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    attempted: true,
    processed: Number(row?.processed ?? 0),
    error: null,
  };
}

async function collectLoanTracesNonBlocking(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  taskId: string,
  traceIds: string[] | undefined,
  resolvedBy: string | null
): Promise<{
  attempted: boolean;
  requested: number;
  collected: number;
  skipped: number;
  error: string | null;
}> {
  const requestedTraceIds = Array.from(
    new Set((traceIds ?? []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (requestedTraceIds.length === 0) {
    return { attempted: false, requested: 0, collected: 0, skipped: 0, error: null };
  }

  try {
    const { data: task, error: taskError } = await supabase
      .from("housekeeping_tasks")
      .select("id, room_id, stay_date")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError || !task) {
      return {
        attempted: true,
        requested: requestedTraceIds.length,
        collected: 0,
        skipped: requestedTraceIds.length,
        error: taskError?.message || "Housekeeping task not found",
      };
    }

    const { data: roomNightRows, error: roomNightError } = await supabase
      .from("reservation_nights")
      .select("reservation_id, stay_date")
      .eq("room_id", task.room_id)
      .lte("stay_date", task.stay_date);
    if (roomNightError) {
      return {
        attempted: true,
        requested: requestedTraceIds.length,
        collected: 0,
        skipped: requestedTraceIds.length,
        error: roomNightError.message,
      };
    }

    const validReservationIds = new Set(
      (roomNightRows ?? []).map((row) => String(row.reservation_id ?? "")).filter(Boolean)
    );

    const { data: traces, error: traceError } = await supabase
      .from("reservation_traces")
      .select("id, reservation_id, loan_item_code, loan_qty, status, loan_items(requires_hk_collection)")
      .in("id", requestedTraceIds);
    if (traceError) {
      return {
        attempted: true,
        requested: requestedTraceIds.length,
        collected: 0,
        skipped: requestedTraceIds.length,
        error: traceError.message,
      };
    }

    const eligibleTraces = (traces ?? []).filter((trace: any) => {
      const reservationId = String(trace.reservation_id ?? "");
      const requiresHkCollection = Boolean(trace?.loan_items?.requires_hk_collection);
      return validReservationIds.has(reservationId) && trace.status === "open" && requiresHkCollection;
    });

    for (const trace of eligibleTraces) {
      if (trace.loan_item_code && Number(trace.loan_qty ?? 0) > 0) {
        await restoreLoanItemStock(supabase, String(trace.loan_item_code), Number(trace.loan_qty));
      }
    }

    if (eligibleTraces.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("reservation_traces")
        .update({
          status: "done",
          resolved_at: nowIso,
          resolved_by: resolvedBy ?? "maid",
        })
        .in("id", eligibleTraces.map((trace: any) => String(trace.id)));
      if (updateError) {
        return {
          attempted: true,
          requested: requestedTraceIds.length,
          collected: 0,
          skipped: requestedTraceIds.length,
          error: updateError.message,
        };
      }
    }

    return {
      attempted: true,
      requested: requestedTraceIds.length,
      collected: eligibleTraces.length,
      skipped: Math.max(requestedTraceIds.length - eligibleTraces.length, 0),
      error: null,
    };
  } catch (err) {
    return {
      attempted: true,
      requested: requestedTraceIds.length,
      collected: 0,
      skipped: requestedTraceIds.length,
      error: err instanceof Error ? err.message : "collect-loan failed",
    };
  }
}

async function completeMaintenanceLegacy(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  task: {
    room_id: string;
    stay_date: string;
  },
  payload: FinishPayload
): Promise<number> {
  const maintenanceNote = payload.maintenance_note?.trim() || null;
  const maidName = payload.maid_name?.trim() || null;

  let selectionQuery = supabase
    .from("maintenance_assignments")
    .select("id, task_id")
    .eq("room_id", task.room_id)
    .eq("assigned_date", task.stay_date)
    .eq("status", "pending");

  if ((payload.maintenance_assignment_ids ?? []).length > 0) {
    selectionQuery = selectionQuery.in("id", payload.maintenance_assignment_ids ?? []);
  }

  const { data: targetAssignments, error: targetError } = await selectionQuery;
  if (targetError) {
    throw new Error(`Failed to fetch maintenance assignments: ${targetError.message}`);
  }

  const assignmentIds = (targetAssignments ?? []).map((row) => row.id);
  if (assignmentIds.length === 0) return 0;

  const completedAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: "completed",
    completed_at: completedAt,
  };
  if (maintenanceNote) updates.notes = maintenanceNote;

  const { data: completedRows, error: updateError } = await supabase
    .from("maintenance_assignments")
    .update(updates)
    .in("id", assignmentIds)
    .eq("status", "pending")
    .select("id, task_id");

  if (updateError) {
    throw new Error(`Failed to complete maintenance assignments: ${updateError.message}`);
  }

  const completed = completedRows ?? [];
  if (completed.length === 0) return 0;

  const logPayload = completed.map((row) => ({
    room_id: task.room_id,
    task_id: row.task_id,
    performed_by: maidName,
    notes: maintenanceNote ?? `Completed with housekeeping task`,
  }));

  const { error: logError } = await supabase.from("maintenance_logs").insert(logPayload);
  if (logError) {
    throw new Error(`Failed to insert maintenance logs: ${logError.message}`);
  }

  return completed.length;
}

async function finishTaskLegacy(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  id: string,
  payload: FinishPayload
) {
  const { data: task, error: fetchError } = await supabase
    .from("housekeeping_tasks")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !task) {
    throw new Error("Task not found");
  }

  if (task.status !== "in_progress" && task.status !== "paused") {
    throw new Error(`Task must be in_progress or paused to finish (current: ${task.status})`);
  }

  let finalMs: number;
  if (task.status === "in_progress") {
    if (!task.started_at) {
      throw new Error("Data inconsistency: in_progress task has no started_at");
    }
    const now = Date.now();
    const startedMs = new Date(task.started_at).getTime();
    finalMs = (task.accumulated_ms ?? 0) + Math.max(now - startedMs, 0);
  } else {
    finalMs = task.accumulated_ms ?? 0;
  }

  const nowIso = new Date().toISOString();
  const finalMin = Math.max(1, Math.round(finalMs / 60_000));
  const { error: updateError } = await supabase
    .from("housekeeping_tasks")
    .update({
      status: "cleaned",
      finished_at: nowIso,
      accumulated_ms: finalMs,
      started_at: null,
      checklist_snapshot: payload.checklist ?? null,
    })
    .eq("id", id);

  if (updateError) {
    throw new Error(`Failed to update task: ${updateError.message}`);
  }

  const { error: logError } = await supabase.from("housekeeping_logs").insert({
    task_id: id,
    status: "cleaned" as const,
    note: payload.note ?? `finished by ${payload.maid_name ?? "unknown"}, duration: ${finalMin} min`,
    checklist: payload.checklist ?? null,
  });
  if (logError) {
    console.error("Failed to insert housekeeping cleaned log:", logError.message);
  }

  const maintenanceCompletedCount = await completeMaintenanceLegacy(supabase, task, payload);

  const shouldAutoApprove = payload.auto_approve || Boolean(task.is_no_service);
  let autoApproveError: string | null = null;
  let finalStatus = "cleaned";
  if (shouldAutoApprove) {
    const approvedAt = new Date().toISOString();
    const { error: approveUpdateError } = await supabase
      .from("housekeeping_tasks")
      .update({
        status: "approved",
        approved_at: approvedAt,
      })
      .eq("id", id);

    if (approveUpdateError) {
      autoApproveError = approveUpdateError.message;
    } else {
      finalStatus = "approved";
      const approver = payload.approved_by ?? payload.maid_name ?? "system";
      const { error: approveLogError } = await supabase.from("housekeeping_logs").insert({
        task_id: id,
        status: "approved" as const,
        note: `approved by ${approver}${task.is_no_service ? " (no service auto-approve)" : ""}`,
      });
      if (approveLogError) {
        console.error("Failed to insert approve log:", approveLogError.message);
      }
    }
  }

  return {
    duration_ms: finalMs,
    final_status: finalStatus,
    auto_approved: shouldAutoApprove && !autoApproveError,
    auto_approve_error: autoApproveError,
    maintenance_completed_count: maintenanceCompletedCount,
    mode: "legacy_fallback",
  };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id } = params;

    const json = await request.json().catch(() => null);
    const parsed = finishSchema.safeParse(json ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const { data: taskRoomData } = await supabase
      .from("housekeeping_tasks")
      .select("id, room_id, stay_date, rooms(room_number, floor_number)")
      .eq("id", id)
      .maybeSingle();

    const roomCtx: TaskRoomContext = {
      room_id: (taskRoomData as { room_id?: string | null } | null)?.room_id ?? null,
      room_number: (taskRoomData?.rooms as { room_number?: string | null } | null)?.room_number ?? null,
      floor_number: (taskRoomData?.rooms as { floor_number?: number | null } | null)?.floor_number ?? null,
      stay_date: (taskRoomData as { stay_date?: string | null } | null)?.stay_date ?? null,
    };

    const reservationContext = await resolveTaskReservationContext(supabase, roomCtx);
    if (
      reservationContext &&
      reservationContext.status === "checked_out" &&
      getStayNightCount(reservationContext.checkin_date, reservationContext.checkout_date) > 1
    ) {
      await backfillReturnableAmenityLedgerIfMissing(supabase, {
        reservationId: reservationContext.reservation_id,
        roomId: reservationContext.room_id,
        roomNumber: reservationContext.room_number,
        floorNumber: reservationContext.floor_number,
        checkinDate: reservationContext.checkin_date ?? null,
        checkoutDate: reservationContext.checkout_date ?? null,
      });
    }
    const returnValidation = await validateReturnStockPayload(supabase, reservationContext, body);
    if (!returnValidation.valid) {
      return NextResponse.json({ error: returnValidation.error }, { status: 400 });
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("hk_finish_task_with_maintenance", {
      p_task_id: id,
      p_maid_name: body.maid_name ?? null,
      p_note: body.note ?? null,
      p_checklist: body.checklist ?? null,
      p_auto_approve: body.auto_approve ?? false,
      p_approved_by: body.approved_by ?? null,
      p_maintenance_assignment_ids: body.maintenance_assignment_ids ?? null,
      p_maintenance_note: body.maintenance_note ?? null,
      p_maintenance_checklist: body.maintenance_checklist ?? null,
    });

    if (rpcError) {
      if (shouldFallbackToLegacy(rpcError.message)) {
        return NextResponse.json(
          {
            error:
              "DB migration required: apply 20260301_phase9_maintenance_checklist_results.sql and reload schema to enable hk_finish_task_with_maintenance RPC.",
            details: rpcError.message,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to finish task atomically", details: rpcError.message },
        { status: 500 }
      );
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const stockResult = await applyStockDeductionNonBlocking(supabase, id, body, roomCtx);
    const deliveryLedgerResult = await recordAmenityDeliveries(supabase, id, body, reservationContext);
    const stockReturnResult = await applyStockReturn(supabase, id, body, reservationContext);
    const loanCollectionResult = await collectLoanTracesNonBlocking(
      supabase,
      id,
      body.collected_loan_trace_ids,
      body.maid_name ?? null
    );

    // Audit log (non-blocking)
    try {
      const finalStatus = String(row?.final_status ?? "cleaned");
      await supabase.from("audit_logs").insert({
        action: finalStatus === "approved" ? "done" : "done",
        entity_type: "housekeeping_task",
        entity_id: id,
        before_json: { status: "in_progress" },
        after_json: {
          status: finalStatus,
          maid_name: body.maid_name ?? null,
          auto_approved: Boolean(row?.auto_approved),
          duration_ms: Number(row?.duration_ms ?? 0),
          room_number: roomCtx.room_number,
        },
        business_date: toBangkokDateString(),
        source: normalizeAuditSource("manual"),
      });
    } catch (auditErr) {
      console.error("HK finish audit log failed:", auditErr);
    }

    return NextResponse.json({
      success: true,
      duration_ms: Number(row?.duration_ms ?? 0),
      final_status: String(row?.final_status ?? "cleaned"),
      auto_approved: Boolean(row?.auto_approved),
      maintenance_completed_count: Number(row?.maintenance_completed_count ?? 0),
      mode: "atomic_rpc",
      stock_deduction: stockResult,
      amenity_deliveries: deliveryLedgerResult,
      stock_return: stockReturnResult,
      loan_collection: loanCollectionResult,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
