import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toInvoiceYearYY } from "@/lib/tax-invoice/utils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  yy: z.string().regex(/^\d{2}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      yy: request.nextUrl.searchParams.get("yy") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const yy = parsed.data.yy ?? toInvoiceYearYY();
    const { data, error } = await supabase.rpc("next_invoice_no", { p_yy: yy });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      yy,
      next_invoice_no: String(data ?? ""),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
