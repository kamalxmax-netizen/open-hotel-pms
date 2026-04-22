"use client";

import { OtaSyncTask } from "@/lib/ota/types";
import { ChannelBadge } from "./ChannelBadge";
import { format } from "date-fns";

export function TaskRow({
  task,
  roomTypeName,
  alarmMinutes,
  onUpdateStatus,
  onCopyPayload
}: {
  task: OtaSyncTask;
  roomTypeName: string;
  alarmMinutes: number;
  onUpdateStatus: (taskId: string, status: "synced" | "skipped") => void;
  onCopyPayload: (payload: any) => void;
}) {
  const isPending = task.status === "pending";
  const created = new Date(task.created_at);
  const ageMinutes = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60000));
  const isStale = isPending && ageMinutes > alarmMinutes;

  return (
    <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 transition ${
      isPending 
        ? "bg-[var(--bg-surface)] border-brand-200 shadow-sm dark:border-brand-900/50" 
        : "bg-[var(--bg-muted)] border-[var(--border-subtle)] opacity-70"
    }`}>
      
      {/* Left info */}
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="flex-shrink-0">
          <ChannelBadge channelId={task.channel_code} />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-bold text-[var(--text-primary)] truncate">{roomTypeName}</h3>
            <span className="text-xs text-[var(--text-secondary)]">
              {task.stay_date}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Generated {format(created, "MMM d, yyyy HH:mm")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">
              Age: {ageMinutes} min
            </span>
            {isStale && (
              <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                Stale
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-[var(--text-secondary)] flex items-center gap-2">
            <span>PMS: <span className="line-through">{task.old_price == null ? "—" : `฿${task.old_price}`}</span> → <strong className="text-[var(--text-primary)]">฿{task.new_price}</strong></span>
            <span>|</span>
            <span>OTA Price: <strong className="text-brand-600">฿{task.calculated_ota_price}</strong></span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button 
          onClick={() => onCopyPayload(task)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] transition"
        >
          📋 Copy JSON
        </button>
        
        {isPending && (
          <>
            <button 
              onClick={() => onUpdateStatus(task.id, "skipped")}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
            >
              Skip
            </button>
            <button 
              onClick={() => onUpdateStatus(task.id, "synced")}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand-600 text-white shadow-sm hover:bg-brand-700 transition"
            >
              ✓ Mark Synced
            </button>
          </>
        )}
        
        {!isPending && (
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            task.status === "synced" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
          }`}>
            {task.status.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}
