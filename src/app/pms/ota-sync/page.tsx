"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OtaSyncTask, OtaSyncTaskStatus } from "@/lib/ota/types";
import { TaskRow } from "./_components/TaskRow";

function formatDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const STATUS_OPTIONS: Array<{ value: OtaSyncTaskStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "synced", label: "Synced" },
  { value: "skipped", label: "Skipped" },
  { value: "superseded", label: "Superseded" },
  { value: "all", label: "All Statuses" },
];

export default function OtaSyncPage() {
  const today = useMemo(() => new Date(), []);
  const [tasks, setTasks] = useState<OtaSyncTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelCode, setChannelCode] = useState<"BOOKING">("BOOKING");
  const [status, setStatus] = useState<OtaSyncTaskStatus | "all">("pending");
  const [fromDate, setFromDate] = useState(formatDate(today));
  const [toDate, setToDate] = useState(formatDate(addDays(today, 30)));
  const [alarmMinutes, setAlarmMinutes] = useState(120);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        channel_code: channelCode,
        status,
        from_date: fromDate,
        to_date: toDate,
      });

      const [otaRes, settingsRes] = await Promise.all([
        fetch(`/api/ota-sync?${params.toString()}`),
        fetch("/api/admin/settings?scope=rates"),
      ]);

      if (settingsRes.ok) {
        const settingsJson = await settingsRes.json();
        if (typeof settingsJson.alarm_minutes === "number") {
          setAlarmMinutes(settingsJson.alarm_minutes);
        }
      }

      if (!otaRes.ok) {
        const errorJson = await otaRes.json().catch(() => null);
        throw new Error(errorJson?.error || "Failed to load tasks");
      }

      const otaJson = await otaRes.json();
      if (otaJson.success) {
        setTasks(otaJson.tasks || []);
      } else {
        throw new Error(otaJson.error || "Failed to load tasks");
      }
    } catch (error) {
      showToast(error instanceof Error ? `Error: ${error.message}` : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [alarmMinutes, channelCode, fromDate, status, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function acknowledgeTask(taskId: string, action: "synced" | "skipped", staffNote?: string) {
    const res = await fetch("/api/ota-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, action, staff_note: staffNote }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.error || "Update failed");
    }
    return json;
  }

  async function handleUpdateStatus(taskId: string, nextStatus: "synced" | "skipped") {
    try {
      const note =
        nextStatus === "skipped"
          ? window.prompt("Enter a reason for skipping this task:", "")?.trim() ?? ""
          : "";
      if (nextStatus === "skipped" && !note) {
        showToast("Skip reason is required");
        return;
      }

      await acknowledgeTask(taskId, nextStatus, note || undefined);
      showToast(`Marked task as ${nextStatus}`);
      await loadData();
    } catch (error) {
      showToast(error instanceof Error ? `Error: ${error.message}` : "Update failed");
    }
  }

  async function handleBatchAcknowledge(taskIds: string[]) {
    let successCount = 0;
    for (const id of taskIds) {
      try {
        await acknowledgeTask(id, "synced");
        successCount += 1;
      } catch {
        // Keep going so operators can clear as many tasks as possible.
      }
    }
    showToast(`Marked ${successCount} task(s) as synced`);
    await loadData();
  }

  async function handleCopy(task: OtaSyncTask) {
    const roomTypeName = task.room_type_name || task.room_type_id;
    const payload = `${task.stay_date} ${roomTypeName} ฿${task.calculated_ota_price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    await navigator.clipboard.writeText(payload);
    showToast("Copied OTA update text");
  }

  const pendingIds = tasks.filter((task) => task.status === "pending").map((task) => task.id);

  return (
    <div className="max-w-6xl space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Operations</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">OTA Sync Queue</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Review manual Booking.com updates and clear stale sync tasks.</p>
        </div>

        <button className="btn btn-secondary" onClick={loadData}>↻ Refresh</button>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
            <button
              className="rounded-md px-3 py-1.5 text-sm font-bold transition bg-[var(--brand-booking-bg)] text-[var(--brand-booking-text)]"
              onClick={() => setChannelCode("BOOKING")}
            >
              Booking.com
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Status
            </label>
            <select
              className="form-select w-40"
              value={status}
              onChange={(event) => setStatus(event.target.value as OtaSyncTaskStatus | "all")}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              From
            </label>
            <input
              type="date"
              className="form-input w-40"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              To
            </label>
            <input
              type="date"
              className="form-input w-40"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-body)] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {pendingIds.length} pending task{pendingIds.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Tasks older than {alarmMinutes} minutes are highlighted as stale.
            </p>
          </div>

          {pendingIds.length > 0 && status === "pending" && (
            <button
              onClick={() => handleBatchAcknowledge(pendingIds)}
              className="btn btn-primary"
            >
              Mark All Synced
            </button>
          )}
        </div>
      </div>

      <div className="card p-6 min-h-[400px]">
        {loading ? (
          <div className="flex flex-col gap-3 opacity-60">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-[var(--bg-muted)] animate-pulse"></div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-20 text-center text-[var(--text-muted)]">
            <div className="mb-3 text-4xl">Done</div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">No tasks in this filter</h3>
            <p className="text-sm">Try a wider date range or switch the status filter.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                roomTypeName={task.room_type_name || task.room_type_id}
                alarmMinutes={alarmMinutes}
                onCopyPayload={handleCopy}
                onUpdateStatus={handleUpdateStatus}
              />
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast-bar toast-success z-50">{toast}</div>}
    </div>
  );
}
