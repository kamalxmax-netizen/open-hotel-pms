import React, { useEffect, useState } from "react";
import { Clock, Play, Pause, CheckCircle } from "lucide-react";
import { computeElapsedMs, formatDuration } from "@/lib/timer";
import type { ExtraTaskAssignment } from "@/lib/types";

interface ExtraTaskCardProps {
  task: ExtraTaskAssignment;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onFinish: (id: string) => void;
  isActionLoading: boolean;
}

export default function ExtraTaskCard({
  task,
  onStart,
  onPause,
  onResume,
  onFinish,
  isActionLoading,
}: ExtraTaskCardProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    setElapsedMs(computeElapsedMs(task.started_at, task.accumulated_ms));
    if (task.status === "in_progress" && task.started_at) {
      const interval = setInterval(() => {
        setElapsedMs(computeElapsedMs(task.started_at, task.accumulated_ms));
      }, 1000);
      return () => clearInterval(interval);
    }
    if (task.status === "done") {
      setElapsedMs(task.accumulated_ms ?? 0);
    }
  }, [task.status, task.started_at, task.accumulated_ms]);

  const isPending = task.status === "pending";
  const isInProgress = task.status === "in_progress";
  const isPaused = task.status === "paused";
  const isDone = task.status === "done";

  const statusClass = isDone
    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
    : isInProgress
      ? "bg-sky-50 border-sky-300 text-sky-800"
      : isPaused
        ? "bg-amber-50 border-amber-300 text-amber-800"
        : "bg-rose-50 border-rose-300 text-rose-800";

  return (
    <div className={`rounded-2xl border-2 p-4 flex flex-col gap-3 shadow-sm transition-colors ${statusClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] font-bold border border-rose-200">
              TASK
            </span>
            <span className="text-[11px] font-bold text-slate-500">P{task.priority}</span>
          </div>
          <h3 className="text-base font-bold text-slate-900 mt-1">{task.task_name}</h3>
          <p className="text-xs text-slate-600 mt-0.5">Estimated: {task.duration_min} min</p>
        </div>

        {isDone ? (
          <span className="inline-flex items-center gap-1 bg-emerald-500 text-white px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider">
            <CheckCircle size={12} /> Done
          </span>
        ) : (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-sm font-bold ${
            isInProgress ? "bg-sky-200 text-sky-800" :
            isPaused ? "bg-amber-200 text-amber-800" :
            "bg-rose-200 text-rose-800"
          }`}>
            <Clock size={14} className={isInProgress ? "animate-spin-slow" : ""} />
            {formatDuration(elapsedMs)}
          </div>
        )}
      </div>

      {!!task.notes && (
        <div className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1.5 text-xs text-slate-600">
          {task.notes}
        </div>
      )}

      {!isDone && (
        <div className="flex gap-2 mt-1">
          {isPending && (
            <button
              onClick={() => onStart(task.id)}
              disabled={isActionLoading}
              className="flex-1 min-h-[48px] bg-brand-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
            >
              <Play size={18} fill="currentColor" /> Start
            </button>
          )}

          {isInProgress && (
            <>
              <button
                onClick={() => onPause(task.id)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-amber-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <Pause size={18} fill="currentColor" /> Pause
              </button>
              <button
                onClick={() => onFinish(task.id)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <CheckCircle size={18} /> Finish
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                onClick={() => onResume(task.id)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-brand-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <Play size={18} fill="currentColor" /> Resume
              </button>
              <button
                onClick={() => onFinish(task.id)}
                disabled={isActionLoading}
                className="flex-1 min-h-[48px] bg-green-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <CheckCircle size={18} /> Finish
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
