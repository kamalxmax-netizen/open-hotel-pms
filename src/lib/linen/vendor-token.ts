import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_TTL_HOURS = 72;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const tokenHits = new Map<string, { count: number; resetAt: number }>();

export class LinenVendorTokenError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function assertVendorTokenRateLimit(token: string) {
  const now = Date.now();
  const current = tokenHits.get(token);
  if (!current || current.resetAt <= now) {
    tokenHits.set(token, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT_MAX) {
    throw new LinenVendorTokenError("Too many requests. Please wait a minute and try again.", 429);
  }
  current.count += 1;
}

export async function createVendorToken(
  supabase: SupabaseClient,
  batchId: string,
  options: { vendorName?: string | null; baseUrl?: string } = {}
) {
  await supabase.from("laundry_vendor_tokens").update({ revoked: true }).eq("batch_id", batchId).eq("revoked", false);

  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("laundry_vendor_tokens")
    .insert({ batch_id: batchId, vendor_name: options.vendorName ?? null, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const token = String((data as any).token);
  return {
    token,
    url: `${options.baseUrl ?? ""}/linen-vendor/${token}`,
    expires_at: String((data as any).expires_at),
  };
}

export async function validateVendorToken(supabase: SupabaseClient, token: string) {
  assertVendorTokenRateLimit(token);

  const { data, error } = await supabase
    .from("laundry_vendor_tokens")
    .select("*, laundry_batches(*)")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new LinenVendorTokenError("Invalid token.", 401);
  if ((data as any).revoked) throw new LinenVendorTokenError("Token was revoked.", 401);
  if (String((data as any).expires_at) <= new Date().toISOString()) {
    throw new LinenVendorTokenError("Token expired.", 401);
  }

  return data as any;
}
