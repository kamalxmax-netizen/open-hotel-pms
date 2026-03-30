"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import { DashboardKPI } from "@/lib/types";
import { formatDateDisplay } from "@/lib/date-display";

// Keep PreviewItem and EodStatus locally for now since they are not in types.ts
type PreviewItem = {
  id: string;
  guest_name: string;
  source?: string;
  checkin_time?: string | null;
  total_price: number;
};

type PickedDashboardKPI = DashboardKPI & {
  arrivals_preview?: PreviewItem[];
  departures_preview?: PreviewItem[];
};

type DashboardDataResponse = {
  success: boolean;
  data: PickedDashboardKPI;
};

// We probably can't get traces directly from KPI route anymore based on instructions, 
// so leaving it as a separate fetch if needed. We will prioritize the spec layout.

function fmt(n: number | undefined) {
  if (n === undefined) return "0";
  return n.toLocaleString("th-TH");
}

function formatB(val: number | undefined) {
  if (val === undefined) return "฿0.00";
  return "฿" + val.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatTile({
  label,
  value,
  sub,
  color,
  href
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  href?: string;
}) {
  const inner = (
    <div className={`stat-card border-l-4 ${color} hover:shadow-md transition bg-[var(--bg-surface)] p-4 rounded-xl shadow-sm h-full dark:border-white/5`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{label}</p>
      <p className="text-3xl font-extrabold text-[var(--text-primary)] mt-2">{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export default function DashboardPage() {
  const [data, setData] = useState<PickedDashboardKPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tracesData, setTracesData] = useState<any>(null);
  const [optionsRes, setOptionsRes] = useState<{ id: string, name: string, cin: string, cout: string } | null>(null);

  useEffect(() => {
    // 1. Fetch main KPI data
    fetch("/api/dashboard/kpi")
      .then((r) => r.json())
      .then((d: DashboardDataResponse) => {
        if (d.success) setData(d.data);
        else setError("Could not load dashboard KPI data.");
      })
      .catch(() => setError("Network error fetching KPI data."))
      .finally(() => setLoading(false));

    // 2. Fetch open traces today (Keeping this existing functionality)
    fetch("/api/traces/today")
      .then((r) => r.json())
      .then((d) => { if (d.success) setTracesData(d); })
      .catch(() => { });
  }, []);

  const today = new Date().toLocaleDateString("th-TH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  // Helper for Occupancy Color
  const getOccColor = (pct: number) => {
    if (pct >= 70) return "border-emerald-400 text-emerald-700 bg-emerald-50";
    if (pct >= 40) return "border-amber-400 text-amber-700 bg-amber-50";
    return "border-rose-400 text-rose-700 bg-rose-50";
  };
  
  const getOccSimpleColor = (pct: number) => {
    if (pct >= 70) return "border-emerald-500";
    if (pct >= 40) return "border-amber-500";
    return "border-rose-500";
  };

  const getSourceColor = (src: string) => {
    switch (src.toLowerCase()) {
      case 'walkin': return 'bg-brand-500';
      case 'direct': return 'bg-sky-500';
      case 'ota': return 'bg-amber-500';
      case 'agent': return 'bg-emerald-500';
      default: return 'bg-slate-500';
    }
  };

  const getMethodColor = (method: string) => {
    switch (method.toLowerCase()) {
      case 'cash': return 'bg-emerald-500';
      case 'transfer': return 'bg-brand-500';
      case 'credit_card': return 'bg-sky-500';
      case 'other': return 'bg-slate-400';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto w-full">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Dashboard</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{today}</p>
      </div>

      {/* Row 1: EOD Alert */}
      {data?.needs_eod && (
        <Link href="/pms/night-audit">
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-100/50 transition border-l-4 shadow-sm dark:bg-amber-500/10 dark:border-amber-500/20 dark:border-l-amber-500">
            <div>
              <p className="text-sm font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2">
                <span>⚠️</span> Night Audit pending
              </p>
              <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-500/80">
                Business Date: <strong>{data.business_date}</strong>
                {" · "}Calendar: <strong>{data.calendar_date}</strong>
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 shrink-0 bg-[var(--bg-surface)] dark:bg-amber-500/20 px-2 py-1 rounded shadow-sm">Run Night Audit →</span>
          </div>
        </Link>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[var(--bg-surface)] p-4 rounded-xl shadow-sm animate-pulse h-28 border border-[var(--border-subtle)]" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Row 2: KPI Row */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Occupancy %"
              value={`${data.live.occupancy_pct.toFixed(0)}%`}
              color={getOccSimpleColor(data.live.occupancy_pct)}
              sub={`${data.live.in_house} / ${data.live.sellable_rooms} sellable rooms`}
            />
             <StatTile
              label="ADR"
              value={formatB(data.revenue.adr)}
              color="border-sky-400"
              sub="Average Daily Rate"
            />
            <StatTile
              label="RevPAR"
              value={formatB(data.revenue.revpar)}
              color="border-violet-400"
              sub="Revenue per Available Rm"
            />
            <StatTile
              label="Revenue Today"
              value={formatB(data.revenue.total)}
              color="border-emerald-400"
              sub="Total Accrual Revenue"
            />
          </div>

          {/* Row 3: Movement Badges */}
          <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-4 dark:border-white/5">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">Live Front Desk Operations</h2>
            <div className="flex flex-wrap gap-2 md:gap-4">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg border border-brand-200 text-sm dark:bg-brand-500/10 dark:text-brand-400 dark:border-brand-500/20">
                 <span className="font-semibold">Arrivals:</span> 
                 <span className="font-bold">{data.live.arrivals_checked_in}/{data.live.arrivals}</span>
              </div>
               <div className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg border border-sky-200 text-sm dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20">
                 <span className="font-semibold">Departures:</span> 
                 <span className="font-bold">{data.live.departures_checked_out}/{data.live.departures}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-muted)] text-[var(--text-table-cell)] rounded-lg border border-[var(--border-default)] text-sm dark:bg-white/5 dark:border-white/10">
                 <span className="font-semibold">In-house:</span> 
                 <span className="font-bold">{data.live.in_house}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg border border-rose-200 text-sm dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
                 <span className="font-semibold">No-show Pending:</span> 
                 <span className="font-bold">{data.live.no_show_pending}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 text-sm dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                 <span className="font-semibold">Dirty Rooms:</span> 
                 <span className="font-bold">{data.live.dirty_rooms}</span>
                 <Link href="/pms/board" className="ml-1 text-[10px] uppercase text-amber-600 dark:text-amber-400 hover:underline">View</Link>
              </div>
            </div>
          </div>

          {/* Row 4: Two-column Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Cash Received By Method */}
            <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Cash Received Today</h2>
              <div className="space-y-4">
                 {[
                   { label: 'Bank Transfer', val: data.payments.transfer || 0, key: 'transfer' },
                   { label: 'Cash', val: data.payments.cash || 0, key: 'cash' },
                   { label: 'Credit Card', val: data.payments.credit_card || 0, key: 'credit_card' },
                   { label: 'Other', val: data.payments.other || 0, key: 'other' },
                 ]
                 .sort((a,b) => b.val - a.val)
                 .filter(item => item.val > 0)
                 .map(item => {
                    const max = Math.max(0.01, data.payments.total || 0.01); // Prevent division by zero
                    const pct = Math.round((item.val / max) * 100);
                    return (
                      <div key={item.key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-[var(--text-table-cell)]">{item.label}</span>
                          <span className="font-bold text-[var(--text-primary)]">{formatB(item.val)} <span className="text-[var(--text-muted)] font-normal">({pct}%)</span></span>
                        </div>
                        <div className="w-full bg-[var(--bg-muted)] dark:bg-white/5 rounded-full h-2.5">
                          <div className={`${getMethodColor(item.key)} h-2.5 rounded-full dark:opacity-80`} style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    )
                 })}
                 {(data.payments.total || 0) === 0 && (
                   <div className="text-sm text-[var(--text-muted)] py-6 text-center italic border border-dashed border-[var(--border-default)] rounded-lg bg-[var(--bg-body)]">
                     No payments received yet.
                   </div>
                 )}
              </div>
            </div>

            {/* Revenue By Source */}
            <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Revenue by Source</h2>
               <div className="space-y-4">
                 {Object.entries(data.revenue.by_source || {})
                 .sort(([, a], [, b]) => b.revenue - a.revenue)
                 .map(([source, stats]) => {
                    return (
                      <div key={source}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-[var(--text-table-cell)] capitalize">{source} <span className="text-[var(--text-muted)] font-normal ml-1">({stats.nights} nights)</span></span>
                          <span className="font-bold text-[var(--text-primary)]">{formatB(stats.revenue)} <span className="text-[var(--text-muted)] font-normal">({stats.pct.toFixed(0)}%)</span></span>
                        </div>
                        <div className="w-full bg-[var(--bg-muted)] dark:bg-white/5 rounded-full h-2.5">
                          <div className={`${getSourceColor(source)} h-2.5 rounded-full dark:opacity-80`} style={{ width: `${stats.pct}%` }}></div>
                        </div>
                      </div>
                    )
                 })}
                 {(!data.revenue.by_source || Object.keys(data.revenue.by_source).length === 0) && (
                   <div className="text-sm text-[var(--text-muted)] py-6 text-center italic border border-dashed border-[var(--border-default)] rounded-lg bg-[var(--bg-body)]">
                     No revenue recorded yet.
                   </div>
                 )}
              </div>
            </div>
          </div>

          {/* Row 5: 7-Day Trend */}
          <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-6">7-Day Revenue Trend</h2>
            
            {(!data.trend || data.trend.length === 0) ? (
              <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm italic border border-dashed border-[var(--border-default)] rounded-lg bg-[var(--bg-body)]">
                No data yet
              </div>
            ) : (
              <div className="flex items-end gap-2 h-48 mt-4 pt-4 border-t border-[var(--border-subtle)]">
                {data.trend.map((day, i) => {
                  // Find max revenue for scaling. Fallback to 1 if all 0 to avoid division by zero
                   const maxRev = Math.max(1, ...data.trend.map(d => d.revenue));
                   const heightPct = Math.max(5, (day.revenue / maxRev) * 100); // Give min height of 5% if > 0
                   const isWeekend = new Date(day.date).getDay() === 0 || new Date(day.date).getDay() === 6;
                   
                   return (
                     <div key={day.date} className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-crosshair">
                       {/* Tooltip on hover */}
                       <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-10 pointer-events-none shadow-lg">
                         <p className="font-bold">{formatB(day.revenue)}</p>
                         <p>Occ: {day.occupancy_pct.toFixed(0)}%</p>
                       </div>
                       
                       {/* Bar */}
                       <div 
                        className={`w-full max-w-[48px] rounded-t-sm transition-all duration-300 ease-out 
                                  ${isWeekend ? 'bg-brand-500' : 'bg-brand-400'} 
                                  group-hover:opacity-80 group-hover:scale-y-105 origin-bottom`}
                        style={{ height: `${heightPct}%` }}
                       />
                       
                       {/* Label */}
                       <div className="mt-2 text-[10px] text-[var(--text-secondary)] font-medium rotate-[-45deg] origin-top-left translate-y-2 translate-x-3 w-12 whitespace-nowrap">
                         {formatDateDisplay(day.date, { withYear: false })}
                       </div>
                     </div>
                   )
                })}
              </div>
            )}
            <div className="mt-8 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-brand-400 rounded-sm"></div> Weekday</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-brand-500 rounded-sm"></div> Weekend</div>
            </div>
          </div>

          {/* Row 6: Extras  */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
             <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-4 flex justify-between items-center group">
               <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] group-hover:text-brand-600 transition-colors">Transfer Services</p>
                  <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{formatB(data.extras.transfer_revenue)}</p>
               </div>
               <div className="text-right">
                 <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Margin</p>
                 <p className="text-sm font-bold text-emerald-700">{formatB(data.extras.transfer_margin)}</p>
               </div>
             </div>
             
             <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-4 group">
               <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] group-hover:text-brand-600 transition-colors">POS Revenue</p>
               <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{formatB(data.extras.pos_revenue)}</p>
             </div>

             <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] p-4 group">
               <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] group-hover:text-brand-600 transition-colors">Tips Logged</p>
               <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{formatB(data.extras.tip_total)}</p>
             </div>

             <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-rose-200 p-4 flex items-center justify-between group">
               <div>
                 <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] group-hover:text-rose-600 transition-colors">Day Use Revenue</p>
                 <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">{formatB(data.extras.dayuse_revenue)}</p>
               </div>
               <div className="text-right">
                 <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600">Sessions</p>
                 <p className="text-lg font-bold text-rose-700">{fmt(data.extras.dayuse_sessions)}</p>
               </div>
             </div>
          </div>

           {/* Quick lists (Arrivals/Departures/Traces from original UI down here now) */}
           <div className="grid gap-4 lg:grid-cols-3 pt-6 border-t mt-6">
            {/* Arrivals preview */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--text-table-cell)]">Arriving Today</h2>
                <Link href="/pms/arrivals" className="text-xs text-brand-600 hover:underline">
                  View all →
                </Link>
              </div>
              {!data.arrivals_preview || data.arrivals_preview.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center border border-dashed border-[var(--border-default)] rounded-lg bg-[var(--bg-body)] italic">No arrivals today</p>
              ) : (
                <div className="space-y-2 bg-[var(--bg-surface)]">
                  {data.arrivals_preview.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-[var(--bg-body)] px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{item.guest_name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {item.source?.toUpperCase()}
                          {item.checkin_time ? ` · C/I ${item.checkin_time}` : ""}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-[var(--text-table-cell)]">
                        {formatB(item.total_price)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Departures preview */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--text-table-cell)]">Departing Today</h2>
                <Link href="/pms/departures" className="text-xs text-brand-600 hover:underline">
                  View all →
                </Link>
              </div>
              {!data.departures_preview || data.departures_preview.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center border border-dashed border-[var(--border-default)] rounded-lg bg-[var(--bg-body)] italic">No departures today</p>
              ) : (
                <div className="space-y-2 bg-[var(--bg-surface)]">
                  {data.departures_preview.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-lg bg-[var(--bg-body)] px-3 py-2.5">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{item.guest_name}</p>
                      <span className="text-sm font-semibold text-[var(--text-table-cell)]">
                         {formatB(item.total_price)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Open Traces Today */}
            <div className="card p-4 border-amber-200 bg-amber-50/20 dark:border-amber-500/20 dark:bg-amber-500/5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5 text-amber-900 dark:text-amber-400">
                  <span className="text-lg">📋</span> Open Traces Today
                  {tracesData?.total > 0 && (
                    <span className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1">
                      {tracesData.total}
                    </span>
                  )}
                </h2>
              </div>
              {!tracesData ? (
                <div className="animate-pulse h-20 bg-[var(--bg-surface)]/50 rounded-lg"></div>
              ) : tracesData.total === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center border border-dashed border-amber-200 rounded-lg bg-amber-50/50 italic">No open traces today</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {tracesData.traces.map((t: any) => (
                    <div
                      key={t.id}
                      className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-3 hover:border-amber-300 transition cursor-pointer shadow-sm"
                      onClick={() => setOptionsRes({
                        id: t.reservation_id,
                        name: t.guest_name,
                        cin: t.checkin_date,
                        cout: t.checkout_date
                      })}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <span className="badge bg-[var(--bg-muted)] text-[var(--text-secondary)] font-bold tracking-wide">{t.dept}</span>
                        <div className="text-right leading-tight">
                          <p className="text-xs font-bold text-[var(--text-primary)]">Room {t.room_number}</p>
                          <p className="text-[10px] text-[var(--text-secondary)] truncate max-w-[100px]">{t.guest_name}</p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--text-table-cell)] font-medium leading-snug">{t.trace_text}</p>
                      {t.loan_item_code && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 bg-emerald-50 w-fit px-1.5 py-0.5 rounded">
                          <span>📦</span> {t.loan_qty}x {t.loan_item_code}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Options Panel if opened from a trace */}
      {optionsRes && (
        <ReservationOptionsPanel
          reservationId={optionsRes.id}
          guestName={optionsRes.name}
          checkinDate={optionsRes.cin}
          checkoutDate={optionsRes.cout}
          onClose={() => setOptionsRes(null)}
          initialTab="traces"
        />
      )}
    </div>
  );
}
