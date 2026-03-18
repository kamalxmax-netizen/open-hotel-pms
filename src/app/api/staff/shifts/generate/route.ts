import { generateFoRoster } from "@/lib/fo-roster-engine";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import type { RosterStaffConfig } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const generateSchema = z.object({
  year: z.number().int().min(2025).max(2030),
  month: z.number().int().min(1).max(12),
  night_start_person_order: z.number().int().min(1).max(10),
});

type StaffRow = {
  id: string;
  nickname: string | null;
  display_name: string;
  department: { code: string; name: string } | null;
  is_active: boolean;
};

type RosterConfigRow = {
  id: string;
  staff_id: string;
  regular_day_off: number;
  shift_preference: "morning_fixed" | "rotate";
  night_rotation_order: number | null;
  extra_day_offs_per_month: number;
};

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

function toMonthRange(year: number, month: number): { from: string; to: string } {
  const fromDate = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const toDate = new Date(year, month, 0, 12, 0, 0, 0);
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: toYmd(fromDate), to: toYmd(toDate) };
}

function staffNickname(row: StaffRow): string {
  const nick = String(row.nickname ?? "").trim();
  if (nick) return nick;
  return String(row.display_name ?? "").trim() || row.id;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const guard = await requireAuthenticatedAdmin(supabase, request);
    if (!guard.ok) return guard.response;

    const json = await request.json().catch(() => null);
    const parsed = generateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month, night_start_person_order } = parsed.data;
    const { from, to } = toMonthRange(year, month);

    const { data: staffRaw, error: staffError } = await supabase
      .from("staff")
      .select("id, nickname, display_name, is_active, department:departments(code,name)")
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
          is_active: Boolean(row.is_active),
          department,
        } as StaffRow;
      })
      .filter((row) => row.department?.code === "FO");

    if (foStaff.length === 0) {
      return NextResponse.json(
        { success: false, error: "No active FO staff found. Invite FO staff first." },
        { status: 400 }
      );
    }

    const foStaffIds = foStaff.map((row) => row.id);
    const staffById = new Map(foStaff.map((row) => [row.id, row]));

    const { data: configRaw, error: configError } = await supabase
      .from("roster_config")
      .select("id, staff_id, regular_day_off, shift_preference, night_rotation_order, extra_day_offs_per_month")
      .in("staff_id", foStaffIds);

    if (configError) {
      return NextResponse.json({ success: false, error: configError.message }, { status: 500 });
    }

    const configRows = (configRaw ?? []) as unknown as RosterConfigRow[];
    if (configRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No roster_config found for FO staff. Configure roster first." },
        { status: 400 }
      );
    }

    const missingConfig = foStaff.filter((staff) => !configRows.some((cfg) => cfg.staff_id === staff.id));
    if (missingConfig.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing roster_config for: ${missingConfig.map(staffNickname).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const rotateCount = configRows.filter((cfg) => cfg.shift_preference === "rotate").length;
    const morningFixedCount = configRows.filter((cfg) => cfg.shift_preference === "morning_fixed").length;

    if (morningFixedCount !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: `Expected exactly 1 morning_fixed config, found ${morningFixedCount}.`,
        },
        { status: 400 }
      );
    }
    if (rotateCount < 1) {
      return NextResponse.json(
        { success: false, error: "At least 1 rotate config is required for night rotation." },
        { status: 400 }
      );
    }

    const configWarnings: string[] = [];
    if (rotateCount !== 3) {
      configWarnings.push(
        `Baseline GAS uses 3 rotate staff. Current rotate count is ${rotateCount}.`
      );
    }

    for (const cfg of configRows) {
      if (cfg.shift_preference === "rotate" && !cfg.night_rotation_order) {
        const name = staffNickname(staffById.get(cfg.staff_id) ?? {
          id: cfg.staff_id,
          nickname: null,
          display_name: cfg.staff_id,
          department: null,
          is_active: true,
        });
        return NextResponse.json(
          {
            success: false,
            error: `night_rotation_order is required for rotate staff: ${name}`,
          },
          { status: 400 }
        );
      }
    }

    const { error: deleteGeneratedError, data: deletedGeneratedRows } = await supabase
      .from("staff_shifts")
      .delete()
      .in("staff_id", foStaffIds)
      .gte("shift_date", from)
      .lte("shift_date", to)
      .eq("is_generated", true)
      .select("id");

    if (deleteGeneratedError) {
      return NextResponse.json(
        { success: false, error: deleteGeneratedError.message },
        { status: 500 }
      );
    }

    const { data: manualRows, error: manualError } = await supabase
      .from("staff_shifts")
      .select("staff_id, shift_date")
      .in("staff_id", foStaffIds)
      .gte("shift_date", from)
      .lte("shift_date", to)
      .eq("is_generated", false);

    if (manualError) {
      return NextResponse.json({ success: false, error: manualError.message }, { status: 500 });
    }

    const manualSlotKeys = new Set(
      ((manualRows ?? []) as Array<Record<string, unknown>>).map(
        (row) => `${String(row.staff_id)}#${String(row.shift_date)}`
      )
    );

    const engineInput: RosterStaffConfig[] = configRows.map((cfg) => {
      const staff = staffById.get(cfg.staff_id);
      return {
        staff_id: cfg.staff_id,
        nickname: staff ? staffNickname(staff) : cfg.staff_id,
        regular_day_off: Number(cfg.regular_day_off),
        shift_preference: cfg.shift_preference,
        night_rotation_order: cfg.night_rotation_order === null ? null : Number(cfg.night_rotation_order),
        extra_day_offs_per_month: Number(cfg.extra_day_offs_per_month ?? 0),
      };
    });

    const generated = generateFoRoster({
      year,
      month,
      nightStartPersonOrder: night_start_person_order,
      staffConfigs: engineInput,
    });

    const skippedByManual = generated.shifts.filter((row) =>
      manualSlotKeys.has(`${row.staff_id}#${row.shift_date}`)
    );
    const insertRows = generated.shifts
      .filter((row) => !manualSlotKeys.has(`${row.staff_id}#${row.shift_date}`))
      .map((row) => ({
        staff_id: row.staff_id,
        shift_date: row.shift_date,
        shift_type: row.shift_type,
        is_generated: true,
      }));

    if (skippedByManual.length > 0) {
      generated.warnings.push(
        `Skipped ${skippedByManual.length} generated slots due to manual shifts (manual wins).`
      );
    }

    let insertedCount = 0;
    if (insertRows.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("staff_shifts")
        .insert(insertRows)
        .select("id");

      if (insertError) {
        return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
      }
      insertedCount = (inserted ?? []).length;
    }

    return NextResponse.json({
      success: true,
      data: {
        year,
        month,
        date_from: from,
        date_to: to,
        deleted_generated_count: (deletedGeneratedRows ?? []).length,
        inserted_generated_count: insertedCount,
        skipped_due_to_manual_count: skippedByManual.length,
        summary: generated.summary,
        warnings: [...configWarnings, ...generated.warnings],
      },
    });
  } catch (err) {
    console.error("api/staff/shifts/generate POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

