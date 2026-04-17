import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, type AuthUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

type StaffLane = {
  id: string;
  display_name: string;
  nickname: string | null;
  is_active: boolean;
  hk_lane_enabled: boolean;
  department_code: string | null;
};

type MaidPermissionMode = "admin" | "maid" | "fo_own_lane" | "fo_view_only" | "forbidden";

export type MaidPermissionContext = {
  user: AuthUser;
  role: string;
  mode: MaidPermissionMode;
  canRead: boolean;
  canSelectMaid: boolean;
  canOperate: boolean;
  selectedMaidName: string | null;
  effectiveMaidName: string | null;
  staffLaneName: string | null;
  staffNickname: string | null;
  departmentCode: string | null;
  reason: string | null;
  audit: {
    actor_user_id: string;
    actor_email: string | null;
    actor_role: string;
    selected_maid_name: string | null;
    effective_maid_name: string | null;
    permission_mode: MaidPermissionMode;
  };
};

export class MaidAuthError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 403, code = "maid_auth_forbidden") {
    super(message);
    this.name = "MaidAuthError";
    this.status = status;
    this.code = code;
  }
}

function getDepartmentCode(relation: unknown): string | null {
  const picked = Array.isArray(relation) ? relation[0] : relation;
  if (!picked || typeof picked !== "object") return null;
  const code = (picked as { code?: string | null }).code;
  return code ? String(code).trim().toUpperCase() : null;
}

export function normalizeMaidName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isMaidNameMatch(candidate: string | null | undefined, target: string | null | undefined): boolean {
  const c = normalizeMaidName(candidate);
  const t = normalizeMaidName(target);
  if (!c || !t) return false;
  if (c === t) return true;

  const compactCandidate = c.replace(/[^a-z0-9ก-๙]/g, "");
  const compactTarget = t.replace(/[^a-z0-9ก-๙]/g, "");
  if (compactCandidate && compactCandidate === compactTarget) return true;

  return c.includes(t) || t.includes(c);
}

function hasPageAccess(allowedPages: unknown, path: string): boolean {
  const pages = Array.isArray(allowedPages) ? allowedPages.map((page) => String(page)) : ["*"];
  if (pages.includes("*")) return true;
  return pages.some((page) => path === page || path.startsWith(`${page}/`));
}

async function loadProfile(
  supabase: SupabaseServerClient,
  userId: string
): Promise<{ role: string; allowed_pages: unknown }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, allowed_pages")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new MaidAuthError(error.message, 500, "maid_auth_profile_error");
  return {
    role: String(data?.role ?? "").trim().toLowerCase(),
    allowed_pages: data?.allowed_pages ?? ["*"],
  };
}

async function loadStaffLane(supabase: SupabaseServerClient, userId: string): Promise<StaffLane | null> {
  const withLaneColumns = await supabase
    .from("staff")
    .select("id, display_name, nickname, is_active, hk_lane_enabled, department:departments(code)")
    .eq("id", userId)
    .maybeSingle();

  if (withLaneColumns.error) {
    const lower = String(withLaneColumns.error.message ?? "").toLowerCase();
    if (!lower.includes("hk_lane_enabled")) {
      throw new MaidAuthError(withLaneColumns.error.message, 500, "maid_auth_staff_error");
    }

    const fallback = await supabase
      .from("staff")
      .select("id, display_name, nickname, is_active, department:departments(code)")
      .eq("id", userId)
      .maybeSingle();

    if (fallback.error) {
      throw new MaidAuthError(fallback.error.message, 500, "maid_auth_staff_error");
    }
    if (!fallback.data) return null;

    return {
      id: String(fallback.data.id),
      display_name: String(fallback.data.display_name ?? "").trim(),
      nickname: fallback.data.nickname ? String(fallback.data.nickname).trim() : null,
      is_active: Boolean(fallback.data.is_active),
      hk_lane_enabled: false,
      department_code: getDepartmentCode((fallback.data as { department?: unknown }).department),
    };
  }

  if (!withLaneColumns.data) return null;

  return {
    id: String(withLaneColumns.data.id),
    display_name: String(withLaneColumns.data.display_name ?? "").trim(),
    nickname: withLaneColumns.data.nickname ? String(withLaneColumns.data.nickname).trim() : null,
    is_active: Boolean(withLaneColumns.data.is_active),
    hk_lane_enabled: Boolean((withLaneColumns.data as { hk_lane_enabled?: boolean | null }).hk_lane_enabled),
    department_code: getDepartmentCode((withLaneColumns.data as { department?: unknown }).department),
  };
}

async function isKnownLaneName(supabase: SupabaseServerClient, maidName: string | null): Promise<boolean> {
  const normalized = normalizeMaidName(maidName);
  if (!normalized) return false;

  const staffRows = await supabase
    .from("staff")
    .select("display_name, nickname, is_active, hk_lane_enabled")
    .eq("is_active", true)
    .eq("hk_lane_enabled", true);

  if (!staffRows.error) {
    const found = (staffRows.data ?? []).some(
      (row) => isMaidNameMatch(row.display_name, normalized) || isMaidNameMatch(row.nickname, normalized)
    );
    if (found) return true;
  }

  const laneRows = await supabase
    .from("hk_staff_lanes")
    .select("display_name, nickname, is_active, hk_lane_enabled")
    .eq("is_active", true)
    .eq("hk_lane_enabled", true);

  if (!laneRows.error) {
    const found = (laneRows.data ?? []).some(
      (row) => isMaidNameMatch(row.display_name, normalized) || isMaidNameMatch(row.nickname, normalized)
    );
    if (found) return true;
  } else {
    const lower = String(laneRows.error.message ?? "").toLowerCase();
    if (!lower.includes("hk_staff_lanes") && !lower.includes("does not exist")) {
      throw new MaidAuthError(laneRows.error.message, 500, "maid_auth_lane_error");
    }
  }

  const [dailyPlans, extraTasks, hkTasks] = await Promise.all([
    supabase.from("daily_plans").select("assigned_maid").not("assigned_maid", "is", null),
    supabase.from("extra_task_assignments").select("assigned_maid").not("assigned_maid", "is", null),
    supabase.from("housekeeping_tasks").select("assigned_maid_name").not("assigned_maid_name", "is", null),
  ]);

  if (!dailyPlans.error) {
    const found = (dailyPlans.data ?? []).some((row) => isMaidNameMatch(row.assigned_maid, normalized));
    if (found) return true;
  }
  if (!extraTasks.error) {
    const found = (extraTasks.data ?? []).some((row) => isMaidNameMatch(row.assigned_maid, normalized));
    if (found) return true;
  }
  if (!hkTasks.error) {
    const found = (hkTasks.data ?? []).some((row) => isMaidNameMatch(row.assigned_maid_name, normalized));
    if (found) return true;
  }

  return false;
}

function buildContext(params: {
  user: AuthUser;
  role: string;
  mode: MaidPermissionMode;
  canRead: boolean;
  canSelectMaid: boolean;
  canOperate: boolean;
  selectedMaidName: string | null;
  effectiveMaidName: string | null;
  staffLane: StaffLane | null;
  reason: string | null;
}): MaidPermissionContext {
  return {
    user: params.user,
    role: params.role,
    mode: params.mode,
    canRead: params.canRead,
    canSelectMaid: params.canSelectMaid,
    canOperate: params.canOperate,
    selectedMaidName: params.selectedMaidName,
    effectiveMaidName: params.effectiveMaidName,
    staffLaneName: params.staffLane?.display_name ?? null,
    staffNickname: params.staffLane?.nickname ?? null,
    departmentCode: params.staffLane?.department_code ?? null,
    reason: params.reason,
    audit: {
      actor_user_id: params.user.id,
      actor_email: params.user.email ?? null,
      actor_role: params.role,
      selected_maid_name: params.selectedMaidName,
      effective_maid_name: params.effectiveMaidName,
      permission_mode: params.mode,
    },
  };
}

export async function resolveMaidPermission(
  supabase: SupabaseServerClient,
  request: NextRequest,
  selectedMaidName?: string | null
): Promise<MaidPermissionContext> {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) throw new MaidAuthError("Unauthorized", 401, "maid_auth_unauthorized");

  const profile = await loadProfile(supabase, user.id);
  if (!hasPageAccess(profile.allowed_pages, "/maid")) {
    throw new MaidAuthError("Maid app permission is required.", 403, "maid_auth_missing_page");
  }

  const staffLane = await loadStaffLane(supabase, user.id);
  const role = profile.role;
  const selected = selectedMaidName?.trim() ? selectedMaidName.trim() : null;
  const staffLaneActive = Boolean(staffLane?.is_active && staffLane.display_name);
  const ownLaneEnabled = Boolean(staffLaneActive && staffLane?.hk_lane_enabled);
  const ownLaneName = ownLaneEnabled ? staffLane?.display_name ?? null : null;
  const selectedOwnLane =
    ownLaneEnabled &&
    (isMaidNameMatch(selected, staffLane?.display_name) || isMaidNameMatch(selected, staffLane?.nickname));
  const isAdminLike = role === "admin" || role === "supervisor";
  const isMaidLike = role === "maid" || staffLane?.department_code === "HK";
  const isFrontdeskLike = role === "frontdesk" || staffLane?.department_code === "FO";

  if (isAdminLike) {
    const effective = selected;
    return buildContext({
      user,
      role,
      mode: "admin",
      canRead: true,
      canSelectMaid: true,
      canOperate: Boolean(effective),
      selectedMaidName: selected,
      effectiveMaidName: effective,
      staffLane,
      reason: effective ? null : "Select a housekeeping lane before operating.",
    });
  }

  if (isMaidLike) {
    return buildContext({
      user,
      role,
      mode: ownLaneEnabled ? "maid" : "forbidden",
      canRead: ownLaneEnabled,
      canSelectMaid: false,
      canOperate: ownLaneEnabled,
      selectedMaidName: selected,
      effectiveMaidName: ownLaneName,
      staffLane,
      reason: ownLaneEnabled ? null : "This housekeeping user does not have an active Maid lane.",
    });
  }

  if (!isFrontdeskLike) {
    return buildContext({
      user,
      role,
      mode: "forbidden",
      canRead: false,
      canSelectMaid: false,
      canOperate: false,
      selectedMaidName: selected,
      effectiveMaidName: null,
      staffLane,
      reason: "This user role cannot access Maid app.",
    });
  }

  const canOperateOwnLane = Boolean(selectedOwnLane);
  return buildContext({
    user,
    role,
    mode: canOperateOwnLane ? "fo_own_lane" : "fo_view_only",
    canRead: true,
    canSelectMaid: true,
    canOperate: canOperateOwnLane,
    selectedMaidName: selected,
    effectiveMaidName: selected,
    staffLane,
    reason: canOperateOwnLane ? null : "View only. Select your own enabled lane to operate.",
  });
}

export async function requireMaidRead(
  supabase: SupabaseServerClient,
  request: NextRequest,
  selectedMaidName?: string | null
): Promise<MaidPermissionContext> {
  const context = await resolveMaidPermission(supabase, request, selectedMaidName);
  if (!context.canRead) {
    throw new MaidAuthError(context.reason ?? "Maid app access is not allowed.", 403);
  }
  return context;
}

export async function requireMaidOperation(
  supabase: SupabaseServerClient,
  request: NextRequest,
  selectedMaidName?: string | null
): Promise<MaidPermissionContext> {
  const context = await resolveMaidPermission(supabase, request, selectedMaidName);
  if (!context.canOperate || !context.effectiveMaidName) {
    throw new MaidAuthError(context.reason ?? "Maid operation is not allowed.", 403);
  }

  if (
    context.mode === "maid" &&
    selectedMaidName?.trim() &&
    !isMaidNameMatch(selectedMaidName, context.staffLaneName) &&
    !isMaidNameMatch(selectedMaidName, context.staffNickname)
  ) {
    throw new MaidAuthError("Maid users can operate only their own lane.", 403, "maid_auth_wrong_lane");
  }

  if (context.mode === "admin") {
    const known = await isKnownLaneName(supabase, context.effectiveMaidName);
    if (!known) {
      throw new MaidAuthError("Selected housekeeping lane does not exist.", 404, "maid_auth_unknown_lane");
    }
  }

  return context;
}

export function maidAuthErrorResponse(error: unknown) {
  if (error instanceof MaidAuthError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return null;
}
