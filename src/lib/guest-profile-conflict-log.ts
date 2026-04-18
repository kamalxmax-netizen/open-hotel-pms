import { normalizeAuditSource, toBangkokDateString } from "@/lib/audit-utils";

type SupabaseLike = {
  from: (table: string) => any;
};

export type GuestProfileConflictLogContext = {
  sourceFlow: string;
  actorUserId?: string | null;
  reservationId?: string | null;
  attemptedProfileId?: string | null;
  resolvedProfileId: string;
  documentType?: string | null;
  documentNumber?: string | null;
  businessDate?: string | null;
  source?: string | null;
  terminalId?: string | null;
  userAgent?: string | null;
  retryCount?: number | null;
  note?: string | null;
  resolvedProfileSnapshot?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function sanitizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function maskGuestDocumentNumber(value: unknown): string | null {
  const text = sanitizeText(value);
  if (!text) return null;
  if (text.length <= 2) return "*".repeat(text.length);
  if (text.length <= 4) return `${text.slice(0, 1)}${"*".repeat(Math.max(1, text.length - 2))}${text.slice(-1)}`;
  return `${text.slice(0, 2)}${"*".repeat(Math.max(2, text.length - 4))}${text.slice(-2)}`;
}

function sanitizeSnapshot(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const entries = Object.entries(snapshot).filter(([, value]) => value != null && value !== "");
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

export async function logGuestProfileConflictEvent(
  supabase: SupabaseLike,
  context: GuestProfileConflictLogContext
): Promise<void> {
  const resolvedProfileId = sanitizeText(context.resolvedProfileId);
  const sourceFlow = sanitizeText(context.sourceFlow);
  if (!resolvedProfileId || !sourceFlow) return;

  const businessDate = sanitizeText(context.businessDate) ?? toBangkokDateString();
  const documentType = sanitizeText(context.documentType);
  const documentMasked = maskGuestDocumentNumber(context.documentNumber);
  const retryCount = Number.isFinite(Number(context.retryCount)) && Number(context.retryCount) >= 0
    ? Math.trunc(Number(context.retryCount))
    : 1;
  const note = sanitizeText(context.note) ?? "Guest profile rerouted after duplicate document conflict.";
  const metadata = {
    ...(context.metadata ?? {}),
    source_flow: sourceFlow,
    terminal_id: sanitizeText(context.terminalId),
    user_agent: sanitizeText(context.userAgent),
    retry_count: retryCount,
    resolved_profile_snapshot: sanitizeSnapshot(context.resolvedProfileSnapshot),
  };

  try {
    const { error } = await supabase.from("guest_profile_conflict_events").insert({
      actor_user_id: sanitizeText(context.actorUserId),
      reservation_id: sanitizeText(context.reservationId),
      attempted_profile_id: sanitizeText(context.attemptedProfileId),
      resolved_profile_id: resolvedProfileId,
      source_flow: sourceFlow,
      document_type: documentType,
      document_masked: documentMasked,
      business_date: businessDate,
      retry_count: retryCount,
      terminal_id: sanitizeText(context.terminalId),
      user_agent: sanitizeText(context.userAgent),
      metadata,
    });
    if (error) {
      console.error("guest_profile_conflict_events insert failed", error);
    }
  } catch (error) {
    console.error("guest_profile_conflict_events insert threw", error);
  }

  try {
    const { error } = await supabase.from("audit_logs").insert({
      actor_user_id: sanitizeText(context.actorUserId),
      action: "guest_profile_duplicate_reroute",
      entity_type: "guest_profile",
      entity_id: resolvedProfileId,
      business_date: businessDate,
      source: normalizeAuditSource(context.source ?? "manual"),
      note,
      before_json: {
        attempted_profile_id: sanitizeText(context.attemptedProfileId),
      },
      after_json: {
        reservation_id: sanitizeText(context.reservationId),
        resolved_profile_id: resolvedProfileId,
        source_flow: sourceFlow,
        document_type: documentType,
        document_masked: documentMasked,
        retry_count: retryCount,
        terminal_id: sanitizeText(context.terminalId),
      },
    });
    if (error) {
      console.error("guest profile duplicate audit insert failed", error);
    }
  } catch (error) {
    console.error("guest profile duplicate audit insert threw", error);
  }
}
