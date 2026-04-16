import { vendorDisputeBatch } from "@/lib/linen/batch-service";
import { validateVendorToken, LinenVendorTokenError } from "@/lib/linen/vendor-token";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function vendorError(error: unknown, fallback: string) {
  const status = error instanceof LinenVendorTokenError ? error.status : 500;
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const body = await request.json().catch(() => ({}));
    const tokenRow = await validateVendorToken(supabase, params.token);
    const data = await vendorDisputeBatch(
      supabase,
      String(tokenRow.batch_id),
      typeof body.note === "string" ? body.note : null,
      typeof body.actor_name === "string" ? body.actor_name : null
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/vendor/[token]/dispute POST failed", error);
    return vendorError(error, "Failed to dispute linen batch.");
  }
}
