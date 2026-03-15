import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

const idSchema = z.string().uuid("Invalid transfer id");

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid transfer id." },
        { status: 400 }
      );
    }

    const transferId = parsedId.data;
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
    console.error("transportation/vouchers/:id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
