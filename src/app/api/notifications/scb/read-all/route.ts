import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const [{ data: notifications, error: notificationsError }, { data: existingReads, error: readsError }] = await Promise.all([
      supabase.from("scb_payment_notifications").select("id"),
      supabase.from("scb_notification_reads").select("notification_id").eq("user_id", user.id),
    ]);
    if (notificationsError || readsError) {
      return NextResponse.json({ success: false, error: notificationsError?.message || readsError?.message || "Failed to load notifications." }, { status: 500 });
    }

    const existing = new Set((existingReads ?? []).map((row: any) => String(row.notification_id)));
    const toInsert = (notifications ?? [])
      .map((row: any) => String(row.id))
      .filter((id) => !existing.has(id))
      .map((notificationId) => ({
        user_id: user.id,
        notification_id: notificationId,
      }));

    if (toInsert.length > 0) {
      const { error } = await supabase
        .from("scb_notification_reads")
        .upsert(toInsert, { onConflict: "user_id,notification_id", ignoreDuplicates: true });
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
