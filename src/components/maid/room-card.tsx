import React, { useState, useEffect } from "react";
import { Clock, Play, Pause, CheckCircle, Ban, Hourglass } from "lucide-react";
import { computeElapsedMs, formatDuration } from "@/lib/timer";
import type { MaidRoom } from "@/lib/types";

interface RoomCardProps {
  room: MaidRoom;
  onStart: (roomId: string, taskId: string | null, isNoService?: boolean) => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onFinishClick: (room: MaidRoom) => void;
  onNoServiceClick: (room: MaidRoom) => void;
  isActionLoading: boolean;
}

export default function RoomCard({
  room,
  onStart,
  onPause,
  onResume,
  onFinishClick,
  onNoServiceClick,
  isActionLoading
}: RoomCardProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [showMaintenanceDetails, setShowMaintenanceDetails] = useState<boolean>(false);
  const maintenanceAssignments = room.maintenance_assignments ?? [];
  const loanCollections = room.loan_collections ?? [];
  const hkTraces = room.hk_traces ?? [];
  const loanCollectionItemCount = loanCollections.length;
  const loanCollectionUnitCount = loanCollections.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)),
    0
  );
  const maintenanceMinutesTotal = Math.max(Number(room.maintenance_minutes_total ?? 0), 0);
  const targetDurationMin = Math.max(
    Number(
      room.target_duration_min ??
      ((room.cleaning_duration_min ?? 60) + maintenanceMinutesTotal)
    ),
    1
  );
  const baseCleaningMin = Math.max(
    Number(room.cleaning_duration_min ?? Math.max(targetDurationMin - maintenanceMinutesTotal, 0)),
    0
  );
  const targetDurationMs = targetDurationMin * 60_000;
  const targetDurationLabel = formatDuration(targetDurationMs);

  // Real-time timer effect
  useEffect(() => {
    // Initial sync
    setElapsedMs(computeElapsedMs(room.started_at, room.accumulated_ms));

    // Only set interval if actively running
    if (room.status === "in_progress" && room.started_at) {
      const interval = setInterval(() => {
        setElapsedMs(computeElapsedMs(room.started_at, room.accumulated_ms));
      }, 1000);
      return () => clearInterval(interval);
    }

    // If finished or approved, stick to the final accumulated time
    if (room.status === "cleaned" || room.status === "approved") {
      setElapsedMs(room.accumulated_ms);
    }
  }, [room.status, room.started_at, room.accumulated_ms]);

  const isPlayable = room.status === "dirty";
  const isInProgress = room.status === "in_progress";
  const isPaused = room.status === "paused";
  const isDone = room.status === "cleaned" || room.status === "approved";
  const remainingMs = targetDurationMs - elapsedMs;
  const isOvertime = remainingMs < 0;

  const formatCountdown = (valueMs: number) => {
    const sign = valueMs < 0 ? "-" : "";
    return `${sign}${formatDuration(Math.abs(valueMs))}`;
  };

  // Status mapping colors
  const statusColors = {
    dirty: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400",
    in_progress: "bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400",
    paused: "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400",
    cleaned: "bg-green-50 border-green-300 text-green-700 dark:bg-green-500/10 dark:border-green-500/20 dark:text-green-400",
    approved: "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400",
    no_service: "bg-sky-50 border-sky-300 text-sky-700 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400",
  };

  const currentStyle = room.is_no_service
    ? statusColors.no_service
    : statusColors[room.status] || statusColors.dirty;

  return (
    <div className={`rounded-2xl border-2 p-4 flex flex-col gap-3 shadow-sm transition-colors ${currentStyle}`}>
      {/* Header Row */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight">{room.room_number}</h2>
            {room.priority <= 3 && !isDone && (
              <span className="bg-rose-600 text-white text-[10px] uppercase font-bold px-1.5 py-0.5 rounded animate-pulse">
                Hot
              </span>
            )}
            {loanCollectionItemCount > 0 && (
              <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30">
                📦 HK Collect {loanCollectionUnitCount}
              </span>
            )}
            {hkTraces.length > 0 && (
              <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30">
                🟠 Trace {hkTraces.length}
              </span>
            )}
          </div>
          <p className="text-sm font-medium opacity-80">
            {room.room_type_code} • {room.guest_name ? room.guest_name : "No Guest"}
          </p>
          {maintenanceAssignments.length > 0 && (
            <div className="mt-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-indigo-400">
              <p className="font-semibold">
                🔧 Maintenance Due: {maintenanceAssignments.length} (+{maintenanceMinutesTotal} min)
              </p>
              <p className="truncate text-indigo-600 dark:text-indigo-400/80">
                {maintenanceAssignments.map((item) => item.task_name).join(" • ")}
              </p>
              <button
                type="button"
                onClick={() => setShowMaintenanceDetails((prev) => !prev)}
                className="mt-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-400 underline underline-offset-2"
              >
                {showMaintenanceDetails ? "Hide special task details" : "View special task details"}
              </button>
            </div>
          )}
          {room.is_no_service && room.no_service_note && (
            <div className="mt-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400">
              <p className="font-semibold">NS Note</p>
              <p className="mt-0.5 whitespace-pre-wrap">{room.no_service_note}</p>
            </div>
          )}
          {loanCollectionItemCount > 0 && (
            <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400">
              <p className="font-semibold">
                Items to collect: {loanCollectionItemCount} item{loanCollectionItemCount > 1 ? "s" : ""} ({loanCollectionUnitCount} unit{loanCollectionUnitCount > 1 ? "s" : ""})
              </p>
              <p className="mt-0.5 truncate">
                {loanCollections
                  .slice(0, 2)
                  .map((item) => `${item.item_icon} ${item.item_name} ×${item.quantity}`)
                  .join(" • ")}
                {loanCollections.length > 2 ? " • ..." : ""}
              </p>
            </div>
          )}
          {hkTraces.length > 0 && (
            <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400">
              <p className="font-semibold">HK Trace</p>
              <p className="mt-0.5 truncate">
                {hkTraces.slice(0, 2).map((trace) => trace.text).join(" • ")}
                {hkTraces.length > 2 ? " • ..." : ""}
              </p>
            </div>
          )}
        </div>

        {/* Status Badge */}
        <div className="shrink-0 flex flex-col items-end justify-start">
          {room.is_no_service ? (
            <span className="inline-flex items-center gap-1 bg-sky-100 text-sky-700 px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider border border-sky-200 dark:bg-sky-500/20 dark:text-sky-400 dark:border-sky-500/30">
              <Ban size={12} /> No Service
            </span>
          ) : room.status === "cleaned" ? (
            <span className="inline-flex items-center gap-1 bg-green-200 text-green-800 px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider dark:bg-green-500/20 dark:text-green-400 dark:border-green-500/30">
              <Hourglass size={12} /> Inspect
            </span>
          ) : room.status === "approved" ? (
            <span className="inline-flex items-center gap-1 bg-emerald-500 text-white px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider">
              <CheckCircle size={12} /> Done
            </span>
          ) : (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-sm font-bold ${isOvertime ? "bg-rose-200 text-rose-800 dark:bg-rose-500/30 dark:text-rose-400" :
                isInProgress ? "bg-sky-200 text-sky-800 dark:bg-sky-500/30 dark:text-sky-400" :
                  isPaused ? "bg-amber-200 text-amber-800 dark:bg-amber-500/30 dark:text-amber-400" :
                    "bg-rose-200 text-rose-800 dark:bg-rose-500/30 dark:text-rose-400"
              }`}>
              <Clock size={14} className={isInProgress ? "animate-spin-slow" : ""} />
              {formatCountdown(remainingMs)}
            </div>
          )}
          {!room.is_no_service && (
            <p className="mt-1 text-right text-[10px] font-semibold text-[var(--text-secondary)]">
              Target {targetDurationMin} min ({targetDurationLabel})
              {maintenanceMinutesTotal > 0
                ? ` = ${baseCleaningMin} + ${maintenanceMinutesTotal}`
                : ""}
            </p>
          )}
        </div>
      </div>

      {maintenanceAssignments.length > 0 && showMaintenanceDetails && (
        <div className="rounded-xl border border-indigo-100 bg-[var(--bg-surface)]/80 p-2 space-y-2">
          {maintenanceAssignments.map((assignment) => (
            <div key={assignment.assignment_id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-body)] px-2 py-1.5">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                {assignment.task_name}
                {!!assignment.estimated_minutes && (
                  <span className="ml-1 text-[10px] font-medium text-[var(--text-muted)]">({assignment.estimated_minutes} min)</span>
                )}
              </p>
              {assignment.checklist_items && assignment.checklist_items.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {assignment.checklist_items.map((item, idx) => (
                    <span
                      key={`${assignment.assignment_id}-${item}-${idx}`}
                      className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-500/30 dark:text-indigo-400"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">No checklist items defined.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions Row */}
      {!isDone && (
        <div className="flex gap-2 mt-2">
          {isPlayable && (
            <>
              <button
                onClick={() => onStart(room.room_id, room.task_id, room.is_no_service)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-brand-600 dark:bg-brand-500/20 text-white dark:text-brand-400 border border-transparent dark:border-brand-500/30 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <Play size={18} fill="currentColor" /> Start
              </button>
              <button
                onClick={() => onNoServiceClick(room)}
                disabled={isActionLoading}
                className="min-h-[48px] px-4 bg-[var(--bg-surface)] dark:bg-white/5 border border-[var(--border-input)] dark:border-white/10 text-[var(--text-secondary)] dark:text-[var(--text-primary)] rounded-xl font-bold flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
              >
                <Ban size={18} className="mr-1" /> NS
              </button>
            </>
          )}

          {isInProgress && (
            <>
              <button
                onClick={() => onPause(room.task_id!)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-amber-500 dark:bg-amber-500/20 text-white dark:text-amber-400 border border-transparent dark:border-amber-500/30 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <Pause size={18} fill="currentColor" /> Pause
              </button>
              <button
                onClick={() => onFinishClick(room)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-green-600 dark:bg-emerald-500/20 text-white dark:text-emerald-400 border border-transparent dark:border-emerald-500/30 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <CheckCircle size={18} /> Finish
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                onClick={() => onResume(room.task_id!)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-brand-600 dark:bg-brand-500/20 text-white dark:text-brand-400 border border-transparent dark:border-brand-500/30 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <Play size={18} fill="currentColor" /> Resume
              </button>
              <button
                onClick={() => onFinishClick(room)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-green-600 dark:bg-emerald-500/20 text-white dark:text-emerald-400 border border-transparent dark:border-emerald-500/30 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <CheckCircle size={18} /> Finish
              </button>
            </>
          )}
        </div>
      )}

      {/* Read-only Time Info for Done state */}
      {isDone && room.finished_at && (
        <div className="mt-1 flex items-center justify-between text-xs font-medium opacity-70">
          <span>Time spent: {formatDuration(room.accumulated_ms)}</span>
          <span>Finished {new Date(room.finished_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      {isDone && (
        <div className="mt-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
          Target time: {targetDurationMin} min ({targetDurationLabel})
        </div>
      )}
    </div>
  );
}
