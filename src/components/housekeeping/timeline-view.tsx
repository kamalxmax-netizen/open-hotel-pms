"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { WORK_END_HOUR, WORK_START_HOUR } from "@/lib/constants";
import type { ExtraTaskAssignment } from "@/lib/types";

type TimelineLog = {
  status: string;
  note: string | null;
  created_at: string;
};

type TimelineRoom = {
  room_id: string;
  room_number: string;
  hk_status: string;
  hk_task_id?: string | null;
  is_no_service: boolean;
  assigned_maid_name: string | null;
  plan_assigned_maid: string | null;
  plan_priority: number | null;
  cleaning_duration_min: number;
  maintenance_minutes_total?: number;
  elapsed_ms: number;
  started_at: string | null;
  finished_at: string | null;
  hk_logs?: TimelineLog[];
};

type TimelineBlock = {
  key: string;
  itemId: string;
  itemType: "room" | "extra";
  label: string;
  taskName: string | null;
  status: string;
  source: "actual" | "planned";
  priority: number | null;
  startMin: number;
  endMin: number;
  durationMin: number;
  note?: string | null;
  dragId: string;
  canDrag: boolean;
};

const MIN_TO_PX = 2;
const MIN_BAR_WIDTH_PX = 24;
const TRACK_START_MIN = WORK_START_HOUR * 60;
const TRACK_END_MIN = WORK_END_HOUR * 60;
const TRACK_DURATION_MIN = TRACK_END_MIN - TRACK_START_MIN;
const TRACK_WIDTH_PX = TRACK_DURATION_MIN * MIN_TO_PX;
const LIVE_TICK_MS = 15_000;
const EXTRA_TASK_DRAG_PREFIX = "extra:";

type DropOptions = {
  requestedPriority?: number;
};

function isActiveTimelineRoomStatus(status: string) {
  return (
    status === "dirty" ||
    status === "in_progress" ||
    status === "paused" ||
    status === "cleaned" ||
    status === "approved" ||
    status === "no_service"
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeMaidKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getLocalISODate(date = new Date()) {
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function toMinuteOfDay(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function minuteToLabel(minute: number): string {
  const rounded = Math.max(0, Math.round(minute));
  const hour = Math.floor(rounded / 60);
  const min = rounded % 60;
  return `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function statusLabel(block: TimelineBlock) {
  if (block.source === "planned") return "Pending";
  if (block.status === "in_progress") return "In Progress";
  if (block.status === "paused") return "Paused";
  if (block.status === "cleaned") return "Cleaned";
  if (block.status === "approved") return "Approved";
  if (block.status === "done") return "Done";
  if (block.status === "no_service") return "No Service";
  if (block.status === "pending") return "Pending";
  return block.status;
}

function getStatusClass(block: TimelineBlock) {
  if (block.itemType === "extra") {
    if (block.source === "planned" || block.status === "pending") {
      return "bg-rose-100 border-rose-300 text-rose-800 border-dashed";
    }
    if (block.status === "in_progress") return "bg-amber-200 border-amber-400 text-amber-900";
    if (block.status === "paused") return "bg-amber-100 border-amber-300 text-amber-900";
    if (block.status === "done") return "bg-emerald-100 border-emerald-300 text-emerald-900";
    return "bg-[var(--bg-muted)] border-[var(--border-input)] text-[var(--text-table-cell)]";
  }
  if (block.source === "planned" && block.status === "no_service") return "bg-sky-100 border-sky-300 text-sky-800 border-dashed";
  if (block.source === "planned") return "bg-rose-100 border-rose-300 text-rose-800 border-dashed";
  if (block.status === "in_progress") return "bg-amber-200 border-amber-400 text-amber-900";
  if (block.status === "paused") return "bg-amber-100 border-amber-300 text-amber-900";
  if (block.status === "cleaned" || block.status === "approved") return "bg-emerald-100 border-emerald-300 text-emerald-900";
  if (block.status === "no_service") return "bg-sky-100 border-sky-300 text-sky-800";
  return "bg-[var(--bg-muted)] border-[var(--border-input)] text-[var(--text-table-cell)]";
}

function buildBlockTooltip(block: TimelineBlock) {
  const lines =
    block.itemType === "extra"
      ? [
        "Extra Task",
        `Task: ${block.taskName ?? block.label}`,
        `Status: ${statusLabel(block)}`,
        `${minuteToLabel(block.startMin)} - ${minuteToLabel(block.endMin)}`,
        `Duration: ${Math.max(Math.round(block.durationMin), 1)} min`,
      ]
      : [
        `Room ${block.label}`,
        `Status: ${statusLabel(block)}`,
        `${minuteToLabel(block.startMin)} - ${minuteToLabel(block.endMin)}`,
        `Duration: ${Math.max(Math.round(block.durationMin), 1)} min`,
      ];

  if (block.priority != null) lines.push(`Priority: P${block.priority}`);
  const normalizedNote = normalizeTimelineNote(block.note);
  if (normalizedNote) lines.push(`Note: ${normalizedNote}`);
  return lines.join("\n");
}

function buildGapTooltip(startMin: number, endMin: number) {
  const duration = Math.max(Math.round(endMin - startMin), 0);
  return ["Gap", `${minuteToLabel(startMin)} - ${minuteToLabel(endMin)}`, `${duration} min`].join("\n");
}

function normalizeTimelineNote(note: string | null | undefined): string | null {
  if (!note) return null;
  return note
    .replace(/(accumulated:\s*)(\d+)\s*s\b/gi, (_m, prefix: string, sec: string) => {
      const min = Math.max(1, Math.round(Number(sec) / 60));
      return `${prefix}${min} min`;
    })
    .replace(/(duration:\s*)(\d+)\s*s\b/gi, (_m, prefix: string, sec: string) => {
      const min = Math.max(1, Math.round(Number(sec) / 60));
      return `${prefix}${min} min`;
    });
}

function getFallbackActualBlock(
  room: TimelineRoom,
  nowMinuteOfDay: number,
  selectedIsToday: boolean
): TimelineBlock | null {
  const elapsedMin = room.elapsed_ms > 0 ? room.elapsed_ms / 60_000 : 0;
  if (elapsedMin <= 0) return null;

  let startMin: number | null = toMinuteOfDay(room.started_at);
  let endMin: number | null = null;

  if (startMin != null) {
    endMin = room.hk_status === "in_progress" && selectedIsToday ? nowMinuteOfDay : startMin + elapsedMin;
  } else {
    const finishedMin = toMinuteOfDay(room.finished_at);
    if (finishedMin != null) {
      endMin = finishedMin;
      startMin = finishedMin - elapsedMin;
    } else {
      const pauseLog = [...(room.hk_logs ?? [])].reverse().find((log) => log.status === "paused");
      const pausedMin = pauseLog ? toMinuteOfDay(pauseLog.created_at) : null;
      if (pausedMin != null) {
        endMin = pausedMin;
        startMin = pausedMin - elapsedMin;
      }
    }
  }

  if (startMin == null || endMin == null || endMin <= startMin) return null;

  return {
    key: `${room.room_id}-fallback-${Math.round(startMin)}-${Math.round(endMin)}`,
    itemId: room.room_id,
    itemType: "room",
    label: room.room_number,
    taskName: null,
    status: room.is_no_service
      ? "no_service"
      : room.hk_status === "approved"
        ? "approved"
        : room.hk_status === "cleaned"
          ? "cleaned"
          : room.hk_status === "paused"
            ? "paused"
            : "in_progress",
    source: "actual",
    priority: room.plan_priority ?? null,
    startMin,
    endMin,
    durationMin: endMin - startMin,
    dragId: room.room_id,
    canDrag: false,
  };
}

function buildActualBlocksFromLogs(
  room: TimelineRoom,
  nowMinuteOfDay: number,
  selectedIsToday: boolean
): TimelineBlock[] {
  // Dirty/no-service rows are queue items. They must stay draggable in timeline.
  if (room.hk_status === "dirty" || room.hk_status === "no_service") {
    return [];
  }

  const allLogs = [...(room.hk_logs ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  // If room is reset to dirty in the same day (e.g. after move-room),
  // ignore earlier completed-cycle logs and only render the latest cycle.
  const lastDirtyIndex = allLogs.reduce((lastIdx, log, idx) => (log.status === "dirty" ? idx : lastIdx), -1);
  const logs = lastDirtyIndex >= 0 ? allLogs.slice(lastDirtyIndex + 1) : allLogs;

  const blocks: TimelineBlock[] = [];
  let activeStartMin: number | null = null;

  logs.forEach((log, idx) => {
    const atMin = toMinuteOfDay(log.created_at);
    if (atMin == null) return;

    if (log.status === "in_progress") {
      activeStartMin = atMin;
      return;
    }

    if (log.status === "paused" || log.status === "cleaned" || log.status === "approved") {
      if (activeStartMin != null && atMin > activeStartMin) {
        blocks.push({
          key: `${room.room_id}-actual-${idx}-${Math.round(activeStartMin)}-${Math.round(atMin)}`,
          itemId: room.room_id,
          itemType: "room",
          label: room.room_number,
          taskName: null,
          status: log.status,
          source: "actual",
          priority: room.plan_priority ?? null,
          startMin: activeStartMin,
          endMin: atMin,
          durationMin: atMin - activeStartMin,
          note: log.note ?? null,
          dragId: room.room_id,
          canDrag: false,
        });
      }
      activeStartMin = null;
    }
  });

  if (activeStartMin != null) {
    const endMin = selectedIsToday ? nowMinuteOfDay : TRACK_END_MIN;
    if (endMin > activeStartMin) {
      blocks.push({
        key: `${room.room_id}-actual-live-${Math.round(activeStartMin)}-${Math.round(endMin)}`,
        itemId: room.room_id,
        itemType: "room",
        label: room.room_number,
        taskName: null,
        status: "in_progress",
        source: "actual",
        priority: room.plan_priority ?? null,
        startMin: activeStartMin,
        endMin,
        durationMin: endMin - activeStartMin,
        dragId: room.room_id,
        canDrag: false,
      });
    }
  }

  if (blocks.length > 0) {
    blocks.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    // When task is already terminal, do not keep paused-colored historical
    // slices in the lane. Promote paused slices to the terminal status so FO
    // does not see stale yellow bars after clean/approved.
    const finalRoomStatus = room.is_no_service ? "no_service" : room.hk_status;
    const terminalRoomStatus =
      finalRoomStatus === "cleaned" || finalRoomStatus === "approved" || finalRoomStatus === "no_service";
    if (terminalRoomStatus) {
      const terminalLog = [...logs].reverse().find((log) => {
        if (finalRoomStatus === "no_service") return log.status === "approved" || log.status === "cleaned";
        return log.status === finalRoomStatus;
      });

      for (let idx = 0; idx < blocks.length; idx += 1) {
        if (blocks[idx].status !== "paused") continue;
        blocks[idx] = {
          ...blocks[idx],
          status: finalRoomStatus,
          note: terminalLog?.note ?? blocks[idx].note ?? null,
        };
      }
    }
    return blocks;
  }

  const fallback = getFallbackActualBlock(room, nowMinuteOfDay, selectedIsToday);
  return fallback ? [fallback] : [];
}

function getExtraTaskActualBlock(
  task: ExtraTaskAssignment,
  nowMinuteOfDay: number,
  selectedIsToday: boolean
): TimelineBlock | null {
  if (task.status === "pending" || task.status === "cancelled") return null;

  const accumulatedMs = Number(task.accumulated_ms ?? 0);
  const safeAccumulatedMs = Number.isFinite(accumulatedMs) ? Math.max(accumulatedMs, 0) : 0;
  const elapsedMin = safeAccumulatedMs / 60_000;
  const parsedDuration = Number(task.duration_min ?? 0);
  const safeDurationMin = Number.isFinite(parsedDuration) ? parsedDuration : 0;
  const actualDurationMin = elapsedMin > 0 ? Math.max(elapsedMin, 1) : null;
  const fallbackDuration = Math.max(safeDurationMin, 1);

  let startMin: number | null = toMinuteOfDay(task.started_at);
  let endMin: number | null = null;

  if (task.status === "in_progress") {
    if (startMin != null) {
      endMin = selectedIsToday ? nowMinuteOfDay : startMin + fallbackDuration;
    } else {
      endMin = selectedIsToday ? nowMinuteOfDay : TRACK_END_MIN;
      startMin = endMin - (actualDurationMin ?? fallbackDuration);
    }
  } else if (task.status === "paused") {
    const finishedMin = toMinuteOfDay(task.finished_at);
    if (startMin != null) {
      endMin = startMin + (actualDurationMin ?? fallbackDuration);
    } else if (finishedMin != null) {
      endMin = finishedMin;
      startMin = finishedMin - (actualDurationMin ?? fallbackDuration);
    } else {
      endMin = selectedIsToday ? nowMinuteOfDay : TRACK_END_MIN;
      startMin = endMin - (actualDurationMin ?? fallbackDuration);
    }
  } else if (task.status === "done") {
    const finishedMin = toMinuteOfDay(task.finished_at);
    if (finishedMin != null) {
      endMin = finishedMin;
      startMin = finishedMin - (actualDurationMin ?? fallbackDuration);
    } else if (startMin != null) {
      endMin = startMin + (actualDurationMin ?? fallbackDuration);
    } else {
      return null;
    }
  } else {
    const finishedMin = toMinuteOfDay(task.finished_at);
    if (startMin != null) {
      endMin = startMin + (actualDurationMin ?? fallbackDuration);
    } else if (finishedMin != null) {
      endMin = finishedMin;
      startMin = finishedMin - (actualDurationMin ?? fallbackDuration);
    } else {
      endMin = selectedIsToday ? nowMinuteOfDay : TRACK_END_MIN;
      startMin = endMin - (actualDurationMin ?? fallbackDuration);
    }
  }

  if (
    startMin == null ||
    endMin == null ||
    !Number.isFinite(startMin) ||
    !Number.isFinite(endMin) ||
    endMin <= startMin
  ) {
    return null;
  }

  return {
    key: `extra-${task.id}-actual-${Math.round(startMin)}-${Math.round(endMin)}`,
    itemId: task.id,
    itemType: "extra",
    label: task.task_name,
    taskName: task.task_name,
    status: task.status,
    source: "actual",
    priority: task.priority ?? null,
    startMin,
    endMin,
    durationMin: endMin - startMin,
    note: task.notes ?? null,
    dragId: `${EXTRA_TASK_DRAG_PREFIX}${task.id}`,
    canDrag: false,
  };
}

export default function TimelineView({
  rooms,
  extraTasks,
  selectedDate,
  maids,
  onAssignDrop,
  onDeleteExtraTask,
  onDragStateChange,
  fallbackDraggedRoomId,
}: {
  rooms: TimelineRoom[];
  extraTasks?: ExtraTaskAssignment[];
  selectedDate: string;
  maids: string[];
  onAssignDrop?: (itemId: string, maid: string, options?: DropOptions) => Promise<void> | void;
  onDeleteExtraTask?: (assignmentId: string) => Promise<void> | void;
  onDragStateChange?: (payload: { dragging: boolean; roomId: string | null }) => void;
  fallbackDraggedRoomId?: string | null;
}) {
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  const [isClientTimeReady, setIsClientTimeReady] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const didAutoScrollRef = useRef<boolean>(false);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    lines: string[];
    x: number;
    y: number;
    highlightPauseNote: boolean;
  } | null>(null);

  const workHours = useMemo(
    () => Array.from({ length: WORK_END_HOUR - WORK_START_HOUR + 1 }, (_, i) => WORK_START_HOUR + i),
    []
  );
  const timeRangeLabel = `${WORK_START_HOUR.toString().padStart(2, "0")}:00-${WORK_END_HOUR
    .toString()
    .padStart(2, "0")}:00`;
  const selectedIsToday = selectedDate === getLocalISODate();
  const nowMinuteOfDay = useMemo(() => {
    const now = new Date(tickNowMs);
    return now.getHours() * 60 + now.getMinutes();
  }, [tickNowMs]);
  const nowLineLeftPx = (clamp(nowMinuteOfDay, TRACK_START_MIN, TRACK_END_MIN) - TRACK_START_MIN) * MIN_TO_PX;

  function setTooltipAt(
    clientX: number,
    clientY: number,
    text: string,
    options?: { highlightPauseNote?: boolean }
  ) {
    const maxX = window.innerWidth - 320;
    const maxY = window.innerHeight - 140;
    setTooltip({
      lines: text.split("\n"),
      x: Math.max(8, Math.min(clientX + 14, maxX)),
      y: Math.max(8, Math.min(clientY + 14, maxY)),
      highlightPauseNote: options?.highlightPauseNote ?? false,
    });
  }

  function openTooltip(
    e: React.MouseEvent,
    text: string,
    options?: { highlightPauseNote?: boolean }
  ) {
    setTooltipAt(e.clientX, e.clientY, text, options);
  }

  function moveTooltip(e: React.MouseEvent) {
    setTooltip((current) => {
      if (!current) return current;
      const maxX = window.innerWidth - 320;
      const maxY = window.innerHeight - 140;
      return {
        ...current,
        x: Math.max(8, Math.min(e.clientX + 14, maxX)),
        y: Math.max(8, Math.min(e.clientY + 14, maxY)),
      };
    });
  }

  function closeTooltip() {
    setTooltip(null);
  }

  function attachDragImage(e: React.DragEvent<HTMLElement>, label: string) {
    const ghost = document.createElement("div");
    ghost.textContent = label;
    ghost.style.position = "fixed";
    ghost.style.top = "-1000px";
    ghost.style.left = "-1000px";
    ghost.style.pointerEvents = "none";
    ghost.style.opacity = "0.96";
    ghost.style.zIndex = "9999";
    ghost.style.padding = "4px 8px";
    ghost.style.borderRadius = "9999px";
    ghost.style.border = "1px solid #fda4af";
    ghost.style.background = "#fff1f2";
    ghost.style.color = "#be123c";
    ghost.style.fontSize = "11px";
    ghost.style.fontWeight = "700";
    ghost.style.lineHeight = "1";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    window.setTimeout(() => ghost.remove(), 0);
  }

  useEffect(() => {
    setIsClientTimeReady(true);
    setTickNowMs(Date.now());
  }, []);

  useEffect(() => {
    setTickNowMs(Date.now());
    didAutoScrollRef.current = false;
  }, [rooms, extraTasks, selectedDate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTickNowMs(Date.now());
    }, LIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedIsToday || didAutoScrollRef.current) return;
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    const focusMin = clamp(nowMinuteOfDay, TRACK_START_MIN, TRACK_END_MIN);
    const focusLeft = (focusMin - TRACK_START_MIN) * MIN_TO_PX;
    const target = Math.max(focusLeft - 240, 0);
    scroller.scrollTo({ left: target, behavior: "smooth" });
    didAutoScrollRef.current = true;
  }, [selectedIsToday, nowMinuteOfDay]);

  // Convert vertical wheel scroll → horizontal scroll on the timeline lane area
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return; // no horizontal overflow, let default run
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const maidTasks = useMemo(() => {
    const grouped: Record<string, TimelineRoom[]> = {};
    for (const room of rooms) {
      const maidKey = normalizeMaidKey(room.assigned_maid_name || room.plan_assigned_maid);
      if (!maidKey) continue;
      if (!isActiveTimelineRoomStatus(room.hk_status)) continue;
      if (!grouped[maidKey]) grouped[maidKey] = [];
      grouped[maidKey].push(room);
    }
    return grouped;
  }, [rooms]);

  const lanes = useMemo(() => {
    const ordered: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    const addLane = (name: string | null | undefined) => {
      const value = String(name ?? "").trim();
      const key = normalizeMaidKey(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      ordered.push({ key, label: value });
    };

    // Keep configured HK lanes first.
    maids.forEach(addLane);
    // Include active assignees to avoid orphaned tasks when stored casing differs.
    rooms.forEach((room) => {
      if (!isActiveTimelineRoomStatus(room.hk_status)) return;
      addLane(room.assigned_maid_name || room.plan_assigned_maid);
    });
    (extraTasks ?? []).forEach((task) => {
      if (task.status === "cancelled" || task.assigned_maid === "POOL") return;
      addLane(task.assigned_maid);
    });

    return ordered;
  }, [maids, rooms, extraTasks]);

  return (
    <div className="bg-[var(--bg-surface)] border text-sm border-[var(--border-default)] rounded-2xl shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-body)] flex items-center justify-between">
        <h3 className="font-bold text-[var(--text-primary)]">Timeline View ({timeRangeLabel})</h3>
        {selectedIsToday && isClientTimeReady && (
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            Now: {new Date(tickNowMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div ref={timelineScrollRef} className="overflow-x-auto p-4 hide-scrollbar">
        <div className="min-w-[1800px] relative">
          <div className="flex border-b border-[var(--border-subtle)] pb-2 mb-4">
            <div className="w-24 shrink-0" />
            <div className="relative" style={{ width: TRACK_WIDTH_PX }}>
              {workHours.map((hour) => (
                <div
                  key={hour}
                  className="absolute top-0 text-xs font-semibold text-[var(--text-muted)] -translate-x-1/2"
                  style={{ left: (hour - WORK_START_HOUR) * 60 * MIN_TO_PX }}
                >
                  {hour.toString().padStart(2, "0")}:00
                </div>
              ))}
            </div>
          </div>

          {Object.entries(maidTasks).length === 0 && (extraTasks ?? []).filter((t) => t.status !== "cancelled" && t.assigned_maid !== "POOL").length === 0 && (
            <div className="text-center py-6 text-[var(--text-secondary)] text-sm">No tasks assigned yet.</div>
          )}

          {lanes.map((lane) => {
            const laneRooms = maidTasks[lane.key] ?? [];
            const sortedRooms = [...laneRooms].sort((a, b) => (a.plan_priority || 99) - (b.plan_priority || 99));
            const laneExtraTasks = (extraTasks ?? [])
              .filter(
                (task) =>
                  task.status !== "cancelled" &&
                  normalizeMaidKey(task.assigned_maid) === lane.key
              )
              .sort((a, b) => {
                const pa = Number(a.priority ?? 9999);
                const pb = Number(b.priority ?? 9999);
                if (pa !== pb) return pa - pb;
                return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""), undefined, {
                  numeric: true,
                });
              });
            const pendingExtraTasks = laneExtraTasks.filter((task) => task.status === "pending");
            const activeExtraTasks = laneExtraTasks.filter(
              (task) => task.status !== "pending" && task.status !== "cancelled"
            );

            let plannedCursor = selectedIsToday ? clamp(nowMinuteOfDay, TRACK_START_MIN, TRACK_END_MIN) : TRACK_START_MIN;
            const rawBlocks: TimelineBlock[] = [];
            const plannedRoomItems: Array<{
              id: string;
              label: string;
              durationMin: number;
              priority: number | null;
              status: "dirty" | "no_service";
            }> = [];

            sortedRooms.forEach((room) => {
              const actualBlocks = buildActualBlocksFromLogs(room, nowMinuteOfDay, selectedIsToday);
              if (actualBlocks.length > 0) {
                rawBlocks.push(...actualBlocks);
                const latestActualEnd = actualBlocks.reduce(
                  (max, block) => Math.max(max, block.endMin),
                  TRACK_START_MIN
                );
                plannedCursor = Math.max(plannedCursor, latestActualEnd);
                return;
              }

              if (room.hk_status === "dirty") {
                const maintenanceMinutes = Math.max(Number(room.maintenance_minutes_total ?? 0), 0);
                plannedRoomItems.push({
                  id: room.room_id,
                  label: room.room_number,
                  durationMin: Math.max((room.cleaning_duration_min || 60) + maintenanceMinutes, 1),
                  priority: room.plan_priority ?? null,
                  status: room.is_no_service ? "no_service" : "dirty",
                });
              }
            });

            activeExtraTasks.forEach((task) => {
              const actualBlock = getExtraTaskActualBlock(task, nowMinuteOfDay, selectedIsToday);
              if (!actualBlock) return;
              rawBlocks.push(actualBlock);
              plannedCursor = Math.max(plannedCursor, actualBlock.endMin);
            });

            const plannedQueue: Array<{
              id: string;
              itemType: "room" | "extra";
              label: string;
              taskName: string | null;
              durationMin: number;
              priority: number | null;
              dragId: string;
              status: "dirty" | "no_service" | "pending";
            }> = [
              ...plannedRoomItems.map((item) => ({
                id: item.id,
                itemType: "room" as const,
                label: item.label,
                taskName: null,
                durationMin: item.durationMin,
                priority: item.priority,
                dragId: item.id,
                status: item.status,
              })),
              ...pendingExtraTasks.map((task) => ({
                id: task.id,
                itemType: "extra" as const,
                label: task.task_name,
                taskName: task.task_name,
                durationMin: Math.max(task.duration_min || 30, 1),
                priority: task.priority ?? null,
                dragId: `${EXTRA_TASK_DRAG_PREFIX}${task.id}`,
                status: "pending" as const,
              })),
            ].sort((a, b) => {
              const pa = Number(a.priority ?? 9999);
              const pb = Number(b.priority ?? 9999);
              if (pa !== pb) return pa - pb;
              if (a.itemType !== b.itemType) return a.itemType === "room" ? -1 : 1;
              return a.label.localeCompare(b.label, undefined, { numeric: true });
            });

            plannedQueue.forEach((item) => {
              const startMin = plannedCursor;
              const endMin = startMin + item.durationMin;
              rawBlocks.push({
                key: `${item.itemType}-${item.id}-planned-${Math.round(startMin)}-${Math.round(endMin)}`,
                itemId: item.id,
                itemType: item.itemType,
                label: item.label,
                taskName: item.taskName,
                status: item.status,
                source: "planned",
                priority: item.priority,
                startMin,
                endMin,
                durationMin: item.durationMin,
                dragId: item.dragId,
                canDrag: true,
              });
              plannedCursor = endMin;
            });

            const blocks = rawBlocks
              .map((block) => {
                if (!Number.isFinite(block.startMin) || !Number.isFinite(block.endMin)) return null;
                const displayStart = clamp(block.startMin, TRACK_START_MIN, TRACK_END_MIN);
                const displayEnd = clamp(block.endMin, TRACK_START_MIN, TRACK_END_MIN);
                if (displayEnd <= displayStart) return null;
                const leftPx = (displayStart - TRACK_START_MIN) * MIN_TO_PX;
                const widthPx = Math.max((displayEnd - displayStart) * MIN_TO_PX, MIN_BAR_WIDTH_PX);
                if (!Number.isFinite(leftPx) || !Number.isFinite(widthPx)) return null;
                return {
                  ...block,
                  displayStart,
                  displayEnd,
                  leftPx,
                  widthPx,
                };
              })
              .filter((block): block is NonNullable<typeof block> => block !== null)
              .sort((a, b) => a.displayStart - b.displayStart || a.displayEnd - b.displayEnd);

            const gaps: Array<{
              key: string;
              startMin: number;
              endMin: number;
              leftPx: number;
              widthPx: number;
            }> = [];

            let prevEnd = TRACK_START_MIN;
            blocks.forEach((block, idx) => {
              if (block.displayStart > prevEnd) {
                const gapStart = prevEnd;
                const gapEnd = block.displayStart;
                gaps.push({
                  key: `${lane.key}-gap-${idx}-${Math.round(gapStart)}-${Math.round(gapEnd)}`,
                  startMin: gapStart,
                  endMin: gapEnd,
                  leftPx: (gapStart - TRACK_START_MIN) * MIN_TO_PX,
                  widthPx: Math.max((gapEnd - gapStart) * MIN_TO_PX, 2),
                });
              }
              prevEnd = Math.max(prevEnd, block.displayEnd);
            });
            if (prevEnd < TRACK_END_MIN) {
              gaps.push({
                key: `${lane.key}-gap-tail-${Math.round(prevEnd)}-${TRACK_END_MIN}`,
                startMin: prevEnd,
                endMin: TRACK_END_MIN,
                leftPx: (prevEnd - TRACK_START_MIN) * MIN_TO_PX,
                widthPx: Math.max((TRACK_END_MIN - prevEnd) * MIN_TO_PX, 2),
              });
            }

            return (
              <div key={lane.key} className="flex items-center mb-4">
                <div className="w-24 shrink-0 font-bold text-[var(--text-table-cell)] text-xs">{lane.label}</div>

                <div
                  className="relative h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)]/70 overflow-hidden"
                  style={{ width: TRACK_WIDTH_PX }}
                  onDragOver={(e) => {
                    if (!onAssignDrop) return;
                    e.preventDefault();
                    setDropLane(lane.key);
                  }}
                  onDragLeave={() => setDropLane((prev) => (prev === lane.key ? null : prev))}
                  onDrop={async (e) => {
                    if (!onAssignDrop) return;
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData("text/plain") || fallbackDraggedRoomId || "";
                    setDropLane(null);
                    if (!draggedId) return;

                    const trackRect = e.currentTarget.getBoundingClientRect();
                    const left = clamp(e.clientX - trackRect.left, 0, TRACK_WIDTH_PX);
                    const dropMinute = TRACK_START_MIN + left / MIN_TO_PX;

                    const comparable = blocks
                      .filter(
                        (block) =>
                          block.source === "planned" &&
                          block.canDrag &&
                          block.dragId !== draggedId
                      )
                      .sort((a, b) => a.displayStart - b.displayStart || a.displayEnd - b.displayEnd);

                    let beforeCount = 0;
                    comparable.forEach((block) => {
                      const midpoint = (block.displayStart + block.displayEnd) / 2;
                      if (dropMinute >= midpoint) beforeCount += 1;
                    });

                    await onAssignDrop(draggedId, lane.label, { requestedPriority: beforeCount + 1 });
                  }}
                >
                  {dropLane === lane.key && (
                    <div className="absolute inset-0 bg-brand-100/60 border-2 border-dashed border-brand-400 z-30 pointer-events-none" />
                  )}

                  {workHours.slice(1, -1).map((hour) => (
                    <div
                      key={`${lane.key}-grid-${hour}`}
                      className="absolute top-0 bottom-0 border-l border-[var(--timeline-grid)]"
                      style={{ left: (hour - WORK_START_HOUR) * 60 * MIN_TO_PX }}
                    />
                  ))}

                  {selectedIsToday && isClientTimeReady && (
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-fuchsia-500/80 z-20 pointer-events-none"
                      style={{ left: nowLineLeftPx }}
                      title="Current time"
                    />
                  )}

                  {gaps.map((gap) => (
                    <div
                      key={gap.key}
                      className="absolute top-1 bottom-1 rounded-md border border-dashed border-[var(--border-input)]/70 z-0 opacity-35 hover:opacity-80 transition"
                      style={{
                        left: gap.leftPx,
                        width: gap.widthPx,
                        backgroundImage:
                          "repeating-linear-gradient(45deg, var(--timeline-gap-line), var(--timeline-gap-line) 4px, var(--timeline-gap-bg) 4px, var(--timeline-gap-bg) 8px)",
                      }}
                      onMouseEnter={(e) => openTooltip(e, buildGapTooltip(gap.startMin, gap.endMin))}
                      onMouseMove={moveTooltip}
                      onMouseLeave={closeTooltip}
                    />
                  ))}

                  {blocks.map((block) => {
                    const isDraggable = block.source === "planned" && block.canDrag;
                    return (
                      <div
                        key={block.key}
                        className={`absolute top-1 bottom-1 border rounded-md flex items-center justify-center text-[10px] font-bold overflow-hidden px-1 shadow-sm whitespace-nowrap z-10 ${getStatusClass(
                          block
                        )} ${isDraggable ? "cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-rose-300" : ""} ${draggingRoomId === block.dragId ? "opacity-70" : ""
                          }`}
                        style={{ left: block.leftPx, width: block.widthPx }}
                        draggable={isDraggable}
                        onDragStart={(e) => {
                          if (!isDraggable) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData("text/plain", block.dragId);
                          e.dataTransfer.effectAllowed = "move";
                          const dragLabel = block.itemType === "extra" ? `Task ${block.taskName ?? block.label}` : `Room ${block.label}`;
                          attachDragImage(e, dragLabel);
                          setDraggingRoomId(block.dragId);
                          setTooltip(null);
                          onDragStateChange?.({ dragging: true, roomId: block.dragId });
                        }}
                        onDragEnd={() => {
                          setDraggingRoomId(null);
                          setDropLane(null);
                          onDragStateChange?.({ dragging: false, roomId: null });
                        }}
                        onMouseEnter={(e) =>
                          openTooltip(e, buildBlockTooltip(block), {
                            highlightPauseNote: block.status === "paused",
                          })
                        }
                        onMouseMove={moveTooltip}
                        onMouseLeave={closeTooltip}
                      >
                        {block.itemType === "extra"
                          ? block.widthPx >= 120
                            ? block.taskName ?? block.label
                            : "TASK"
                          : block.widthPx >= 42
                            ? block.label
                            : "•"}
                        {block.itemType === "extra" && block.source === "planned" && onDeleteExtraTask && block.widthPx >= 70 && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDeleteExtraTask(block.itemId);
                            }}
                            className="absolute right-0 top-0 h-full px-1 text-[11px] font-bold text-rose-700 hover:bg-rose-200/60"
                            title="Delete task"
                            aria-label="Delete task"
                          >
                            x
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {tooltip && (
        <div
          className="fixed z-[120] pointer-events-none max-w-xs rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] leading-snug text-white whitespace-pre-line shadow-xl"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.lines.map((line, idx) => {
            const isTitle = idx === 0;
            const isPauseStatus = line.startsWith("Status: Paused");
            const isPauseNote = tooltip.highlightPauseNote && line.startsWith("Note:");
            return (
              <div
                key={`${line}-${idx}`}
                className={
                  isTitle
                    ? "font-semibold text-white"
                    : isPauseNote
                      ? "text-amber-300"
                      : isPauseStatus
                        ? "text-amber-200"
                        : "text-slate-100"
                }
              >
                {line}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
