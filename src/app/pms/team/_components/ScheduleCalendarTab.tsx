"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import GenerateRosterDialog from "./GenerateRosterDialog";

type StaffRow = {
  id: string;
  display_name: string;
  nickname: string | null;
  department?: { code: string; name: string } | null;
};

type RosterConfigRow = {
  id: string;
  staff_id: string;
  regular_day_off: number;
  shift_preference: "morning_fixed" | "rotate";
  night_rotation_order: number | null;
  extra_day_offs_per_month: number;
  staff?: {
    id: string;
    display_name: string;
    nickname: string | null;
    department?: { code: string; name: string } | null;
  } | null;
};

type ShiftRow = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_type: "morning" | "afternoon" | "night" | "off";
  is_generated?: boolean;
  staff?: {
    id: string;
    display_name: string;
    nickname: string | null;
    department?: { code: string; name: string } | null;
  } | null;
};

type ConfigDraft = {
  config_id: string | null;
  regular_day_off: number;
  shift_preference: "morning_fixed" | "rotate";
  night_rotation_order: string;
  extra_day_offs_per_month: number;
};

type ShiftCount = {
  morning: number;
  afternoon: number;
  night: number;
  work: number;
  off: number;
};

type ShiftCellEntry = {
  shift_id: string;
  staff_id: string;
  nickname: string;
  is_generated: boolean;
};

type ValidateWarningCode =
  | "work_days_over"
  | "work_days_under"
  | "day_offs_over"
  | "day_offs_under"
  | "back_to_back_violation"
  | "understaffed_shift";

type ValidationWarning = {
  code: ValidateWarningCode;
  message: string;
  staff_id: string | null;
  shift_date: string | null;
};

type ManualEditTarget = {
  date: string;
  shiftType: "morning" | "afternoon" | "night";
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_OFF_LABELS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const REQUIRED_STAFFING: Record<number, { morning: number; afternoon: number; night: number }> = {
  0: { morning: 1, afternoon: 2, night: 1 },
  1: { morning: 1, afternoon: 2, night: 1 },
  2: { morning: 1, afternoon: 1, night: 1 },
  3: { morning: 1, afternoon: 1, night: 1 },
  4: { morning: 1, afternoon: 1, night: 1 },
  5: { morning: 1, afternoon: 1, night: 1 },
  6: { morning: 1, afternoon: 1, night: 1 },
};

const STAFF_COLOR_PRESET: Record<string, string> = {
  "สาว": "#FFB6C1",
  sao: "#FFB6C1",
  "ดาว": "#DDA0DD",
  dao: "#DDA0DD",
  "เอ็ม": "#90EE90",
  em: "#90EE90",
  "อิ๋ว": "#87CEEB",
  ew: "#87CEEB",
};

const FALLBACK_COLORS = ["#F9A8D4", "#A78BFA", "#60A5FA", "#34D399", "#FBBF24", "#FB7185"];
const SHIFT_LABELS: Record<"morning" | "afternoon" | "night", string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  night: "Night",
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthRange(year: number, month: number): { from: string; to: string; daysInMonth: number } {
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    from: toYmd(year, month, 1),
    to: toYmd(year, month, daysInMonth),
    daysInMonth,
  };
}

function buildCalendarCells(year: number, month: number) {
  const firstDow = new Date(year, month - 1, 1, 12, 0, 0, 0).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  const cells: Array<{ key: string; label: number; inMonth: boolean; date: string | null; dow: number }> = [];

  for (let i = 0; i < firstDow; i += 1) {
    const day = prevMonthDays - firstDow + i + 1;
    const date = new Date(year, month - 2, day, 12, 0, 0, 0);
    cells.push({
      key: `prev-${day}-${i}`,
      label: day,
      inMonth: false,
      date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      dow: i,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    cells.push({
      key: `cur-${day}`,
      label: day,
      inMonth: true,
      date: toYmd(year, month, day),
      dow: date.getDay(),
    });
  }

  while (cells.length % 7 !== 0) {
    const nextDay = cells.length - (firstDow + daysInMonth) + 1;
    const date = new Date(year, month, nextDay, 12, 0, 0, 0);
    cells.push({
      key: `next-${nextDay}`,
      label: nextDay,
      inMonth: false,
      date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      dow: cells.length % 7,
    });
  }

  return { cells, daysInMonth };
}

function normalizedNickName(staff: { nickname: string | null; display_name: string }): string {
  const nick = String(staff.nickname ?? "").trim();
  if (nick) return nick;
  return String(staff.display_name ?? "").trim() || "Unknown";
}

function colorForStaff(nickname: string, staffId: string): string {
  const key = nickname.trim().toLowerCase();
  if (STAFF_COLOR_PRESET[key]) return STAFF_COLOR_PRESET[key];
  for (const [name, color] of Object.entries(STAFF_COLOR_PRESET)) {
    if (nickname.includes(name)) return color;
  }
  let hash = 0;
  for (let i = 0; i < staffId.length; i += 1) hash = (hash * 31 + staffId.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function countWeekdayInMonth(year: number, month: number, dow: number): number {
  const { daysInMonth } = monthRange(year, month);
  let count = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getDay() === dow) count += 1;
  }
  return count;
}

export function ScheduleCalendarTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [foStaff, setFoStaff] = useState<StaffRow[]>([]);
  const [configs, setConfigs] = useState<RosterConfigRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [configDraftByStaff, setConfigDraftByStaff] = useState<Record<string, ConfigDraft>>({});
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [nightStartOrder, setNightStartOrder] = useState<number | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);

  const [manualEditTarget, setManualEditTarget] = useState<ManualEditTarget | null>(null);
  const [manualEditLoading, setManualEditLoading] = useState(false);
  const [manualEditError, setManualEditError] = useState<string | null>(null);
  const [manualAddStaffId, setManualAddStaffId] = useState("");

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = createBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const sortedFoStaff = useMemo(() => {
    return [...foStaff].sort((a, b) =>
      normalizedNickName(a).localeCompare(normalizedNickName(b), "th")
    );
  }, [foStaff]);

  const rotateOptions = useMemo(() => {
    return configs
      .filter((cfg) => cfg.shift_preference === "rotate" && cfg.night_rotation_order !== null)
      .map((cfg) => {
        const staff = sortedFoStaff.find((row) => row.id === cfg.staff_id);
        return {
          staff_id: cfg.staff_id,
          nickname: staff ? normalizedNickName(staff) : cfg.staff?.nickname || cfg.staff?.display_name || cfg.staff_id,
          night_rotation_order: Number(cfg.night_rotation_order),
        };
      })
      .sort((a, b) => a.night_rotation_order - b.night_rotation_order || a.nickname.localeCompare(b.nickname, "th"));
  }, [configs, sortedFoStaff]);

  const hydrateDrafts = useCallback((staffRows: StaffRow[], configRows: RosterConfigRow[]) => {
    const map: Record<string, ConfigDraft> = {};
    for (const staff of staffRows) {
      const cfg = configRows.find((row) => row.staff_id === staff.id);
      map[staff.id] = {
        config_id: cfg?.id ?? null,
        regular_day_off: cfg?.regular_day_off ?? 0,
        shift_preference: cfg?.shift_preference ?? "rotate",
        night_rotation_order: cfg?.night_rotation_order ? String(cfg.night_rotation_order) : "",
        extra_day_offs_per_month: cfg?.extra_day_offs_per_month ?? 0,
      };
    }
    setConfigDraftByStaff(map);
  }, []);

  const runValidate = useCallback(
    async (targetYear = year, targetMonth = month) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/staff/shifts/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ year: targetYear, month: targetMonth }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to validate monthly schedule.");
        }
        const warnings = Array.isArray(data?.data?.warnings)
          ? ((data.data.warnings as ValidationWarning[]) ?? [])
          : [];
        setValidationWarnings(warnings);
      } catch (err) {
        setValidationWarnings([
          {
            code: "understaffed_shift",
            message: err instanceof Error ? err.message : "Validation check failed.",
            staff_id: null,
            shift_date: null,
          },
        ]);
      }
    },
    [getAuthHeaders, month, year]
  );

  const fetchData = useCallback(
    async (targetYear = year, targetMonth = month) => {
      try {
        setLoading(true);
        setError(null);
        const headers = await getAuthHeaders();
        const range = monthRange(targetYear, targetMonth);

        const [staffRes, configRes, shiftRes] = await Promise.all([
          fetch("/api/staff?department_code=FO&is_active=true", { headers, cache: "no-store" }),
          fetch("/api/staff/roster-config", { headers, cache: "no-store" }),
          fetch(
            `/api/staff/shifts?department_code=FO&shift_date_from=${range.from}&shift_date_to=${range.to}&limit=500&offset=0`,
            { headers, cache: "no-store" }
          ),
        ]);

        const [staffJson, configJson, shiftJson] = await Promise.all([
          staffRes.json().catch(() => ({})),
          configRes.json().catch(() => ({})),
          shiftRes.json().catch(() => ({})),
        ]);

        if (!staffRes.ok || !staffJson.success) {
          throw new Error(staffJson.error || "Failed to load FO staff.");
        }
        if (!configRes.ok || !configJson.success) {
          throw new Error(configJson.error || "Failed to load roster config.");
        }
        if (!shiftRes.ok || !shiftJson.success) {
          throw new Error(shiftJson.error || "Failed to load monthly shifts.");
        }

        const staffRows = (staffJson.data ?? []) as StaffRow[];
        const configRows = (configJson.data ?? []) as RosterConfigRow[];
        const shiftRows = (shiftJson.data ?? []) as ShiftRow[];

        setFoStaff(staffRows);
        setConfigs(configRows);
        setShifts(shiftRows.filter((row) => row.shift_type !== "off"));
        hydrateDrafts(staffRows, configRows);

        if (nightStartOrder === null) {
          const firstRotate = configRows
            .filter((cfg) => cfg.shift_preference === "rotate" && cfg.night_rotation_order !== null)
            .sort((a, b) => Number(a.night_rotation_order) - Number(b.night_rotation_order))[0];
          setNightStartOrder(firstRotate?.night_rotation_order ?? null);
        }

        await runValidate(targetYear, targetMonth);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load schedule calendar.");
      } finally {
        setLoading(false);
      }
    },
    [getAuthHeaders, hydrateDrafts, month, nightStartOrder, runValidate, year]
  );

  useEffect(() => {
    fetchData(year, month);
  }, [fetchData, month, year]);

  const moveMonth = (delta: number) => {
    const date = new Date(year, month - 1 + delta, 1, 12, 0, 0, 0);
    setYear(date.getFullYear());
    setMonth(date.getMonth() + 1);
  };

  const handleDraftChange = (staffId: string, patch: Partial<ConfigDraft>) => {
    setConfigDraftByStaff((prev) => ({
      ...prev,
      [staffId]: {
        ...prev[staffId],
        ...patch,
      },
    }));
  };

  const saveConfig = async (staffId: string) => {
    const draft = configDraftByStaff[staffId];
    if (!draft) return;
    if (draft.shift_preference === "rotate" && !draft.night_rotation_order) {
      alert("night_rotation_order is required for rotate staff.");
      return;
    }
    if (
      draft.shift_preference === "morning_fixed" &&
      draft.night_rotation_order &&
      String(draft.night_rotation_order).trim() !== ""
    ) {
      alert("night_rotation_order must be empty for morning_fixed.");
      return;
    }

    try {
      setSavingStaffId(staffId);
      const headers = await getAuthHeaders();
      const payload = {
        regular_day_off: Number(draft.regular_day_off),
        shift_preference: draft.shift_preference,
        night_rotation_order:
          draft.shift_preference === "rotate" ? Number(draft.night_rotation_order) : null,
        extra_day_offs_per_month: Number(draft.extra_day_offs_per_month),
      };

      let res: Response;
      if (draft.config_id) {
        res = await fetch(`/api/staff/roster-config/${draft.config_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/staff/roster-config", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            staff_id: staffId,
            ...payload,
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save roster config.");
      }

      await fetchData(year, month);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save roster config.");
    } finally {
      setSavingStaffId(null);
    }
  };

  const runGenerate = async (payload: {
    year: number;
    month: number;
    nightStartPersonOrder: number;
  }) => {
    try {
      setGenerateLoading(true);
      setGenerateError(null);
      const headers = await getAuthHeaders();

      const res = await fetch("/api/staff/shifts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          year: payload.year,
          month: payload.month,
          night_start_person_order: payload.nightStartPersonOrder,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate roster.");
      }

      const warnings = Array.isArray(data?.data?.warnings) ? (data.data.warnings as string[]) : [];
      setGenerateWarnings(warnings);
      setNightStartOrder(payload.nightStartPersonOrder);
      setYear(payload.year);
      setMonth(payload.month);
      setGenerateOpen(false);
      await fetchData(payload.year, payload.month);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate roster.");
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!nightStartOrder) {
      setGenerateError("Night Start Person is not configured yet.");
      setGenerateOpen(true);
      return;
    }
    await runGenerate({ year, month, nightStartPersonOrder: nightStartOrder });
  };

  const { cells, daysInMonth } = useMemo(() => buildCalendarCells(year, month), [year, month]);

  const shiftMap = useMemo(() => {
    const map = new Map<
      string,
      { morning: ShiftCellEntry[]; afternoon: ShiftCellEntry[]; night: ShiftCellEntry[] }
    >();
    const configByStaff = new Map(configs.map((cfg) => [cfg.staff_id, cfg]));
    const staffById = new Map(sortedFoStaff.map((staff) => [staff.id, staff]));

    for (const row of shifts) {
      if (row.shift_type === "off") continue;
      const date = row.shift_date;
      const bucket = map.get(date) ?? { morning: [], afternoon: [], night: [] };
      const staff = staffById.get(row.staff_id);
      const config = configByStaff.get(row.staff_id);
      const nickname =
        (staff ? normalizedNickName(staff) : null) ||
        (config?.staff?.nickname?.trim() || config?.staff?.display_name || row.staff?.nickname || row.staff?.display_name || row.staff_id);

      bucket[row.shift_type].push({
        shift_id: row.id,
        staff_id: row.staff_id,
        nickname,
        is_generated: Boolean(row.is_generated),
      });
      map.set(date, bucket);
    }

    for (const value of map.values()) {
      value.morning.sort((a, b) => a.nickname.localeCompare(b.nickname, "th"));
      value.afternoon.sort((a, b) => a.nickname.localeCompare(b.nickname, "th"));
      value.night.sort((a, b) => a.nickname.localeCompare(b.nickname, "th"));
    }

    return map;
  }, [configs, shifts, sortedFoStaff]);

  const summaryByStaff = useMemo(() => {
    const summary = new Map<string, ShiftCount>();
    for (const staff of sortedFoStaff) {
      summary.set(staff.id, { morning: 0, afternoon: 0, night: 0, work: 0, off: daysInMonth });
    }
    for (const row of shifts) {
      if (row.shift_type === "off") continue;
      const entry = summary.get(row.staff_id);
      if (!entry) continue;
      entry[row.shift_type] += 1;
      entry.work += 1;
      entry.off = Math.max(0, daysInMonth - entry.work);
    }
    return summary;
  }, [daysInMonth, shifts, sortedFoStaff]);

  const manualTargetEntries = useMemo(() => {
    if (!manualEditTarget) return [] as ShiftCellEntry[];
    const bucket = shiftMap.get(manualEditTarget.date);
    if (!bucket) return [] as ShiftCellEntry[];
    return bucket[manualEditTarget.shiftType] ?? [];
  }, [manualEditTarget, shiftMap]);

  const staffShiftByDate = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const row of shifts) {
      if (row.shift_type === "off") continue;
      const key = `${row.staff_id}#${row.shift_date}`;
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return map;
  }, [shifts]);

  const addableStaffOptions = useMemo(() => {
    if (!manualEditTarget) return [] as StaffRow[];
    const existingIds = new Set(manualTargetEntries.map((entry) => entry.staff_id));
    return sortedFoStaff.filter((staff) => !existingIds.has(staff.id));
  }, [manualEditTarget, manualTargetEntries, sortedFoStaff]);

  useEffect(() => {
    if (!manualEditTarget) {
      setManualAddStaffId("");
      setManualEditError(null);
      return;
    }
    const first = addableStaffOptions[0];
    setManualAddStaffId(first?.id ?? "");
    setManualEditError(null);
  }, [addableStaffOptions, manualEditTarget]);

  const closeManualEdit = () => {
    setManualEditTarget(null);
    setManualEditError(null);
    setManualAddStaffId("");
  };

  const removeShiftEntry = async (shiftId: string) => {
    try {
      setManualEditLoading(true);
      setManualEditError(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/staff/shifts?id=${shiftId}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to remove shift.");
      }
      await fetchData(year, month);
    } catch (err) {
      setManualEditError(err instanceof Error ? err.message : "Failed to remove shift.");
    } finally {
      setManualEditLoading(false);
    }
  };

  const addShiftEntry = async () => {
    if (!manualEditTarget) return;
    if (!manualAddStaffId) {
      setManualEditError("Select staff before adding shift.");
      return;
    }

    try {
      setManualEditLoading(true);
      setManualEditError(null);
      const headers = await getAuthHeaders();
      const key = `${manualAddStaffId}#${manualEditTarget.date}`;
      const existingRows = staffShiftByDate.get(key) ?? [];

      for (const row of existingRows) {
        const deleteRes = await fetch(`/api/staff/shifts?id=${row.id}`, {
          method: "DELETE",
          headers,
        });
        const deleteJson = await deleteRes.json().catch(() => ({}));
        if (!deleteRes.ok || !deleteJson.success) {
          throw new Error(deleteJson.error || "Failed to replace existing shift.");
        }
      }

      const createRes = await fetch("/api/staff/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          staff_id: manualAddStaffId,
          shift_date: manualEditTarget.date,
          shift_type: manualEditTarget.shiftType,
        }),
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createJson.success) {
        throw new Error(createJson.error || "Failed to add shift.");
      }

      await fetchData(year, month);
    } catch (err) {
      setManualEditError(err instanceof Error ? err.message : "Failed to add shift.");
    } finally {
      setManualEditLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-8 text-center text-[var(--text-secondary)]">
        Loading monthly schedule...
      </Card>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <Dialog open={Boolean(manualEditTarget)} onOpenChange={(open) => (!open ? closeManualEdit() : undefined)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manual Shift Edit</DialogTitle>
            <DialogDescription>
              {manualEditTarget
                ? `${SHIFT_LABELS[manualEditTarget.shiftType]} shift on ${manualEditTarget.date}`
                : "Edit shift entries"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {manualEditError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {manualEditError}
              </div>
            ) : null}

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Assigned Staff</h4>
              {manualTargetEntries.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No staff assigned for this slot.</p>
              ) : (
                <div className="space-y-2">
                  {manualTargetEntries.map((entry) => (
                    <div
                      key={entry.shift_id}
                      className="flex items-center justify-between rounded-md border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{entry.nickname}</span>
                        <Badge variant={entry.is_generated ? "outline" : "secondary"} className="text-[10px]">
                          {entry.is_generated ? "Generated" : "Manual"}
                        </Badge>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeShiftEntry(entry.shift_id)}
                        disabled={manualEditLoading}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Add Staff</h4>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={manualAddStaffId}
                  onChange={(event) => setManualAddStaffId(event.target.value)}
                  className="h-9 flex-1 rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 text-sm"
                  disabled={manualEditLoading || addableStaffOptions.length === 0}
                >
                  {addableStaffOptions.length === 0 ? (
                    <option value="">No additional staff available</option>
                  ) : (
                    addableStaffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {normalizedNickName(staff)}
                      </option>
                    ))
                  )}
                </select>
                <Button
                  onClick={addShiftEntry}
                  disabled={manualEditLoading || addableStaffOptions.length === 0 || !manualAddStaffId}
                >
                  {manualEditLoading ? "Saving..." : "Add Shift"}
                </Button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                If selected staff already has another shift on this day, the old slot will be replaced.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeManualEdit} disabled={manualEditLoading}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateRosterDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        year={year}
        month={month}
        defaultNightStartOrder={nightStartOrder}
        rotateOptions={rotateOptions}
        loading={generateLoading}
        errorMessage={generateError}
        onConfirm={runGenerate}
      />

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {generateWarnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-amber-900">Generation warnings</h3>
            <Button variant="ghost" size="sm" onClick={() => setGenerateWarnings([])}>
              Clear
            </Button>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {generateWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>- {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {validationWarnings.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-rose-900">Schedule warnings (advisory)</h3>
            <Button variant="ghost" size="sm" onClick={() => setValidationWarnings([])}>
              Clear
            </Button>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-rose-800">
            {validationWarnings.slice(0, 12).map((warning, index) => (
              <li key={`${warning.code}-${warning.staff_id ?? "all"}-${warning.shift_date ?? "none"}-${index}`}>
                - {warning.message}
              </li>
            ))}
            {validationWarnings.length > 12 ? (
              <li className="text-[11px] text-rose-700">
                ...and {validationWarnings.length - 12} more warnings.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Roster Config</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Configure day off, preference, and night rotation order per FO staff.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchData(year, month)}>
            Refresh
          </Button>
        </div>

        {sortedFoStaff.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-[var(--text-secondary)]">
            No active FO staff found. Invite FO staff first.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-[var(--border-default)] text-[var(--text-muted)]">
                <tr>
                  <th className="p-2 text-left font-semibold">Staff</th>
                  <th className="p-2 text-left font-semibold">Regular Day Off</th>
                  <th className="p-2 text-left font-semibold">Shift Preference</th>
                  <th className="p-2 text-left font-semibold">Night Rotation Order</th>
                  <th className="p-2 text-left font-semibold">Extra Off / Month</th>
                  <th className="p-2 text-left font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedFoStaff.map((staff) => {
                  const draft = configDraftByStaff[staff.id];
                  if (!draft) return null;
                  const saving = savingStaffId === staff.id;
                  return (
                    <tr key={staff.id} className="border-b border-[var(--border-subtle)]">
                      <td className="p-2">
                        <div className="font-medium text-[var(--text-primary)]">{normalizedNickName(staff)}</div>
                        <div className="text-xs text-[var(--text-muted)]">{staff.display_name}</div>
                      </td>
                      <td className="p-2">
                        <select
                          className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
                          value={draft.regular_day_off}
                          onChange={(event) =>
                            handleDraftChange(staff.id, { regular_day_off: Number(event.target.value) })
                          }
                        >
                          {DAY_OFF_LABELS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
                          value={draft.shift_preference}
                          onChange={(event) =>
                            handleDraftChange(staff.id, {
                              shift_preference: event.target.value as "morning_fixed" | "rotate",
                              night_rotation_order:
                                event.target.value === "morning_fixed" ? "" : draft.night_rotation_order,
                            })
                          }
                        >
                          <option value="morning_fixed">morning_fixed</option>
                          <option value="rotate">rotate</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm disabled:opacity-50"
                          value={draft.night_rotation_order}
                          disabled={draft.shift_preference === "morning_fixed"}
                          onChange={(event) =>
                            handleDraftChange(staff.id, {
                              night_rotation_order: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
                          value={draft.extra_day_offs_per_month}
                          onChange={(event) =>
                            handleDraftChange(staff.id, {
                              extra_day_offs_per_month: Number(event.target.value || 0),
                            })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Button size="sm" onClick={() => saveConfig(staff.id)} disabled={saving}>
                          {saving ? "Saving..." : draft.config_id ? "Save" : "Create"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4 overflow-x-auto">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Monthly Schedule</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {MONTH_LABELS[month - 1]} {year}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => moveMonth(-1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => moveMonth(1)}>
              Next
            </Button>
            <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={generateLoading}>
              {generateLoading ? "Running..." : "Re-generate"}
            </Button>
            <Button size="sm" onClick={() => setGenerateOpen(true)}>
              Generate
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[32px_repeat(7,1fr)] bg-[var(--border-default)] border border-[var(--border-default)] rounded-lg overflow-hidden min-w-[800px] gap-[1px]">
          {/* Column Headers */}
          <div className="flex items-center justify-center h-7 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-tight bg-[var(--bg-body)]">Shift</div>
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="flex items-center justify-center h-7 px-2 text-center text-[11px] font-bold text-[var(--text-secondary)] bg-[var(--bg-body)]"
            >
              {label}
            </div>
          ))}

          {/* Group cells into weeks */}
          {Array.from({ length: Math.ceil(cells.length / 7) }).map((_, weekIndex) => {
            const weekCells = cells.slice(weekIndex * 7, (weekIndex + 1) * 7);
            
            const renderCompactRow = (label: string, shiftKey: "morning" | "afternoon" | "night") => (
              <>
                <div className="flex items-center justify-center font-black text-[10px] text-[var(--text-muted)] bg-[var(--bg-body)]">
                  {label}
                </div>
                {weekCells.map((cell) => {
                  const bucket = cell.date && cell.inMonth
                    ? shiftMap.get(cell.date) ?? { morning: [], afternoon: [], night: [] }
                    : { morning: [], afternoon: [], night: [] };
                  const need = REQUIRED_STAFFING[cell.dow] ?? { morning: 1, afternoon: 1, night: 1 };
                  const under = cell.inMonth && bucket[shiftKey].length < need[shiftKey];

                  return (
                    <div
                      key={`${cell.key}-${shiftKey}`}
                      className={`group relative min-h-[34px] flex flex-wrap items-center justify-center gap-1 p-1 transition-all ${
                        cell.inMonth 
                          ? `bg-[var(--bg-surface)] ${under ? "bg-rose-500/5 ring-1 ring-inset ring-rose-500/20" : ""}`
                          : "bg-[var(--bg-body)] opacity-40"
                      }`}
                    >
                      {bucket[shiftKey].length === 0 && cell.inMonth ? (
                        <span className="text-[10px] text-[var(--text-muted)] opacity-20">-</span>
                      ) : (
                        bucket[shiftKey].map((entry) => {
                          const color = colorForStaff(entry.nickname, entry.staff_id);
                          return (
                            <div
                              key={`${cell.key}-${shiftKey}-${entry.staff_id}`}
                              className="px-2 py-0.5 rounded-sm text-[10.5px] font-bold tracking-tight truncate max-w-full shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                              style={{
                                backgroundColor: `${color}44`,
                                border: `1px solid ${color}88`,
                                color: "var(--text-primary)",
                              }}
                            >
                              {entry.nickname}
                            </div>
                          );
                        })
                      )}

                      {cell.inMonth && cell.date && (
                        <button
                          type="button"
                          className="absolute inset-0 z-10 flex items-center justify-center bg-brand-500/5 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => setManualEditTarget({ date: cell.date as string, shiftType: shiftKey })}
                        >
                          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-lg ring-1 ring-white/20 uppercase">
                            Edit
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            );

            return (
              <div key={`week-${weekIndex}`} className="contents">
                {/* Date Row */}
                <div className="flex items-center justify-center h-5 bg-[var(--bg-body)] opacity-30 text-[9px] font-black">#</div>
                {weekCells.map((cell) => (
                  <div key={`date-${cell.key}`} className="flex items-center justify-center h-5 bg-[var(--bg-body)]/50">
                    <span className={`text-[10px] font-black ${cell.inMonth ? "text-[var(--text-muted)]" : "text-slate-300"}`}>
                      {cell.label}
                    </span>
                  </div>
                ))}

                {/* Shift Rows */}
                {renderCompactRow("M", "morning")}
                {renderCompactRow("A", "afternoon")}
                {renderCompactRow("N", "night")}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">Monthly Summary</h3>
        {sortedFoStaff.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No FO staff to summarize.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-[var(--border-default)] text-[var(--text-muted)]">
                <tr>
                  <th className="p-2 text-left font-semibold">Staff</th>
                  <th className="p-2 text-right font-semibold">Morning</th>
                  <th className="p-2 text-right font-semibold">Afternoon</th>
                  <th className="p-2 text-right font-semibold">Night</th>
                  <th className="p-2 text-right font-semibold">Work</th>
                  <th className="p-2 text-right font-semibold">Off</th>
                  <th className="p-2 text-right font-semibold">Total</th>
                  <th className="p-2 text-right font-semibold">Expected Off</th>
                </tr>
              </thead>
              <tbody>
                {sortedFoStaff.map((staff) => {
                  const summary = summaryByStaff.get(staff.id) ?? {
                    morning: 0,
                    afternoon: 0,
                    night: 0,
                    work: 0,
                    off: daysInMonth,
                  };
                  const cfg = configs.find((row) => row.staff_id === staff.id);
                  const expectedOff = cfg
                    ? countWeekdayInMonth(year, month, cfg.regular_day_off) + Number(cfg.extra_day_offs_per_month ?? 0)
                    : 0;
                  const offDelta = summary.off - expectedOff;

                  return (
                    <tr key={staff.id} className="border-b border-[var(--border-subtle)]">
                      <td className="p-2 font-medium text-[var(--text-primary)]">{normalizedNickName(staff)}</td>
                      <td className="p-2 text-right">{summary.morning}</td>
                      <td className="p-2 text-right">{summary.afternoon}</td>
                      <td className="p-2 text-right">{summary.night}</td>
                      <td className="p-2 text-right">{summary.work}</td>
                      <td className="p-2 text-right">{summary.off}</td>
                      <td className="p-2 text-right text-[var(--text-muted)]">{summary.work + summary.off}</td>
                      <td className="p-2 text-right">
                        <span className={offDelta === 0 ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                          {expectedOff}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
