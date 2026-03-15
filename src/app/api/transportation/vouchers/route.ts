import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  transfer_id: z.string().uuid("transfer_id must be a valid UUID"),
});

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      transfer_id: request.nextUrl.searchParams.get("transfer_id") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: parsedQuery.error.issues[0]?.message ?? "Invalid transfer_id." },
        { status: 400 }
      );
    }

    const transferId = parsedQuery.data.transfer_id;
    const supabase = createServerSupabaseClient();
    const { data: voucher, error } = await supabase
      .from("transfer_vouchers")
      .select("*")
      .eq("transfer_id", transferId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!voucher) {
      return NextResponse.json({ success: false, error: "Voucher not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, voucher });
  } catch (err) {
    console.error("transportation/vouchers GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
