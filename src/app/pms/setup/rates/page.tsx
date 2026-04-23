"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function RateSetupPage() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    async function loadRole() {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data } = await supabase.from("profiles").select("role").eq("user_id", session.user.id).single();
      if (data) setRole(data.role);
    }
    loadRole();
  }, []);

  const CARDS = [
    {
      href: "/pms/rates/plans",
      title: "Rate Plans",
      description: "Manage public, tier-based, and special profile pricing plans.",
      accent: "bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-300",
    },
    {
      href: "/pms/rates",
      title: "Rate Grid",
      description: "Review daily room-type pricing and availability rules.",
      accent: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300",
    },
    {
      href: "/pms/ota-sync",
      title: "OTA Sync",
      description: "Manage pending sync tasks for OTA channels like Booking.com.",
      accent: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300",
    }
  ];

  if (role === "admin" || role === "supervisor") {
    CARDS.push({
      href: "/pms/setup/rates/dynamic",
      title: "Dynamic Rules",
      description: "Configure automated rule groups for occupancy-based pricing.",
      accent: "bg-violet-50 border-violet-200 text-violet-800 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-300",
    });
  }

  if (role === "admin") {
    CARDS.push({
      href: "/pms/setup/rates/admin",
      title: "Admin Settings",
      description: "Configure rate floors, delta warnings, and OTA alarm thresholds.",
      accent: "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300",
    });
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Setup</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Rate Setup</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Pricing configuration, rate plans, and room-type rate controls.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className={`rounded-2xl border p-5 transition hover:shadow-md ${card.accent}`}>
            <div className="space-y-2">
              <h2 className="text-lg font-bold">{card.title}</h2>
              <p className="text-sm opacity-80">{card.description}</p>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Open Module</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
