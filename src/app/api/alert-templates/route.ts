import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

const SURFACES = ["arrivals", "room_diary", "calendar", "reservation", "inhouse", "room_drawer", "hk_dashboard"] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;
const CATEGORIES = ["arrival", "housekeeping", "policy", "transport", "other"] as const;

function normalizeSurfaceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter((item) => SURFACES.includes(item as any))));
}

export async function GET(request: NextRequest) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    const active = request.nextUrl.searchParams.get("active");

    let query = supabase
      .from("alert_templates")
      .select("id, code, name, description, category, display_surfaces, severity, is_system, is_active, sort_order, icon")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });

    if (active === "true") query = query.eq("is_active", true);
    if (active === "false") query = query.eq("is_active", false);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, templates: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(body.code ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim() || null;
    const category = String(body.category ?? "").trim().toLowerCase();
    const severity = String(body.severity ?? "").trim().toLowerCase();
    const displaySurfaces = normalizeSurfaceList(body.display_surfaces);
    const sortOrder = Number(body.sort_order ?? 0);

    if (!code) return NextResponse.json({ error: "code is required." }, { status: 400 });
    if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
    if (!CATEGORIES.includes(category as any)) return NextResponse.json({ error: "invalid category." }, { status: 400 });
    if (!SEVERITIES.includes(severity as any)) return NextResponse.json({ error: "invalid severity." }, { status: 400 });
    if (displaySurfaces.length === 0) return NextResponse.json({ error: "Select at least one display surface." }, { status: 400 });
    if (!Number.isFinite(sortOrder)) return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("alert_templates")
      .insert({
        code,
        name,
        description,
        category,
        display_surfaces: displaySurfaces,
        severity,
        is_system: body.is_system === true,
        is_active: body.is_active === undefined ? true : Boolean(body.is_active),
        sort_order: Math.trunc(sortOrder),
        icon: body.icon ? String(body.icon) : null,
      })
      .select("id, code, name, description, category, display_surfaces, severity, is_system, is_active, sort_order, icon")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, template: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
