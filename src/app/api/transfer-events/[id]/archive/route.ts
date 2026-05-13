import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import {
  fetchTransferAuditPaymentsByEvent,
  unlinkTransferAuditPayments,
} from "@/lib/transfer-audit-server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RouteParams = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const transferEventId = String(params.id ?? "").trim();
    if (!transferEventId) {
      return NextResponse.json({ success: false, error: "Transfer event id is required." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request, {
      allowRoles: ["admin", "supervisor", "frontdesk"],
    });
    if (auth.error) return auth.error;

    const { data: existingEvent, error: existingError } = await supabase
      .from("transfer_events")
      .select("id, status")
      .eq("id", transferEventId)
      .eq("source", "manual")
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existingEvent || String((existingEvent as any).status ?? "active") !== "active") {
      return NextResponse.json({ success: false, error: "Active transfer group was not found." }, { status: 404 });
    }

    const linkedRows = await fetchTransferAuditPaymentsByEvent(supabase, transferEventId);
    await unlinkTransferAuditPayments(supabase, linkedRows);

    const { error: archiveError } = await supabase
      .from("transfer_events")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        archived_by: auth.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transferEventId);

    if (archiveError) {
      return NextResponse.json({ success: false, error: archiveError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      transfer_event_id: transferEventId,
      restored_payment_count: linkedRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
