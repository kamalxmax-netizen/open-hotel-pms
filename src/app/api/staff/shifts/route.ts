import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { syncStaffFromProfiles } from "@/lib/staff-sync";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  staff_id: z.string().uuid().optional(),
  shift_date: z.string().regex(dateRegex, "shift_date must be YYYY-MM-DD").optional(),
  shift_date_from: z.string().regex(dateRegex, "shift_date_from must be YYYY-MM-DD").optional(),
  shift_date_to: z.string().regex(dateRegex, "shift_date_to must be YYYY-MM-DD").optional(),
  department_code: z.enum(["FO", "HK", "MNT", "FB", "SEC"]).optional(),
  on_duty: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createSchema = z.object({
  staff_id: z.string().uuid(),
  shift_date: z.string().regex(dateRegex, "shift_date must be YYYY-MM-DD"),
  shift_type: z.enum(["morning", "afternoon", "night", "off"]),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    // Legacy PMS mode: keep endpoint readable even when auth has not been wired end-to-end yet.
    void user;

    try {
      await syncStaffFromProfiles(supabase);
    } catch (syncError) {
      console.error("api/staff/shifts GET syncStaffFromProfiles failed", syncError);
    }

    const parsed = querySchema.safeParse({
      staff_id: request.nextUrl.searchParams.get("staff_id") ?? undefined,
      shift_date: request.nextUrl.searchParams.get("shift_date") ?? undefined,
      shift_date_from: request.nextUrl.searchParams.get("shift_date_from") ?? undefined,
      shift_date_to: request.nextUrl.searchParams.get("shift_date_to") ?? undefined,
      department_code: request.nextUrl.searchParams.get("department_code") ?? undefined,
      on_duty: request.nextUrl.searchParams.get("on_duty") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      staff_id,
      shift_date,
      shift_date_from,
      shift_date_to,
      department_code,
      on_duty,
      limit,
      offset,
    } = parsed.data;

    let query = supabase
      .from("staff_shifts")
      .select(
        `
        id,
        staff_id,
        shift_date,
        shift_type,
        is_generated,
        started_at,
        ended_at,
        is_on_duty,
        created_at
      `,
        { count: "exact" }
      )
      .order("shift_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (staff_id) query = query.eq("staff_id", staff_id);
    if (shift_date) query = query.eq("shift_date", shift_date);
    if (shift_date_from) query = query.gte("shift_date", shift_date_from);
    if (shift_date_to) query = query.lte("shift_date", shift_date_to);
    if (on_duty) query = query.eq("is_on_duty", on_duty === "true");
    let allowedStaffIdSet: Set<string> | null = null;

    if (department_code) {
      const { data: departmentRows, error: departmentLookupError } = await supabase
        .from("departments")
        .select("id")
        .eq("code", department_code)
        .limit(1);

      if (departmentLookupError) {
        return NextResponse.json({ success: false, error: departmentLookupError.message }, { status: 500 });
      }

      const departmentId = departmentRows?.[0]?.id ? String(departmentRows[0].id) : null;
      if (!departmentId) {
        return NextResponse.json({
          success: true,
          data: [],
          total: 0,
          limit,
          offset,
        });
      }

      const { data: departmentStaffRows, error: departmentStaffError } = await supabase
        .from("staff")
        .select("id")
        .eq("department_id", departmentId);

      if (departmentStaffError) {
        return NextResponse.json({ success: false, error: departmentStaffError.message }, { status: 500 });
      }

      allowedStaffIdSet = new Set(
        (departmentStaffRows ?? []).map((row) => String((row as { id: string }).id))
      );

      if (allowedStaffIdSet.size === 0) {
        return NextResponse.json({
          success: true,
          data: [],
          total: 0,
          limit,
          offset,
        });
      }

      query = query.in("staff_id", Array.from(allowedStaffIdSet));
    }

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    const staffIds = Array.from(new Set(rows.map((row) => String(row.staff_id))));
    let staffMap: Record<
      string,
      {
        id: string;
        employee_code: string;
        display_name: string;
        nickname: string | null;
        department: { code: string; name: string } | null;
      }
    > = {};
    if (staffIds.length > 0) {
      const { data: staffs, error: staffError } = await supabase
        .from("staff")
        .select("id, employee_code, display_name, nickname, department_id")
        .in("id", staffIds);

      if (staffError) {
        return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
      }

      const departmentIds = Array.from(
        new Set(
          (staffs ?? [])
            .map((s) => (s.department_id ? String(s.department_id) : null))
            .filter((id): id is string => Boolean(id))
        )
      );

      const departmentMap: Record<string, { code: string; name: string }> = {};
      if (departmentIds.length > 0) {
        const { data: departments, error: departmentError } = await supabase
          .from("departments")
          .select("id, code, name")
          .in("id", departmentIds);
        if (departmentError) {
          return NextResponse.json({ success: false, error: departmentError.message }, { status: 500 });
        }
        for (const department of departments ?? []) {
          departmentMap[String(department.id)] = {
            code: String(department.code),
            name: String(department.name),
          };
        }
      }

      for (const staff of staffs ?? []) {
        if (allowedStaffIdSet && !allowedStaffIdSet.has(String(staff.id))) {
          continue;
        }
        const departmentId = staff.department_id ? String(staff.department_id) : null;
        staffMap[String(staff.id)] = {
          id: String(staff.id),
          employee_code: String(staff.employee_code),
          display_name: String(staff.display_name),
          nickname: staff.nickname ? String(staff.nickname) : null,
          department: departmentId ? departmentMap[departmentId] ?? null : null,
        };
      }
    }

    const shaped = rows
      .map((row) => ({
        id: String(row.id),
        staff_id: String(row.staff_id),
        shift_date: String(row.shift_date),
        shift_type: String(row.shift_type),
        is_generated: Boolean(row.is_generated),
        started_at: row.started_at ? String(row.started_at) : null,
        ended_at: row.ended_at ? String(row.ended_at) : null,
        is_on_duty: Boolean(row.is_on_duty),
        created_at: String(row.created_at),
        staff: staffMap[String(row.staff_id)] ?? null,
      }))
      .filter((row) => row.staff !== null);

    return NextResponse.json({
      success: true,
      data: shaped,
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("api/staff/shifts GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    if (user) {
      try {
        await assertAdminOrSupervisor(supabase, user.id);
      } catch (guardError) {
        const message = guardError instanceof Error ? guardError.message : "Forbidden";
        const status = message === "Forbidden" ? 403 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
      }
    }

    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id")
      .eq("id", parsed.data.staff_id)
      .maybeSingle();
    if (staffError) {
      return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
    }
    if (!staffRow) {
      return NextResponse.json({ success: false, error: "Staff not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("staff_shifts")
      .insert(parsed.data)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("api/staff/shifts POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
      await assertAdminOrSupervisor(supabase, user.id);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Forbidden";
      const status = message === "Forbidden" ? 403 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    const parsed = deleteSchema.safeParse({
      id: request.nextUrl.searchParams.get("id") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("staff_shifts")
      .delete()
      .eq("id", parsed.data.id)
      .select("id, staff_id, shift_date, shift_type")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: String(data.id),
        staff_id: String(data.staff_id),
        shift_date: String(data.shift_date),
        shift_type: String(data.shift_type),
      },
    });
  } catch (err) {
    console.error("api/staff/shifts DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
