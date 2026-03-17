import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const maidRoomsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  maid_name: z.string().trim().min(1, "maid_name is required"),
});

type TaskStatus = "dirty" | "in_progress" | "paused" | "cleaned" | "approved";

type MaintenanceAssignmentRow = {
  assignment_id: string;
  room_id: string;
  task_id: string;
  task_name: string;
  sync_to_housekeeper: boolean | null;
  checklist_items: string[] | null;
  estimated_minutes: number | null;
  notes: string | null;
};

type MaidTaskRow = {
  id: string;
  room_id: string;
  stay_date: string;
  status: TaskStatus;
  is_no_service: boolean | null;
  no_service_note?: string | null;
  accumulated_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  approved_at: string | null;
};

type MaidRoomsSummary = {
  total: number;
  dirty: number;
  in_progress: number;
  paused: number;
  cleaned: number;
  approved: number;
  no_service: number;
};

function emptySummary(): MaidRoomsSummary {
  return {
    total: 0,
    dirty: 0,
    in_progress: 0,
    paused: 0,
    cleaned: 0,
    approved: 0,
    no_service: 0,
  };
}

function getThailandDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function shiftDate(dateStr: string, diffDays: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setUTCDate(d.getUTCDate() + diffDays);
  return d.toISOString().slice(0, 10);
}

type CarryForwardTask = {
  id: string;
  room_id: string;
  status: "dirty" | "in_progress" | "paused";
  assigned_maid_name: string | null;
  is_no_service: boolean | null;
  no_service_note?: string | null;
  accumulated_ms: number | null;
  started_at: string | null;
};

async function autoCarryForwardOpenHousekeepingTasks(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  targetDate: string,
  roomIds: string[]
) {
  if (roomIds.length === 0) return;
  if (targetDate !== getThailandDateString()) return;

  const yesterday = shiftDate(targetDate, -1);
  const { data: prevRowsRaw, error: prevError } = await supabase
    .from("housekeeping_tasks")
    .select("id, room_id, status, assigned_maid_name, is_no_service, no_service_note, accumulated_ms, started_at")
    .eq("stay_date", yesterday)
    .in("room_id", roomIds)
    .in("status", ["dirty", "in_progress", "paused"]);
  if (prevError) throw new Error(prevError.message);

  const prevRows = (prevRowsRaw ?? []) as unknown as CarryForwardTask[];
  if (prevRows.length === 0) return;

  const prevRoomIds = Array.from(new Set(prevRows.map((row) => row.room_id)));
  const { data: todayRows, error: todayError } = await supabase
    .from("housekeeping_tasks")
    .select("room_id")
    .eq("stay_date", targetDate)
    .in("room_id", prevRoomIds);
  if (todayError) throw new Error(todayError.message);

  const todayRoomSet = new Set((todayRows ?? []).map((row) => String(row.room_id)));
  const nowMs = Date.now();

  for (const prev of prevRows) {
    if (todayRoomSet.has(prev.room_id)) continue;

    const carryStatus: "dirty" | "paused" = prev.status === "dirty" ? "dirty" : "paused";
    let carryAccumulatedMs = Math.max(Number(prev.accumulated_ms ?? 0), 0);
    if (prev.status === "in_progress" && prev.started_at) {
      const startedMs = new Date(prev.started_at).getTime();
      if (!Number.isNaN(startedMs)) {
        carryAccumulatedMs += Math.max(nowMs - startedMs, 0);
      }
    }

    const { error: carryError } = await supabase
      .from("housekeeping_tasks")
      .upsert(
        {
          room_id: prev.room_id,
          stay_date: targetDate,
          task_seq: 1,
          status: carryStatus,
          assigned_maid_name: prev.assigned_maid_name ?? null,
          is_no_service: prev.is_no_service ?? false,
          no_service_note: prev.no_service_note ?? null,
          accumulated_ms: carryStatus === "paused" ? carryAccumulatedMs : 0,
          started_at: null,
          finished_at: null,
          approved_at: null,
        },
        { onConflict: "room_id,stay_date,task_seq", ignoreDuplicates: true }
      );
    if (carryError) throw new Error(carryError.message);

    if (prev.status === "in_progress") {
      const { error: normalizePrevError } = await supabase
        .from("housekeeping_tasks")
        .update({
          status: "paused",
          started_at: null,
          accumulated_ms: carryAccumulatedMs,
        })
        .eq("id", prev.id)
        .eq("status", "in_progress");
      if (normalizePrevError) throw new Error(normalizePrevError.message);
    }
  }
}

function toRoomNumberSortKey(roomNumber: string): string {
  return roomNumber ?? "";
}

function normalizeMaidName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isMaidMatch(candidate: string | null | undefined, target: string): boolean {
  const c = normalizeMaidName(candidate);
  const t = normalizeMaidName(target);
  if (!c || !t) return false;
  if (c === t) return true;

  const compactCandidate = c.replace(/[^a-z0-9ก-๙]/g, "");
  const compactTarget = t.replace(/[^a-z0-9ก-๙]/g, "");
  if (compactCandidate && compactCandidate === compactTarget) return true;

  return c.includes(t) || t.includes(c);
}

export async function GET(request: NextRequest) {
  try {
    const rawDate = request.nextUrl.searchParams.get("date") ?? undefined;
    const rawMaid = request.nextUrl.searchParams.get("maid_name") ?? "";

    const parsedQuery = maidRoomsQuerySchema.safeParse({
      date: rawDate,
      maid_name: rawMaid,
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const date = parsedQuery.data.date ?? getThailandDateString();
    const maidName = parsedQuery.data.maid_name;

    const supabase = createServerSupabaseClient();

    // Load all plans for date then match maid in code (trim/case-insensitive).
    const { data: allPlanRows, error: planError } = await supabase
      .from("daily_plans")
      .select("room_id, assigned_maid, priority")
      .eq("plan_date", date)
      .order("priority", { ascending: true });

    if (planError) {
      return NextResponse.json({ error: planError.message }, { status: 500 });
    }

    const maidPlanRows = (allPlanRows ?? []).filter((row) =>
      isMaidMatch(row.assigned_maid, maidName)
    );

    const planByRoomId = new Map<string, { priority: number }>();
    for (const row of maidPlanRows) {
      const current = planByRoomId.get(row.room_id);
      if (!current || row.priority < current.priority) {
        planByRoomId.set(row.room_id, { priority: row.priority });
      }
    }

    // Fallback source: runtime task assignment (in case plan rows are missing).
    const { data: allAssignedTasks, error: assignedTaskError } = await supabase
      .from("housekeeping_tasks")
      .select("room_id, assigned_maid_name, status")
      .eq("stay_date", date)
      .not("assigned_maid_name", "is", null)
      .in("status", ["dirty", "in_progress", "paused", "cleaned", "approved"]);

    if (assignedTaskError) {
      return NextResponse.json({ error: assignedTaskError.message }, { status: 500 });
    }

    const fallbackTaskRoomIds = Array.from(
      new Set(
        (allAssignedTasks ?? [])
          .filter((row) => isMaidMatch(row.assigned_maid_name, maidName))
          .map((row) => row.room_id)
      )
    );

    let carryForwardRoomIds: string[] = [];
    if (date === getThailandDateString()) {
      const yesterday = shiftDate(date, -1);
      const { data: prevAssignedRows, error: prevAssignedError } = await supabase
        .from("housekeeping_tasks")
        .select("room_id, assigned_maid_name")
        .eq("stay_date", yesterday)
        .not("assigned_maid_name", "is", null)
        .in("status", ["dirty", "in_progress", "paused"]);
      if (prevAssignedError) {
        return NextResponse.json({ error: prevAssignedError.message }, { status: 500 });
      }
      carryForwardRoomIds = Array.from(
        new Set(
          (prevAssignedRows ?? [])
            .filter((row) => isMaidMatch(row.assigned_maid_name, maidName))
            .map((row) => String(row.room_id))
        )
      );
    }

    const candidateRoomIds = Array.from(
      new Set([...planByRoomId.keys(), ...fallbackTaskRoomIds, ...carryForwardRoomIds])
    );

    if (candidateRoomIds.length === 0) {
      return NextResponse.json({
        success: true,
        date,
        maid_name: maidName,
        summary: emptySummary(),
        rooms: [],
      });
    }

    const { data: roomRows, error: roomError } = await supabase
      .from("rooms")
      .select("id, room_number, room_type_id")
      .in("id", candidateRoomIds);

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }

    const roomById = new Map<string, { room_number: string; room_type_id: string | null }>();
    for (const row of roomRows ?? []) {
      roomById.set(row.id, {
        room_number: row.room_number ?? "",
        room_type_id: row.room_type_id ?? null,
      });
    }

    const roomTypeIds = Array.from(
      new Set(
        (roomRows ?? [])
          .map((row) => row.room_type_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const roomTypeCodeById = new Map<string, string>();
    const roomTypeCleaningDurationById = new Map<string, number>();
    if (roomTypeIds.length > 0) {
      const { data: roomTypeRows, error: roomTypeError } = await supabase
        .from("room_types")
        .select("id, code, cleaning_duration_min")
        .in("id", roomTypeIds);

      if (roomTypeError) {
        const message = String(roomTypeError.message ?? "").toLowerCase();
        if (message.includes("cleaning_duration_min")) {
          return NextResponse.json(
            {
              error:
                "DB migration required: apply 20260228_housekeeping_phase6.sql before using maid rooms API.",
            },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: roomTypeError.message }, { status: 500 });
      }

      for (const row of roomTypeRows ?? []) {
        roomTypeCodeById.set(row.id, row.code ?? "");
        roomTypeCleaningDurationById.set(
          row.id,
          Math.max(Number((row as { cleaning_duration_min?: number | null }).cleaning_duration_min ?? 60), 1)
        );
      }
    }

    const baseRooms = candidateRoomIds.map((roomId) => {
      const room = roomById.get(roomId);
      const roomTypeCode = room?.room_type_id
        ? roomTypeCodeById.get(room.room_type_id) ?? ""
        : "";
      const plan = planByRoomId.get(roomId);
      return {
        room_id: roomId,
        room_number: room?.room_number ?? "",
        room_type_code: roomTypeCode,
        cleaning_duration_min: room?.room_type_id
          ? roomTypeCleaningDurationById.get(room.room_type_id) ?? 60
          : 60,
        priority: plan?.priority ?? 999,
      };
    });

    const roomIds = baseRooms.map((r) => r.room_id);
    const roomTypeCodes = Array.from(
      new Set(baseRooms.map((r) => r.room_type_code).filter(Boolean))
    );

    // Hotfix: when maid opens app today, auto carry unresolved tasks from yesterday.
    await autoCarryForwardOpenHousekeepingTasks(supabase, date, roomIds);

    const maintenanceByRoomId = new Map<
      string,
      Array<{
        assignment_id: string;
        task_id: string;
        task_name: string;
        sync_to_housekeeper: boolean;
        checklist_items: string[] | null;
        estimated_minutes: number;
        notes: string | null;
      }>
    >();

    const { data: maintenanceRows, error: maintenanceError } = await supabase.rpc(
      "get_todays_maintenance_assignments",
      { p_target_date: date }
    );
    if (maintenanceError) {
      console.error("maid-rooms GET maintenance rpc failed", maintenanceError);
    } else {
      const roomIdSet = new Set(roomIds);
      for (const row of ((maintenanceRows ?? []) as MaintenanceAssignmentRow[])) {
        if (!roomIdSet.has(String(row.room_id))) continue;
        const roomId = String(row.room_id);
        if (!maintenanceByRoomId.has(roomId)) maintenanceByRoomId.set(roomId, []);
        maintenanceByRoomId.get(roomId)?.push({
          assignment_id: String(row.assignment_id),
          task_id: String(row.task_id),
          task_name: String(row.task_name ?? ""),
          sync_to_housekeeper: Boolean(row.sync_to_housekeeper),
          checklist_items: Array.isArray(row.checklist_items) ? row.checklist_items : null,
          estimated_minutes: Number(row.estimated_minutes ?? 0),
          notes: row.notes ?? null,
        });
      }
    }

    const taskSelectBase =
      "id, room_id, stay_date, status, is_no_service, accumulated_ms, started_at, finished_at, approved_at";
    const { data: taskRowsRaw, error: taskError } = await supabase
      .from("housekeeping_tasks")
      .select(`${taskSelectBase}, no_service_note`)
      .eq("stay_date", date)
      .in("room_id", roomIds);

    if (taskError) {
      const message = String(taskError.message ?? "").toLowerCase();
      if (message.includes("no_service_note")) {
        return NextResponse.json(
          {
            error:
              "DB migration required: apply 20260303_phase11_hk_no_service_note.sql before using maid rooms API.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: taskError.message }, { status: 500 });
    }
    const taskRows = (taskRowsRaw ?? []) as unknown as MaidTaskRow[];

    const taskByRoomId = new Map<
      string,
      {
        id: string;
        status: TaskStatus;
        is_no_service: boolean;
        no_service_note: string | null;
        accumulated_ms: number;
        started_at: string | null;
        finished_at: string | null;
        approved_at: string | null;
      }
    >();

    for (const row of taskRows) {
      taskByRoomId.set(row.room_id, {
        id: row.id,
        status: row.status as TaskStatus,
        is_no_service: row.is_no_service ?? false,
        no_service_note: row.no_service_note ?? null,
        accumulated_ms: row.accumulated_ms ?? 0,
        started_at: row.started_at ?? null,
        finished_at: row.finished_at ?? null,
        approved_at: row.approved_at ?? null,
      });
    }

    const guestVisibleReservationStatuses = new Set(["active"]);

    const { data: nightRows, error: nightError } = await supabase
      .from("reservation_nights")
      .select("room_id, reservation_id")
      .eq("stay_date", date)
      .is("cancelled_at", null)
      .in("room_id", roomIds);

    if (nightError) {
      return NextResponse.json({ error: nightError.message }, { status: 500 });
    }

    const reservationIds = Array.from(
      new Set(
        (nightRows ?? [])
          .map((row) => row.reservation_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const reservationById = new Map<
      string,
      {
        guest_name: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }
    >();

    if (reservationIds.length > 0) {
      const { data: reservationRows, error: reservationError } = await supabase
        .from("reservations")
        .select("id, guest_name, checkin_date, checkout_date, status")
        .in("id", reservationIds);

      if (reservationError) {
        return NextResponse.json({ error: reservationError.message }, { status: 500 });
      }

      for (const row of reservationRows ?? []) {
        if (!guestVisibleReservationStatuses.has(String(row.status ?? ""))) {
          continue;
        }
        reservationById.set(row.id, {
          guest_name: row.guest_name ?? null,
          checkin_date: row.checkin_date ?? null,
          checkout_date: row.checkout_date ?? null,
        });
      }
    }

    const guestByRoomId = new Map<
      string,
      {
        guest_name: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }
    >();

    const recentReservationByRoomId = new Map<
      string,
      {
        reservation_id: string;
        status: string | null;
        guest_name: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }
    >();

    for (const row of nightRows ?? []) {
      if (!row.reservation_id) continue;
      const reservation = reservationById.get(row.reservation_id);
      if (!reservation) continue;
      if (guestByRoomId.has(row.room_id)) continue;
      guestByRoomId.set(row.room_id, reservation);
    }

    const { data: recentNightRows, error: recentNightError } = await supabase
      .from("reservation_nights")
      .select("room_id, reservation_id, stay_date")
      .lte("stay_date", date)
      .is("cancelled_at", null)
      .in("room_id", roomIds)
      .order("stay_date", { ascending: false });

    if (recentNightError) {
      return NextResponse.json({ error: recentNightError.message }, { status: 500 });
    }

    const recentReservationIds = Array.from(
      new Set(
        (recentNightRows ?? [])
          .map((row) => row.reservation_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (recentReservationIds.length > 0) {
      const { data: recentReservationRows, error: recentReservationError } = await supabase
        .from("reservations")
        .select("id, status, guest_name, checkin_date, checkout_date")
        .in("id", recentReservationIds);

      if (recentReservationError) {
        return NextResponse.json({ error: recentReservationError.message }, { status: 500 });
      }

      const recentReservationLookup = new Map(
        (recentReservationRows ?? []).map((row) => [
          String(row.id),
          {
            reservation_id: String(row.id),
            status: row.status ?? null,
            guest_name: row.guest_name ?? null,
            checkin_date: row.checkin_date ?? null,
            checkout_date: row.checkout_date ?? null,
          }
        ])
      );

      for (const row of recentNightRows ?? []) {
        const roomId = String(row.room_id ?? "");
        const reservationId = String(row.reservation_id ?? "");
        if (!roomId || !reservationId) continue;
        if (recentReservationByRoomId.has(roomId)) continue;
        const reservation = recentReservationLookup.get(reservationId);
        if (!reservation) continue;
        recentReservationByRoomId.set(roomId, reservation);
      }
    }

    const loanCollectionsByReservationId = new Map<
      string,
      Array<{
        trace_id: string;
        item_code: string;
        item_name: string;
        item_icon: string;
        quantity: number;
        due_date: string | null;
      }>
    >();

    const loanCollectionReservationIds = Array.from(
      new Set(
        Array.from(recentReservationByRoomId.values()).map((row) => row.reservation_id)
      )
    );
    const runtimeTraceReservationIds = Array.from(
      new Set(
        Array.from(recentReservationByRoomId.values())
          .filter((row) => row.status === "active")
          .map((row) => row.reservation_id)
      )
    );

    if (loanCollectionReservationIds.length > 0) {
      const { data: loanTraceRows, error: loanTraceError } = await supabase
        .from("reservation_traces")
        .select("id, reservation_id, loan_item_code, loan_qty, due_date, loan_items(code, name, icon, requires_hk_collection)")
        .in("reservation_id", loanCollectionReservationIds)
        .eq("status", "open")
        .not("loan_item_code", "is", null);

      if (loanTraceError) {
        return NextResponse.json({ error: loanTraceError.message }, { status: 500 });
      }

      for (const row of loanTraceRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        const item = (row as any).loan_items;
        if (!reservationId || !item?.requires_hk_collection) continue;
        if (!loanCollectionsByReservationId.has(reservationId)) {
          loanCollectionsByReservationId.set(reservationId, []);
        }
        loanCollectionsByReservationId.get(reservationId)?.push({
          trace_id: String((row as any).id ?? ""),
          item_code: String((row as any).loan_item_code ?? ""),
          item_name: String(item.name ?? (row as any).loan_item_code ?? ""),
          item_icon: String(item.icon ?? "📦"),
          quantity: Number((row as any).loan_qty ?? 1),
          due_date: (row as any).due_date ? String((row as any).due_date) : null,
        });
      }
    }

    const hkTraceItemsByReservationId = new Map<
      string,
      Array<{
        id: string;
        text: string;
      }>
    >();

    if (runtimeTraceReservationIds.length > 0) {
      const { data: hkTraceRows, error: hkTraceError } = await supabase
        .from("reservation_traces")
        .select("id, reservation_id, trace_text, dept, loan_item_code, status")
        .in("reservation_id", runtimeTraceReservationIds)
        .eq("status", "open")
        .eq("dept", "HK")
        .is("loan_item_code", null);

      if (hkTraceError) {
        return NextResponse.json({ error: hkTraceError.message }, { status: 500 });
      }

      for (const row of hkTraceRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        const traceText = String((row as any).trace_text ?? "").trim();
        if (!reservationId || !traceText) continue;
        if (!hkTraceItemsByReservationId.has(reservationId)) {
          hkTraceItemsByReservationId.set(reservationId, []);
        }
        hkTraceItemsByReservationId.get(reservationId)?.push({
          id: String((row as any).id ?? ""),
          text: traceText,
        });
      }
    }

    const checklistByRoomType = new Map<
      string,
      Array<{
        item: string;
        quantity: number;
        used: number;
        checked: boolean;
        category: string;
        item_name: string;
        default_quantity: number;
        product_id: string | null;
      }>
    >();

    if (roomTypeCodes.length > 0) {
      const { data: checklistRows, error: checklistError } = await supabase
        .from("checklist_templates")
        .select("room_type_code, item_name, default_quantity, category, sort_order, product_id")
        .eq("is_active", true)
        .in("room_type_code", roomTypeCodes)
        .order("sort_order", { ascending: true });

      if (checklistError) {
        return NextResponse.json({ error: checklistError.message }, { status: 500 });
      }

      for (const row of checklistRows ?? []) {
        const normalizedCategory = String(row.category ?? "").trim().toLowerCase();
        const isSupportedAmenityCategory =
          normalizedCategory === "amenity" ||
          normalizedCategory === "linen" ||
          normalizedCategory === "equipment" ||
          normalizedCategory === "water"; // backward compatibility with old setup
        if (!isSupportedAmenityCategory) continue;

        const key = row.room_type_code ?? "";
        if (!checklistByRoomType.has(key)) {
          checklistByRoomType.set(key, []);
        }
        checklistByRoomType.get(key)?.push({
          item: row.item_name,
          quantity: row.default_quantity,
          used: 0,
          checked: false,
          category: row.category,
          item_name: row.item_name,
          default_quantity: row.default_quantity,
          product_id: (row as any).product_id ?? null,
        });
      }
    }

    const rooms = baseRooms.map((baseRoom) => {
      const task = taskByRoomId.get(baseRoom.room_id);
      const guest = guestByRoomId.get(baseRoom.room_id);
      const checklistItems = checklistByRoomType.get(baseRoom.room_type_code) ?? [];
      const maintenanceAssignments = maintenanceByRoomId.get(baseRoom.room_id) ?? [];
      const maintenanceMinutesTotal = maintenanceAssignments.reduce(
        (sum, item) => sum + Math.max(Number(item.estimated_minutes ?? 0), 0),
        0
      );
      const cleaningDurationMin = Math.max(Number(baseRoom.cleaning_duration_min ?? 60), 1);
      const targetDurationMin = Math.max(cleaningDurationMin + maintenanceMinutesTotal, 1);
      const recentReservation = recentReservationByRoomId.get(baseRoom.room_id);
      const taskStatus = task?.status ?? "dirty";
      const isCollectionVisibleStatus =
        taskStatus === "dirty" || taskStatus === "in_progress" || taskStatus === "paused";
      const shouldShowCheckoutCollections =
        isCollectionVisibleStatus &&
        !guest &&
        (recentReservation?.status === "checked_out" || recentReservation?.status === "cancelled");
      const shouldShowStayoverCollections =
        isCollectionVisibleStatus &&
        Boolean(guest);
      const loanCollections = recentReservation
        ? (loanCollectionsByReservationId.get(recentReservation.reservation_id) ?? [])
            .filter((item) => {
              if (shouldShowCheckoutCollections) return true;
              if (shouldShowStayoverCollections) return true; // Visible daily for HK awareness
              return false;
            })
            .map((item) => ({
              ...item,
              is_due: shouldShowCheckoutCollections || (item.due_date !== null && item.due_date <= date),
            }))
        : [];
      const hkTraces = recentReservation
        ? (hkTraceItemsByReservationId.get(recentReservation.reservation_id) ?? [])
        : [];

      return {
        task_id: task?.id ?? null,
        room_id: baseRoom.room_id,
        room_number: baseRoom.room_number,
        room_type_code: baseRoom.room_type_code,
        cleaning_duration_min: cleaningDurationMin,
        target_duration_min: targetDurationMin,
        priority: baseRoom.priority,
        status: task?.status ?? "dirty",
        is_no_service: task?.is_no_service ?? false,
        no_service_note: task?.no_service_note ?? null,
        accumulated_ms: task?.accumulated_ms ?? 0,
        started_at: task?.started_at ?? null,
        finished_at: task?.finished_at ?? null,
        approved_at: task?.approved_at ?? null,
        guest_name: guest?.guest_name ?? null,
        checkin_date: guest?.checkin_date ?? null,
        checkout_date: guest?.checkout_date ?? null,
        checklist_items: checklistItems,
        maintenance_assignments: maintenanceAssignments,
        maintenance_minutes_total: maintenanceMinutesTotal,
        loan_collections: loanCollections,
        hk_traces: hkTraces,
      };
    });

    rooms.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return toRoomNumberSortKey(a.room_number).localeCompare(
        toRoomNumberSortKey(b.room_number),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
    });

    const summary = emptySummary();
    summary.total = rooms.length;

    for (const room of rooms) {
      if (room.status === "dirty") summary.dirty += 1;
      if (room.status === "in_progress") summary.in_progress += 1;
      if (room.status === "paused") summary.paused += 1;
      if (room.status === "cleaned") summary.cleaned += 1;
      if (room.status === "approved") summary.approved += 1;
      if (room.is_no_service) summary.no_service += 1;
    }

    return NextResponse.json({
      success: true,
      date,
      maid_name: maidName,
      summary,
      rooms,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
