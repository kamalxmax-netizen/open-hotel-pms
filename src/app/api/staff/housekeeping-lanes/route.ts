import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { syncStaffFromProfiles } from "@/lib/staff-sync";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const FALLBACK_MAIDS = ["Jan", "Tan", "Others"];

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    // Legacy PMS mode: keep endpoint readable even when auth has not been wired end-to-end yet.
    void user;

    try {
      await syncStaffFromProfiles(supabase);
    } catch (syncError) {
      console.error("api/staff/housekeeping-lanes syncStaffFromProfiles failed", syncError);
    }

    let { data, error } = await supabase
      .from("staff")
      .select("id, display_name, nickname, hk_lane_order, hk_lane_enabled, is_active, department:departments(code)")
      .eq("is_active", true)
      .eq("hk_lane_enabled", true)
      .order("hk_lane_order", { ascending: true })
      .order("display_name", { ascending: true });

    let rows = data ?? [];
    let laneColumnsAvailable = true;

    if (error) {
      const lower = String(error.message ?? "").toLowerCase();
      if (!lower.includes("hk_lane_enabled") && !lower.includes("hk_lane_order")) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      laneColumnsAvailable = false;
      rows = [];
    }

    // Compatibility fallback for legacy DBs only (before hk_lane_* columns existed).
    if (!laneColumnsAvailable && rows.length === 0) {
      const hkDepartment = await supabase
        .from("departments")
        .select("id")
        .eq("code", "HK")
        .maybeSingle();
      if (!hkDepartment.error && hkDepartment.data?.id) {
        const fallback = await supabase
          .from("staff")
          .select("id, display_name, nickname, hk_lane_order, hk_lane_enabled, is_active, department:departments(code)")
          .eq("is_active", true)
          .eq("department_id", String(hkDepartment.data.id))
          .order("display_name", { ascending: true });
        if (!fallback.error) rows = fallback.data ?? [];
      }
    }

    // Legacy fallback #2: if no HK-linked staff yet, use all active staff names.
    if (!laneColumnsAvailable && rows.length === 0) {
      const fallbackAll = await supabase
        .from("staff")
        .select("id, display_name, nickname, hk_lane_order, hk_lane_enabled, is_active, department:departments(code)")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      if (!fallbackAll.error) rows = fallbackAll.data ?? [];
    }

    const staffItems = rows.map((row) => ({
      id: String(row.id),
      display_name: String(row.display_name ?? "").trim(),
      nickname: row.nickname ? String(row.nickname) : null,
      hk_lane_order: Number((row as { hk_lane_order?: number }).hk_lane_order ?? 100),
      hk_lane_enabled: Boolean((row as { hk_lane_enabled?: boolean }).hk_lane_enabled),
      department_code: (() => {
        const relation = Array.isArray((row as { department?: unknown }).department)
          ? ((row as { department?: Array<{ code?: string }> }).department ?? [])[0]
          : ((row as { department?: { code?: string } | null }).department ?? null);
        return relation?.code ? String(relation.code) : null;
      })(),
    }))
    .filter((row) => row.display_name.length > 0);

    let laneItems: Array<{
      id: string;
      display_name: string;
      nickname: string | null;
      hk_lane_order: number;
      hk_lane_enabled: boolean;
      department_code: string | null;
    }> = [];

    const laneQuery = await supabase
      .from("hk_staff_lanes")
      .select("id, display_name, nickname, department_code, hk_lane_order, hk_lane_enabled, is_active")
      .eq("is_active", true)
      .eq("hk_lane_enabled", true)
      .order("hk_lane_order", { ascending: true })
      .order("display_name", { ascending: true });

    if (laneQuery.error) {
      const lower = String(laneQuery.error.message ?? "").toLowerCase();
      if (!lower.includes("hk_staff_lanes") && !lower.includes("does not exist")) {
        return NextResponse.json({ success: false, error: laneQuery.error.message }, { status: 500 });
      }
    } else {
      laneItems = (laneQuery.data ?? [])
        .map((row) => ({
          id: String(row.id),
          display_name: String(row.display_name ?? "").trim(),
          nickname: row.nickname ? String(row.nickname) : null,
          hk_lane_order: Number(row.hk_lane_order ?? 100),
          hk_lane_enabled: Boolean(row.hk_lane_enabled ?? true),
          department_code: row.department_code ? String(row.department_code) : "HK",
        }))
        .filter((row) => row.display_name.length > 0);
    }

    const combinedByName = new Map<string, (typeof staffItems)[number]>();
    for (const item of [...laneItems, ...staffItems]) {
      const key = item.display_name.trim().toLowerCase();
      if (!key) continue;
      if (!combinedByName.has(key)) combinedByName.set(key, item);
    }
    const items = Array.from(combinedByName.values()).sort((a, b) => {
      if (a.hk_lane_order !== b.hk_lane_order) return a.hk_lane_order - b.hk_lane_order;
      return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" });
    });

    if (items.length === 0) {
      // Last fallback: use operation names already assigned in housekeeping data.
      const [dailyPlans, extraTasks, hkTasks] = await Promise.all([
        supabase.from("daily_plans").select("assigned_maid").not("assigned_maid", "is", null),
        supabase.from("extra_task_assignments").select("assigned_maid").not("assigned_maid", "is", null),
        supabase
          .from("housekeeping_tasks")
          .select("assigned_maid_name")
          .not("assigned_maid_name", "is", null),
      ]);

      const legacyNames = new Set<string>();
      for (const row of dailyPlans.data ?? []) {
        const name = String((row as { assigned_maid?: string }).assigned_maid ?? "").trim();
        if (name) legacyNames.add(name);
      }
      for (const row of extraTasks.data ?? []) {
        const name = String((row as { assigned_maid?: string }).assigned_maid ?? "").trim();
        if (name && name !== "POOL") legacyNames.add(name);
      }
      for (const row of hkTasks.data ?? []) {
        const name = String((row as { assigned_maid_name?: string }).assigned_maid_name ?? "").trim();
        if (name) legacyNames.add(name);
      }

      if (legacyNames.size > 0) {
        const legacyItems = Array.from(legacyNames)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map((name, idx) => ({
            id: `legacy-${idx + 1}`,
            display_name: name,
            nickname: null,
            hk_lane_order: idx + 1,
            hk_lane_enabled: true,
            department_code: "HK",
          }));
        return NextResponse.json({ success: true, data: legacyItems });
      }

      return NextResponse.json({
        success: true,
        data: FALLBACK_MAIDS.map((name, idx) => ({
          id: `fallback-${idx + 1}`,
          display_name: name,
          nickname: null,
          hk_lane_order: idx + 1,
          hk_lane_enabled: true,
          department_code: "HK",
        })),
      });
    }

    return NextResponse.json({ success: true, data: items });
  } catch (err) {
    console.error("api/staff/housekeeping-lanes GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
