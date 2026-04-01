import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  note: z.string().trim().min(1),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const role = await getUserRole(supabase, user.id);
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Ignore note is required.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: transactionRow, error: transactionError } = await supabase
      .from("scb_payment_transactions")
      .select("id, request_id, raw_payload, transaction_id")
      .eq("id", params.id)
      .maybeSingle();
    if (transactionError) {
      return NextResponse.json({ success: false, error: transactionError.message }, { status: 500 });
    }
    if (!transactionRow) {
      return NextResponse.json({ success: false, error: "Transaction not found." }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from("scb_payment_transactions")
      .update({
        match_status: "ignored",
        processed_at: new Date().toISOString(),
      })
      .eq("id", params.id);
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    if (transactionRow.request_id) {
      await supabase
        .from("scb_payment_requests")
        .update({
          status: "cancelled",
          error_message: `Ignored: ${parsed.data.note}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", transactionRow.request_id)
        .in("status", ["unmatched", "pending"]);
    }

    await supabase.from("scb_recheck_logs").insert({
      request_id: transactionRow.request_id ?? null,
      transaction_id: String(transactionRow.transaction_id),
      triggered_by: user.id,
      source: "manual",
      result_status: `ignored:${parsed.data.note}`,
      raw_payload: transactionRow.raw_payload ?? {},
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
