import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const receiptId = String(params.id ?? "").trim();
    if (!receiptId) {
      return NextResponse.json({ success: false, error: "Missing receipt id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("receipts")
      .select("id, receipt_no, reservation_id, guest_name, room_numbers, grand_total, language, printed_at, printed_by, note, created_at")
      .eq("id", receiptId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "Receipt not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, receipt: data, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
