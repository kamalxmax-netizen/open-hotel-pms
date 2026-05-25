import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { isUiEventLogEmailAllowed } from "@/lib/ui-event-log-settings";

export const dynamic = "force-dynamic";

const MAX_BATCH_EVENTS = 200;
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

const batchSchema = z.object({
  events: z.array(createLogSchema).min(1).max(MAX_BATCH_EVENTS),
});

type UiEventPayload = z.infer<typeof createLogSchema>;

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

function filterEventsForCapture(events: UiEventPayload[], actorEmail: string | null, captureEmails: unknown) {
  const emailAllowed = isUiEventLogEmailAllowed(actorEmail, captureEmails);
  return events.filter((event) => shouldBypassCaptureEmailFilter(event.event_type) || emailAllowed);
}

export async function POST(request: NextRequest) {
  if (skipUiEventLogsForStrictMode(request)) {
    return NextResponse.json({ success: true, skipped: true, reason: "egress_strict_mode" });
  }

  const parsed = batchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  const { data: hotelSettings } = await supabase
    .from("hotel_settings")
    .select("ui_event_log_capture_emails")
    .eq("id", 1)
    .maybeSingle();

  const eventsToInsert = filterEventsForCapture(
    parsed.data.events,
    user.email ?? null,
    hotelSettings?.ui_event_log_capture_emails
  );

  if (eventsToInsert.length === 0) {
    return NextResponse.json({
      success: true,
      skipped: true,
      accepted: parsed.data.events.length,
      inserted: 0,
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, full_name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  const actorName = String(profile?.display_name ?? profile?.full_name ?? "").trim() || null;
  const actorEmail = String(user.email ?? "").trim().toLowerCase() || null;
  const actorRole = String(profile?.role ?? "").trim().toLowerCase() || null;
  const rows = eventsToInsert.map((event) => ({
    actor_user_id: user.id,
    actor_name: actorName,
    actor_email: actorEmail,
    actor_role: actorRole,
    pathname: event.pathname,
    event_type: event.event_type,
    event_name: event.event_name,
    severity: event.severity ?? "info",
    entity_type: event.entity_type ?? null,
    entity_id: event.entity_id ?? null,
    request_id: event.request_id ?? null,
    message: event.message ?? null,
    metadata: sanitizeMetadata(event.metadata),
  }));

  const { error } = await supabase.from("ui_event_logs").insert(rows);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    accepted: parsed.data.events.length,
    inserted: rows.length,
    skipped: parsed.data.events.length - rows.length,
  });
}
