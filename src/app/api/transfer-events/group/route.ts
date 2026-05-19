import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { TRANSFER_AUDIT_WRITE_ROLES } from "@/lib/transfer-audit-auth";
import {
  bangkokDateFromIso,
  buildTransferAuditNote,
  parseTransferAuditDetail,
} from "@/lib/transfer-audit";
import {
  archiveTransferEventHeaders,
  buildTransferAuditFallbackLabel,
  linkTransferAuditPayments,
  validateTransferAuditSelection,
} from "@/lib/transfer-audit-server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const detailSchema = z.object({
  sender_name: z.string().trim().nullable().optional(),
  bank_ref: z.string().trim().nullable().optional(),
  transfer_at: z.string().trim(),
  note: z.string().trim().nullable().optional(),
}).passthrough();

const bodySchema = z.object({
  folio_payment_ids: z.array(z.string().uuid()).min(1).max(250),
  detail: detailSchema,
}).passthrough();

function includesClientAmount(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const keys = ["amount", "actual_amount", "folio_amount", "total_amount"];
  if (keys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) return true;
  const detail = body.detail;
  if (!detail || typeof detail !== "object") return false;
  const detailBody = detail as Record<string, unknown>;
  return keys.some((key) => Object.prototype.hasOwnProperty.call(detailBody, key));
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: [...TRANSFER_AUDIT_WRITE_ROLES],
    });
    if (auth.error) return auth.error;

    const rawBody = await request.json().catch(() => null);
    if (includesClientAmount(rawBody)) {
      return NextResponse.json(
        { success: false, error: "Transfer group amount is calculated from selected folio payments." },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid transfer group payload." }, { status: 400 });
    }

    const detail = parseTransferAuditDetail(parsed.data.detail);
    if (!detail.ok) {
      return NextResponse.json({ success: false, error: detail.error }, { status: 400 });
    }

    const selection = await validateTransferAuditSelection(supabase, parsed.data.folio_payment_ids, {
      allowMergeFromOtherEvents: true,
    });
    if (!selection.ok) {
      return NextResponse.json({ success: false, error: selection.error }, { status: 400 });
    }

    const fallbackLabel = await buildTransferAuditFallbackLabel(supabase, selection.rows);
    const syncedNote = buildTransferAuditNote({
      transferAt: detail.value.transferAt,
      senderName: detail.value.senderName,
      bankRef: detail.value.bankRef,
      fallbackLabel,
      totalAmount: selection.total,
    });

    const { data: eventRow, error: eventError } = await supabase
      .from("transfer_events")
      .insert({
        source: "manual",
        status: "active",
        paid_date: bangkokDateFromIso(detail.value.transferAt),
        sender_name: detail.value.senderName,
        transfer_at: detail.value.transferAt,
        amount: selection.total,
        bank_ref: detail.value.bankRef,
        note: detail.value.note,
        recorded_by: auth.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (eventError) {
      return NextResponse.json({ success: false, error: eventError.message }, { status: 500 });
    }

    const transferEventId = String((eventRow as any).id);
    await linkTransferAuditPayments(supabase, selection.rows, transferEventId, syncedNote);
    await archiveTransferEventHeaders(supabase, selection.foreignTransferEventIds, auth.user?.id ?? null);

    return NextResponse.json({
      success: true,
      transfer_event_id: transferEventId,
      amount: selection.total,
      note: syncedNote,
      merged_transfer_event_ids: selection.foreignTransferEventIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
