import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { isUiEventLogEmailAllowed } from "@/lib/ui-event-log-settings";

export const dynamic = "force-dynamic";

const MAX_METADATA_CHARS = 4000;

function skipUiEventLogsForStrictMode(request: NextRequest): boolean {
  if (process.env.NEXT_PUBLIC_EGRESS_STRICT_MODE === "false") return false;
  return request.headers.get("x-pms-ui-event-log-manual") !== "1";
}

const createLogSchema = z.object({
  pathname: z.string().trim().min(1).max(300),
  event_type: z.string().trim().min(1).max(80),
  event_name: z.string().trim().min(1).max(120),
  severity: z.enum(["info", "warning", "error"]).optional(),
  entity_type: z.string().trim().max(80).optional().nullable(),
  entity_id: z.string().trim().max(120).optional().nullable(),
  request_id: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(1000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function sanitizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_METADATA_CHARS) return value;
    return {
      truncated: true,
      preview: json.slice(0, MAX_METADATA_CHARS),
    };
  } catch {
    return { invalid_metadata: true };
  }
}

function shouldBypassCaptureEmailFilter(eventType: string): boolean {
  return eventType === "auth_activity";
}

export async function POST(request: NextRequest) {
  if (skipUiEventLogsForStrictMode(request)) {
    return NextResponse.json({ success: true, skipped: true, reason: "egress_strict_mode" });
  }

  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const parsed = createLogSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data: hotelSettings } = await supabase
    .from("hotel_settings")
    .select("ui_event_log_capture_emails")
    .eq("id", 1)
    .maybeSingle();

  if (
    !shouldBypassCaptureEmailFilter(parsed.data.event_type) &&
    !isUiEventLogEmailAllowed(user.email ?? null, hotelSettings?.ui_event_log_capture_emails)
  ) {
    return NextResponse.json({ success: true, skipped: true });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, full_name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("ui_event_logs").insert({
    actor_user_id: user.id,
    actor_name: String(profile?.display_name ?? profile?.full_name ?? "").trim() || null,
    actor_email: String(user.email ?? "").trim().toLowerCase() || null,
    actor_role: String(profile?.role ?? "").trim().toLowerCase() || null,
    pathname: parsed.data.pathname,
    event_type: parsed.data.event_type,
    event_name: parsed.data.event_name,
    severity: parsed.data.severity ?? "info",
    entity_type: parsed.data.entity_type ?? null,
    entity_id: parsed.data.entity_id ?? null,
    request_id: parsed.data.request_id ?? null,
    message: parsed.data.message ?? null,
    metadata: sanitizeMetadata(parsed.data.metadata),
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
