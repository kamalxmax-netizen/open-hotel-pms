import { createBrowserClient } from "@supabase/ssr";
import { navigatorLock, type LockFunc } from "@supabase/auth-js";

// Use globalThis instead of a module-level variable so the singleton survives
// Next.js HMR reloads. Without this, HMR resets the module variable to null
// while the old GoTrueClient still holds the Navigator LockManager lock,
// causing "timed out waiting 10000ms" errors in the dev console.
const globalStore = globalThis as typeof globalThis & {
  __supabaseBrowserClient?: ReturnType<typeof createBrowserClient>;
};

/**
 * Browser-side Supabase client via @supabase/ssr.
 * Stores session in cookies (not localStorage) so Next.js middleware
 * can read it server-side for route protection.
 */
export function createBrowserSupabaseClient() {
  if (globalStore.__supabaseBrowserClient) {
    return globalStore.__supabaseBrowserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const configuredTimeout = Number(process.env.NEXT_PUBLIC_SUPABASE_LOCK_TIMEOUT_MS ?? "");
  const lockAcquireTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 0
    ? Math.trunc(configuredTimeout)
    : 30000;
  const lockWithExtendedTimeout: LockFunc = (name, acquireTimeout, fn) =>
    navigatorLock(name, Math.max(acquireTimeout, lockAcquireTimeoutMs), fn);
  const shouldBypassBrowserLock =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_SUPABASE_DISABLE_BROWSER_LOCK === "true";
  const lockFunc: LockFunc = shouldBypassBrowserLock
    ? async (_name, _acquireTimeout, fn) => fn()
    : lockWithExtendedTimeout;

  globalStore.__supabaseBrowserClient = createBrowserClient(url, anonKey, {
    auth: {
      lock: lockFunc,
    },
  });
  return globalStore.__supabaseBrowserClient;
}
