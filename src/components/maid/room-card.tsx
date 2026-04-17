import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Package,
  Pause,
  Play,
  Wrench,
} from "lucide-react";
import { computeElapsedMs, formatDuration } from "@/lib/timer";
import type { MaidRoom } from "@/lib/types";
import { getRoomPalette } from "@/components/maid/maid-ui";

interface RoomCardProps {
  room: MaidRoom;
  onStart: (roomId: string, taskId: string | null, isNoService?: boolean) => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onFinishClick: (room: MaidRoom) => void;
  onNoServiceClick: (room: MaidRoom) => void;
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

export default function RoomCard({
  room,
  onStart,
  onPause,
  onResume,
  onFinishClick,
  onNoServiceClick,
  isActionLoading,
  canOperate = true,
  disabledReason = "View only",
}: RoomCardProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const palette = getRoomPalette(room);
  const maintenanceAssignments = room.maintenance_assignments ?? [];
  const loanCollections = room.loan_collections ?? [];
  const hkTraces = room.hk_traces ?? [];

  const dueLoanCollections = useMemo(
    () => loanCollections.filter((item) => item.is_due !== false),
    [loanCollections]
  );
  const loanCollectionUnitCount = dueLoanCollections.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)),
    0
  );
  const maintenanceMinutesTotal = Math.max(Number(room.maintenance_minutes_total ?? 0), 0);
  const targetDurationMin = Math.max(
    Number(room.target_duration_min ?? (room.cleaning_duration_min ?? 60) + maintenanceMinutesTotal),
    1
  );
  const targetDurationMs = targetDurationMin * 60_000;

  useEffect(() => {
    setElapsedMs(computeElapsedMs(room.started_at, room.accumulated_ms));

    if (room.status === "in_progress" && room.started_at) {
      const interval = setInterval(() => {
        setElapsedMs(computeElapsedMs(room.started_at, room.accumulated_ms));
      }, 1000);
      return () => clearInterval(interval);
    }

    if (room.status === "cleaned" || room.status === "approved") {
      setElapsedMs(room.accumulated_ms ?? 0);
    }
  }, [room.status, room.started_at, room.accumulated_ms]);

  const isDirty = room.status === "dirty";
  const isInProgress = room.status === "in_progress";
  const isPaused = room.status === "paused";
  const isDone = room.status === "cleaned" || room.status === "approved";
  const operationDisabled = isActionLoading || !canOperate;
  const remainingMs = targetDurationMs - elapsedMs;
  const isOvertime = remainingMs < 0;
  const guestName = room.guest_name || "ไม่มีชื่อผู้เข้าพัก";

  return (
    <div className={`flex flex-col overflow-hidden rounded-[28px] transition-all ${palette.card}`}>
      <div className="flex flex-1 flex-col p-5 pb-3">
        <div className="flex gap-4">
          <div className="shrink-0 pt-2">
            <h2 className={`text-[92px] font-black leading-[0.74] tracking-tighter sm:text-[108px] ${palette.accentText}`}>
              {room.room_number}
            </h2>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-end text-right">
            <p className="w-full truncate text-[17px] font-bold leading-tight text-slate-800 dark:text-slate-200">
              {guestName}
            </p>

            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {dueLoanCollections.length > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${palette.pill}`}>
                  <Package size={12} strokeWidth={2.5} />
                  เก็บคืน
                </span>
              )}
              {maintenanceAssignments.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/60 bg-sky-100 px-2.5 py-1 text-[11px] font-black text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300">
                  <Wrench size={12} strokeWidth={2.5} />
                  งานซ่อม
                </span>
              )}
              {room.is_no_service && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${palette.badge}`}>
                  <Ban size={12} strokeWidth={2.5} />
                  งดทำ
                </span>
              )}
              {room.status === "cleaned" && !room.is_no_service && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${palette.badge}`}>
                  <CheckCircle2 size={12} strokeWidth={2.5} />
                  รอตรวจ
                </span>
              )}
              {room.status === "approved" && !room.is_no_service && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${palette.badge}`}>
                  <CheckCircle2 size={12} strokeWidth={2.5} />
                  เสร็จ
                </span>
              )}
            </div>

            <div className="mt-auto pt-4">
              {!isDone && targetDurationMs > 0 ? (
                <div
                  className={`text-[36px] font-black leading-none tracking-tighter sm:text-[40px] ${
                    isOvertime ? "text-rose-600 dark:text-rose-400" : palette.timer
                  }`}
                >
                  {formatCountdown(remainingMs)}
                </div>
              ) : (
                <div className={`text-[34px] font-black leading-none tracking-tighter sm:text-[38px] ${palette.timer}`}>
                  {formatDuration(elapsedMs)}
                </div>
              )}

              <p className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">
                เป้าหมาย {targetDurationMin} นาที
              </p>
            </div>
          </div>
        </div>

        {room.no_service_note && (
          <div className="mt-5 flex items-start gap-3 rounded-[20px] border border-slate-200/60 bg-slate-100 p-4 shadow-inner dark:border-white/10 dark:bg-black/40">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-slate-800 opacity-80 dark:text-white" strokeWidth={2.5} />
            <p className="text-sm font-bold leading-snug tracking-wide text-slate-800 dark:text-white">
              {room.no_service_note}
            </p>
          </div>
        )}

        {maintenanceAssignments.length > 0 && (
          <div className="mt-4 rounded-[20px] border border-sky-200/80 bg-sky-50 px-4 py-3 dark:border-sky-500/20 dark:bg-sky-500/10">
            <p className="text-sm font-black text-sky-700 dark:text-sky-300">
              งานซ่อม {maintenanceAssignments.length} รายการ
              {maintenanceMinutesTotal > 0 ? ` · +${maintenanceMinutesTotal} นาที` : ""}
            </p>
            <p className="mt-1 truncate text-xs font-bold text-sky-700/80 dark:text-sky-300/75">
              {maintenanceAssignments.map((item) => item.task_name).join(" • ")}
            </p>
          </div>
        )}

        {dueLoanCollections.length > 0 && (
          <div className="mt-4 rounded-[20px] border border-amber-200/80 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="text-sm font-black text-amber-700 dark:text-amber-300">
              เก็บคืน {dueLoanCollections.length} รายการ · {loanCollectionUnitCount} ชิ้น
            </p>
            <p className="mt-1 truncate text-xs font-bold text-amber-700/80 dark:text-amber-300/75">
              {dueLoanCollections
                .slice(0, 2)
                .map((item) => `${item.item_icon} ${item.item_name} ×${item.quantity}`)
                .join(" • ")}
              {dueLoanCollections.length > 2 ? " • ..." : ""}
            </p>
          </div>
        )}

        {hkTraces.length > 0 && (
          <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 dark:border-white/5 dark:bg-slate-900">
            <p className="text-sm font-black text-slate-800 dark:text-white">เตือนก่อนจบงาน</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-500 dark:text-slate-400">
              {hkTraces.slice(0, 2).map((trace) => trace.text).join(" • ")}
              {hkTraces.length > 2 ? " • ..." : ""}
            </p>
          </div>
        )}
      </div>

      {!isDone && (
        <div className="flex flex-wrap gap-3 p-4 pt-4">
          {isDirty && (
            <>
              <button
                type="button"
                onClick={() => onStart(room.room_id, room.task_id, room.is_no_service)}
                disabled={operationDisabled}
                title={!canOperate ? disabledReason : undefined}
                className={`flex min-h-[68px] min-w-[150px] flex-1 items-center justify-center gap-3 rounded-[20px] border-transparent text-2xl font-black text-white transition-all active:scale-95 disabled:opacity-50 ${
                  room.is_no_service
                    ? "bg-sky-500 shadow-[0_4px_16px_rgba(2,132,199,0.22)] hover:bg-sky-600"
                    : "bg-rose-500 shadow-[0_4px_16px_rgba(225,29,72,0.22)] hover:bg-rose-600"
                }`}
              >
                <Play size={28} fill="currentColor" />
                {room.is_no_service ? "เริ่มดำเนินการ" : "เริ่มงาน"}
              </button>

              {!room.is_no_service && (
                <button
                  type="button"
                  onClick={() => onNoServiceClick(room)}
                  disabled={operationDisabled}
                  title={!canOperate ? disabledReason : undefined}
                  className="flex min-h-[68px] items-center justify-center gap-2 rounded-[20px] border border-slate-300 bg-slate-100 px-5 text-lg font-black text-slate-700 transition-all active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                >
                  <Ban size={22} />
                  งดทำ
                </button>
              )}
            </>
          )}

          {isInProgress && (
            <>
              <button
                type="button"
                onClick={() => room.task_id && onPause(room.task_id)}
                disabled={operationDisabled || !room.task_id}
                title={!canOperate ? disabledReason : undefined}
                className="flex h-[68px] w-[84px] shrink-0 items-center justify-center rounded-[20px] border border-slate-300 bg-slate-100 text-slate-700 transition-all active:scale-95 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                aria-label="พัก"
              >
                <Pause size={28} fill="currentColor" />
              </button>

              <button
                type="button"
                onClick={() => onFinishClick(room)}
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
                onClick={() => room.task_id && onResume(room.task_id)}
                disabled={operationDisabled || !room.task_id}
                title={!canOperate ? disabledReason : undefined}
                className="flex min-h-[68px] min-w-[130px] flex-1 items-center justify-center gap-2 rounded-[20px] bg-purple-500 text-2xl font-black text-white shadow-[0_4px_16px_rgba(147,51,234,0.2)] transition-all active:scale-95 disabled:opacity-50 hover:bg-purple-600"
              >
                <Play size={28} fill="currentColor" />
                ทำต่อ
              </button>

              <button
                type="button"
                onClick={() => onFinishClick(room)}
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
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <Clock size={14} />
              ใช้เวลา {formatDuration(room.accumulated_ms ?? 0)}
            </span>
            {room.finished_at && (
              <span>
                {new Date(room.finished_at).toLocaleTimeString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
