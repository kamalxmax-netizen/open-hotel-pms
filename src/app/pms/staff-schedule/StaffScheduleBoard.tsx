"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { STAFF_SCHEDULE_SHIFT_META, type StaffScheduleShift, type StaffScheduleShiftType, type StaffScheduleView } from "@/lib/staff-schedule";

type Props = {
  data: StaffScheduleView;
  selectedMonthKey: string;
  loading?: boolean;
  onMonthChange: (key: string) => void;
};

type CalendarCell = {
  key: string;
  date: string | null;
  day: number;
  inMonth: boolean;
  is_today: boolean;
  is_weekend: boolean;
};

type ViewMode = "calendar" | "week";
type StaffFilterMode = "scheduled" | "all";

const SHIFT_ORDER: Array<Exclude<StaffScheduleShiftType, "off">> = ["morning", "afternoon", "night"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

const SHIFT_STYLES: Record<StaffScheduleShiftType, string> = {
  morning: "border-blue-300 bg-blue-100 text-blue-950 dark:border-blue-500/30 dark:bg-blue-900/30 dark:text-blue-100",
  afternoon: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-500/30 dark:bg-amber-900/30 dark:text-amber-100",
  night: "border-purple-400 bg-purple-200 text-purple-950 dark:border-purple-500/40 dark:bg-purple-900/60 dark:text-purple-100",
  off: "border-slate-300 bg-slate-200 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function staffDisplayName(staff: StaffScheduleView["staff"][number]): string {
  return staff.nickname || staff.display_name || staff.employee_code || "-";
}

function colorForStaff(name: string, staffId: string): string {
  const key = name.trim().toLowerCase();
  if (STAFF_COLOR_PRESET[key]) return STAFF_COLOR_PRESET[key];
  for (const [presetName, color] of Object.entries(STAFF_COLOR_PRESET)) {
    if (name.includes(presetName)) return color;
  }
  let hash = 0;
  for (let i = 0; i < staffId.length; i += 1) hash = (hash * 31 + staffId.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function highContrastColorForStaff(name: string, staffId: string): string {
  const key = name.trim().toLowerCase();
  if (key === "สาว" || key === "sao" || name.includes("สาว")) return "#FCA5A5";
  if (key === "ดาว" || key === "dao" || name.includes("ดาว")) return "#C4B5FD";
  return colorForStaff(name, staffId);
}

function alphaHex(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

function buildCalendarCells(data: StaffScheduleView): CalendarCell[] {
  const firstDow = new Date(data.month.year, data.month.month - 1, 1, 12, 0, 0, 0).getDay();
  const daysByDate = new Map(data.days.map((day) => [day.date, day]));
  const cells: CalendarCell[] = [];
  const previousMonthDays = new Date(data.month.year, data.month.month - 1, 0).getDate();

  for (let i = 0; i < firstDow; i += 1) {
    const day = previousMonthDays - firstDow + i + 1;
    const dateObj = new Date(data.month.year, data.month.month - 2, day, 12, 0, 0, 0);
    cells.push({
      key: `prev-${day}-${i}`,
      date: isoDate(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate()),
      day,
      inMonth: false,
      is_today: false,
      is_weekend: dateObj.getDay() === 0 || dateObj.getDay() === 6,
    });
  }

  for (const day of data.days) {
    cells.push({
      key: day.date,
      date: day.date,
      day: day.day,
      inMonth: true,
      is_today: day.is_today,
      is_weekend: day.is_weekend,
    });
  }

  while (cells.length % 7 !== 0) {
    const nextDay = cells.length - firstDow - data.days.length + 1;
    const dateObj = new Date(data.month.year, data.month.month, nextDay, 12, 0, 0, 0);
    cells.push({
      key: `next-${nextDay}`,
      date: isoDate(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate()),
      day: nextDay,
      inMonth: false,
      is_today: false,
      is_weekend: dateObj.getDay() === 0 || dateObj.getDay() === 6,
    });
  }

  return cells.map((cell) => {
    if (!cell.date) return cell;
    const day = daysByDate.get(cell.date);
    return day ? { ...cell, is_today: day.is_today, is_weekend: day.is_weekend } : cell;
  });
}

function groupByDateAndShift(shifts: StaffScheduleShift[]) {
  const map = new Map<string, Record<StaffScheduleShiftType, StaffScheduleShift[]>>();
  for (const shift of shifts) {
    const bucket = map.get(shift.shift_date) ?? { morning: [], afternoon: [], night: [], off: [] };
    bucket[shift.shift_type].push(shift);
    map.set(shift.shift_date, bucket);
  }
  return map;
}

function groupShifts(shifts: StaffScheduleShift[]) {
  return shifts.reduce((acc, shift) => {
    const key = `${shift.staff_id}:${shift.shift_date}`;
    const bucket = acc.get(key) ?? [];
    bucket.push(shift);
    acc.set(key, bucket);
    return acc;
  }, new Map<string, StaffScheduleShift[]>());
}

function startOfWeekIso(date: string): string {
  const dateObj = new Date(`${date}T12:00:00+07:00`);
  dateObj.setDate(dateObj.getDate() - dateObj.getDay());
  return isoDate(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate());
}

function buildWeekDays(data: StaffScheduleView, weekStart: string) {
  const daysByDate = new Map(data.days.map((day) => [day.date, day]));
  const start = new Date(`${weekStart}T12:00:00+07:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const date = isoDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
    const inMonthDay = daysByDate.get(date);
    return {
      date,
      day: day.getDate(),
      weekday: WEEKDAY_LABELS[day.getDay()],
      is_today: date === data.today,
      is_weekend: day.getDay() === 0 || day.getDay() === 6,
      in_month: Boolean(inMonthDay),
    };
  });
}

function StaffPill({ staff }: { staff: StaffScheduleView["staff"][number] }) {
  const name = staffDisplayName(staff);
  const color = colorForStaff(name, staff.id);
  const style = {
    "--staff-color": highContrastColorForStaff(name, staff.id),
  } as CSSProperties & Record<string, string>;

  return (
    <span
      className="staff-schedule-pill relative inline-flex min-h-7 max-w-full items-center justify-center gap-2 overflow-hidden rounded-md border border-black/10 px-2.5 py-1 text-[13px] font-black leading-tight text-slate-950 shadow-sm dark:border-white/20 dark:text-white"
      style={style}
      title={`${name}${staff.department?.code ? ` • ${staff.department.code}` : ""}`}
    >
      <div className="absolute inset-0 z-0 opacity-100 dark:opacity-30" style={{ backgroundColor: color }} />
      <span className="relative z-10 truncate">{name}</span>
    </span>
  );
}

function ShiftCapsule({ shift }: { shift: StaffScheduleShift }) {
  const meta = STAFF_SCHEDULE_SHIFT_META[shift.shift_type];
  return (
    <div
      className={[
        `staff-schedule-shift-band staff-shift-${shift.shift_type} mx-auto flex h-9 min-w-[76px] max-w-[96px] flex-col items-center justify-center rounded-md border px-2 text-center leading-none shadow-sm`,
        SHIFT_STYLES[shift.shift_type],
      ].join(" ")}
      title={`${meta.label}${meta.time ? ` ${meta.time}` : ""}`}
    >
      <span className="text-[13px] font-extrabold tracking-normal">{meta.code}</span>
      {meta.time ? <span className="mt-0.5 text-[10px] font-semibold opacity-80">{meta.time}</span> : null}
    </div>
  );
}

function CalendarMonthView({
  data,
  staffById,
  dateShiftMap,
}: {
  data: StaffScheduleView;
  staffById: Map<string, StaffScheduleView["staff"][number]>;
  dateShiftMap: Map<string, Record<StaffScheduleShiftType, StaffScheduleShift[]>>;
}) {
  const cells = useMemo(() => buildCalendarCells(data), [data]);

  return (
    <div className="staff-schedule-surface overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        {WEEKDAY_LABELS.map((day, index) => (
          <div
            key={day}
            className={[
              "border-r border-slate-200 px-2 py-2 last:border-r-0 dark:border-slate-800",
              index === 0 || index === 6 ? "bg-cyan-100 text-cyan-950 dark:bg-cyan-500/15 dark:text-cyan-100" : "",
            ].join(" ")}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const bucket = cell.date ? dateShiftMap.get(cell.date) : null;
          return (
            <div
              key={cell.key}
              className={[
                "staff-schedule-cell min-h-[168px] border-r border-t border-slate-200 p-2 last:border-r-0 dark:border-slate-800",
                cell.is_weekend
                  ? "staff-schedule-weekend bg-cyan-50 dark:bg-cyan-500/10"
                  : "bg-white dark:bg-slate-950",
                !cell.inMonth ? "bg-opacity-60 dark:bg-opacity-40" : "",
                cell.is_today ? "ring-2 ring-inset ring-emerald-500" : "",
              ].join(" ")}
            >
              <div className={["flex h-full flex-col gap-1.5", !cell.inMonth ? "opacity-30" : ""].join(" ")}>
                  <div className="flex items-center justify-between">
                    <span className={["text-lg font-black", cell.inMonth && cell.is_today ? "text-emerald-700 dark:text-emerald-300" : "text-slate-950 dark:text-slate-100"].join(" ")}>
                      {cell.day}
                    </span>
                    {cell.inMonth && cell.is_today ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">TODAY</span> : null}
                  </div>

                  {SHIFT_ORDER.map((shiftType) => {
                    const entries = bucket?.[shiftType] ?? [];
                    return (
                      <div key={shiftType} className={[`staff-schedule-shift-band staff-shift-${shiftType} min-h-[38px] rounded-md border px-1.5 py-1`, SHIFT_STYLES[shiftType]].join(" ")}>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {entries.length > 0 ? (
                            entries.map((shift) => {
                              const staff = staffById.get(shift.staff_id);
                              return staff ? <StaffPill key={shift.id} staff={staff} /> : null;
                            })
                          ) : (
                            <span className="px-1 text-xs font-bold opacity-45">-</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  data,
  loading,
  weekStart,
  onWeekStartChange,
  filteredStaff,
  shiftMap,
}: {
  data: StaffScheduleView;
  loading: boolean;
  weekStart: string;
  onWeekStartChange: (weekStart: string) => void;
  filteredStaff: StaffScheduleView["staff"];
  shiftMap: Map<string, StaffScheduleShift[]>;
}) {
  const weekDays = useMemo(() => buildWeekDays(data, weekStart), [data, weekStart]);
  const currentWeekIndex = data.days.findIndex((day) => startOfWeekIso(day.date) === weekStart);
  const canMovePrev = currentWeekIndex > 0;
  const canMoveNext = Boolean(weekDays[6]?.date && weekDays[6].date < data.month.last_date);

  const moveWeek = (delta: number) => {
    const date = new Date(`${weekStart}T12:00:00+07:00`);
    date.setDate(date.getDate() + delta * 7);
    onWeekStartChange(isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate()));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
          Week of {weekDays[0]?.date} - {weekDays[6]?.date}
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            disabled={!canMovePrev}
            onClick={() => moveWeek(-1)}
            className="rounded-md px-3 py-1.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!canMoveNext}
            onClick={() => moveWeek(1)}
            className="rounded-md px-3 py-1.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Next
          </button>
        </div>
      </div>

      <div className="staff-schedule-surface overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="max-h-[calc(100vh-330px)] min-h-[430px] overflow-auto">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-20 bg-white shadow-[0_1px_0_rgba(15,23,42,0.10)] dark:bg-slate-950">
              <tr>
                <th className="sticky left-0 z-30 w-[220px] min-w-[220px] border-r border-slate-200 bg-white px-4 py-3 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  Staff
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day.date}
                    className={[
                      "w-[112px] min-w-[112px] border-r border-slate-100 px-2 py-2 text-center align-middle dark:border-slate-800",
                      !day.in_month ? "bg-slate-100/70 dark:bg-slate-900/50" : day.is_today ? "bg-emerald-50 dark:bg-emerald-500/10" : day.is_weekend ? "bg-slate-50 dark:bg-slate-900/70" : "bg-white dark:bg-slate-950",
                    ].join(" ")}
                  >
                    <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">{day.weekday}</div>
                    <div className={["mt-1 text-lg font-black", day.is_today ? "text-emerald-700 dark:text-emerald-300" : "text-slate-950 dark:text-slate-100"].join(" ")}>
                      {day.day}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={loading ? "opacity-55 transition-opacity" : "opacity-100 transition-opacity"}>
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={weekDays.length + 1} className="px-4 py-10 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                    ไม่พบพนักงานตาม filter ที่เลือก
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff) => (
                  <tr key={staff.id} className="border-t border-slate-100 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/60">
                    <th className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-200 bg-white px-4 py-3 text-left align-middle shadow-[1px_0_0_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-950">
                      <div className="text-[15px] font-black leading-tight text-slate-950 dark:text-slate-100">{staffDisplayName(staff)}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <span>{staff.employee_code || "-"}</span>
                        <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                        <span>{staff.department?.code || "-"}</span>
                      </div>
                    </th>
                    {weekDays.map((day) => {
                      const entries = shiftMap.get(`${staff.id}:${day.date}`) ?? [];
                      return (
                        <td
                          key={`${staff.id}-${day.date}`}
                          className={[
                            "h-[64px] border-r border-t border-slate-100 px-2 py-2 text-center align-middle transition-colors hover:bg-sky-50 dark:border-slate-800 dark:hover:bg-sky-500/10",
                            !day.in_month ? "bg-slate-100/70 dark:bg-slate-900/50" : day.is_today ? "bg-emerald-50/70 dark:bg-emerald-500/10" : day.is_weekend ? "bg-slate-50/80 dark:bg-slate-900/70" : "bg-white dark:bg-slate-950",
                          ].join(" ")}
                        >
                          {entries.length > 0 ? (
                            <div className="flex flex-col items-center gap-1">
                              {entries.map((shift) => (
                                <div key={shift.id} className={[
                                  `staff-schedule-shift-band staff-shift-${shift.shift_type} mx-auto flex h-9 min-w-[76px] max-w-[96px] flex-col items-center justify-center rounded-md border px-2 text-center leading-none shadow-sm`,
                                  SHIFT_STYLES[shift.shift_type],
                                ].join(" ")}>
                                  <span className="text-[13px] font-extrabold tracking-normal">
                                    {STAFF_SCHEDULE_SHIFT_META[shift.shift_type].code}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm font-bold text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function StaffScheduleBoard({ data, selectedMonthKey, loading = false, onMonthChange }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(data.today < data.month.first_date || data.today > data.month.last_date ? data.month.first_date : data.today));
  const [filterMode, setFilterMode] = useState<StaffFilterMode>("scheduled");
  const [departmentCode, setDepartmentCode] = useState("all");
  const [staffQuery, setStaffQuery] = useState("");

  const staffById = useMemo(() => new Map(data.staff.map((staff) => [staff.id, staff])), [data.staff]);
  const shiftMap = useMemo(() => groupShifts(data.shifts), [data.shifts]);
  const dateShiftMap = useMemo(() => groupByDateAndShift(data.shifts), [data.shifts]);
  const hasAnyShift = data.shifts.length > 0;

  const activeWeekDays = useMemo(() => buildWeekDays(data, weekStart), [data, weekStart]);
  const activeWeekDateSet = useMemo(() => new Set(activeWeekDays.filter((day) => day.in_month).map((day) => day.date)), [activeWeekDays]);
  const scheduledStaffIdsForWeek = useMemo(() => {
    const ids = new Set<string>();
    for (const shift of data.shifts) {
      if (activeWeekDateSet.has(shift.shift_date)) ids.add(shift.staff_id);
    }
    return ids;
  }, [activeWeekDateSet, data.shifts]);

  const filteredStaff = useMemo(() => {
    const query = staffQuery.trim().toLowerCase();
    return data.staff.filter((staff) => {
      if (filterMode === "scheduled" && !scheduledStaffIdsForWeek.has(staff.id)) return false;
      if (departmentCode !== "all" && staff.department?.code !== departmentCode) return false;
      if (!query) return true;
      const haystack = `${staff.display_name} ${staff.nickname ?? ""} ${staff.employee_code} ${staff.department?.code ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [data.staff, departmentCode, filterMode, scheduledStaffIdsForWeek, staffQuery]);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Read-only roster</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">Staff Schedule</h1>
          <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">
            ตารางเวรสำหรับพนักงานทุกคน แสดงเฉพาะเดือนปัจจุบันและเดือนถัดไป
          </p>
        </div>

        <div className="flex w-full rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950 md:w-auto">
          {data.allowed_months.map((month) => {
            const key = monthKey(month.year, month.month);
            const active = key === selectedMonthKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onMonthChange(key);
                  setWeekStart(startOfWeekIso(month.first_date));
                }}
                className={[
                  "flex-1 rounded-md px-4 py-2 text-sm font-bold transition md:flex-none",
                  active ? "bg-slate-950 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50",
                ].join(" ")}
              >
                {month.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950 lg:w-auto">
          {(["calendar", "week"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={[
                "flex-1 rounded-md px-4 py-2 text-sm font-black transition lg:flex-none",
                viewMode === mode ? "bg-emerald-700 text-white shadow-sm dark:bg-emerald-500 dark:text-slate-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50",
              ].join(" ")}
            >
              {mode === "calendar" ? "Calendar View" : "Week View"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          {SHIFT_ORDER.map((shiftType) => {
            const meta = STAFF_SCHEDULE_SHIFT_META[shiftType];
            return (
              <span
                key={shiftType}
                className={[`staff-schedule-shift-band staff-shift-${shiftType} inline-flex items-center gap-2 rounded-md border px-2.5 py-1`, SHIFT_STYLES[shiftType]].join(" ")}
              >
                <span className="font-black">{meta.code}</span>
                <span>{meta.label}</span>
                <span className="font-semibold opacity-75">{meta.time}</span>
              </span>
            );
          })}
        </div>
      </div>

      {!hasAnyShift ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          ยังไม่มีตารางเวรสำหรับเดือนนี้
        </div>
      ) : null}

      {viewMode === "week" ? (
        <div className="staff-schedule-surface flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
          <div className="grid gap-3 md:grid-cols-[180px_180px_1fr]">
            <select
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as StaffFilterMode)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="scheduled">Scheduled only</option>
              <option value="all">All staff</option>
            </select>
            <select
              value={departmentCode}
              onChange={(event) => setDepartmentCode(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All departments</option>
              {data.departments.map((department) => (
                <option key={department.id} value={department.code}>
                  {department.code || department.name}
                </option>
              ))}
            </select>
            <input
              value={staffQuery}
              onChange={(event) => setStaffQuery(event.target.value)}
              placeholder="Search staff"
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <WeekView
            data={data}
            loading={loading}
            weekStart={weekStart}
            onWeekStartChange={setWeekStart}
            filteredStaff={filteredStaff}
            shiftMap={shiftMap}
          />
        </div>
      ) : (
        <CalendarMonthView data={data} staffById={staffById} dateShiftMap={dateShiftMap} />
      )}
    </div>
  );
}
