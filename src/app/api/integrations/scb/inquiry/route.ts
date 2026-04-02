import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { runScbInquiryForRequest } from "@/lib/scb/inquiry-runner";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  request_id: z.string().uuid().optional(),
  source: z.enum(["manual", "scheduled", "callback_retry"]).default("manual"),
});

export async function POST(request: NextRequest) {
  let supabase: ReturnType<typeof createServerSupabaseClient> | null = null;
  let requestIdForLog: string | null = null;
  let userIdForLog: string | null = null;
  let sourceForLog: "manual" | "scheduled" | "callback_retry" = "manual";
  try {
    supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    userIdForLog = user.id;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.request_id) {
      return NextResponse.json({ success: false, error: "request_id is required." }, { status: 400 });
    }
    sourceForLog = parsed.data.source;
    requestIdForLog = parsed.data.request_id;

    const { data: scbRequest, error: requestError } = await supabase
      .from("scb_payment_requests")
      .select("*")
      .eq("id", parsed.data.request_id)
      .maybeSingle();
    if (requestError) return NextResponse.json({ success: false, error: requestError.message }, { status: 500 });
    if (!scbRequest) return NextResponse.json({ success: false, error: "SCB request not found." }, { status: 404 });
    if (!scbRequest.partner_reference_no || !scbRequest.scb_order_id || !scbRequest.wallet_id) {
      return NextResponse.json({ success: false, error: "SCB request is missing partner reference / order id / wallet id." }, { status: 409 });
    }

    const result = await runScbInquiryForRequest({
      supabase: supabase as any,
      scbRequest,
      source: parsed.data.source,
      triggeredBy: user.id,
    });

    return NextResponse.json({ success: true, request: result.request, inquiry: result.inquiry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[SCB inquiry route:error]", message);
    if (supabase && requestIdForLog) {
      try {
        await supabase.from("scb_recheck_logs").insert({
          request_id: requestIdForLog,
          transaction_id: null,
          triggered_by: userIdForLog,
          source: sourceForLog,
          result_status: "failed",
          raw_payload: { error: message },
        });
      } catch (insertError) {
        console.error("[SCB inquiry route:error-log-failed]", insertError instanceof Error ? insertError.message : String(insertError));
      }
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
