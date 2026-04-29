type SupabaseServerClient = any;

export type StaffScheduleShiftType = "morning" | "afternoon" | "night" | "off";

export type StaffScheduleStaff = {
  id: string;
  employee_code: string;
  display_name: string;
  nickname: string | null;
  department: { id: string; code: string; name: string } | null;
};

export type StaffScheduleShift = {
  id: string;
  staff_id: string;
  shift_date: string;
  shift_type: StaffScheduleShiftType;
  is_generated: boolean;
};

export type StaffScheduleMonth = {
  year: number;
  month: number;
  label: string;
  first_date: string;
  last_date: string;
};

export type StaffScheduleView = {
  month: StaffScheduleMonth;
  today: string;
  allowed_months: StaffScheduleMonth[];
  days: Array<{
    date: string;
    day: number;
    dow: number;
    weekday: string;
    is_today: boolean;
    is_weekend: boolean;
  }>;
  departments: Array<{ id: string; code: string; name: string }>;
  staff: StaffScheduleStaff[];
  shifts: StaffScheduleShift[];
};

export type LineStaffScheduleResult =
  | { ok: true; staff: StaffScheduleStaff; month: StaffScheduleMonth; today: string; shifts: StaffScheduleShift[]; is_next_month: boolean }
  | { ok: false; reason: "unbound" };

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SHIFT_LABELS: Record<StaffScheduleShiftType, { code: string; label: string; time: string }> = {
  morning: { code: "M", label: "Morning", time: "06:30-14:30" },
  afternoon: { code: "A", label: "Afternoon", time: "14:30-22:30" },
  night: { code: "N", label: "Night", time: "22:30-06:30" },
  off: { code: "OFF", label: "Off", time: "" },
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function bangkokToday(): string {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}

function monthFromIso(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

function addMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthMeta(year: number, month: number): StaffScheduleMonth {
  return {
    year,
    month,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
    first_date: isoDate(year, month, 1),
    last_date: isoDate(year, month, daysInMonth(year, month)),
  };
}

export function getAllowedScheduleMonths(today = bangkokToday()): StaffScheduleMonth[] {
  const current = monthFromIso(today);
  const next = addMonth(current.year, current.month);
  return [monthMeta(current.year, current.month), monthMeta(next.year, next.month)];
}

export function assertAllowedScheduleMonth(year: number, month: number, today = bangkokToday()): StaffScheduleMonth {
  const allowed = getAllowedScheduleMonths(today);
  const found = allowed.find((item) => item.year === year && item.month === month);
  if (!found) {
    throw new Error("Staff schedule is available only for the current month and next month.");
  }
  return found;
}

function buildDays(month: StaffScheduleMonth, today: string): StaffScheduleView["days"] {
  const totalDays = daysInMonth(month.year, month.month);
  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const date = isoDate(month.year, month.month, day);
    const dow = new Date(month.year, month.month - 1, day).getDay();
    return {
      date,
      day,
      dow,
      weekday: WEEKDAY_LABELS[dow],
      is_today: date === today,
      is_weekend: dow === 0 || dow === 6,
    };
  });
}

function calendarVisibleRange(month: StaffScheduleMonth): { first_date: string; last_date: string } {
  const firstDow = new Date(month.year, month.month - 1, 1, 12, 0, 0, 0).getDay();
  const visibleStart = new Date(month.year, month.month - 1, 1, 12, 0, 0, 0);
  visibleStart.setDate(visibleStart.getDate() - firstDow);

  const last = new Date(month.year, month.month - 1, daysInMonth(month.year, month.month), 12, 0, 0, 0);
  const visibleEnd = new Date(last);
  visibleEnd.setDate(visibleEnd.getDate() + (6 - last.getDay()));

  return {
    first_date: isoDate(visibleStart.getFullYear(), visibleStart.getMonth() + 1, visibleStart.getDate()),
    last_date: isoDate(visibleEnd.getFullYear(), visibleEnd.getMonth() + 1, visibleEnd.getDate()),
  };
}

function normalizeDepartment(raw: any): StaffScheduleStaff["department"] {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row?.id) return null;
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
  };
}

function normalizeShiftType(value: unknown): StaffScheduleShiftType {
  const shift = String(value ?? "").trim();
  if (shift === "afternoon" || shift === "night" || shift === "off") return shift;
  return "morning";
}

export async function getStaffScheduleView(
  supabase: SupabaseServerClient,
  params: { year: number; month: number; today?: string }
): Promise<StaffScheduleView> {
  const today = params.today ?? bangkokToday();
  const allowedMonths = getAllowedScheduleMonths(today);
  const month = assertAllowedScheduleMonth(params.year, params.month, today);
  const visibleRange = calendarVisibleRange(month);

  const [staffRes, shiftRes] = await Promise.all([
    supabase
      .from("staff")
      .select("id, employee_code, display_name, nickname, department_id, department:departments(id, code, name)")
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    supabase
      .from("staff_shifts")
      .select("id, staff_id, shift_date, shift_type, is_generated")
      .gte("shift_date", visibleRange.first_date)
      .lte("shift_date", visibleRange.last_date)
      .order("shift_date", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (staffRes.error) throw new Error(staffRes.error.message);
  if (shiftRes.error) throw new Error(shiftRes.error.message);

  const staffRows = (staffRes.data ?? []) as any[];
  const shiftRows = (shiftRes.data ?? []) as any[];

  const staff = staffRows.map((row: any): StaffScheduleStaff => ({
    id: String(row.id),
    employee_code: String(row.employee_code ?? ""),
    display_name: String(row.display_name ?? ""),
    nickname: row.nickname ? String(row.nickname) : null,
    department: normalizeDepartment(row.department),
  }));

  const staffIdSet = new Set(staff.map((row) => row.id));
  const shifts = shiftRows
    .map((row: any): StaffScheduleShift => ({
      id: String(row.id),
      staff_id: String(row.staff_id),
      shift_date: String(row.shift_date),
      shift_type: normalizeShiftType(row.shift_type),
      is_generated: Boolean(row.is_generated),
    }))
    .filter((row) => staffIdSet.has(row.staff_id));

  const departmentMap = staff.reduce((acc, row) => {
    if (row.department?.id && !acc.has(row.department.id)) acc.set(row.department.id, row.department);
    return acc;
  }, new Map<string, { id: string; code: string; name: string }>());

  const departments = Array.from(departmentMap.values())
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    month,
    today,
    allowed_months: allowedMonths,
    days: buildDays(month, today),
    departments,
    staff,
    shifts,
  };
}

export async function getLineStaffSchedule(
  supabase: SupabaseServerClient,
  params: { lineUserId: string; nextMonth?: boolean; today?: string }
): Promise<LineStaffScheduleResult> {
  const today = params.today ?? bangkokToday();
  const allowed = getAllowedScheduleMonths(today);
  const targetMonth = params.nextMonth ? allowed[1] : allowed[0];

  const { data: staffRow, error: staffError } = await supabase
    .from("staff")
    .select("id, employee_code, display_name, nickname, department_id, department:departments(id, code, name)")
    .eq("line_user_id", params.lineUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (staffError) throw new Error(staffError.message);
  if (!staffRow?.id) return { ok: false, reason: "unbound" };

  const staff: StaffScheduleStaff = {
    id: String(staffRow.id),
    employee_code: String(staffRow.employee_code ?? ""),
    display_name: String(staffRow.display_name ?? ""),
    nickname: staffRow.nickname ? String(staffRow.nickname) : null,
    department: normalizeDepartment((staffRow as any).department),
  };

  let query = supabase
    .from("staff_shifts")
    .select("id, staff_id, shift_date, shift_type, is_generated")
    .eq("staff_id", staff.id)
    .gte("shift_date", params.nextMonth ? targetMonth.first_date : today)
    .lte("shift_date", targetMonth.last_date)
    .order("shift_date", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: shiftRows, error: shiftError } = await query;
  if (shiftError) throw new Error(shiftError.message);

  return {
    ok: true,
    staff,
    month: targetMonth,
    today,
    is_next_month: Boolean(params.nextMonth),
    shifts: (shiftRows ?? []).map((row: any): StaffScheduleShift => ({
      id: String(row.id),
      staff_id: String(row.staff_id),
      shift_date: String(row.shift_date),
      shift_type: normalizeShiftType(row.shift_type),
      is_generated: Boolean(row.is_generated),
    })),
  };
}

export function formatLineStaffScheduleReply(result: Extract<LineStaffScheduleResult, { ok: true }>): string {
  const displayName = result.staff.nickname || result.staff.display_name || "พนักงาน";
  const title = result.is_next_month
    ? `ตารางเวร ${displayName} เดือนหน้า (${result.month.label})`
    : `ตารางเวร ${displayName} (${result.month.label})`;

  if (result.shifts.length === 0) {
    return result.is_next_month
      ? `📅 ${title}\n\nยังไม่มีตารางเวรสำหรับเดือนหน้า`
      : `📅 ${title}\n\nยังไม่มีเวรตั้งแต่วันนี้ถึงสิ้นเดือน`;
  }

  const grouped = new Map<string, StaffScheduleShiftType[]>();
  for (const shift of result.shifts) {
    const bucket = grouped.get(shift.shift_date) ?? [];
    bucket.push(shift.shift_type);
    grouped.set(shift.shift_date, bucket);
  }

  const lines = Array.from(grouped.entries()).map(([date, shiftTypes]) => {
    const dateObj = new Date(`${date}T00:00:00+07:00`);
    const dayLabel = dateObj.toLocaleDateString("th-TH", {
      timeZone: "Asia/Bangkok",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const shiftLabel = shiftTypes
      .map((shiftType) => {
        const meta = SHIFT_LABELS[shiftType];
        return meta.time ? `${meta.code} ${meta.time}` : meta.code;
      })
      .join(", ");
    return `• ${dayLabel}: ${shiftLabel}`;
  });

  return `📅 ${title}\n\n${lines.join("\n")}`;
}

export const STAFF_SCHEDULE_SHIFT_META = SHIFT_LABELS;
