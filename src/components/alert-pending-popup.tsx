"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AlertSettings, AlertsSummary } from "@/lib/types/alerts";

type AlertPendingPopupProps = {
  pageName: string;
};

const ALERT_SNOOZE_KEY_PREFIX = "pms.alert-job-warning-snooze-until";
const ALERT_REMINDER_REFRESH_MS = 5 * 60 * 1000;

type ReminderState = {
  settings: AlertSettings;
  summary: AlertsSummary;
};

function getBangkokMinutesNow() {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function parseTimeToMinutes(value: string) {
  const [hour, minute] = String(value ?? "").split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getSnoozeKey(businessDate: string) {
  return `${ALERT_SNOOZE_KEY_PREFIX}.${businessDate}`;
}

function getSnoozeUntil(businessDate: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(getSnoozeKey(businessDate));
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function setSnoozeUntil(businessDate: string, untilMs: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getSnoozeKey(businessDate), String(untilMs));
}

function clearSnooze(businessDate: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getSnoozeKey(businessDate));
}

export default function AlertPendingPopup({ pageName }: AlertPendingPopupProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReminderState | null>(null);
  const [nowMinutes, setNowMinutes] = useState(() => getBangkokMinutesNow());

  const pendingCount = useMemo(() => {
    if (!state) return 0;
    return state.summary.pending_prepayment + state.summary.pending_custom;
  }, [state]);

  const shouldWarn = useMemo(() => {
    if (!state) return false;
    if (state.summary.is_finished) return false;
    if (state.summary.total <= 0) return false;
    const startMinutes = parseTimeToMinutes(state.settings.start_time);
    return startMinutes !== null && nowMinutes >= startMinutes;
  }, [nowMinutes, state]);

  const loadReminderState = useCallback(async () => {
    try {
      const [settingsResponse, todayResponse] = await Promise.all([
        fetch("/api/settings/alerts", { cache: "no-store" }),
        fetch("/api/alerts/today", { cache: "no-store" }),
      ]);

      if (!settingsResponse.ok || !todayResponse.ok) {
        setState(null);
        setOpen(false);
        return;
      }

      const [settingsData, todayData] = await Promise.all([
        settingsResponse.json(),
        todayResponse.json(),
      ]);

      if (!settingsData.success || !todayData.success || !settingsData.settings || !todayData.summary) {
        setState(null);
        setOpen(false);
        return;
      }

      const nextState = {
        settings: settingsData.settings as AlertSettings,
        summary: todayData.summary as AlertsSummary,
      };
      setState(nextState);

      if (nextState.summary.is_finished) {
        clearSnooze(nextState.summary.business_date);
        setOpen(false);
        return;
      }

      const startMinutes = parseTimeToMinutes(nextState.settings.start_time);
      const reachedStartTime = startMinutes !== null && getBangkokMinutesNow() >= startMinutes;
      const hasAlertJob = nextState.summary.total > 0;
      const snoozeUntil = getSnoozeUntil(nextState.summary.business_date);
      setOpen(hasAlertJob && reachedStartTime && snoozeUntil <= Date.now());
    } catch {
      setState(null);
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    loadReminderState();
    const clockIntervalId = window.setInterval(() => {
      setNowMinutes(getBangkokMinutesNow());
    }, 60_000);
    const dataIntervalId = window.setInterval(() => {
      loadReminderState();
    }, ALERT_REMINDER_REFRESH_MS);
    return () => {
      window.clearInterval(clockIntervalId);
      window.clearInterval(dataIntervalId);
    };
  }, [loadReminderState]);

  useEffect(() => {
    if (!state || !shouldWarn) {
      setOpen(false);
      return;
    }

    const snoozeUntil = getSnoozeUntil(state.summary.business_date);
    setOpen(snoozeUntil <= Date.now());
  }, [shouldWarn, state]);

  if (!state || !shouldWarn) return null;

  const snoozeMinutes = Math.max(5, Number(state.settings.snooze_minutes || 60));
  const readyToFinish = pendingCount === 0 && state.summary.ready_to_finish;

  function handleSnooze() {
    if (!state) return;
    setSnoozeUntil(state.summary.business_date, Date.now() + snoozeMinutes * 60 * 1000);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleSnooze();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden border-2 border-amber-300 bg-amber-50 p-0 dark:border-amber-500/30 dark:bg-zinc-950">
        <DialogHeader className="border-b border-amber-200 bg-amber-100 px-6 py-5 dark:border-amber-500/20 dark:bg-amber-950/40">
          <DialogTitle className="text-xl font-bold text-amber-950 dark:text-amber-300">
            {readyToFinish ? "Alarm Job is ready to finish" : "Alerts still need attention"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-amber-900 dark:text-amber-400">
            {pageName} still has today&apos;s alert work open after {state.settings.start_time}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5 text-sm text-amber-950 dark:text-amber-500">
          <div className="rounded-xl border border-amber-200 bg-[var(--bg-surface)]/80 px-4 py-3 dark:border-amber-500/20">
            <p className="font-semibold">
              Business Date: <span className="font-bold">{state.summary.business_date}</span>
            </p>
            <p className="mt-1">
              Pending Alerts: <span className="font-bold">{pendingCount}</span>
            </p>
            <p className="mt-1">
              Cleared: <span className="font-bold">{state.summary.cleared}</span> / {state.summary.total}
            </p>
          </div>

          <p className="leading-6 text-amber-900 dark:text-amber-400/80">
            {readyToFinish
              ? "All alerts are cleared. Please finish the Alarm Job so the admin notification is sent and the day is marked complete."
              : "Please clear or snooze the remaining alerts before finishing the Alarm Job."}
          </p>
        </div>

        <DialogFooter className="border-t border-amber-200 bg-amber-50 px-6 py-4 dark:border-amber-500/20 dark:bg-amber-950/40">
          <button type="button" className="btn btn-secondary" onClick={handleSnooze}>
            Remind Me In {snoozeMinutes} Min
          </button>
          <Link href="/pms/alerts" className="btn btn-primary" onClick={() => setOpen(false)}>
            Open Today&apos;s Alerts
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
