import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const SURFACES = ["arrivals", "room_diary", "calendar", "reservation", "inhouse", "room_drawer", "hk_dashboard"] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;
const CATEGORIES = ["arrival", "housekeeping", "policy", "transport", "other"] as const;

function normalizeSurfaceList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter((item) => SURFACES.includes(item as any))));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid template id." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.code !== undefined) {
      const code = String(body.code ?? "").trim().toLowerCase().replace(/\s+/g, "_");
      if (!code) return NextResponse.json({ error: "code cannot be empty." }, { status: 400 });
      updates.code = code;
    }
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
      updates.name = name;
    }
    if (body.description !== undefined) {
      updates.description = String(body.description ?? "").trim() || null;
    }
    if (body.category !== undefined) {
      const category = String(body.category ?? "").trim().toLowerCase();
      if (!CATEGORIES.includes(category as any)) return NextResponse.json({ error: "invalid category." }, { status: 400 });
      updates.category = category;
    }
    if (body.severity !== undefined) {
      const severity = String(body.severity ?? "").trim().toLowerCase();
      if (!SEVERITIES.includes(severity as any)) return NextResponse.json({ error: "invalid severity." }, { status: 400 });
      updates.severity = severity;
    }
    if (body.display_surfaces !== undefined) {
      const surfaces = normalizeSurfaceList(body.display_surfaces);
      if (!surfaces || surfaces.length === 0) return NextResponse.json({ error: "Select at least one display surface." }, { status: 400 });
      updates.display_surfaces = surfaces;
    }
    if (body.is_system !== undefined) updates.is_system = Boolean(body.is_system);
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
    if (body.icon !== undefined) updates.icon = body.icon ? String(body.icon) : null;
    if (body.sort_order !== undefined) {
      const sortOrder = Number(body.sort_order);
      if (!Number.isFinite(sortOrder)) return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
      updates.sort_order = Math.trunc(sortOrder);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("alert_templates")
      .update(updates)
      .eq("id", id)
      .select("id, code, name, description, category, display_surfaces, severity, is_system, is_active, sort_order, icon")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ success: true, template: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid template id." }, { status: 400 });

    const supabase = createServerSupabaseClient();

    const { error: clearError } = await supabase
      .from("reservation_alerts")
      .update({ alert_template_id: null })
      .eq("alert_template_id", id);

    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });

    const { error } = await supabase
      .from("alert_templates")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
