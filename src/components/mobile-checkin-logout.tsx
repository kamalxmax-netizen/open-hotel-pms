"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function MobileCheckinLogout() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    const confirmed = window.confirm("Log out of Mobile Check-in?");
    if (!confirmed) return;

    setLoggingOut(true);
    try {
      if (typeof window !== "undefined") {
        Object.keys(window.sessionStorage).forEach((key) => {
          if (key.startsWith("mobile-checkin-")) window.sessionStorage.removeItem(key);
        });
      }
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="px-6 pt-20 pb-12">
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="mx-auto block rounded-full border border-[var(--border-subtle)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] opacity-55 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
      >
        {loggingOut ? "Logging out..." : "Log out"}
      </button>
    </div>
  );
}
