import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const validateSchema = z.object({
  year: z.number().int().min(2025).max(2030),
  month: z.number().int().min(1).max(12),
  staff_id: z.string().uuid().optional(),
});

const REQUIRED_STAFFING: Record<number, { morning: number; afternoon: number; night: number }> = {
  0: { morning: 1, afternoon: 2, night: 1 },
  1: { morning: 1, afternoon: 2, night: 1 },
  2: { morning: 1, afternoon: 1, night: 1 },
  3: { morning: 1, afternoon: 1, night: 1 },
  4: { morning: 1, afternoon: 1, night: 1 },
  5: { morning: 1, afternoon: 1, night: 1 },
  6: { morning: 1, afternoon: 1, night: 1 },
};

type ShiftType = "morning" | "afternoon" | "night";

type WarningCode =
  | "work_days_over"
  | "work_days_under"
  | "day_offs_over"
  | "day_offs_under"
  | "back_to_back_violation"
  | "understaffed_shift";

type WarningItem = {
  code: WarningCode;
  message: string;
  staff_id: string | null;
  shift_date: string | null;
};

type StaffRow = {
  id: string;
  nickname: string | null;
  display_name: string;
  department: { code: string; name: string } | null;
};

type ConfigRow = {
  staff_id: string;
  regular_day_off: number;
  extra_day_offs_per_month: number;
};

function toMonthRange(year: number, month: number): { from: string; to: string; days: string[] } {
  const start = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const end = new Date(year, month, 0, 12, 0, 0, 0);
  const toYmd = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

  const days: string[] = [];
  for (let day = 1; day <= end.getDate(); day += 1) {
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    days.push(toYmd(date));
  }
  return { from: toYmd(start), to: toYmd(end), days };
}

function weekdayOfYmd(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getDay();
}

function nicknameOf(staff: StaffRow): string {
  const nick = String(staff.nickname ?? "").trim();
  if (nick) return nick;
  return String(staff.display_name ?? "").trim() || staff.id;
}

function countSpecificDow(days: string[], dow: number): number {
  return days.reduce((acc, date) => acc + (weekdayOfYmd(date) === dow ? 1 : 0), 0);
}

async function requireAuthenticatedAdmin(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  request: NextRequest
) {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  try {
    await assertAdminOrSupervisor(supabase, user.id);
  } catch (guardError) {
    const message = guardError instanceof Error ? guardError.message : "Forbidden";
    const status = message === "Forbidden" ? 403 : 500;
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: message }, { status }),
    };
  }
  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const guard = await requireAuthenticatedAdmin(supabase, request);
    if (!guard.ok) return guard.response;

    const json = await request.json().catch(() => null);
    const parsed = validateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month, staff_id } = parsed.data;
    const { from, to, days } = toMonthRange(year, month);

    const { data: staffRaw, error: staffError } = await supabase
      .from("staff")
      .select("id, nickname, display_name, department:departments(code,name)")
      .eq("is_active", true);

    if (staffError) {
      return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
    }

    const foStaff = ((staffRaw ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const relation = Array.isArray(row.department) ? row.department[0] : row.department;
        const department =
          relation && typeof relation === "object" && (relation as { code?: string }).code
            ? {
                code: String((relation as { code?: string }).code),
                name: String((relation as { name?: string }).name ?? ""),
              }
            : null;
        return {
          id: String(row.id),
          nickname: row.nickname ? String(row.nickname) : null,
          display_name: String(row.display_name ?? ""),
          department,
        } as StaffRow;
      })
      .filter((row) => row.department?.code === "FO");

    if (foStaff.length === 0) {
      return NextResponse.json({ success: false, error: "No active FO staff found." }, { status: 400 });
    }

    const scopedStaff = staff_id ? foStaff.filter((row) => row.id === staff_id) : foStaff;
    if (staff_id && scopedStaff.length === 0) {
      return NextResponse.json(
        { success: false, error: "Provided staff_id is not an active FO staff." },
        { status: 400 }
      );
    }

    const scopedStaffIds = scopedStaff.map((row) => row.id);
    const scopedSet = new Set(scopedStaffIds);

    const { data: configRaw, error: configError } = await supabase
      .from("roster_config")
      .select("staff_id, regular_day_off, extra_day_offs_per_month")
      .in("staff_id", scopedStaffIds);

    if (configError) {
      return NextResponse.json({ success: false, error: configError.message }, { status: 500 });
    }

    const configByStaff = new Map<string, ConfigRow>();
    for (const row of (configRaw ?? []) as Array<Record<string, unknown>>) {
      configByStaff.set(String(row.staff_id), {
        staff_id: String(row.staff_id),
        regular_day_off: Number(row.regular_day_off),
        extra_day_offs_per_month: Number(row.extra_day_offs_per_month ?? 0),
      });
    }

    const { data: shiftRaw, error: shiftError } = await supabase
      .from("staff_shifts")
      .select("id, staff_id, shift_date, shift_type")
      .in("staff_id", scopedStaffIds)
      .gte("shift_date", from)
      .lte("shift_date", to);

    if (shiftError) {
      return NextResponse.json({ success: false, error: shiftError.message }, { status: 500 });
    }

    const warnings: WarningItem[] = [];
    const countsByDate = new Map<string, { morning: number; afternoon: number; night: number }>();
    const shiftsByStaffDate = new Map<string, Set<ShiftType>>();

    for (const row of (shiftRaw ?? []) as Array<Record<string, unknown>>) {
      const rowStaffId = String(row.staff_id);
      const rowDate = String(row.shift_date);
      const rowShift = String(row.shift_type) as ShiftType | "off";

      if (!scopedSet.has(rowStaffId) || rowShift === "off") continue;

      const countBucket = countsByDate.get(rowDate) ?? { morning: 0, afternoon: 0, night: 0 };
      countBucket[rowShift] += 1;
      countsByDate.set(rowDate, countBucket);

      const key = `${rowStaffId}#${rowDate}`;
      const set = shiftsByStaffDate.get(key) ?? new Set<ShiftType>();
      set.add(rowShift);
      shiftsByStaffDate.set(key, set);
    }

    for (const date of days) {
      const dow = weekdayOfYmd(date);
      const required = REQUIRED_STAFFING[dow] ?? { morning: 1, afternoon: 1, night: 1 };
      const actual = countsByDate.get(date) ?? { morning: 0, afternoon: 0, night: 0 };
      for (const shift of ["morning", "afternoon", "night"] as const) {
        if (actual[shift] >= required[shift]) continue;
        warnings.push({
          code: "understaffed_shift",
          staff_id: null,
          shift_date: date,
          message: `${date} ${shift} understaffed (${actual[shift]}/${required[shift]}).`,
        });
      }
    }

    const summary = scopedStaff
      .slice()
      .sort((a, b) => nicknameOf(a).localeCompare(nicknameOf(b), "th"))
      .map((staff) => {
        const dateToShift = new Map<string, Set<ShiftType>>();
        for (const date of days) {
          const key = `${staff.id}#${date}`;
          const shiftsOnDay = shiftsByStaffDate.get(key);
          if (shiftsOnDay && shiftsOnDay.size > 0) {
            dateToShift.set(date, shiftsOnDay);
          }
        }

        const workDays = dateToShift.size;
        const offDays = Math.max(0, days.length - workDays);
        const cfg = configByStaff.get(staff.id);

        if (cfg) {
          const expectedOff = countSpecificDow(days, cfg.regular_day_off) + Math.max(0, cfg.extra_day_offs_per_month);
          const expectedWork = Math.max(0, days.length - expectedOff);

          if (workDays > expectedWork) {
            warnings.push({
              code: "work_days_over",
              staff_id: staff.id,
              shift_date: null,
              message: `${nicknameOf(staff)} works ${workDays}/${expectedWork} expected days (over).`,
            });
            warnings.push({
              code: "day_offs_under",
              staff_id: staff.id,
              shift_date: null,
              message: `${nicknameOf(staff)} has ${offDays}/${expectedOff} expected off days (under).`,
            });
          } else if (workDays < expectedWork) {
            warnings.push({
              code: "work_days_under",
              staff_id: staff.id,
              shift_date: null,
              message: `${nicknameOf(staff)} works ${workDays}/${expectedWork} expected days (under).`,
            });
            warnings.push({
              code: "day_offs_over",
              staff_id: staff.id,
              shift_date: null,
              message: `${nicknameOf(staff)} has ${offDays}/${expectedOff} expected off days (over).`,
            });
          }
        }

        for (let i = 1; i < days.length; i += 1) {
          const prevDate = days[i - 1];
          const currDate = days[i];
          const prevShiftSet = dateToShift.get(prevDate) ?? new Set<ShiftType>();
          const currShiftSet = dateToShift.get(currDate) ?? new Set<ShiftType>();

          const afternoonToMorning = prevShiftSet.has("afternoon") && currShiftSet.has("morning");
          const nightToNextDay =
            prevShiftSet.has("night") &&
            (currShiftSet.has("morning") || currShiftSet.has("afternoon"));

          if (!afternoonToMorning && !nightToNextDay) continue;
          warnings.push({
            code: "back_to_back_violation",
            staff_id: staff.id,
            shift_date: currDate,
            message: `${nicknameOf(staff)} has invalid shift sequence from ${prevDate} to ${currDate}.`,
          });
        }

        return {
          staff_id: staff.id,
          nickname: nicknameOf(staff),
          work_days: workDays,
          off_days: offDays,
          expected_off_days: cfg
            ? countSpecificDow(days, cfg.regular_day_off) + Math.max(0, cfg.extra_day_offs_per_month)
            : null,
        };
      });

    return NextResponse.json({
      success: true,
      data: {
        year,
        month,
        staff_id: staff_id ?? null,
        warning_count: warnings.length,
        warnings,
        summary,
      },
    });
  } catch (err) {
    console.error("api/staff/shifts/validate POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

