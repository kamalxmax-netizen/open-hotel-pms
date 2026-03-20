import { isValidDateString, normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Context = {
  params: {
    type: string;
    id: string;
  };
};

async function requireAuditAccess(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  request: NextRequest
) {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  try {
    await assertAdminOrSupervisor(supabase, user.id);
  } catch (guardError) {
    const message = guardError instanceof Error ? guardError.message : "Forbidden";
    const status = message === "Forbidden" ? 403 : 500;
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: message }, { status }),
    };
  }

  return { ok: true as const, user };
}

function getActorName(raw: unknown): string {
  const profile = Array.isArray(raw) ? raw[0] : raw;
  const name = String((profile as { full_name?: string | null } | null)?.full_name ?? "").trim();
  return name || "System";
}

function toBusinessDateOrFallback(value: unknown, createdAt: string): string {
  if (isValidDateString(value)) return value;
  const parsed = new Date(createdAt);
  if (!Number.isNaN(parsed.getTime())) return toBangkokDateString(parsed);
  return toBangkokDateString();
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireAuditAccess(supabase, request);
    if (!auth.ok) return auth.response;

    const entityType = decodeURIComponent(String(context.params.type ?? "")).trim();
    const entityId = decodeURIComponent(String(context.params.id ?? "")).trim();
    if (!entityType || !entityId) {
      return NextResponse.json(
        { success: false, error: "Invalid entity path params." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("audit_logs")
      .select(
        "id, actor_user_id, action, entity_type, entity_id, before_json, after_json, source, note, business_date, created_at, profiles:actor_user_id(full_name)"
      )
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const history = ((data ?? []) as any[]).map((row) => {
      const createdAt = String(row.created_at ?? "");
      return {
        id: String(row.id),
        actor_user_id: row.actor_user_id ? String(row.actor_user_id) : null,
        actor_name: getActorName(row.profiles),
        action: String(row.action ?? ""),
        entity_type: String(row.entity_type ?? ""),
        entity_id: String(row.entity_id ?? ""),
        before_json: row.before_json ?? null,
        after_json: row.after_json ?? null,
        source: normalizeAuditSource(row.source ? String(row.source) : null),
        note: row.note ? String(row.note) : null,
        business_date: toBusinessDateOrFallback(row.business_date, createdAt),
        created_at: createdAt,
      };
    });

    return NextResponse.json({
      success: true,
      entity_type: entityType,
      entity_id: entityId,
      history,
    });
  } catch (err) {
    console.error("api/audit/entity/[type]/[id] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

