import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AbbreviatedTaxInvoiceError } from "@/lib/abbreviated-tax-invoice/service";
import { MonthlyAuditChannelFlagError } from "@/lib/monthly-audit-channel-flag/service";
import { NextRequest, NextResponse } from "next/server";

export async function requireAbbreviatedTaxActor(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  await assertAdminOrSupervisor(supabase, user.id);
  return { ok: true as const, supabase, user };
}

export function abbreviatedTaxErrorResponse(err: unknown) {
  if (err instanceof AbbreviatedTaxInvoiceError || err instanceof MonthlyAuditChannelFlagError) {
    return NextResponse.json({ success: false, error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  const status = message === "Forbidden" ? 403 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}
