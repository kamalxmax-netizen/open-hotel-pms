import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function decrementLoanItemStock(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  code: string,
  qty: number
) {
  if (!code || qty <= 0) return;

  const { data: item, error } = await supabase
    .from("loan_items")
    .select("available")
    .eq("code", code)
    .single();

  if (error || !item) {
    throw new Error("Loan item not found");
  }
  if (item.available < qty) {
    throw new Error(`Not enough stock. Available: ${item.available}`);
  }

  const { error: updateError } = await supabase
    .from("loan_items")
    .update({ available: item.available - qty })
    .eq("code", code);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function restoreLoanItemStock(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  code: string,
  qty: number
) {
  if (!code || qty <= 0) return;

  const { data: item, error } = await supabase
    .from("loan_items")
    .select("available, total_qty")
    .eq("code", code)
    .single();

  if (error || !item) {
    throw new Error("Loan item not found");
  }

  const nextAvailable = Math.min(
    Number(item.available ?? 0) + qty,
    Number(item.total_qty ?? 0) || Number(item.available ?? 0) + qty
  );

  const { error: updateError } = await supabase
    .from("loan_items")
    .update({ available: nextAvailable })
    .eq("code", code);

  if (updateError) {
    throw new Error(updateError.message);
  }
}
