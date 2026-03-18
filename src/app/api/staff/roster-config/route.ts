import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  staff_id: z.string().uuid().optional(),
});

const createSchema = z.object({
  staff_id: z.string().uuid(),
  regular_day_off: z.coerce.number().int().min(0).max(6),
  shift_preference: z.enum(["morning_fixed", "rotate"]),
  night_rotation_order: z.coerce.number().int().min(1).max(10).nullable().optional(),
  extra_day_offs_per_month: z.coerce.number().int().min(0).optional().default(0),
});

type StaffLookup = {
  id: string;
  employee_code: string;
  display_name: string;
  nickname: string | null;
  is_active: boolean;
  department_id: string | null;
  department: { code: string; name: string } | null;
};

async function requireAuthenticated(
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
  return { ok: true as const, user };
}

function mapDepartmentRelation(relation: unknown): { code: string; name: string } | null {
  const picked = Array.isArray(relation) ? relation[0] : relation;
  if (!picked || typeof picked !== "object") return null;
  const row = picked as { code?: string; name?: string };
  if (!row.code || !row.name) return null;
  return { code: String(row.code), name: String(row.name) };
}

async function fetchStaffById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  staffId: string
): Promise<{ data: StaffLookup | null; error: string | null }> {
  const { data, error } = await supabase
    .from("staff")
    .select("id, employee_code, display_name, nickname, is_active, department_id, department:departments(code,name)")
    .eq("id", staffId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: null };

  const row = data as Record<string, unknown>;
  return {
    data: {
      id: String(row.id),
      employee_code: String(row.employee_code ?? ""),
      display_name: String(row.display_name ?? ""),
      nickname: row.nickname ? String(row.nickname) : null,
      is_active: Boolean(row.is_active),
      department_id: row.department_id ? String(row.department_id) : null,
      department: mapDepartmentRelation(row.department),
    },
    error: null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireAuthenticated(supabase, request);
    if (!auth.ok) return auth.response;

    const parsed = querySchema.safeParse({
      staff_id: request.nextUrl.searchParams.get("staff_id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    let query = supabase
      .from("roster_config")
      .select("id, staff_id, regular_day_off, shift_preference, night_rotation_order, extra_day_offs_per_month, created_at, updated_at")
      .order("created_at", { ascending: true });

    if (parsed.data.staff_id) {
      query = query.eq("staff_id", parsed.data.staff_id);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const staffIds = Array.from(new Set(rows.map((row) => String(row.staff_id))));
    const staffMap = new Map<string, StaffLookup | null>();

    if (staffIds.length > 0) {
      const { data: staffRows, error: staffError } = await supabase
        .from("staff")
        .select("id, employee_code, display_name, nickname, is_active, department_id, department:departments(code,name)")
        .in("id", staffIds);

      if (staffError) {
        return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
      }

      for (const raw of (staffRows ?? []) as Array<Record<string, unknown>>) {
        const id = String(raw.id);
        staffMap.set(id, {
          id,
          employee_code: String(raw.employee_code ?? ""),
          display_name: String(raw.display_name ?? ""),
          nickname: raw.nickname ? String(raw.nickname) : null,
          is_active: Boolean(raw.is_active),
          department_id: raw.department_id ? String(raw.department_id) : null,
          department: mapDepartmentRelation(raw.department),
        });
      }
    }

    const shaped = rows.map((row) => ({
      id: String(row.id),
      staff_id: String(row.staff_id),
      regular_day_off: Number(row.regular_day_off),
      shift_preference: String(row.shift_preference),
      night_rotation_order: row.night_rotation_order === null ? null : Number(row.night_rotation_order),
      extra_day_offs_per_month: Number(row.extra_day_offs_per_month ?? 0),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      staff: staffMap.get(String(row.staff_id)) ?? null,
    }));

    shaped.sort((a, b) => {
      const aOrder = a.night_rotation_order ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.night_rotation_order ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aName = a.staff?.display_name ?? "";
      const bName = b.staff?.display_name ?? "";
      return aName.localeCompare(bName, "th");
    });

    return NextResponse.json({ success: true, data: shaped });
  } catch (err) {
    console.error("api/staff/roster-config GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireAuthenticated(supabase, request);
    if (!auth.ok) return auth.response;

    try {
      await assertAdminOrSupervisor(supabase, auth.user.id);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Forbidden";
      const status = message === "Forbidden" ? 403 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    if (payload.shift_preference === "rotate" && !payload.night_rotation_order) {
      return NextResponse.json(
        { success: false, error: "night_rotation_order is required when shift_preference is rotate." },
        { status: 400 }
      );
    }

    if (payload.shift_preference === "morning_fixed" && payload.night_rotation_order !== null && payload.night_rotation_order !== undefined) {
      return NextResponse.json(
        { success: false, error: "night_rotation_order must be null for morning_fixed." },
        { status: 400 }
      );
    }

    const staffLookup = await fetchStaffById(supabase, payload.staff_id);
    if (staffLookup.error) {
      return NextResponse.json({ success: false, error: staffLookup.error }, { status: 500 });
    }
    if (!staffLookup.data) {
      return NextResponse.json({ success: false, error: "Staff not found." }, { status: 404 });
    }
    if (staffLookup.data.department?.code !== "FO") {
      return NextResponse.json(
        { success: false, error: "Only FO staff can be configured for FO roster." },
        { status: 400 }
      );
    }

    const insertPayload = {
      staff_id: payload.staff_id,
      regular_day_off: payload.regular_day_off,
      shift_preference: payload.shift_preference,
      night_rotation_order: payload.shift_preference === "morning_fixed" ? null : payload.night_rotation_order ?? null,
      extra_day_offs_per_month: payload.extra_day_offs_per_month,
    };

    const { data, error } = await supabase
      .from("roster_config")
      .insert(insertPayload)
      .select("id, staff_id, regular_day_off, shift_preference, night_rotation_order, extra_day_offs_per_month, created_at, updated_at")
      .maybeSingle();

    if (error) {
      const lower = String(error.message ?? "").toLowerCase();
      if (lower.includes("unique") || lower.includes("duplicate key")) {
        return NextResponse.json(
          { success: false, error: "Roster config already exists for this staff." },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("api/staff/roster-config POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
