import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _cachedClient: SupabaseClient | null = null;

export function createServerSupabaseClient(): SupabaseClient {
  if (_cachedClient) return _cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  _cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return _cachedClient;
}
