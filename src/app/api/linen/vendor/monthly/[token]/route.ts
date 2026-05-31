import { getMonthlyMegaGrid } from "@/lib/linen/monthly";
import {
  LinenMonthlyVendorTokenError,
  validateMonthlyVendorToken,
} from "@/lib/linen/monthly-vendor-token";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function monthlyVendorError(error: unknown, fallback: string) {
  const status = error instanceof LinenMonthlyVendorTokenError ? error.status : 500;
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = createServerSupabaseClient();
    const tokenRow = await validateMonthlyVendorToken(supabase, params.token);
    const [{ data: settings }, grid] = await Promise.all([
      supabase.from("hotel_settings").select("hotel_name, company_name").limit(1).maybeSingle(),
      getMonthlyMegaGrid(supabase, Number(tokenRow.year), Number(tokenRow.month), { includeRw: false }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        meta: {
          hotel_name: String((settings as any)?.hotel_name ?? (settings as any)?.company_name ?? "Hotel"),
          vendor_name: tokenRow.vendor_name,
          year: Number(tokenRow.year),
          month: Number(tokenRow.month),
          generated_at: tokenRow.created_at,
          expires_at: tokenRow.expires_at,
        },
        grid,
      },
    });
  } catch (error) {
    console.error("api/linen/vendor/monthly/[token] GET failed", error);
    return monthlyVendorError(error, "Failed to load monthly vendor linen statement.");
  }
}
