"use client";

import { useState } from "react";
import MaidChip from "@/components/housekeeping/maid-chip";

export type HkStatus =
  | "available"
  | "dirty"
  | "in_progress"
  | "paused"
  | "cleaned"
  | "approved"
  | "closed"
  | "no_service";

type DiaryState = "available" | "due_in" | "inhouse" | "back_to_back" | "due_out";

export type HkRoom = {
  room_id: string;
  room_number: string;
  floor_number: number;
  wing: string;
  sort_order: number;
  room_type: string;
  room_type_code: string;
  cleaning_duration_min: number;
  is_sellable: boolean;
  hk_task_id: string | null;
  hk_status: HkStatus;
  started_at: string | null;
  finished_at: string | null;
  approved_at: string | null;
  accumulated_ms: number;
  is_no_service: boolean;
  no_service_note: string | null;
  assigned_maid_name: string | null;
  plan_assigned_maid: string | null;
  plan_priority: number | null;
  diary_state: DiaryState;
  due_in: boolean;
  due_out: boolean;
  back_to_back: boolean;
  in_house: boolean;
  in_house_sold_last_night: boolean;
  is_checkout_dirty_today: boolean;
  guest_name: string | null;
  hk_alert_count?: number;
  hk_first_alert_message?: string | null;
  hk_alert_severity?: "info" | "warning" | "critical" | null;
  hk_trace_count?: number;
  hk_trace_items?: Array<{
    id: string;
    text: string;
  }>;
  hk_collect_count?: number;
  hk_collect_units?: number;
  hk_collect_items?: Array<{
    item_name: string;
    quantity: number;
  }>;
  elapsed_ms: number;
  remaining_ms: number;
  /** Completed tasks from earlier task_seq on the same day (re-clean scenario) */
  hk_prior_tasks?: Array<{
    task_id: string;
    status: string;
    finished_at: string | null;
    approved_at: string | null;
    assigned_maid_name: string | null;
  }>;
  maintenance_minutes_total: number;
  maintenance_assignments: Array<{
    assignment_id: string;
    task_id: string;
    task_name: string;
    checklist_items: string[] | null;
    estimated_minutes: number;
    notes: string | null;
  }>;
};

const STATUS_CONFIG: Record<HkStatus, { label: string; badge: string; pill: string; emoji: string }> = {
  available: {
    label: "Available",
    badge: "status-available",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:opacity-80 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    emoji: "✓",
  },
  dirty: {
    label: "Dirty",
    badge: "status-dirty",
    pill: "border-rose-200 bg-rose-50 text-rose-700 hover:opacity-80 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400",
    emoji: "🧹",
  },
  in_progress: {
    label: "Cleaning",
    badge: "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
    pill: "border-amber-200 bg-amber-50 text-amber-700 hover:opacity-80 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    emoji: "🔄",
  },
  paused: {
    label: "Paused",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    pill: "border-amber-200 bg-amber-50 text-amber-700 hover:opacity-80 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    emoji: "⏸",
  },
  cleaned: {
    label: "⏳ Wait Appr.",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    pill: "border-amber-300 bg-amber-100 text-amber-800 hover:opacity-80 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    emoji: "✅",
  },
  approved: {
    label: "Clean ✓",
    badge: "status-approved",
    pill: "border-emerald-300 bg-emerald-100 text-emerald-800 hover:opacity-80 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    emoji: "✅",
  },
  no_service: {
    label: "No Service",
    badge: "bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800",
    pill: "border-sky-300 bg-sky-50 text-sky-700 hover:opacity-80 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
    emoji: "🚫",
  },
  closed: {
    label: "Renovation",
    badge: "status-closed",
    pill: "border-[var(--border-default)] bg-[var(--bg-surface-hover)] text-[var(--text-muted)]",
    emoji: "🚧",
  },
};

const NEXT_STATUS: Partial<Record<HkStatus, HkStatus[]>> = {
  available: ["dirty"],
  dirty: ["in_progress"],
  in_progress: ["paused"],
  paused: ["in_progress"],
};

export default function FloorGroup({
  floor,
  rooms,
  updatingRoomId,
  onUpdateStatus,
  onApprove,
  onAssignClick,
  formatTime,
}: {
  floor: number;
  rooms: HkRoom[];
  updatingRoomId: string | null;
  onUpdateStatus: (room: HkRoom, newStatus: HkStatus) => void | Promise<void>;
  onApprove: (room: HkRoom) => void | Promise<void>;
  onAssignClick: (room: HkRoom) => void;
  formatTime: (iso: string | null) => string;
}) {
  const [expandedMaintenanceByRoomId, setExpandedMaintenanceByRoomId] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[var(--text-table-cell)] flex items-center gap-2">
        <span className="w-6 h-6 rounded bg-[var(--bg-muted)] flex items-center justify-center text-xs">F{floor}</span>
        Floor {floor}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {rooms.map((room) => {
          const isNoService = room.is_no_service;
          const isCleanedAndWaiting = String(room.hk_status) === "cleaned" && !isNoService;
          const cfg = isNoService ? STATUS_CONFIG.no_service : (STATUS_CONFIG[room.hk_status] ?? STATUS_CONFIG.available);
          const nextStatuses = NEXT_STATUS[room.hk_status] ?? [];
          const isUpdating = updatingRoomId === room.room_id;
          const isCheckoutLocked =
            (room.diary_state === "due_out" || room.diary_state === "back_to_back") && !room.is_checkout_dirty_today;
          const hkCollectCount = Math.max(Number(room.hk_collect_count ?? 0), 0);
          const hkCollectUnits = Math.max(Number(room.hk_collect_units ?? 0), 0);
          const hkCollectItems = Array.isArray(room.hk_collect_items) ? room.hk_collect_items : [];
          const hkAlertCount = Math.max(Number(room.hk_alert_count ?? 0), 0);
          const hkTraceItems = Array.isArray(room.hk_trace_items) ? room.hk_trace_items : [];
          const hkCollectTooltipLines =
            hkCollectCount > 0
              ? [
                  `HK Collect: ${hkCollectCount} line${hkCollectCount > 1 ? "s" : ""}, ${hkCollectUnits} unit${hkCollectUnits > 1 ? "s" : ""}`,
                  ...hkCollectItems.map((item) => `${item.item_name} ×${Math.max(Number(item.quantity ?? 1), 1)}`),
                ]
              : [];
          const occupancyChip =
            room.diary_state === "back_to_back"
              ? { label: "↕ Back-to-back", className: "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800" }
              : room.diary_state === "due_out"
                ? { label: "↑ Due out", className: "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800" }
                : room.diary_state === "due_in"
                  ? { label: "↓ Due in", className: "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800" }
                  : room.diary_state === "inhouse"
                    ? { label: "● In-house", className: "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800" }
                    : null;

          return (
            <div
              key={room.room_id}
              className={`card p-4 space-y-3 relative overflow-hidden transition-all ${
                isCleanedAndWaiting ? "ring-2 ring-amber-400 bg-amber-50/30" : ""
              }`}
            >
              {isCleanedAndWaiting && (
                <div className="absolute top-0 inset-x-0 bg-amber-400 text-amber-900 text-[10px] font-bold text-center py-0.5 uppercase tracking-wider">
                  Waiting Approval
                </div>
              )}

              <div className={`flex items-start justify-between ${isCleanedAndWaiting ? "mt-2" : ""}`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-[var(--text-primary)] tracking-tight">{room.room_number}</span>
                    {hkAlertCount > 0 && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          room.hk_alert_severity === "critical"
                            ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400"
                            : room.hk_alert_severity === "warning"
                              ? "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                              : "border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400"
                        }`}
                        title={room.hk_first_alert_message ?? "Housekeeping alert"}
                      >
                        🔴 {hkAlertCount}
                      </span>
                    )}
                    {hkTraceItems.length > 0 && (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                        title={hkTraceItems[0]?.text ?? "Housekeeping trace"}
                      >
                        🟠 {hkTraceItems.length}
                      </span>
                    )}
                    {hkCollectCount > 0 && (
                      <span className="relative inline-flex group">
                        <span
                          tabIndex={0}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800 outline-none"
                        >
                          📦 HK Collect {hkCollectCount}
                        </span>
                        <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden w-56 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] leading-4 text-slate-100 shadow-lg group-hover:block group-focus-within:block">
                          {hkCollectTooltipLines.map((line, idx) => (
                            <span key={`${room.room_id}-hk-collect-tooltip-${idx}`} className={`block ${idx === 0 ? "font-semibold" : ""}`}>
                              {line}
                            </span>
                          ))}
                        </span>
                      </span>
                    )}
                    {(room.hk_prior_tasks?.length ?? 0) > 0 && (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400"
                        title={`Cleaned ${room.hk_prior_tasks!.length}x earlier today — re-clean after room move`}
                      >
                        🔁 {room.hk_prior_tasks!.length > 1 ? `${room.hk_prior_tasks!.length}x` : "Re-clean"}
                      </span>
                    )}
                    <MaidChip maidName={room.assigned_maid_name || room.plan_assigned_maid} priority={room.plan_priority} />
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] font-medium tracking-wide mt-0.5">{room.room_type_code}</p>
                </div>
                <span className={`badge text-[10px] shrink-0 ${cfg.badge}`}>
                  {cfg.emoji} {cfg.label}
                </span>
              </div>

              {occupancyChip && (
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${occupancyChip.className}`}>
                    {occupancyChip.label}
                  </span>
                  {room.diary_state === "inhouse" && !room.in_house_sold_last_night && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] border border-[var(--border-default)]">
                      Excluded from In-house filter
                    </span>
                  )}
                </div>
              )}

              {room.guest_name && (
                <div className="text-xs text-[var(--text-secondary)] bg-[var(--bg-surface-hover)] rounded-md px-2 py-1.5 flex items-center gap-2">
                  <span className="opacity-50">👤</span>
                  <span className="truncate font-semibold">{room.guest_name}</span>
                </div>
              )}

              {hkTraceItems.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2">
                  <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">HK Trace</p>
                  <div className="mt-1 space-y-1">
                    {hkTraceItems.slice(0, 3).map((trace) => (
                      <p key={trace.id} className="text-[11px] text-amber-700 dark:text-amber-400">
                        • {trace.text}
                      </p>
                    ))}
                    {hkTraceItems.length > 3 && (
                      <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        +{hkTraceItems.length - 3} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {room.is_no_service && room.no_service_note && (
                <div className="text-[11px] text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 rounded-md px-2 py-1.5 border border-sky-200 dark:border-sky-800">
                  <span className="font-semibold">NS Note:</span> {room.no_service_note}
                </div>
              )}

              {isCheckoutLocked && (
                <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 rounded-md px-2 py-1.5 border border-rose-200 dark:border-rose-800">
                  Checkout not completed. Room is locked from HK pool until guest checks out.
                </div>
              )}

              {room.maintenance_assignments.length > 0 && (
                <div className="text-[10px] text-indigo-700 dark:text-indigo-400 space-y-1 bg-indigo-50 dark:bg-indigo-950/40 p-2 rounded-lg border border-indigo-100 dark:border-indigo-800">
                  <div className="flex justify-between items-center font-semibold">
                    <span>🔧 Maintenance Due: {room.maintenance_assignments.length}</span>
                    <span>+{room.maintenance_minutes_total} min</span>
                  </div>
                  <p className="truncate text-indigo-600 dark:text-indigo-400">
                    {room.maintenance_assignments.map((item) => item.task_name).join(" • ")}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMaintenanceByRoomId((prev) => ({
                        ...prev,
                        [room.room_id]: !prev[room.room_id],
                      }))
                    }
                    className="text-[10px] font-bold text-indigo-700 underline underline-offset-2"
                  >
                    {expandedMaintenanceByRoomId[room.room_id] ? "Hide details" : "View details"}
                  </button>
                  {expandedMaintenanceByRoomId[room.room_id] && (
                    <div className="space-y-1 rounded border border-indigo-100 bg-[var(--bg-surface)]/80 p-2">
                      {room.maintenance_assignments.map((item) => (
                        <div key={item.assignment_id} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-body)] px-2 py-1">
                          <p className="font-semibold text-[var(--text-primary)]">
                            {item.task_name}
                            {!!item.estimated_minutes && (
                              <span className="ml-1 font-medium text-[var(--text-secondary)]">({item.estimated_minutes} min)</span>
                            )}
                          </p>
                          {item.checklist_items && item.checklist_items.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.checklist_items.map((checkItem, idx) => (
                                <span
                                  key={`${item.assignment_id}-${checkItem}-${idx}`}
                                  className="rounded border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:text-indigo-400"
                                >
                                  {checkItem}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-[var(--text-secondary)]">No checklist items defined.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(room.started_at || room.finished_at || room.elapsed_ms > 0) && (
                <div className="text-[10px] text-[var(--text-secondary)] space-y-1 bg-[var(--bg-body)] p-2 rounded-lg border border-[var(--border-subtle)]">
                  {room.elapsed_ms > 0 && (
                    <div className="flex justify-between items-center font-mono font-bold text-[var(--text-table-cell)]">
                      <span>Elapsed:</span>
                      <span>{Math.floor(room.elapsed_ms / 60000)} mins</span>
                    </div>
                  )}
                  {room.started_at && <p>▶ Start: {formatTime(room.started_at)}</p>}
                  {room.finished_at && <p>✓ Finish: {formatTime(room.finished_at)}</p>}
                </div>
              )}

              <div className="pt-2 flex flex-wrap gap-2 border-t border-[var(--border-subtle)]">
                {!isCleanedAndWaiting &&
                  nextStatuses.length > 0 &&
                  nextStatuses.map((nextStatus) => {
                    const nextCfg = STATUS_CONFIG[nextStatus];
                    return (
                      <button
                        key={nextStatus}
                        disabled={isUpdating}
                        onClick={() => onUpdateStatus(room, nextStatus)}
                        className={`flex-1 rounded-lg border text-[10px] font-bold py-2 transition ${nextCfg.pill}`}
                      >
                        {isUpdating ? "…" : `Mark ${nextCfg.label}`}
                      </button>
                    );
                  })}

                {isCleanedAndWaiting && (
                  <button
                    disabled={isUpdating}
                    onClick={() => onApprove(room)}
                    className="w-full rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 text-xs font-bold py-2 transition-colors shadow-sm"
                  >
                    {isUpdating ? "..." : "✓ Approve Clean"}
                  </button>
                )}

                {room.hk_status === "dirty" && (
                  <button
                    disabled={isCheckoutLocked}
                    onClick={() => onAssignClick(room)}
                    className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border-input)] text-[var(--text-table-cell)] text-[10px] font-bold py-2 hover:bg-[var(--bg-body)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCheckoutLocked ? "Checkout Pending" : "Assign Maid"}
                  </button>
                )}
                {(room.hk_status === "in_progress" || room.hk_status === "paused") && (
                  <div className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                    Assignment locked after start
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
