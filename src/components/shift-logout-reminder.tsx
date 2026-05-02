"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { logUiEvent } from "@/lib/ui-event-log-client";

type ReminderSettings = {
  hotel_timezone: string;
  shift_logout_reminder_times: string[];
  shift_logout_snooze_min: number;
  shift_logout_snooze_enabled: boolean;
};

type UserInfo = {
  id: string;
  name: string;
  detail: string | null;
};

const DEFAULT_SETTINGS: ReminderSettings = {
  hotel_timezone: "Asia/Bangkok",
  shift_logout_reminder_times: ["07:00", "15:00", "23:00"],
  shift_logout_snooze_min: 15,
  shift_logout_snooze_enabled: true,
};

const SNOOZE_PREFIX = "pms.shift-logout.snooze.";
const ACK_PREFIX = "pms.shift-logout.ack.";

export function ShiftLogoutReminder() {
  const router = useRouter();
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_SETTINGS);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [activeOccurrence, setActiveOccurrence] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const sortedTimes = useMemo(
    () => normalizeTimes(settings.shift_logout_reminder_times),
    [settings.shift_logout_reminder_times]
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabaseClient();

    async function load() {
      const [{ data: sessionData }, settingsResponse] = await Promise.all([
        supabase.auth.getSession(),
        fetch("/api/settings", { cache: "no-store" }).catch(() => null),
      ]);
      if (cancelled) return;

      const session = sessionData.session;
      const userId = session?.user?.id ?? null;
      if (!userId) return;

      if (settingsResponse?.ok) {
        const payload = await settingsResponse.json().catch(() => null);
        if (payload?.settings) {
          setSettings({
            hotel_timezone: String(payload.settings.hotel_timezone ?? DEFAULT_SETTINGS.hotel_timezone),
            shift_logout_reminder_times: normalizeTimes(payload.settings.shift_logout_reminder_times),
            shift_logout_snooze_min: clampMinutes(payload.settings.shift_logout_snooze_min, DEFAULT_SETTINGS.shift_logout_snooze_min),
            shift_logout_snooze_enabled: payload.settings.shift_logout_snooze_enabled ?? DEFAULT_SETTINGS.shift_logout_snooze_enabled,
          });
        }
      }

      const [{ data: profile }, { data: staff }] = await Promise.all([
        supabase.from("profiles").select("full_name, role").eq("user_id", userId).maybeSingle(),
        supabase.from("staff").select("display_name, nickname").eq("id", userId).maybeSingle(),
      ]);
      if (cancelled) return;

      const name =
        String(staff?.nickname || staff?.display_name || profile?.full_name || session?.user?.email || "").trim() ||
        "Staff";
      const role = String(profile?.role ?? "").trim().toUpperCase();
      setUserInfo({ id: userId, name, detail: role || null });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userInfo?.id || sortedTimes.length === 0) return;

    const check = () => {
      const occurrence = getDueOccurrence(new Date(), settings.hotel_timezone, sortedTimes);
      if (!occurrence) {
        setActiveOccurrence(null);
        return;
      }
      if (isAcknowledged(userInfo.id, occurrence.id)) {
        setActiveOccurrence(null);
        return;
      }
      if (isSnoozed(userInfo.id, occurrence.id)) {
        setActiveOccurrence(null);
        return;
      }
      setActiveOccurrence(occurrence.id);
    };

    check();
    const interval = window.setInterval(check, 30_000);
    return () => window.clearInterval(interval);
  }, [settings.hotel_timezone, sortedTimes, userInfo?.id]);

  if (!activeOccurrence || !userInfo) return null;
  const visibleUser = userInfo;
  const visibleOccurrence = activeOccurrence;

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      acknowledgeOccurrence(visibleUser.id, visibleOccurrence);
      setActiveOccurrence(null);
      logUiEvent({
        pathname: window.location.pathname,
        event_type: "auth_activity",
        event_name: "logout_clicked",
        metadata: {
          source: "shift_logout_reminder",
          occurrence: visibleOccurrence,
        },
      });
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  function handleSnooze() {
    setSnooze(visibleUser.id, visibleOccurrence, settings.shift_logout_snooze_min);
    setActiveOccurrence(null);
  }

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-sm rounded-xl border border-amber-200 bg-white p-5 shadow-2xl">
        <div className="mb-4">
          <p className="text-sm font-bold text-amber-700">Shift logout reminder</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">เปลี่ยนเวรแล้ว กรุณาออกจากระบบ</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            เครื่องนี้ยัง login เป็น <strong>{visibleUser.name}</strong>
            {visibleUser.detail ? ` (${visibleUser.detail})` : ""} อยู่
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
          {settings.shift_logout_snooze_enabled ? (
            <button
              type="button"
              onClick={handleSnooze}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Snooze {settings.shift_logout_snooze_min}m
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function normalizeTimes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : DEFAULT_SETTINGS.shift_logout_reminder_times;
  const normalized = Array.from(new Set(values
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^\d{2}:\d{2}$/.test(entry))))
    .sort();
  return normalized.length > 0 ? normalized.slice(0, 6) : DEFAULT_SETTINGS.shift_logout_reminder_times;
}

function clampMinutes(value: unknown, fallback: number): number {
  const raw = Number(value);
  const normalized = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  return Math.min(Math.max(normalized, 1), 1440);
}

function getDueOccurrence(now: Date, timeZone: string, times: string[]): { id: string } | null {
  const parts = getZonedParts(now, timeZone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const dueTime = times
    .map((time) => ({ time, minutes: toMinutes(time) }))
    .filter((entry) => entry.minutes <= nowMinutes)
    .sort((a, b) => b.minutes - a.minutes)[0];

  if (!dueTime) {
    const previousParts = getZonedParts(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
    return { id: `${previousParts.date}:${times[times.length - 1]}` };
  }
  return { id: `${parts.date}:${dueTime.time}` };
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
  };
}

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function isSnoozed(userId: string, occurrenceId: string): boolean {
  try {
    const value = window.localStorage.getItem(`${SNOOZE_PREFIX}${userId}.${occurrenceId}`);
    return value ? Number(value) > Date.now() : false;
  } catch {
    return false;
  }
}

function isAcknowledged(userId: string, occurrenceId: string): boolean {
  try {
    return window.localStorage.getItem(`${ACK_PREFIX}${userId}.${occurrenceId}`) === "1";
  } catch {
    return false;
  }
}

function setSnooze(userId: string, occurrenceId: string, minutes: number) {
  try {
    window.localStorage.setItem(
      `${SNOOZE_PREFIX}${userId}.${occurrenceId}`,
      String(Date.now() + minutes * 60_000)
    );
  } catch {
    // ignore localStorage errors
  }
}

function acknowledgeOccurrence(userId: string, occurrenceId: string) {
  try {
    window.localStorage.setItem(`${ACK_PREFIX}${userId}.${occurrenceId}`, "1");
    window.localStorage.removeItem(`${SNOOZE_PREFIX}${userId}.${occurrenceId}`);
  } catch {
    // ignore localStorage errors
  }
}
