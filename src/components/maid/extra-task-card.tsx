import { useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Pause, Play } from "lucide-react";
import { computeElapsedMs } from "@/lib/timer";
import type { ExtraTaskAssignment } from "@/lib/types";
import { getExtraTaskPalette } from "@/components/maid/maid-ui";

interface ExtraTaskCardProps {
  task: ExtraTaskAssignment;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onFinish: (id: string) => void;
  isActionLoading: boolean;
  canOperate?: boolean;
  disabledReason?: string;
}

function formatCountdown(valueMs: number) {
  const absolute = Math.abs(valueMs);
  const totalSeconds = Math.floor(absolute / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const prefix = valueMs < 0 ? "+" : "";
  return `${prefix}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatElapsed(valueMs: number) {
  const totalSeconds = Math.floor(Math.max(valueMs, 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ExtraTaskCard({
  task,
  onStart,
  onPause,
  onResume,
  onFinish,
  isActionLoading,
  canOperate = true,
  disabledReason = "View only",
}: ExtraTaskCardProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const palette = getExtraTaskPalette(task.status);

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
  const operationDisabled = isActionLoading || !canOperate;
  const targetMs = Math.max(Number(task.duration_min ?? 0), 1) * 60_000;
  const remainingMs = targetMs - elapsedMs;
  const locationLabel = task.assigned_maid || "งานส่วนกลาง";

  return (
    <div className={`flex flex-col overflow-hidden rounded-[28px] transition-all ${palette.card}`}>
      <div className="flex flex-1 flex-col p-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className={`break-words pr-2 text-3xl font-black leading-snug tracking-tight sm:text-[32px] ${palette.accentText}`}>
              {task.task_name}
            </h3>
          </div>

          <div className="flex min-w-[124px] flex-col items-end text-right">
            <p className="text-[17px] font-bold leading-tight text-slate-800 dark:text-slate-200">
              {locationLabel}
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <span className="rounded-full border border-slate-300/50 bg-black/5 px-2.5 py-1 text-[11px] font-black text-slate-700 dark:border-white/20 dark:bg-white/10 dark:text-slate-300">
                P{task.priority}
              </span>
            </div>

            <div className="mt-auto pt-4">
              {!isDone ? (
                <div className={`text-[36px] font-black leading-none tracking-tighter sm:text-[40px] ${remainingMs < 0 ? "text-rose-600 dark:text-rose-400" : palette.timer}`}>
                  {formatCountdown(remainingMs)}
                </div>
              ) : (
                <div className={`text-[34px] font-black leading-none tracking-tighter sm:text-[38px] ${palette.timer}`}>
                  {formatElapsed(elapsedMs)}
                </div>
              )}
            </div>
          </div>
        </div>

        {!!task.notes && (
          <div className="mt-5 flex items-start gap-3 rounded-[20px] border border-slate-200/60 bg-slate-100 p-4 shadow-inner dark:border-white/10 dark:bg-black/40">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-slate-800 opacity-80 dark:text-white" strokeWidth={2.5} />
            <p className="text-sm font-bold leading-snug tracking-wide text-slate-800 dark:text-white">{task.notes}</p>
          </div>
        )}
      </div>

      {!isDone && (
        <div className="flex flex-wrap gap-3 p-4">
          {isPending && (
            <button
              type="button"
              onClick={() => onStart(task.id)}
              disabled={operationDisabled}
              title={!canOperate ? disabledReason : undefined}
              className="flex min-h-[68px] min-w-[150px] flex-1 items-center justify-center gap-3 rounded-[20px] bg-rose-500 text-2xl font-black text-white shadow-[0_4px_16px_rgba(225,29,72,0.2)] transition-all active:scale-95 disabled:opacity-50 hover:bg-rose-600"
            >
              <Play size={28} fill="currentColor" />
              เริ่มงาน
            </button>
          )}

          {isInProgress && (
            <>
              <button
                type="button"
                onClick={() => onPause(task.id)}
                disabled={operationDisabled}
                title={!canOperate ? disabledReason : undefined}
                className="flex h-[68px] w-[84px] shrink-0 items-center justify-center rounded-[20px] border border-slate-300 bg-slate-100 text-slate-700 transition-all active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                aria-label="พัก"
              >
                <Pause size={28} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={() => onFinish(task.id)}
                disabled={operationDisabled}
                title={!canOperate ? disabledReason : undefined}
                className="flex min-h-[68px] min-w-[150px] flex-1 items-center justify-center gap-2 rounded-[20px] bg-emerald-500 text-2xl font-black text-white shadow-[0_4px_16px_rgba(5,150,105,0.22)] transition-all active:scale-95 disabled:opacity-50 hover:bg-emerald-600"
              >
                <Check size={28} strokeWidth={3} />
                เสร็จ
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                type="button"
                onClick={() => onResume(task.id)}
                disabled={operationDisabled}
                title={!canOperate ? disabledReason : undefined}
                className="flex min-h-[68px] min-w-[130px] flex-1 items-center justify-center gap-2 rounded-[20px] bg-purple-500 text-2xl font-black text-white shadow-[0_4px_16px_rgba(147,51,234,0.2)] transition-all active:scale-95 disabled:opacity-50 hover:bg-purple-600"
              >
                <Play size={28} fill="currentColor" />
                ทำต่อ
              </button>
              <button
                type="button"
                onClick={() => onFinish(task.id)}
                disabled={operationDisabled}
                title={!canOperate ? disabledReason : undefined}
                className="flex min-h-[68px] min-w-[130px] flex-[1.4] items-center justify-center gap-2 rounded-[20px] bg-emerald-500 text-2xl font-black text-white shadow-[0_4px_16px_rgba(5,150,105,0.22)] transition-all active:scale-95 disabled:opacity-50 hover:bg-emerald-600"
              >
                <Check size={28} strokeWidth={3} />
                เสร็จ
              </button>
            </>
          )}
        </div>
      )}

      {isDone && (
        <div className="border-t border-slate-200/70 px-5 py-4 text-sm font-bold text-slate-500 dark:border-white/5 dark:text-slate-400">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 size={14} />
            ทำงานเรียบร้อย
          </span>
        </div>
      )}
    </div>
  );
}
