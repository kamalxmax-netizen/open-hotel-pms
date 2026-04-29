"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import AssignmentModal from "@/components/housekeeping/assignment-modal";
import TimelineView from "@/components/housekeeping/timeline-view";
import FloorGroup, { type HkRoom, type HkStatus } from "@/components/housekeeping/floor-group";
import PmsModal from "@/components/pms-modal";
import type { ExtraTaskAssignment } from "@/lib/types";

type Summary = {
  dirty: number;
  cleaning: number;
  clean: number;
  available: number;
  no_service: number;
};

type DraftAssignment = {
  maid: string | null;
  priority: number | null;
};

type AssignDropOptions = {
  requestedPriority?: number;
};

type LaneQueueItem = {
  kind: "room" | "extra";
  id: string;
  maid: string;
  priority: number;
  label: string;
};

type DueMaintenanceTask = {
  room_id: string;
  room_number: string;
  task_id: string;
  task_name: string;
  checklist_items: string[] | null;
  estimated_minutes: number;
  stays_since_last: number;
  threshold_count: number;
  status: string;
  already_assigned: boolean;
  assignment_id: string | null;
};

function sortExtraTasksByPriority(tasks: ExtraTaskAssignment[]) {
  return [...tasks].sort((a, b) => {
    const pa = Number(a.priority ?? 9999);
    const pb = Number(b.priority ?? 9999);
    if (pa !== pb) return pa - pb;
    return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""), undefined, { numeric: true });
  });
}

function sortLaneQueueItems(items: LaneQueueItem[]) {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.kind !== b.kind) return a.kind === "room" ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });
}

function buildLaneQueue(
  maid: string,
  draftAssignments: Record<string, DraftAssignment>,
  extraTasks: ExtraTaskAssignment[],
  roomsById: Map<string, HkRoom>
) {
  const roomItems: LaneQueueItem[] = Object.entries(draftAssignments)
    .filter(([, plan]) => plan.maid === maid && plan.priority != null)
    .map(([roomId, plan]) => ({
      kind: "room" as const,
      id: roomId,
      maid,
      priority: Number(plan.priority ?? 9999),
      label: roomsById.get(roomId)?.room_number ?? roomId,
    }));

  const extraItems: LaneQueueItem[] = extraTasks
    .filter((task) => task.status === "pending" && task.assigned_maid === maid)
    .map((task) => ({
      kind: "extra" as const,
      id: task.id,
      maid,
      priority: Number(task.priority ?? 9999),
      label: String(task.task_name ?? ""),
    }));

  return sortLaneQueueItems([...roomItems, ...extraItems]);
}

function normalizeLaneQueue(
  maid: string,
  laneItems: LaneQueueItem[],
  nextDraftAssignments: Record<string, DraftAssignment>,
  nextExtraTasks: ExtraTaskAssignment[]
) {
  const sorted = sortLaneQueueItems(laneItems);
  const nextExtraById = new Map(nextExtraTasks.map((task) => [task.id, task]));

  sorted.forEach((item, idx) => {
    const normalizedPriority = idx + 1;
    if (item.kind === "room") {
      nextDraftAssignments[item.id] = { maid, priority: normalizedPriority };
      return;
    }
    const existing = nextExtraById.get(item.id);
    if (!existing) return;
    nextExtraById.set(item.id, {
      ...existing,
      assigned_maid: maid,
      priority: normalizedPriority,
    });
  });

  return Array.from(nextExtraById.values());
}

function applyUnifiedLaneMove(params: {
  itemKind: "room" | "extra";
  itemId: string;
  targetMaid: string | null;
  requestedPriority?: number;
  draftAssignments: Record<string, DraftAssignment>;
  extraTasks: ExtraTaskAssignment[];
  roomsById: Map<string, HkRoom>;
  extraPoolMaid: string;
}) {
  const {
    itemKind,
    itemId,
    targetMaid,
    requestedPriority,
    draftAssignments,
    extraTasks,
    roomsById,
    extraPoolMaid,
  } = params;

  const nextDraftAssignments: Record<string, DraftAssignment> = { ...draftAssignments };
  let nextExtraTasks = [...extraTasks];

  const movingRoomPlan = itemKind === "room" ? nextDraftAssignments[itemId] ?? null : null;
  const movingExtra = itemKind === "extra" ? nextExtraTasks.find((task) => task.id === itemId) ?? null : null;
  const sourceMaid =
    itemKind === "room"
      ? movingRoomPlan?.maid ?? null
      : movingExtra?.assigned_maid && movingExtra.assigned_maid !== extraPoolMaid
        ? movingExtra.assigned_maid
        : null;

  if (itemKind === "room" && !movingRoomPlan) {
    return { nextDraftAssignments, nextExtraTasks };
  }
  if (itemKind === "extra" && !movingExtra) {
    return { nextDraftAssignments, nextExtraTasks };
  }

  if (sourceMaid) {
    const sourceItems = buildLaneQueue(sourceMaid, nextDraftAssignments, nextExtraTasks, roomsById).filter((item) => {
      return !(item.kind === itemKind && item.id === itemId);
    });
    nextExtraTasks = normalizeLaneQueue(sourceMaid, sourceItems, nextDraftAssignments, nextExtraTasks);
  }

  if (targetMaid) {
    const targetItems = buildLaneQueue(targetMaid, nextDraftAssignments, nextExtraTasks, roomsById).filter((item) => {
      return !(item.kind === itemKind && item.id === itemId);
    });
    const insertIndex =
      requestedPriority != null
        ? Math.max(0, Math.min(targetItems.length, requestedPriority - 1))
        : targetItems.length;
    const label =
      itemKind === "room"
        ? roomsById.get(itemId)?.room_number ?? itemId
        : movingExtra?.task_name ?? itemId;
    targetItems.splice(insertIndex, 0, {
      kind: itemKind,
      id: itemId,
      maid: targetMaid,
      priority: insertIndex + 1,
      label,
    });
    nextExtraTasks = normalizeLaneQueue(targetMaid, targetItems, nextDraftAssignments, nextExtraTasks);
  } else if (itemKind === "room") {
    nextDraftAssignments[itemId] = { maid: null, priority: null };
  } else {
    nextExtraTasks = nextExtraTasks.map((task) =>
      task.id === itemId
        ? { ...task, assigned_maid: extraPoolMaid, priority: 9999 }
        : task
    );
  }

  return { nextDraftAssignments, nextExtraTasks: sortExtraTasksByPriority(nextExtraTasks) };
}

function isEditableDirtyRoom(room: HkRoom) {
  if (!room.is_sellable || room.hk_status !== "dirty") return false;
  return !isCheckoutLockedForHk(room);
}

function isCheckoutLockedForHk(room: HkRoom) {
  return (
    (room.diary_state === "due_out" || room.diary_state === "back_to_back") &&
    !room.is_checkout_dirty_today &&
    !room.is_stayover_service_request
  );
}

function getPersistedAssignedMaid(room: HkRoom) {
  // Runtime task assignee is the source of truth for active dirty tasks.
  // Daily plan can be stale after move-room / re-dirty flows.
  return room.assigned_maid_name || room.plan_assigned_maid || null;
}

function normalizeMaidKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sortRoomIdsByPriority(
  roomIds: string[],
  plans: Record<string, DraftAssignment>,
  roomsById: Map<string, HkRoom>
) {
  return [...roomIds].sort((a, b) => {
    const pa = plans[a]?.priority ?? 999;
    const pb = plans[b]?.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const ra = roomsById.get(a)?.room_number ?? "";
    const rb = roomsById.get(b)?.room_number ?? "";
    return ra.localeCompare(rb, undefined, { numeric: true });
  });
}

function buildBaselineDraftAssignments(
  rooms: HkRoom[],
  allowedLanesByKey: Map<string, string>
) {
  const result: Record<string, DraftAssignment> = {};

  rooms.forEach((room) => {
    if (!isEditableDirtyRoom(room)) return;
    const maid = getPersistedAssignedMaid(room);
    const maidKey = normalizeMaidKey(maid);
    const normalizedMaid = maidKey ? allowedLanesByKey.get(maidKey) ?? null : null;
    if (!normalizedMaid) {
      result[room.room_id] = { maid: null, priority: null };
      return;
    }
    // Keep persisted priority from DB as-is to preserve unified lane queue with extra tasks.
    result[room.room_id] = {
      maid: normalizedMaid,
      priority: room.plan_priority ?? null,
    };
  });

  return result;
}

function countDraftChanges(
  draft: Record<string, DraftAssignment>,
  baseline: Record<string, DraftAssignment>
) {
  const keys = new Set([...Object.keys(draft), ...Object.keys(baseline)]);
  let count = 0;
  keys.forEach((roomId) => {
    const d = draft[roomId] ?? { maid: null, priority: null };
    const b = baseline[roomId] ?? { maid: null, priority: null };
    if (d.maid !== b.maid || (d.maid && d.priority !== b.priority)) count += 1;
  });
  return count;
}

const FILTER_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "due_out", label: "↑ Due Out" },
  { key: "back_to_back", label: "↕ Back-to-back" },
  { key: "in_house", label: "● In-house (Sold Last Night)" },
  { key: "dirty", label: "🧹 Dirty" },
  { key: "in_progress", label: "🔄 Cleaning (Inc. Paused)" },
  { key: "cleaned", label: "⏳ Waiting Appr." }, // Temporary 'cleaned' tab
  { key: "approved", label: "✅ Clean" },
  { key: "no_service", label: "🚫 NS" },
  { key: "extra_tasks", label: "🟥 Extra Tasks" },
  { key: "available", label: "Available" }
];

function fmt(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function getLocalISODate(date = new Date()) {
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

const EXTRA_TASK_POOL_MAID = "POOL";
const EXTRA_TASK_DRAG_PREFIX = "extra:";

function isExtraTaskDragId(value: string): boolean {
  return value.startsWith(EXTRA_TASK_DRAG_PREFIX);
}

function getExtraTaskIdFromDragId(value: string): string {
  return value.slice(EXTRA_TASK_DRAG_PREFIX.length);
}

function getDueTaskKey(task: Pick<DueMaintenanceTask, "room_id" | "task_id">): string {
  return `${task.room_id}:${task.task_id}`;
}

function attachDragImage(e: DragEvent<HTMLElement>) {
  const target = e.currentTarget;
  const ghost = target.cloneNode(true) as HTMLElement;
  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "-1000px";
  ghost.style.pointerEvents = "none";
  ghost.style.opacity = "0.95";
  ghost.style.zIndex = "9999";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
  window.setTimeout(() => ghost.remove(), 0);
}

export default function HousekeepingPage() {
  const fallbackMaids = ["Jan", "Tan", "Others"];
  const today = getLocalISODate();
  const [date, setDate] = useState(today);
  const [rooms, setRooms] = useState<HkRoom[]>([]);
  const [extraTaskPending, setExtraTaskPending] = useState<ExtraTaskAssignment[]>([]);
  const [extraTaskBaseline, setExtraTaskBaseline] = useState<ExtraTaskAssignment[]>([]);
  const [extraTaskTimeline, setExtraTaskTimeline] = useState<ExtraTaskAssignment[]>([]);
  const [summary, setSummary] = useState<Summary>({ dirty: 0, cleaning: 0, clean: 0, available: 0, no_service: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const [assignRoom, setAssignRoom] = useState<HkRoom | null>(null);
  const [showDueModal, setShowDueModal] = useState(false);
  const [loadingDueTasks, setLoadingDueTasks] = useState(false);
  const [assigningDueTasks, setAssigningDueTasks] = useState(false);
  const [dueTasks, setDueTasks] = useState<DueMaintenanceTask[]>([]);
  const [selectedDueTaskKeys, setSelectedDueTaskKeys] = useState<string[]>([]);
  const [draggingDirtyRoomId, setDraggingDirtyRoomId] = useState<string | null>(null);
  const [timelineBarDragging, setTimelineBarDragging] = useState(false);
  const [timelineDraggingRoomId, setTimelineDraggingRoomId] = useState<string | null>(null);
  const [poolDropActive, setPoolDropActive] = useState(false);
  const [draftAssignments, setDraftAssignments] = useState<Record<string, DraftAssignment>>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const [maidLaneNames, setMaidLaneNames] = useState<string[]>(fallbackMaids);

  const refreshExtraTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/housekeeping/extra-tasks/assignments?date=${date}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({} as { success?: boolean; assignments?: ExtraTaskAssignment[]; error?: string }));
      if (!res.ok || !data.success) return;

      const allTasks = (data.assignments ?? [])
        .sort((a: ExtraTaskAssignment, b: ExtraTaskAssignment) => {
          const pa = Number(a.priority ?? 9999);
          const pb = Number(b.priority ?? 9999);
          if (pa !== pb) return pa - pb;
          return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""), undefined, { numeric: true });
        });

      setExtraTaskTimeline(allTasks.filter((task: ExtraTaskAssignment) => task.status !== "cancelled"));

      const pendingTasks = allTasks.filter((task: ExtraTaskAssignment) => task.status === "pending");
      setExtraTaskPending(pendingTasks);
      setExtraTaskBaseline(pendingTasks);
    } catch {
      // keep pool stale on network hiccup; main load handles visible errors
    }
  }, [date]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError("");
    try {
      const [res, lanesRes] = await Promise.all([
        fetch(`/api/housekeeping/status?date=${date}`, { cache: "no-store" }),
        fetch("/api/staff/housekeeping-lanes", { cache: "no-store" }),
        refreshExtraTasks(),
      ]);
      const d = await res.json();
      const lanesJson = await lanesRes
        .json()
        .catch(() => ({} as { success?: boolean; data?: Array<{ display_name?: string }> }));
      if (lanesRes.ok && lanesJson?.success !== false) {
        const names = (lanesJson?.data ?? [])
          .map((row: { display_name?: string }) => String(row.display_name ?? "").trim())
          .filter((name: string) => name.length > 0);
        if (names.length > 0) {
          setMaidLaneNames(names);
        }
      }
      if (d.success) {
        setRooms(d.rooms || []);

        // Ensure "clean" count covers both "cleaned" or "approved" tasks as appropriate
        setSummary(d.summary || { dirty: 0, cleaning: 0, clean: 0, available: 0, no_service: 0 });
      } else {
        setError(d.error ?? "Failed to load.");
      }
    } catch {
      setError("Network error.");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [date, refreshExtraTasks]);

  useEffect(() => { load(); }, [load]);

  const roomsById = useMemo(() => {
    const map = new Map<string, HkRoom>();
    for (const room of rooms) {
      const existing = map.get(room.room_id);
      if (!existing) {
        map.set(room.room_id, room);
        continue;
      }
      // Keep actionable (non-prior) row as source of truth for assignment actions.
      if (existing.is_prior_task && !room.is_prior_task) {
        map.set(room.room_id, room);
      }
    }
    return map;
  }, [rooms]);
  const planningRooms = useMemo(() => Array.from(roomsById.values()), [roomsById]);
  const laneNameByKey = useMemo(
    () => {
      const map = new Map<string, string>();
      maidLaneNames.forEach((name) => {
        const value = String(name ?? "").trim();
        const key = normalizeMaidKey(value);
        if (!key || map.has(key)) return;
        map.set(key, value);
      });
      return map;
    },
    [maidLaneNames]
  );

  const baselineAssignments = useMemo(
    () => buildBaselineDraftAssignments(planningRooms, laneNameByKey),
    [planningRooms, laneNameByKey]
  );

  useEffect(() => {
    setDraftAssignments(baselineAssignments);
  }, [baselineAssignments]);

  const draftChangeCount = useMemo(
    () => countDraftChanges(draftAssignments, baselineAssignments),
    [draftAssignments, baselineAssignments]
  );
  const extraDraftChangeCount = useMemo(() => {
    const baselineById = new Map(extraTaskBaseline.map((task) => [task.id, task]));
    let changes = 0;
    for (const task of extraTaskPending) {
      if (task.status !== "pending") continue;
      const baseline = baselineById.get(task.id);
      if (!baseline) continue;
      if (baseline.assigned_maid !== task.assigned_maid || Number(baseline.priority ?? 0) !== Number(task.priority ?? 0)) {
        changes += 1;
      }
    }
    return changes;
  }, [extraTaskPending, extraTaskBaseline]);
  const totalDraftChangeCount = draftChangeCount + extraDraftChangeCount;
  const hasDraftChanges = totalDraftChangeCount > 0;

  const boardRooms = useMemo(
    () =>
      planningRooms.map((room) => {
        if (!isEditableDirtyRoom(room)) return room;
        const draft = draftAssignments[room.room_id] ?? { maid: null, priority: null };
        return {
          ...room,
          // Keep assignment source single: draft -> plan fields for editable dirty rooms.
          assigned_maid_name: null,
          plan_assigned_maid: draft.maid,
          plan_priority: draft.priority,
        };
      }),
    [planningRooms, draftAssignments]
  );
  const displayRooms = useMemo(() => {
    const priorRooms = rooms.filter((room) => room.is_prior_task);
    return [...boardRooms, ...priorRooms].sort((a, b) => {
      const floorDiff = Number(a.floor_number ?? 0) - Number(b.floor_number ?? 0);
      if (floorDiff !== 0) return floorDiff;
      const roomDiff = a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
      if (roomDiff !== 0) return roomDiff;
      return Number(a.is_prior_task ?? false) - Number(b.is_prior_task ?? false);
    });
  }, [boardRooms, rooms]);

  const extraTaskPool = useMemo(
    () => extraTaskPending.filter((task) => task.assigned_maid === EXTRA_TASK_POOL_MAID),
    [extraTaskPending]
  );

  const timelineExtraTasks = useMemo(() => {
    const nonPending = extraTaskTimeline.filter((task) => task.status !== "pending");
    return [...nonPending, ...extraTaskPending];
  }, [extraTaskTimeline, extraTaskPending]);

  const dirtyRoomIds = useMemo(
    () =>
      boardRooms
        .filter((room) => isEditableDirtyRoom(room))
        .map((room) => room.room_id),
    [boardRooms]
  );

  const selectedDueTasks = useMemo(() => {
    const selectedSet = new Set(selectedDueTaskKeys);
    return dueTasks.filter(
      (task) => !task.already_assigned && selectedSet.has(getDueTaskKey(task))
    );
  }, [dueTasks, selectedDueTaskKeys]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (updating || savingDraft) return;
      if (hasDraftChanges) return;
      if (timelineBarDragging || draggingDirtyRoomId) return;
      void load({ silent: true });
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (updating || savingDraft) return;
      if (hasDraftChanges) return;
      if (timelineBarDragging || draggingDirtyRoomId) return;
      void load({ silent: true });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [load, updating, savingDraft, hasDraftChanges, timelineBarDragging, draggingDirtyRoomId]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function closeDueModal() {
    if (assigningDueTasks) return;
    setShowDueModal(false);
    setLoadingDueTasks(false);
    setDueTasks([]);
    setSelectedDueTaskKeys([]);
  }

  async function openDueMaintenanceModal() {
    if (hasDraftChanges) {
      showToast("Please Save or Discard assignment changes before adding maintenance due.");
      return;
    }
    if (dirtyRoomIds.length === 0) {
      showToast("No dirty rooms to attach maintenance due.");
      return;
    }

    setShowDueModal(true);
    setLoadingDueTasks(true);
    setSelectedDueTaskKeys([]);
    setDueTasks([]);

    try {
      const params = new URLSearchParams({
        mode: "due",
        date,
        room_ids: dirtyRoomIds.join(","),
      });
      const res = await fetch(`/api/maintenance/assignments?${params.toString()}`, {
        cache: "no-store",
      });
      const data: { success?: boolean; due_tasks?: DueMaintenanceTask[]; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(`Load due failed: ${data.error ?? res.statusText}`);
        closeDueModal();
        return;
      }

      const nextTasks = (data.due_tasks ?? []).sort((a, b) => {
        const roomDiff = a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
        if (roomDiff !== 0) return roomDiff;
        return a.task_name.localeCompare(b.task_name, undefined, { numeric: true });
      });
      setDueTasks(nextTasks);
      setSelectedDueTaskKeys(
        nextTasks
          .filter((task) => !task.already_assigned)
          .map((task) => getDueTaskKey(task))
      );
    } catch {
      showToast("Network error while loading maintenance due.");
      closeDueModal();
    } finally {
      setLoadingDueTasks(false);
    }
  }

  function toggleDueTaskSelection(task: DueMaintenanceTask, checked: boolean) {
    const key = getDueTaskKey(task);
    setSelectedDueTaskKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return Array.from(next);
    });
  }

  async function assignSelectedDueTasks() {
    const targets = selectedDueTasks;
    if (targets.length === 0) {
      showToast("Select at least one maintenance task.");
      return;
    }

    setAssigningDueTasks(true);
    let created = 0;
    let duplicates = 0;
    let failed = 0;
    const succeededKeys = new Set<string>();

    try {
      for (const task of targets) {
        const res = await fetch("/api/maintenance/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: task.room_id,
            task_id: task.task_id,
            assigned_date: date,
            assigned_by: "HK Dashboard",
            notes: `Auto-assigned from overdue list ${date}`,
          }),
        });
        const payload = await res.json().catch(() => ({} as { error?: string; duplicate?: boolean }));
        if (!res.ok) {
          failed += 1;
          console.error("assignSelectedDueTasks item failed", {
            room_id: task.room_id,
            task_id: task.task_id,
            error: payload.error ?? res.statusText,
          });
          continue;
        }

        if (payload.duplicate) duplicates += 1;
        else created += 1;
        succeededKeys.add(getDueTaskKey(task));
      }

      if (succeededKeys.size > 0) {
        setDueTasks((prev) =>
          prev.map((task) => {
            const key = getDueTaskKey(task);
            if (!succeededKeys.has(key)) return task;
            return {
              ...task,
              already_assigned: true,
            };
          })
        );
        setSelectedDueTaskKeys((prev) => prev.filter((key) => !succeededKeys.has(key)));
        await load();
      }

      const summaryParts = [
        created > 0 ? `${created} created` : null,
        duplicates > 0 ? `${duplicates} already existed` : null,
        failed > 0 ? `${failed} failed` : null,
      ].filter(Boolean);
      showToast(
        summaryParts.length > 0
          ? `Maintenance due assign: ${summaryParts.join(", ")}.`
          : "No changes applied."
      );

      if (failed === 0) closeDueModal();
    } finally {
      setAssigningDueTasks(false);
    }
  }

  async function updateStatus(room: HkRoom, newStatus: HkStatus) {
    if (hasDraftChanges) {
      showToast("Please Save or Discard assignment changes before updating room status.");
      return;
    }
    setUpdating(room.room_id);
    try {
      if (newStatus === "in_progress") {
        if (!room.hk_task_id) {
          showToast(`Room ${room.room_number}: housekeeping task not found.`);
          return;
        }
        const maidName = room.assigned_maid_name || room.plan_assigned_maid || maidLaneNames[0] || fallbackMaids[0];
        const res = await fetch(`/api/housekeeping/tasks/${room.hk_task_id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maid_name: maidName })
        });
        const d = await res.json().catch(() => ({} as { error?: string }));
        if (res.ok) {
          showToast(`Room ${room.room_number} started cleaning.`);
          await load();
        } else {
          showToast(`Error: ${d.error ?? "Failed to start cleaning."}`);
        }
        return;
      }

      if (newStatus === "paused") {
        if (!room.hk_task_id) {
          showToast(`Room ${room.room_number}: housekeeping task not found.`);
          return;
        }
        const res = await fetch(`/api/housekeeping/tasks/${room.hk_task_id}/pause`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const d = await res.json().catch(() => ({} as { error?: string }));
        if (res.ok) {
          showToast(`Room ${room.room_number} paused.`);
          await load();
        } else {
          showToast(`Error: ${d.error ?? "Failed to pause cleaning."}`);
        }
        return;
      }

      const res = await fetch("/api/housekeeping/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", room_id: room.room_id, date, new_status: newStatus })
      });
      if (res.ok) {
        showToast(`Room ${room.room_number} status updated.`);
        await load();
      } else {
        const d = await res.json();
        showToast(`Error: ${d.error}`);
      }
    } finally {
      setUpdating(null);
    }
  }

  async function handleApprove(room: HkRoom) {
    if (hasDraftChanges) {
      showToast("Please Save or Discard assignment changes before approving.");
      return;
    }
    if (!room.hk_task_id) return;
    setUpdating(room.room_id);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${room.hk_task_id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: "Admin" })
      });
      if (res.ok) {
        showToast(`Room ${room.room_number} approved! 🌟`);
        await load();
      } else {
        const d = await res.json();
        showToast(`Error: ${d.error}`);
      }
    } finally {
      setUpdating(null);
    }
  }

  function stageDirtyAssignment(roomId: string, targetMaid: string | null, requestedPriority?: number) {
    const room = roomsById.get(roomId);
    if (!room) return;
    if (!isEditableDirtyRoom(room)) {
      const isCheckoutLocked = isCheckoutLockedForHk(room);
      if (isCheckoutLocked) {
        showToast(`Room ${room.room_number} is locked until checkout is completed.`);
      } else if (room.hk_status !== "dirty") {
        showToast(`Room ${room.room_number} cannot be reassigned after cleaning has started.`);
      } else {
        showToast(`Room ${room.room_number} is not editable right now.`);
      }
      return;
    }
    const current = draftAssignments[roomId];
    if (!current) {
      showToast(`Room ${room.room_number} is not editable right now.`);
      return;
    }
    if (current.maid === targetMaid && requestedPriority == null) return;

    const { nextDraftAssignments, nextExtraTasks } = applyUnifiedLaneMove({
      itemKind: "room",
      itemId: roomId,
      targetMaid,
      requestedPriority,
      draftAssignments,
      extraTasks: extraTaskPending,
      roomsById,
      extraPoolMaid: EXTRA_TASK_POOL_MAID,
    });
    setDraftAssignments(nextDraftAssignments);
    setExtraTaskPending(nextExtraTasks);
  }

  function saveAssignment(roomId: string, maidName: string, priority: number) {
    stageDirtyAssignment(roomId, maidName, priority);
    setAssignRoom(null);
  }

  function stageExtraTaskAssignment(assignmentId: string, maid: string, requestedPriority?: number) {
    const { nextDraftAssignments, nextExtraTasks } = applyUnifiedLaneMove({
      itemKind: "extra",
      itemId: assignmentId,
      targetMaid: maid === EXTRA_TASK_POOL_MAID ? null : maid,
      requestedPriority,
      draftAssignments,
      extraTasks: extraTaskPending,
      roomsById,
      extraPoolMaid: EXTRA_TASK_POOL_MAID,
    });
    setDraftAssignments(nextDraftAssignments);
    setExtraTaskPending(nextExtraTasks);
  }

  async function cancelExtraTask(assignmentId: string) {
    setUpdating(`${EXTRA_TASK_DRAG_PREFIX}${assignmentId}`);
    try {
      const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${assignmentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const d = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        showToast(`Delete extra task failed: ${d.error ?? res.statusText}`);
        return;
      }
      setExtraTaskPending((prev) => prev.filter((task) => task.id !== assignmentId));
      setExtraTaskBaseline((prev) => prev.filter((task) => task.id !== assignmentId));
      setExtraTaskTimeline((prev) => prev.filter((task) => task.id !== assignmentId));
      showToast("Extra task deleted.");
    } finally {
      setUpdating(null);
    }
  }

  async function assignDirtyToMaid(itemId: string, maid: string, options?: AssignDropOptions) {
    if (isExtraTaskDragId(itemId)) {
      const assignmentId = getExtraTaskIdFromDragId(itemId);
      if (!assignmentId) return;
      stageExtraTaskAssignment(assignmentId, maid, options?.requestedPriority);
      return;
    }
    stageDirtyAssignment(itemId, maid, options?.requestedPriority);
  }

  async function unassignDirtyToPool(itemId: string) {
    if (isExtraTaskDragId(itemId)) {
      const assignmentId = getExtraTaskIdFromDragId(itemId);
      if (!assignmentId) return;
      stageExtraTaskAssignment(assignmentId, EXTRA_TASK_POOL_MAID);
      return;
    }
    stageDirtyAssignment(itemId, null);
  }

  async function saveDraftAssignments() {
    if (!hasDraftChanges) return;

    setSavingDraft(true);
    try {
      const editableRoomIds = Object.keys(baselineAssignments);
      const requests: Promise<Response>[] = [];

      editableRoomIds.forEach((roomId) => {
        const baseline = baselineAssignments[roomId] ?? { maid: null, priority: null };
        const draft = draftAssignments[roomId] ?? { maid: null, priority: null };
        if (baseline.maid && !draft.maid) {
          requests.push(
            fetch("/api/housekeeping/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "unassign", room_id: roomId, date })
            })
          );
        }
      });

      const groupedByMaid: Record<string, string[]> = {};
      editableRoomIds.forEach((roomId) => {
        const draft = draftAssignments[roomId] ?? { maid: null, priority: null };
        if (!draft.maid) return;
        if (!groupedByMaid[draft.maid]) groupedByMaid[draft.maid] = [];
        groupedByMaid[draft.maid].push(roomId);
      });

      for (const [maidName, roomIds] of Object.entries(groupedByMaid)) {
        const orderedRoomIds = sortRoomIdsByPriority(roomIds, draftAssignments, roomsById);
        orderedRoomIds.forEach((roomId) => {
          const priority = draftAssignments[roomId]?.priority ?? 1;
          requests.push(
            fetch("/api/housekeeping/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "assign",
                room_id: roomId,
                date,
                assigned_maid: maidName,
                priority,
              })
            })
          );
        });
      }

      const extraBaselineById = new Map(extraTaskBaseline.map((task) => [task.id, task]));
      extraTaskPending.forEach((task) => {
        if (task.status !== "pending") return;
        const baseline = extraBaselineById.get(task.id);
        if (!baseline) return;
        if (
          baseline.assigned_maid === task.assigned_maid &&
          Number(baseline.priority ?? 0) === Number(task.priority ?? 0)
        ) {
          return;
        }
        requests.push(
          fetch(`/api/housekeeping/extra-tasks/assignments/${task.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assigned_maid: task.assigned_maid,
              priority: task.priority,
            }),
          })
        );
      });

      const responses = await Promise.all(requests);
      const failed = responses.find((res) => !res.ok);
      if (failed) {
        const d = await failed.json().catch(() => ({} as { error?: string }));
        showToast(`Save failed: ${d.error ?? failed.statusText}`);
        return;
      }

      showToast(`Saved ${totalDraftChangeCount} assignment change${totalDraftChangeCount > 1 ? "s" : ""}.`);
      await load();
    } finally {
      setSavingDraft(false);
      setTimelineBarDragging(false);
      setTimelineDraggingRoomId(null);
      setDraggingDirtyRoomId(null);
      setPoolDropActive(false);
    }
  }

  function discardDraftAssignments() {
    setDraftAssignments(baselineAssignments);
    setExtraTaskPending(extraTaskBaseline);
    setTimelineBarDragging(false);
    setTimelineDraggingRoomId(null);
    setDraggingDirtyRoomId(null);
    setPoolDropActive(false);
    showToast("Discarded unsaved assignment changes.");
  }

  const dirtyRoomPool = boardRooms
    .filter((r) => {
      if (!r.is_sellable || r.hk_status !== "dirty") return false;
      if (isCheckoutLockedForHk(r)) return false;
      const assignedMaid = r.plan_assigned_maid || r.assigned_maid_name;
      return !assignedMaid;
    })
    .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  const dirtyPoolCollectCount = dirtyRoomPool.filter((room) => Number(room.hk_collect_count ?? 0) > 0).length;
  const showPoolDragHint = poolDropActive || timelineBarDragging || draggingDirtyRoomId !== null;
  const showPlanningBoard = ["all", "dirty", "in_progress", "extra_tasks", "due_out", "back_to_back", "in_house"].includes(filter);

  const filtered = displayRooms.filter((r) => {
    if (!r.is_sellable) return false;
    if (filter === "all") return true;
    if (filter === "extra_tasks") return false;
    if (filter === "due_out") return r.diary_state === "due_out" || (r.is_checkout_dirty_today && r.hk_status === "dirty");
    if (filter === "back_to_back") return r.diary_state === "back_to_back";
    if (filter === "in_house") return r.diary_state === "inhouse" && r.in_house_sold_last_night;
    if (filter === "cleaned") return String(r.hk_status) === "cleaned" && !r.is_no_service;
    if (filter === "in_progress") return r.hk_status === "in_progress" || r.hk_status === "paused";
    if (filter === "no_service") return r.is_no_service;
    if (filter === "dirty") return r.hk_status === "dirty";

    return r.hk_status === filter;
  });

  // Group by floor for clearer view
  const floorGroups = filtered.reduce((acc, r) => {
    const f = r.floor_number || 0;
    if (!acc[f]) acc[f] = [];
    acc[f].push(r);
    return acc;
  }, {} as Record<number, HkRoom[]>);

  const sortedFloors = Object.keys(floorGroups).map(Number).sort((a, b) => a - b);

  const todayLabel = new Date(date).toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Housekeeping Dashboard</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Room & Maid Management</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center justify-center gap-2 px-4 py-1.5 bg-white dark:bg-[#1a1f26] border border-[var(--border-input)] rounded-xl text-[var(--text-primary)] dark:text-slate-100 font-bold text-xs hover:bg-gray-100 dark:hover:bg-[#242a33] transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => void openDueMaintenanceModal()}
            disabled={loadingDueTasks || assigningDueTasks || hasDraftChanges || savingDraft}
            title={hasDraftChanges ? "Save or Discard draft changes first" : undefined}
          >
            <span className="text-lg leading-none font-bold">+</span>
            {loadingDueTasks ? "Loading..." : "Add Maintenance Due"}
          </button>
          <input
            type="date"
            className="form-input py-1 text-sm bg-[var(--bg-surface)]"
            value={date}
            disabled={hasDraftChanges || savingDraft}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void load()}
            disabled={hasDraftChanges || savingDraft}
            title={hasDraftChanges ? "Save or Discard draft changes first" : undefined}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Dirty/Assigned", value: summary.dirty, color: "border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800", text: "text-rose-700 dark:text-rose-400" },
          { label: "Cleaning Now", value: summary.cleaning, color: "border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-800", text: "text-sky-700 dark:text-sky-400" },
          { label: "Pending Approval", value: rooms.filter(r => String(r.hk_status) === "cleaned" && !r.is_no_service).length, color: "border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400" },
          { label: "Clean ✓", value: summary.clean, color: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-400" },
          { label: "No Service", value: summary.no_service, color: "border-[var(--border-input)] bg-[var(--bg-body)]", text: "text-[var(--text-secondary)]" },
          { label: "Extra Tasks", value: extraTaskPending.length, color: "border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800", text: "text-rose-700 dark:text-rose-400" }
        ].map((t) => (
          <div key={t.label} className={`card border-l-4 p-4 ${t.color}`}>
            <p className={`text-2xl font-extrabold ${t.text}`}>{t.value}</p>
            <p className="text-[11px] font-bold text-[var(--text-secondary)] mt-1 tracking-wide uppercase">{t.label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">{error}</div>
      )}

      {/* Timeline (only show if all or when managing tasks) */}
      {showPlanningBoard && (
        <TimelineView
          rooms={displayRooms}
          extraTasks={timelineExtraTasks}
          selectedDate={date}
          maids={[...maidLaneNames]}
          onAssignDrop={assignDirtyToMaid}
          onDeleteExtraTask={cancelExtraTask}
          onDragStateChange={({ dragging, roomId }) => {
            setTimelineBarDragging(dragging);
            setTimelineDraggingRoomId(roomId);
          }}
          fallbackDraggedRoomId={draggingDirtyRoomId}
        />
      )}

      {/* Dirty room + extra task pool for drag-to-timeline assignment */}
      {showPlanningBoard && (
        <div
          className={`card p-4 transition ${showPoolDragHint ? "ring-2 ring-rose-400 bg-rose-50/40 dark:ring-rose-500/30 dark:bg-rose-950/20" : ""
            }`}
          onDragOver={(e) => {
            e.preventDefault();
            setPoolDropActive(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setPoolDropActive(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setPoolDropActive(false);
            const itemId =
              e.dataTransfer.getData("text/plain") ||
              timelineDraggingRoomId ||
              draggingDirtyRoomId;
            if (!itemId) return;
            void unassignDirtyToPool(itemId);
            setTimelineBarDragging(false);
            setTimelineDraggingRoomId(null);
            setDraggingDirtyRoomId(null);
          }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Dirty &amp; Task Pool</h3>
              <span className="text-xs rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-1 font-bold dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                {dirtyRoomPool.length} Dirty · {dirtyPoolCollectCount} HK Collect · {extraTaskPool.length} Extra
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={discardDraftAssignments}
                disabled={!hasDraftChanges || savingDraft}
                className="rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] disabled:opacity-30 disabled:grayscale transition-all"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void saveDraftAssignments()}
                disabled={!hasDraftChanges || savingDraft}
                className="rounded-md border border-emerald-300 bg-emerald-500 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-30 disabled:grayscale transition-all dark:border-emerald-500/50 shadow-sm"
              >
                {savingDraft ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
          <div
            className={`mt-3 min-h-10 rounded-xl border border-dashed p-3 transition ${showPoolDragHint
              ? "border-rose-400 bg-rose-100/60 dark:border-rose-500/40 dark:bg-rose-500/10"
              : "border-[var(--border-default)] bg-[var(--bg-surface)]"
              }`}
          >
            <div
              className={`mb-2 h-4 text-center text-xs font-bold transition ${showPoolDragHint ? "text-rose-700 dark:text-rose-400 opacity-100" : "text-transparent opacity-0"
                }`}
              aria-hidden={!showPoolDragHint}
            >
              Drag Bar Here to Return to Pool
            </div>
            <div className="flex flex-wrap gap-2">
              {dirtyRoomPool.length === 0 && extraTaskPool.length === 0 ? (
                <span className="text-xs text-[var(--text-secondary)]">No dirty rooms / pending extra tasks right now.</span>
              ) : (
                <>
                  {dirtyRoomPool.map((room) => {
                    const isDragging = draggingDirtyRoomId === room.room_id;
                    const isAssigning = savingDraft;
                    const hkCollectCount = Math.max(Number(room.hk_collect_count ?? 0), 0);
                    const chipClass = room.is_no_service
                      ? "border-sky-300 bg-sky-100 text-sky-800 hover:bg-sky-200 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60"
                      : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/60";
                    return (
                      <button
                        key={room.room_id}
                        type="button"
                        draggable={!isAssigning}
                        onDragStart={(e) => {
                          setTimelineBarDragging(false);
                          setTimelineDraggingRoomId(null);
                          setDraggingDirtyRoomId(room.room_id);
                          e.dataTransfer.setData("text/plain", room.room_id);
                          e.dataTransfer.effectAllowed = "move";
                          attachDragImage(e);
                        }}
                        onDragEnd={() => {
                          setDraggingDirtyRoomId(null);
                          setPoolDropActive(false);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isDragging
                          ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                          : chipClass
                          } ${isAssigning ? "opacity-60 cursor-wait" : "cursor-grab active:cursor-grabbing"}`}
                      >
                        {room.is_no_service && <span>NS</span>}
                        {hkCollectCount > 0 && <span>📦{hkCollectCount}</span>}
                        <span>{room.room_number}</span>
                      </button>
                    );
                  })}
                  {extraTaskPool.map((task) => {
                    const dragId = `${EXTRA_TASK_DRAG_PREFIX}${task.id}`;
                    const isDragging = draggingDirtyRoomId === dragId;
                    const isAssigning = savingDraft || Boolean(updating);
                    const isCancelling = updating === dragId;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        draggable={!isAssigning && !isCancelling}
                        onDragStart={(e) => {
                          setTimelineBarDragging(false);
                          setTimelineDraggingRoomId(null);
                          setDraggingDirtyRoomId(dragId);
                          e.dataTransfer.setData("text/plain", dragId);
                          e.dataTransfer.effectAllowed = "move";
                          attachDragImage(e);
                        }}
                        onDragEnd={() => {
                          setDraggingDirtyRoomId(null);
                          setPoolDropActive(false);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isDragging
                          ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-400 dark:border-brand-500/30"
                          : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400 dark:hover:bg-rose-950/60"
                          } ${isAssigning || isCancelling ? "opacity-60 cursor-wait" : "cursor-grab active:cursor-grabbing"}`}
                        title={`${task.task_name} • ${task.duration_min} min`}
                      >
                        <span>TASK</span>
                        <span className="max-w-[140px] truncate">{task.task_name}</span>
                        <span
                          role="button"
                          aria-label="Delete task"
                          title="Delete task"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void cancelExtraTask(task.id);
                          }}
                          className="ml-1 rounded px-1 text-[11px] font-black leading-none hover:bg-rose-200 dark:hover:bg-rose-500/30"
                        >
                          x
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-2">
        <div className="flex flex-wrap gap-2">
          {FILTER_TABS.map((f) => {
            let count = 0;
            if (f.key === "all") count = rooms.filter(r => r.is_sellable).length;
            else if (f.key === "extra_tasks") count = extraTaskPending.length;
            else if (f.key === "due_out") count = rooms.filter(r => r.diary_state === "due_out" || (r.is_checkout_dirty_today && r.hk_status === "dirty")).length;
            else if (f.key === "back_to_back") count = rooms.filter(r => r.diary_state === "back_to_back").length;
            else if (f.key === "in_house") count = rooms.filter(r => r.diary_state === "inhouse" && r.in_house_sold_last_night).length;
            else if (f.key === "cleaned") count = rooms.filter(r => String(r.hk_status) === "cleaned" && !r.is_no_service).length;
            else if (f.key === "in_progress") count = rooms.filter(r => r.hk_status === "in_progress" || r.hk_status === "paused").length;
            else if (f.key === "no_service") count = rooms.filter(r => r.is_no_service).length;
            else if (f.key === "dirty") count = rooms.filter((r) => r.is_sellable && r.hk_status === "dirty").length;
            else count = rooms.filter((r) => r.is_sellable && r.hk_status === f.key).length;

            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f.key
                  ? "border-brand-500 bg-brand-600 text-white dark:bg-brand-500 dark:border-brand-400"
                  : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)] dark:border-white/10 dark:hover:bg-white/5"
                  }`}
              >
                {f.label}
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${filter === f.key ? 'bg-white/20 text-white' : 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] dark:bg-white/10 dark:text-gray-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Room cards grouped by floor */}
      {filter === "extra_tasks" ? (
        <div className="card p-8 text-center bg-[var(--bg-body)] border-dashed">
          <p className="text-[var(--text-secondary)] font-semibold">Extra Task view is focused on Timeline and Task Pool.</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-[var(--bg-muted)]" />
          ))}
        </div>
      ) : sortedFloors.length === 0 ? (
        <div className="card p-12 text-center bg-[var(--bg-body)] border-dashed">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-[var(--text-secondary)] font-bold">No rooms found in this view.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedFloors.map((floor) => (
            <FloorGroup
              key={floor}
              floor={floor}
              rooms={floorGroups[floor]}
              updatingRoomId={updating}
              onUpdateStatus={updateStatus}
              onApprove={handleApprove}
              onAssignClick={setAssignRoom}
              formatTime={fmt}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="toast-bar toast-success fixed bottom-6 right-6 z-50 shadow-2xl">{toast}</div>
      )}

      <AssignmentModal
        isOpen={!!assignRoom}
        room={assignRoom}
        onClose={() => setAssignRoom(null)}
        onSave={saveAssignment}
        isSubmitting={assignRoom ? updating === assignRoom.room_id : false}
        maidNames={maidLaneNames}
      />

      {showDueModal && (
        <PmsModal
          title={`Add Maintenance Due (${date})`}
          size="lg"
          onClose={closeDueModal}
          footer={
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-[var(--text-secondary)]">
                Selected: {selectedDueTasks.length} task{selectedDueTasks.length !== 1 ? "s" : ""} ·{" "}
                {selectedDueTasks.reduce((sum, task) => sum + Number(task.estimated_minutes ?? 0), 0)} min
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeDueModal}
                  disabled={assigningDueTasks}
                  className="rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void assignSelectedDueTasks()}
                  disabled={assigningDueTasks || selectedDueTasks.length === 0}
                  className="rounded-md border border-indigo-300 bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {assigningDueTasks ? "Assigning..." : "Assign Selected"}
                </button>
              </div>
            </div>
          }
        >
          {loadingDueTasks ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="h-11 animate-pulse rounded-lg bg-[var(--bg-muted)]" />
              ))}
            </div>
          ) : dueTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-input)] bg-[var(--bg-body)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
              No overdue maintenance tasks found for current dirty rooms.
            </div>
          ) : (
            <div className="space-y-2 max-h-[58vh] overflow-y-auto pr-1">
              {dueTasks.map((task) => {
                const key = getDueTaskKey(task);
                const isChecked = selectedDueTaskKeys.includes(key);
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition ${task.already_assigned
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
                      : isChecked
                        ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40"
                        : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-body)]"
                      }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-[var(--border-input)] text-indigo-600 focus:ring-indigo-500"
                      disabled={task.already_assigned || assigningDueTasks}
                      checked={task.already_assigned ? true : isChecked}
                      onChange={(event) => toggleDueTaskSelection(task, event.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[var(--text-primary)]">Room {task.room_number}</span>
                        <span className="text-[11px] rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 font-semibold text-[var(--text-secondary)]">
                          {task.estimated_minutes} min
                        </span>
                        <span className="text-[11px] rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
                          {task.stays_since_last}/{task.threshold_count} stays
                        </span>
                        {task.already_assigned && (
                          <span className="text-[11px] rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                            Already Added
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-[var(--text-table-cell)]">{task.task_name}</p>
                      {task.checklist_items && task.checklist_items.length > 0 && (
                        <p className="mt-1 text-xs text-[var(--text-secondary)] truncate">
                          {task.checklist_items.join(" • ")}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </PmsModal>
      )}
    </div>
  );
}
