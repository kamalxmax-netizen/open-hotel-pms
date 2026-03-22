import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// All PMS route prefixes selectable in the UI
const ALL_PAGES = [
  { path: "/pms", label: "Dashboard", section: "Front Desk" },
  { path: "/pms/board", label: "Room Diary", section: "Front Desk" },
  { path: "/pms/calendar", label: "Calendar", section: "Front Desk" },
  { path: "/pms/arrivals", label: "Arrivals", section: "Front Desk" },
  { path: "/pms/inhouse", label: "In-House", section: "Front Desk" },
  { path: "/pms/departures", label: "Departures", section: "Front Desk" },
  { path: "/pms/reservations", label: "Reservations", section: "Front Desk" },
  { path: "/pms/groups", label: "Group Bookings", section: "Front Desk" },
  { path: "/pms/availability", label: "Availability", section: "Front Desk" },
  { path: "/pms/guests", label: "Guest Profiles", section: "Client Relations" },
  { path: "/pms/rates", label: "Rate Grid", section: "Revenue" },
  { path: "/pms/revenue", label: "Revenue Report", section: "Revenue" },
  { path: "/pms/payments", label: "Payment Report", section: "Revenue" },
  { path: "/pms/payment-daily", label: "Payment Daily", section: "Revenue" },
  { path: "/pms/accounting", label: "Com and Tips", section: "Revenue" },
  { path: "/pms/pos", label: "POS", section: "Point of Sale" },
  { path: "/pms/inventory", label: "Inventory", section: "Inventory" },
  { path: "/pms/housekeeping", label: "HK Dashboard", section: "Housekeeping" },
  { path: "/maid", label: "Maid App", section: "Housekeeping" },
  { path: "/pms/maintenance", label: "Maintenance", section: "Maintenance" },
  { path: "/pms/transportation", label: "Transportation", section: "Transportation" },
  { path: "/pms/reports/tm30", label: "TM.30 Export", section: "Reports" },
  { path: "/pms/reports/rr3", label: "รร.3 Export", section: "Reports" },
  { path: "/pms/night-audit", label: "Night Audit", section: "Admin" },
  { path: "/pms/audit", label: "Audit Explorer", section: "Admin" },
  { path: "/pms/admin/corrections", label: "Admin Corrections", section: "Admin" },
  { path: "/pms/audit/monthly", label: "Monthly Audit", section: "Admin" },
  { path: "/pms/settings", label: "Settings", section: "Admin" },
  { path: "/pms/team", label: "Team & Shifts", section: "Admin" },
  { path: "/pms/logbook", label: "Logbook", section: "Admin" },
  { path: "/pms/setup", label: "All Setup Pages", section: "Admin" },
  { path: "/pms/training", label: "Training", section: "Admin" },
];

/* ─── GET /api/permissions ───────────────────────
   List all Auth users; auto-upsert profiles for any that don't have one.
*/
export async function GET(_request: NextRequest) {
  const supabase = createServerSupabaseClient();

  // 1. Fetch all auth users (service role only)
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  const authUsers = authData?.users ?? [];

  // 2. Auto-upsert a profiles row for each auth user that doesn't have one
  if (authUsers.length > 0) {
    const upsertRows = authUsers.map((u) => ({
      user_id: u.id,
      full_name: u.email ?? u.id,
      role: "staff",
      allowed_pages: ["*"],
    }));
    await supabase
      .from("profiles")
      .upsert(upsertRows, { onConflict: "user_id", ignoreDuplicates: true });
  }

  // 3. Fetch profiles (now guaranteed to exist for all auth users)
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("user_id, full_name, role, allowed_pages")
    .order("full_name", { ascending: true });

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  // 4. Merge email from auth users into profiles
  const emailMap = new Map(authUsers.map((u) => [u.id, u.email ?? ""]));
  const users = (profiles ?? []).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name,
    email: emailMap.get(p.user_id) ?? "",
    role: p.role,
    allowed_pages: p.allowed_pages,
  }));

  return NextResponse.json({ success: true, users, all_pages: ALL_PAGES });
}

/* ─── PATCH /api/permissions ─────────────────────
   Update allowed_pages for a profile
   Body: { profile_id: string, allowed_pages: string[] }
*/
export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const body = await request.json();
  const { profile_id, allowed_pages } = body;

  if (!profile_id) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }
  if (!Array.isArray(allowed_pages)) {
    return NextResponse.json({ error: "allowed_pages must be an array" }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ allowed_pages })
    .eq("user_id", profile_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
