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
});

type FinishPayload = z.infer<typeof finishSchema>;
type StockChecklistItem = { product_id: string; used: number };
type TaskRoomContext = {
  room_number: string | null;
  floor_number: number | null;
};

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
      .select("id, room_id")
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
      .select("reservation_id")
      .eq("room_id", task.room_id)
      .is("cancelled_at", null);
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
      .select("id, rooms(room_number, floor_number)")
      .eq("id", id)
      .maybeSingle();

    const roomCtx: TaskRoomContext = {
      room_number: (taskRoomData?.rooms as { room_number?: string | null } | null)?.room_number ?? null,
      floor_number: (taskRoomData?.rooms as { floor_number?: number | null } | null)?.floor_number ?? null,
    };

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
    const loanCollectionResult = await collectLoanTracesNonBlocking(
      supabase,
      id,
      body.collected_loan_trace_ids,
      body.maid_name ?? null
    );
    return NextResponse.json({
      success: true,
      duration_ms: Number(row?.duration_ms ?? 0),
      final_status: String(row?.final_status ?? "cleaned"),
      auto_approved: Boolean(row?.auto_approved),
      maintenance_completed_count: Number(row?.maintenance_completed_count ?? 0),
      mode: "atomic_rpc",
      stock_deduction: stockResult,
      loan_collection: loanCollectionResult,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
