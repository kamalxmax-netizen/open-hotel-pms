import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getAuthenticatedUser,
  assertAdminOrSupervisor,
  type AuthUser,
} from "@/lib/server-auth";

// All PMS route prefixes selectable in the UI
const ALL_PAGES = [
  { path: "/pms", label: "Dashboard", section: "Front Desk" },
  { path: "/pms/board", label: "Room Rack", section: "Front Desk" },
  { path: "/pms/calendar", label: "Calendar", section: "Front Desk" },
  { path: "/pms/arrivals", label: "Arrivals", section: "Front Desk" },
  { path: "/pms/inhouse", label: "In-House", section: "Front Desk" },
  { path: "/pms/departures", label: "Departures", section: "Front Desk" },
  { path: "/pms/reservations", label: "Reservations", section: "Front Desk" },
  { path: "/pms/mobile-checkin", label: "Mobile Check-in", section: "Front Desk" },
  { path: "/pms/groups", label: "Group Bookings", section: "Front Desk" },
  { path: "/pms/availability", label: "Availability", section: "Front Desk" },
  { path: "/pms/vehicles", label: "Vehicle Registry", section: "Front Desk" },
  { path: "/pms/alerts", label: "Today's Alerts", section: "Front Desk" },
  { path: "/pms/guests", label: "Guest Profiles", section: "Client Relations" },
  { path: "/pms/rates", label: "Rate Grid", section: "Revenue" },
  { path: "/pms/revenue", label: "Revenue Report", section: "Revenue" },
  { path: "/pms/tax-invoice", label: "Tax Invoice", section: "Revenue" },
  { path: "/pms/payments", label: "Payment Report", section: "Revenue" },
  { path: "/pms/payment-daily", label: "Payment Daily", section: "Revenue" },
  { path: "/pms/accounting", label: "Com and Tips", section: "Revenue" },
  { path: "/pms/transfer-audit", label: "Transfer Audit", section: "Revenue" },
  { path: "/pms/pos", label: "POS", section: "Point of Sale" },
  { path: "/pms/inventory", label: "Inventory Dashboard", section: "Inventory" },
  { path: "/pms/inventory/stock", label: "Stock Levels", section: "Inventory" },
  { path: "/pms/inventory/snapshots", label: "Daily Snapshot", section: "Inventory" },
  { path: "/pms/inventory/fo-prepare", label: "FO Prepare", section: "Inventory" },
  { path: "/pms/inventory/amenity-audit", label: "Amenity Audit", section: "Inventory" },
  { path: "/pms/inventory/transactions", label: "Transactions", section: "Inventory" },
  { path: "/pms/housekeeping", label: "HK Dashboard", section: "Housekeeping" },
  { path: "/pms/housekeeping/extra-tasks", label: "Extra Tasks", section: "Housekeeping" },
  { path: "/pms/lost-found", label: "Lost & Found", section: "Housekeeping" },
  { path: "/pms/lost-found/expired", label: "Lost & Found Expired", section: "Housekeeping" },
  { path: "/pms/linen", label: "Linen & Laundry", section: "Housekeeping" },
  { path: "/pms/linen/batch", label: "Linen Batch Workflow", section: "Housekeeping" },
  { path: "/linen-mobile", label: "Linen App", section: "Housekeeping" },
  { path: "/pms/linen/monthly", label: "Linen Monthly", section: "Housekeeping" },
  { path: "/pms/linen/history", label: "Linen History", section: "Housekeeping" },
  { path: "/pms/linen/settings", label: "Linen Setting", section: "Housekeeping" },
  { path: "/maid", label: "Maid App", section: "Housekeeping" },
  { path: "/pms/maintenance", label: "Maintenance", section: "Maintenance" },
  { path: "/pms/transportation", label: "Transportation", section: "Transportation" },
  { path: "/pms/reports/tm30", label: "TM.30 Export", section: "Reports" },
  { path: "/pms/reports/rr3", label: "รร.3 Export", section: "Reports" },
  { path: "/pms/night-audit", label: "Night Audit", section: "Audit & Finance" },
  { path: "/pms/audit", label: "Audit Explorer", section: "Audit & Finance" },
  { path: "/pms/admin/corrections", label: "Admin Corrections", section: "Audit & Finance" },
  { path: "/pms/audit/monthly", label: "Monthly Audit", section: "Audit & Finance" },
  { path: "/pms/admin/guest-migration", label: "Guest Migration", section: "System" },
  { path: "/pms/inventory/settings", label: "Inventory Settings", section: "System" },
  { path: "/pms/settings", label: "Settings", section: "System" },
  { path: "/pms/team", label: "Team & Shifts", section: "System" },
  { path: "/pms/staff-schedule", label: "Staff Schedule", section: "System" },
  { path: "/pms/logbook", label: "Logbook", section: "Front Desk" },
  { path: "/pms/analytics", label: "Data Analysis", section: "Analytics" },
  { path: "/pms/analytics/material", label: "Material Analytics", section: "Analytics" },
  { path: "/pms/analytics/material/linen", label: "Linen Analytics", section: "Analytics" },
  { path: "/pms/analytics/material/amenity", label: "Amenity Analytics", section: "Analytics" },
  { path: "/pms/analytics/room", label: "Room Analytics", section: "Analytics" },
  { path: "/pms/analytics/budget", label: "Budget Analytics", section: "Analytics" },
  { path: "/pms/setup", label: "All Setup Pages", section: "System" },
  { path: "/pms/training", label: "Training", section: "System" },
  { path: "/pms/admin/backup-status", label: "Backup Status", section: "System" },
  { path: "/pms/admin/debug-logs", label: "Activity Logs", section: "System" },
  { path: "/pms/setup/bug-reports", label: "Bug Reports", section: "System" },
  { path: "/pms/setup/permissions", label: "Permissions", section: "System" },
];

async function listAllAuthUsers(supabase: ReturnType<typeof createServerSupabaseClient>) {
  const users: any[] = [];
  const perPage = 1000;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < perPage) break;
  }

  return users;
}

async function requirePermissionsAccess(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  request: NextRequest
): Promise<{ ok: true; user: AuthUser } | { ok: false; response: NextResponse }> {
  let user: AuthUser | null;
  try {
    user = await getAuthenticatedUser(supabase, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth check failed";
    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status: 500 }),
    };
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  try {
    await assertAdminOrSupervisor(supabase, user.id);
  } catch (guardError) {
    const message = guardError instanceof Error ? guardError.message : "Forbidden";
    const status = message === "Forbidden" ? 403 : 500;
    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status }),
    };
  }

  return { ok: true, user };
}

/* ─── GET /api/permissions ───────────────────────
   List all Auth users; auto-upsert profiles for any that don't have one.
   Phase 75 Batch 1.1: admin/supervisor guard added (was unauthed — CRITICAL).
*/
export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient();

  // Phase 75: auth gate — admin/supervisor only
  const auth = await requirePermissionsAccess(supabase, request);
  if (!auth.ok) return auth.response;

  // 1. Fetch all auth users (service role only). Supabase paginates this list;
  // new staff can otherwise disappear from the permissions screen.
  let authUsers: any[] = [];
  try {
    authUsers = await listAllAuthUsers(supabase);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list auth users";
    return NextResponse.json({ error: message }, { status: 500 });
  }

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
  const users = (profiles ?? [])
    .map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      email: emailMap.get(p.user_id) ?? "",
      role: p.role,
      allowed_pages: p.allowed_pages,
    }))
    .sort((a, b) => {
      const aLabel = String(a.email || a.full_name || a.user_id).toLowerCase();
      const bLabel = String(b.email || b.full_name || b.user_id).toLowerCase();
      return aLabel.localeCompare(bLabel);
    });

  return NextResponse.json({ success: true, users, all_pages: ALL_PAGES });
}

/* ─── PATCH /api/permissions ─────────────────────
   Update allowed_pages for a profile
   Body: { profile_id: string, allowed_pages: string[] }
   Phase 75 Batch 1.1: admin/supervisor guard added (was unauthed — CRITICAL).
*/
export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabaseClient();

  // Phase 75: auth gate — admin/supervisor only
  const auth = await requirePermissionsAccess(supabase, request);
  if (!auth.ok) return auth.response;

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
