import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getReturnableStockForReservationRooms } from "@/lib/hk-returnable-stock";
import { isMaidNameMatch, maidAuthErrorResponse, requireMaidRead } from "@/lib/maid-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const maidRoomsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  maid_name: z.string().trim().optional(),
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
  task_seq: number | null;
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

function toBangkokWindow(dateString: string): { from: string; to: string } {
  return {
    from: `${dateString}T00:00:00+07:00`,
    to: `${dateString}T24:00:00+07:00`,
  };
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
  task_seq?: number | null;
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

function getStayNightCount(checkinDate: string | null | undefined, checkoutDate: string | null | undefined): number {
  if (!checkinDate || !checkoutDate) return 0;
  const checkin = new Date(`${checkinDate}T00:00:00.000Z`);
  const checkout = new Date(`${checkoutDate}T00:00:00.000Z`);
  if (Number.isNaN(checkin.getTime()) || Number.isNaN(checkout.getTime())) return 0;
  return Math.max(Math.round((checkout.getTime() - checkin.getTime()) / 86_400_000), 0);
}

function isMaidMatch(candidate: string | null | undefined, target: string): boolean {
  return isMaidNameMatch(candidate, target);
}

function buildLatestTaskByRoom<T extends { room_id: string; task_seq?: number | null }>(rows: T[]) {
  const latestByRoomId = new Map<string, T>();
  for (const row of rows) {
    const existing = latestByRoomId.get(row.room_id);
    const nextSeq = Number(row.task_seq ?? 0);
    const existingSeq = Number(existing?.task_seq ?? 0);
    if (!existing || nextSeq >= existingSeq) {
      latestByRoomId.set(row.room_id, row);
    }
  }
  return latestByRoomId;
}

export async function GET(request: NextRequest) {
  try {
    const rawDate = request.nextUrl.searchParams.get("date") ?? undefined;
    const rawMaid = request.nextUrl.searchParams.get("maid_name") ?? undefined;

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

    const supabase = createServerSupabaseClient();
    const maidAuth = await requireMaidRead(supabase, request, parsedQuery.data.maid_name);
    const maidName = maidAuth.effectiveMaidName?.trim();

    if (!maidName) {
      return NextResponse.json({ error: "maid_name is required" }, { status: 400 });
    }

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
      .select("room_id, task_seq, assigned_maid_name, status")
      .eq("stay_date", date)
      .not("assigned_maid_name", "is", null)
      .order("task_seq", { ascending: true })
      .in("status", ["dirty", "in_progress", "paused", "cleaned", "approved"]);

    if (assignedTaskError) {
      return NextResponse.json({ error: assignedTaskError.message }, { status: 500 });
    }

    const latestAssignedTaskByRoomId = buildLatestTaskByRoom(
      ((allAssignedTasks ?? []) as Array<{
        room_id: string;
        task_seq?: number | null;
        assigned_maid_name?: string | null;
        status?: string | null;
      }>)
    );

    const fallbackTaskRoomIds = Array.from(latestAssignedTaskByRoomId.values())
      .filter((row) => isMaidMatch(row.assigned_maid_name, maidName))
      .map((row) => row.room_id);

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
        auth: {
          mode: maidAuth.mode,
          can_select_maid: maidAuth.canSelectMaid,
          can_operate_selected: maidAuth.canOperate,
          staff_lane_name: maidAuth.staffLaneName,
          reason: maidAuth.reason,
        },
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

    const carryForwardTargetRoomIds = carryForwardRoomIds.filter((roomId) => roomIds.includes(roomId));
    if (carryForwardTargetRoomIds.length > 0) {
      // Do not block the main room list on carry-forward normalization.
      void autoCarryForwardOpenHousekeepingTasks(supabase, date, carryForwardTargetRoomIds).catch((error) => {
        console.error("maid-rooms carry-forward failed", error);
      });
    }

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

    const taskSelectBase =
      "id, room_id, stay_date, task_seq, status, is_no_service, accumulated_ms, started_at, finished_at, approved_at";
    const maintenancePromise = supabase.rpc("get_todays_maintenance_assignments", {
      p_target_date: date,
    });
    const taskRowsPromise = supabase
      .from("housekeeping_tasks")
      .select(`${taskSelectBase}, no_service_note`)
      .eq("stay_date", date)
      .in("room_id", roomIds)
      .order("task_seq", { ascending: true });
    const nightRowsPromise = supabase
      .from("reservation_nights")
      .select("room_id, reservation_id")
      .eq("stay_date", date)
      .is("cancelled_at", null)
      .in("room_id", roomIds);
    const checkedOutTodayPromise = supabase
      .from("reservations")
      .select("id, status, guest_name, checkin_date, checkout_date, reservation_nights(room_id, stay_date, cancelled_at)")
      .eq("status", "checked_out")
      .eq("checkout_date", date);
    const { from: bangkokDayFrom, to: bangkokDayTo } = toBangkokWindow(date);
    const cancelledAuditPromise = supabase
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "reservation")
      .eq("action", "booking_cancelled")
      .gte("created_at", bangkokDayFrom)
      .lt("created_at", bangkokDayTo);
    const checklistPromise =
      roomTypeCodes.length > 0
        ? supabase
            .from("checklist_templates")
            .select("room_type_code, item_name, default_quantity, category, sort_order, product_id")
            .eq("is_active", true)
            .in("room_type_code", roomTypeCodes)
            .order("sort_order", { ascending: true })
        : Promise.resolve({ data: [], error: null });

    const [
      { data: maintenanceRows, error: maintenanceError },
      { data: taskRowsRaw, error: taskError },
      { data: nightRows, error: nightError },
      { data: checkedOutTodayRows, error: checkedOutTodayError },
      { data: cancelledAuditRows, error: cancelledAuditError },
      { data: checklistRows, error: checklistError },
    ] = await Promise.all([
      maintenancePromise,
      taskRowsPromise,
      nightRowsPromise,
      checkedOutTodayPromise,
      cancelledAuditPromise,
      checklistPromise,
    ]);

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

    const latestTaskByRoomId = buildLatestTaskByRoom(taskRows);

    for (const row of latestTaskByRoomId.values()) {
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
    const collectionReservationByRoomId = new Map<
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
      if (!guestByRoomId.has(row.room_id)) {
        guestByRoomId.set(row.room_id, reservation);
      }
      if (!recentReservationByRoomId.has(row.room_id)) {
        const reservationRef = {
          reservation_id: String(row.reservation_id),
          status: "active",
          guest_name: reservation.guest_name ?? null,
          checkin_date: reservation.checkin_date ?? null,
          checkout_date: reservation.checkout_date ?? null,
        };
        recentReservationByRoomId.set(row.room_id, reservationRef);
        if (!collectionReservationByRoomId.has(row.room_id)) {
          collectionReservationByRoomId.set(row.room_id, reservationRef);
        }
      }
    }

    const checkedOutTodayReservationByRoomId = new Map<
      string,
      {
        reservation_id: string;
        status: string | null;
        guest_name: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
      }
    >();
    if (checkedOutTodayError) {
      return NextResponse.json({ error: checkedOutTodayError.message }, { status: 500 });
    }
    for (const reservation of checkedOutTodayRows ?? []) {
      const nights = Array.isArray((reservation as any).reservation_nights)
        ? (((reservation as any).reservation_nights ?? []) as Array<{ room_id?: string | null; stay_date?: string | null; cancelled_at?: string | null }>)
        : [];
      const activeNights = nights
        .filter((night) => !night?.cancelled_at && night?.room_id)
        .sort((a, b) => String(b?.stay_date ?? "").localeCompare(String(a?.stay_date ?? "")));
      const roomId = String(activeNights[0]?.room_id ?? "");
      const reservationId = String((reservation as any).id ?? "");
      if (!roomId || !reservationId || !roomIds.includes(roomId) || checkedOutTodayReservationByRoomId.has(roomId)) continue;
      checkedOutTodayReservationByRoomId.set(roomId, {
        reservation_id: reservationId,
        status: "checked_out",
        guest_name: (reservation as any).guest_name ?? null,
        checkin_date: (reservation as any).checkin_date ?? null,
        checkout_date: (reservation as any).checkout_date ?? null,
      });
    }
    checkedOutTodayReservationByRoomId.forEach((reservation, roomId) => {
      const existingRecent = recentReservationByRoomId.get(roomId);
      if (!existingRecent || existingRecent.status !== "active") {
        recentReservationByRoomId.set(roomId, reservation);
      }
      const existingCollection = collectionReservationByRoomId.get(roomId);
      if (!existingCollection || existingCollection.status !== "active") {
        collectionReservationByRoomId.set(roomId, reservation);
      }
    });
    if (cancelledAuditError) {
      return NextResponse.json({ error: cancelledAuditError.message }, { status: 500 });
    }

    const cancelledTodayReservationIds = Array.from(
      new Set(
        (cancelledAuditRows ?? [])
          .map((row) => String((row as any)?.entity_id ?? ""))
          .filter(Boolean)
      )
    );
    if (cancelledTodayReservationIds.length > 0) {
      const { data: cancelledReservationRows, error: cancelledReservationError } = await supabase
        .from("reservations")
        .select("id, status, guest_name, checkin_date, checkout_date")
        .in("id", cancelledTodayReservationIds)
        .eq("status", "cancelled");
      if (cancelledReservationError) {
        return NextResponse.json({ error: cancelledReservationError.message }, { status: 500 });
      }

      const validCancelledIds = Array.from(
        new Set(
          (cancelledReservationRows ?? [])
            .map((row) => String((row as any)?.id ?? ""))
            .filter(Boolean)
        )
      );

      if (validCancelledIds.length > 0) {
        const { data: cancelledNightRows, error: cancelledNightError } = await supabase
          .from("reservation_nights")
          .select("reservation_id, room_id, stay_date")
          .in("reservation_id", validCancelledIds)
          .in("room_id", roomIds)
          .order("stay_date", { ascending: false });
        if (cancelledNightError) {
          return NextResponse.json({ error: cancelledNightError.message }, { status: 500 });
        }

        const cancelledRoomByReservationId = new Map<string, string>();
        for (const row of cancelledNightRows ?? []) {
          const reservationId = String((row as any).reservation_id ?? "");
          const roomId = String((row as any).room_id ?? "");
          if (!reservationId || !roomId || cancelledRoomByReservationId.has(reservationId)) continue;
          cancelledRoomByReservationId.set(reservationId, roomId);
        }

        const cancelledById = new Map(
          (cancelledReservationRows ?? []).map((row) => [String((row as any).id ?? ""), row as any])
        );
        cancelledRoomByReservationId.forEach((roomId, reservationId) => {
          const reservation = cancelledById.get(reservationId);
          const reservationRef = {
            reservation_id: reservationId,
            status: "cancelled",
            guest_name: reservation?.guest_name ?? null,
            checkin_date: reservation?.checkin_date ?? null,
            checkout_date: reservation?.checkout_date ?? null,
          };
          const existingRecent = recentReservationByRoomId.get(roomId);
          if (!existingRecent || existingRecent.status !== "active") {
            recentReservationByRoomId.set(roomId, reservationRef);
          }
          const existingCollection = collectionReservationByRoomId.get(roomId);
          if (!existingCollection || existingCollection.status !== "active") {
            // Cancelled on the same day should override older checked_out context.
            collectionReservationByRoomId.set(roomId, reservationRef);
          }
        });
      }
    }

    // Fallback for carry-forward / unresolved tasks from previous days:
    // use latest reservation by room (including cancelled nights).
    const unresolvedRoomIds = roomIds.filter((roomId) => !recentReservationByRoomId.has(roomId));
    if (unresolvedRoomIds.length > 0) {
      const { data: fallbackNightRows, error: fallbackNightError } = await supabase
        .from("reservation_nights")
        .select("room_id, reservation_id, stay_date")
        .lte("stay_date", date)
        .in("room_id", unresolvedRoomIds)
        .order("stay_date", { ascending: false });
      if (fallbackNightError) {
        return NextResponse.json({ error: fallbackNightError.message }, { status: 500 });
      }

      const fallbackReservationIds = Array.from(
        new Set(
          (fallbackNightRows ?? [])
            .map((row) => String((row as any)?.reservation_id ?? ""))
            .filter(Boolean)
        )
      );
      if (fallbackReservationIds.length > 0) {
        const { data: fallbackReservations, error: fallbackReservationsError } = await supabase
          .from("reservations")
          .select("id, status, guest_name, checkin_date, checkout_date")
          .in("id", fallbackReservationIds);
        if (fallbackReservationsError) {
          return NextResponse.json({ error: fallbackReservationsError.message }, { status: 500 });
        }

        const fallbackById = new Map(
          (fallbackReservations ?? []).map((row) => [String((row as any).id ?? ""), row as any])
        );
        for (const row of fallbackNightRows ?? []) {
          const roomId = String((row as any)?.room_id ?? "");
          const reservationId = String((row as any)?.reservation_id ?? "");
          if (!roomId || !reservationId || recentReservationByRoomId.has(roomId)) continue;
          const reservation = fallbackById.get(reservationId);
          if (!reservation) continue;
          recentReservationByRoomId.set(roomId, {
            reservation_id: reservationId,
            status: reservation.status ?? null,
            guest_name: reservation.guest_name ?? null,
            checkin_date: reservation.checkin_date ?? null,
            checkout_date: reservation.checkout_date ?? null,
          });
        }
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
        Array.from(collectionReservationByRoomId.values()).map((row) => row.reservation_id)
      )
    );
    const runtimeTraceReservationIds = Array.from(
      new Set(
        Array.from(collectionReservationByRoomId.values())
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
    const returnableStockByRoomId = new Map<
      string,
      Array<{
        product_id: string;
        item: string;
        available_to_return: number;
        delivered_total: number;
        returned_total: number;
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

    const checkedOutReturnCandidates = Array.from(checkedOutTodayReservationByRoomId.entries()).filter(
      ([, reservation]) =>
        reservation.status === "checked_out" &&
        getStayNightCount(reservation.checkin_date, reservation.checkout_date) > 1
    );

    if (checkedOutReturnCandidates.length > 0) {
      const returnableStockByCandidateRoomId = await getReturnableStockForReservationRooms(
        supabase,
        checkedOutReturnCandidates.map(([roomId, reservation]) => ({
          reservationId: reservation.reservation_id,
          roomId,
          checkinDate: reservation.checkin_date ?? null,
          checkoutDate: reservation.checkout_date ?? null,
        }))
      );
      for (const [roomId, stock] of returnableStockByCandidateRoomId) {
        if (stock.items.length > 0) {
          returnableStockByRoomId.set(roomId, stock.items);
        }
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

    if (checklistError) {
      return NextResponse.json({ error: checklistError.message }, { status: 500 });
    }

    if (roomTypeCodes.length > 0) {
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
      const collectionReservation = collectionReservationByRoomId.get(baseRoom.room_id);
      const stayNightCount = getStayNightCount(
        collectionReservation?.checkin_date ?? null,
        collectionReservation?.checkout_date ?? null
      );
      const taskStatus = task?.status ?? "dirty";
      const isCollectionVisibleStatus =
        taskStatus === "dirty" || taskStatus === "in_progress" || taskStatus === "paused";
      const shouldShowCheckoutCollections =
        isCollectionVisibleStatus &&
        !guest &&
        (collectionReservation?.status === "checked_out" || collectionReservation?.status === "cancelled");
      const shouldShowStayoverCollections =
        isCollectionVisibleStatus &&
        Boolean(guest);
      const loanCollections = collectionReservation
        ? (loanCollectionsByReservationId.get(collectionReservation.reservation_id) ?? [])
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
      const hkTraces = collectionReservation
        ? (hkTraceItemsByReservationId.get(collectionReservation.reservation_id) ?? [])
        : [];
      const returnableStock = returnableStockByRoomId.get(baseRoom.room_id) ?? [];
      const canReturnStock =
        collectionReservation?.status === "checked_out" &&
        stayNightCount > 1 &&
        returnableStock.length > 0;

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
        can_return_stock: Boolean(canReturnStock),
        returnable_stock: returnableStock,
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
      auth: {
        mode: maidAuth.mode,
        can_select_maid: maidAuth.canSelectMaid,
        can_operate_selected: maidAuth.canOperate,
        staff_lane_name: maidAuth.staffLaneName,
        reason: maidAuth.reason,
      },
      summary,
      rooms,
    });
  } catch (err) {
    const authResponse = maidAuthErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
