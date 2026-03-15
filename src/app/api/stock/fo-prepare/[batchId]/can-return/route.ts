import { checkFoCanReturn, getFoPrepareBatchDetail } from "@/lib/fo-prepare";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  batchId: z.string().uuid("Invalid batch id"),
});

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  _request: Request,
  { params }: { params: { batchId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid batch id" },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const detail = await getFoPrepareBatchDetail(supabase, parsedParams.data.batchId);
    if (!detail) {
      return NextResponse.json({ success: false, error: "Batch not found." }, { status: 404 });
    }

    const canReturn = await checkFoCanReturn(supabase, detail.batch.business_date);
    return NextResponse.json({
      success: true,
      business_date: detail.batch.business_date,
      can_return: canReturn,
    });
  } catch (err) {
    console.error("stock/fo-prepare/[batchId]/can-return GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
