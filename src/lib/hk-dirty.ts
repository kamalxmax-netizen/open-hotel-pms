/**
 * hk-dirty.ts
 * Smart helper to mark a room as dirty without overwriting completed HK tasks.
 *
 * Rule: if the latest task for (room_id, stay_date) is already completed
 * (status = "cleaned" or "approved"), INSERT a NEW task with task_seq + 1
 * instead of overwriting the completed record.
 *
 * This preserves full history when a room is cleaned and then made dirty again
 * on the same day (e.g., guest moves out after move-room, or second checkout).
 */

type SupabaseLike = {
  from: (table: string) => any;
};

export type MarkDirtyOptions = {
  roomId: string;
  stayDate: string;
  /**
   * - undefined: keep current assignee when updating an existing active task
   * - null: force unassign (send to Pool)
   * - string: force assign to this maid
   */
  assignedMaidName?: string | null;
  /**
   * When force-unassigning to Pool, also clear assignment board row
   * (`daily_plans`) for the same room + date.
   */
  clearDailyPlanWhenUnassigned?: boolean;
  /** Short note stored in housekeeping_logs */
  logNote?: string;
};

export type MarkDirtyResult = {
  task_id: string;
  task_seq: number;
  /** true = new task row was inserted (previous was completed) */
  created_new: boolean;
};

/**
 * Mark a room as dirty.
 * - If no task exists for (room_id, stay_date): INSERT task_seq = 1
 * - If existing task is NOT completed (dirty / in_progress / paused): UPDATE it
 * - If existing task IS completed (cleaned / approved): INSERT task_seq = n + 1
 */
export async function markRoomDirtyTask(
  supabase: SupabaseLike,
  options: MarkDirtyOptions
): Promise<MarkDirtyResult> {
  const {
    roomId,
    stayDate,
    assignedMaidName,
    clearDailyPlanWhenUnassigned = false,
    logNote = "Marked dirty",
  } = options;
  const hasAssignedMaidOverride = Object.prototype.hasOwnProperty.call(options, "assignedMaidName");

  // --- 1. Find the latest existing task for this room+date ---
  const { data: latestTask, error: fetchError } = await supabase
    .from("housekeeping_tasks")
    .select("id, task_seq, status, assigned_maid_name")
    .eq("room_id", roomId)
    .eq("stay_date", stayDate)
    .order("task_seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message ?? "Failed to fetch HK task");

  const isCompleted =
    latestTask?.status === "cleaned" || latestTask?.status === "approved";

  // --- 2a. INSERT new task (no existing OR existing is completed) ---
  if (!latestTask || isCompleted) {
    const nextSeq = latestTask ? latestTask.task_seq + 1 : 1;

    const { data: newTask, error: insertError } = await supabase
      .from("housekeeping_tasks")
      .insert({
        room_id: roomId,
        stay_date: stayDate,
        task_seq: nextSeq,
        status: "dirty",
        is_no_service: false,
        no_service_note: null,
        no_service_marked_at: null,
        no_service_marked_by: null,
        started_at: null,
        finished_at: null,
        approved_at: null,
        accumulated_ms: 0,
        assigned_maid_name: hasAssignedMaidOverride ? (assignedMaidName ?? null) : null,
      })
      .select("id, task_seq")
      .single();

    if (insertError) throw new Error(insertError.message ?? "Failed to insert HK task");

    await supabase.from("housekeeping_logs").insert({
      task_id: String(newTask.id),
      status: "dirty",
      note: logNote,
    });

    if (clearDailyPlanWhenUnassigned && hasAssignedMaidOverride && assignedMaidName == null) {
      const { error: clearPlanError } = await supabase
        .from("daily_plans")
        .delete()
        .eq("plan_date", stayDate)
        .eq("room_id", roomId);
      if (clearPlanError) {
        throw new Error(clearPlanError.message ?? "Failed to clear HK daily plan assignment");
      }
    }

    return { task_id: String(newTask.id), task_seq: Number(newTask.task_seq), created_new: true };
  }

  // --- 2b. UPDATE existing task (not completed) ---
  const { data: updatedTask, error: updateError } = await supabase
    .from("housekeeping_tasks")
    .update({
      status: "dirty",
      is_no_service: false,
      no_service_note: null,
      no_service_marked_at: null,
      no_service_marked_by: null,
      started_at: null,
      finished_at: null,
      approved_at: null,
      accumulated_ms: 0,
      assigned_maid_name: hasAssignedMaidOverride
        ? (assignedMaidName ?? null)
        : (latestTask.assigned_maid_name ?? null),
    })
    .eq("id", latestTask.id)
    .select("id, task_seq")
    .single();

  if (updateError) throw new Error(updateError.message ?? "Failed to update HK task");

  await supabase.from("housekeeping_logs").insert({
    task_id: String(updatedTask.id),
    status: "dirty",
    note: logNote,
  });

  if (clearDailyPlanWhenUnassigned && hasAssignedMaidOverride && assignedMaidName == null) {
    const { error: clearPlanError } = await supabase
      .from("daily_plans")
      .delete()
      .eq("plan_date", stayDate)
      .eq("room_id", roomId);
    if (clearPlanError) {
      throw new Error(clearPlanError.message ?? "Failed to clear HK daily plan assignment");
    }
  }

  return {
    task_id: String(updatedTask.id),
    task_seq: Number(updatedTask.task_seq),
    created_new: false,
  };
}
