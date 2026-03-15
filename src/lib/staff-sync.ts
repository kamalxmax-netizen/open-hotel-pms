import { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  is_active?: boolean | null;
};

const ROLE_TO_DEPARTMENT_CODE: Record<string, "FO" | "HK" | "MNT" | "FB" | "SEC"> = {
  admin: "FO",
  frontdesk: "FO",
  supervisor: "FO",
  maid: "HK",
};

function toDisplayName(value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  return v.length > 0 ? v : "Unknown";
}

function toEmployeeCode(userId: string): string {
  return `TMP-${String(userId).slice(0, 8).toUpperCase()}`;
}

export async function syncStaffFromProfiles(
  supabase: SupabaseServerClient
): Promise<{ inserted: number }> {
  // Some older databases do not have profiles.is_active yet.
  let profiles: ProfileRow[] | null = null;
  const withActive = await supabase.from("profiles").select("user_id, full_name, role, is_active");
  if (withActive.error) {
    const lower = String(withActive.error.message ?? "").toLowerCase();
    if (lower.includes("is_active")) {
      const fallback = await supabase.from("profiles").select("user_id, full_name, role");
      if (fallback.error) throw new Error(fallback.error.message);
      profiles = (fallback.data ?? []) as ProfileRow[];
    } else {
      throw new Error(withActive.error.message);
    }
  } else {
    profiles = (withActive.data ?? []) as ProfileRow[];
  }

  const [{ data: staffRows, error: staffError }, { data: departments, error: departmentsError }] =
    await Promise.all([
      supabase.from("staff").select("id"),
      supabase.from("departments").select("id, code"),
    ]);

  if (staffError) throw new Error(staffError.message);
  if (departmentsError) throw new Error(departmentsError.message);

  const existingIds = new Set((staffRows ?? []).map((row) => String(row.id)));
  const departmentIdByCode = new Map<string, string>(
    (departments ?? []).map((row) => [String(row.code), String(row.id)])
  );

  const missingProfiles = ((profiles ?? []) as ProfileRow[]).filter(
    (row) => !existingIds.has(String(row.user_id))
  );

  if (missingProfiles.length === 0) return { inserted: 0 };

  const insertRows = missingProfiles.map((profile) => {
    const role = String(profile.role ?? "").toLowerCase();
    const departmentCode = ROLE_TO_DEPARTMENT_CODE[role] ?? "FO";
    const departmentId = departmentIdByCode.get(departmentCode) ?? null;

    return {
      id: String(profile.user_id),
      employee_code: toEmployeeCode(String(profile.user_id)),
      display_name: toDisplayName(profile.full_name),
      department_id: departmentId,
      is_active: profile.is_active ?? true,
      hk_lane_enabled: role === "maid",
      hk_lane_order: 100,
    };
  });

  const { error: insertError } = await supabase.from("staff").insert(insertRows);
  if (insertError) throw new Error(insertError.message);

  return { inserted: insertRows.length };
}
