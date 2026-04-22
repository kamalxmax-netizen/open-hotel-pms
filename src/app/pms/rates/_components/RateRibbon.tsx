"use client";

import Link from "next/link";
import { OccupancyBlock } from "@/lib/rates/types";

export function RateRibbon({
  occupancy,
  days,
  otaAlertCount
}: {
  occupancy?: OccupancyBlock;
  days: string[];
  otaAlertCount: number;
}) {
  if (!occupancy || days.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todayOcc = occupancy.hotel_wide[today];

  return (
    <div className="flex flex-wrap items-center gap-4 bg-[var(--bg-surface)] p-4 rounded-2xl border border-[var(--border-default)] shadow-sm">
      
      {/* Today OCC */}
      {todayOcc && (
        <div className="flex flex-col border-r border-[var(--border-default)] pr-4">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Today's OCC</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-bold text-brand-600">{todayOcc.pct.toFixed(1)}%</span>
            <span className="text-xs text-[var(--text-secondary)] font-medium">({todayOcc.booked}/{todayOcc.total})</span>
          </div>
        </div>
      )}

      {/* OTA Sync Alert */}
      <Link href="/pms/ota-sync" className="flex items-center gap-3 px-4 py-2 rounded-xl transition hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] bg-[var(--bg-body)]">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-amber-600 dark:text-amber-500">
            <path d="M21.5 12H16c-.7 2-3 3-4.5 3S8 14 7.3 12H2.5" />
            <path d="M5.5 5.5A5 5 0 0 1 12 2c3.1 0 5.6 2.6 5.6 5.6" />
            <path d="M18.5 18.5A5 5 0 0 1 12 22c-3.1 0-5.6-2.6-5.6-5.6" />
            <path d="M12 2v20" />
          </svg>
          {otaAlertCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-[var(--bg-surface)]">
              {otaAlertCount > 99 ? "99+" : otaAlertCount}
            </span>
          )}
        </div>
        <div>
          <p className="text-sm font-bold text-[var(--text-primary)]">OTA Sync</p>
          <p className="text-[10px] text-[var(--text-muted)]">{otaAlertCount === 0 ? "All caught up" : `${otaAlertCount} pending tasks`}</p>
        </div>
      </Link>
    </div>
  );
}
