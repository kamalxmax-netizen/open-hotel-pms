import type { SupabaseClient } from "@supabase/supabase-js";

export async function reopenLinenMonth(
  supabase: SupabaseClient,
  params: { year: number; month: number; reason: string; actorUserId: string }
) {
  const { data, error } = await (supabase as any).rpc("fn_linen_monthly_reopen", {
    p_year: params.year,
    p_month: params.month,
    p_reason: params.reason,
    p_actor: params.actorUserId,
  });

  if (error) throw new Error(error.message);
  return data as { success: boolean; close: unknown; log_id?: number; error?: string };
}
