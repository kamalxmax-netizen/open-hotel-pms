import { createServerSupabaseClient } from "@/lib/supabase/server";
import { attachTemplateFallback, filterAlertsForSurface, mapEffectiveReservationAlert, normalizeAlertCodeKey, normalizeAlertSeverity, normalizeDisplaySurfaces } from "@/lib/reservation-alerts";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

const ALERT_SELECT = `
  *,
  alert_codes(code, description, dept, auto_on_co, icon),
  alert_templates(id, code, name, description, category, display_surfaces, severity, is_active, sort_order, icon)
`;

async function resolveTemplateByCode(supabase: any, alertCode: string) {
  const { data, error } = await supabase
    .from("alert_templates")
    .select("id, code, name, description, category, display_surfaces, severity, icon");
  if (error) throw new Error(error.message);
  return (data ?? []).find((row: any) => normalizeAlertCodeKey(row?.code) === normalizeAlertCodeKey(alertCode)) ?? null;
}

/* ─── GET /api/bookings/[id]/alerts ─────────────────────────
   List alerts for a reservation with runtime-effective fields
─────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, req, { denyRoles: [] });
    if (auth.error) return auth.error;

    const includeDismissed = req.nextUrl.searchParams.get("include_dismissed") === "1";
    const surface = req.nextUrl.searchParams.get("surface");

    const { data, error } = await supabase
      .from("reservation_alerts")
      .select(ALERT_SELECT)
      .eq("reservation_id", params.id)
      .order("created_at");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const legacyCodes = Array.from(
      new Set((data ?? []).filter((row: any) => !row?.alert_template_id && row?.alert_code).map((row: any) => normalizeAlertCodeKey(row.alert_code)).filter(Boolean))
    );
    let templateMap = new Map<string, any>();
    if (legacyCodes.length > 0) {
      const { data: templates, error: templateError } = await supabase
        .from("alert_templates")
        .select("id, code, name, description, category, display_surfaces, severity, icon");
      if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
      templateMap = new Map((templates ?? []).map((template: any) => [normalizeAlertCodeKey(template.code), template]));
    }

    let alerts = attachTemplateFallback(data ?? [], templateMap).map(mapEffectiveReservationAlert);
    if (surface) {
      alerts = filterAlertsForSurface(alerts, surface as any, { includeDismissed });
    } else if (!includeDismissed) {
      alerts = alerts.filter((alert) => !alert.is_dismissed);
    }

    return NextResponse.json({ success: true, alerts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─── POST /api/bookings/[id]/alerts ────────────────────────
   Add an alert using template or legacy code
─────────────────────────────────────────────────────────── */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      alert_code,
      alert_template_id,
      note,
      custom_message,
      display_surfaces,
      severity,
      created_by,
    } = await request.json();

    let template: any = null;
    let resolvedAlertCode = alert_code ? String(alert_code).trim().toUpperCase() : "";
    let resolvedTemplateId = alert_template_id == null ? null : Number(alert_template_id);

    if (resolvedTemplateId) {
      const { data, error } = await supabase
        .from("alert_templates")
        .select("id, code, name, description, category, display_surfaces, severity, icon")
        .eq("id", resolvedTemplateId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Alert template not found." }, { status: 404 });
      template = data;
      if (!resolvedAlertCode && data.code) resolvedAlertCode = String(data.code);
    } else if (resolvedAlertCode) {
      template = await resolveTemplateByCode(supabase, resolvedAlertCode);
      if (template?.id) resolvedTemplateId = Number(template.id);
    }

    if (!resolvedAlertCode && !resolvedTemplateId) {
      return NextResponse.json({ error: "alert_code or alert_template_id is required" }, { status: 400 });
    }

    const insertPayload: Record<string, unknown> = {
      reservation_id: params.id,
      alert_code: resolvedAlertCode || null,
      note: note ? String(note) : null,
      alert_template_id: resolvedTemplateId,
      custom_message: custom_message ? String(custom_message).trim() : null,
      display_surfaces: display_surfaces === undefined
        ? null
        : normalizeDisplaySurfaces(display_surfaces, template?.display_surfaces ?? ["reservation"]),
      severity: severity === undefined
        ? normalizeAlertSeverity(template?.severity ?? "info")
        : normalizeAlertSeverity(severity),
      is_dismissed: false,
      created_by: created_by ? String(created_by).trim() : null,
    };

    const { data, error } = await supabase
      .from("reservation_alerts")
      .insert(insertPayload)
      .select(ALERT_SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Alert already added to this reservation" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, alert: mapEffectiveReservationAlert(data) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─── PATCH /api/bookings/[id]/alerts ───────────────────────
   Dismiss / restore or update one alert
─────────────────────────────────────────────────────────── */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const { alert_id, action, custom_message, display_surfaces, severity, note } = await request.json();
    if (!alert_id) {
      return NextResponse.json({ error: "alert_id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (action === "dismiss") updates.is_dismissed = true;
    else if (action === "restore") updates.is_dismissed = false;
    if (custom_message !== undefined) updates.custom_message = custom_message ? String(custom_message).trim() : null;
    if (display_surfaces !== undefined) updates.display_surfaces = normalizeDisplaySurfaces(display_surfaces);
    if (severity !== undefined) updates.severity = normalizeAlertSeverity(severity);
    if (note !== undefined) updates.note = note ? String(note).trim() : null;

    const { data, error } = await supabase
      .from("reservation_alerts")
      .update(updates)
      .eq("id", alert_id)
      .eq("reservation_id", params.id)
      .select(ALERT_SELECT)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Alert not found." }, { status: 404 });

    return NextResponse.json({ success: true, alert: mapEffectiveReservationAlert(data) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/* ─── DELETE /api/bookings/[id]/alerts ──────────────────────
   Remove an alert from a reservation
─────────────────────────────────────────────────────────── */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const { alert_id } = await request.json();

    if (!alert_id) {
      return NextResponse.json({ error: "alert_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("reservation_alerts")
      .delete()
      .eq("id", alert_id)
      .eq("reservation_id", params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
