"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppSettings = {
  hotel_timezone: string;
  shift_logout_reminder_times: string[];
  shift_logout_snooze_min: number;
  shift_logout_snooze_enabled: boolean;
  urgent_overlay_enabled: boolean;
};

type SettingsContextValue = {
  settings: AppSettings;
  loading: boolean;
  refresh: () => Promise<void>;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  hotel_timezone: "Asia/Bangkok",
  shift_logout_reminder_times: ["07:00", "15:00", "23:00"],
  shift_logout_snooze_min: 15,
  shift_logout_snooze_enabled: true,
  urgent_overlay_enabled: false,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function normalizeTimes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : DEFAULT_APP_SETTINGS.shift_logout_reminder_times;
  const normalized = Array.from(
    new Set(
      values
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => /^\d{2}:\d{2}$/.test(entry))
    )
  ).sort();
  return normalized.length > 0 ? normalized.slice(0, 6) : DEFAULT_APP_SETTINGS.shift_logout_reminder_times;
}

function clampMinutes(value: unknown, fallback: number): number {
  const raw = Number(value);
  const normalized = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
  return Math.min(Math.max(normalized, 1), 1440);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function mergeSettings(value: unknown): AppSettings {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    hotel_timezone: String(data.hotel_timezone ?? DEFAULT_APP_SETTINGS.hotel_timezone),
    shift_logout_reminder_times: normalizeTimes(data.shift_logout_reminder_times),
    shift_logout_snooze_min: clampMinutes(
      data.shift_logout_snooze_min,
      DEFAULT_APP_SETTINGS.shift_logout_snooze_min
    ),
    shift_logout_snooze_enabled: normalizeBoolean(
      data.shift_logout_snooze_enabled,
      DEFAULT_APP_SETTINGS.shift_logout_snooze_enabled
    ),
    urgent_overlay_enabled: normalizeBoolean(
      data.urgent_overlay_enabled,
      DEFAULT_APP_SETTINGS.urgent_overlay_enabled
    ),
  };
}

export function SettingsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.settings) {
        setSettings(mergeSettings(payload.settings));
      }
    } catch {
      // Keep conservative defaults when settings cannot be loaded.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ settings, loading, refresh }), [settings, loading, refresh]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context) return context;
  return {
    settings: DEFAULT_APP_SETTINGS,
    loading: false,
    refresh: async () => undefined,
  };
}
