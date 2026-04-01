import type { SupabaseClient } from "@supabase/supabase-js";

export async function insertScbNotification(params: {
  supabase: SupabaseClient;
  transactionId: string;
  targetType: "reservation" | "pos_order";
  targetId: string;
  title: string;
  body: string;
}) {
  const { supabase, transactionId, targetType, targetId, title, body } = params;
  const { error } = await supabase.from("scb_payment_notifications").insert({
    transaction_id: transactionId,
    target_type: targetType,
    target_id: targetId,
    title,
    body,
  });
  if (error) {
    throw new Error(error.message);
  }
}
