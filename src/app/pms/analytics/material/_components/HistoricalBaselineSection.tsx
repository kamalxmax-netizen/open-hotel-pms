"use client";

import { useEffect, useState, useMemo } from "react";
import type {
  AnalyticsHistoricalAmenity,
  AnalyticsHistoricalLinen,
  AnalyticsHistoricalRoomtype,
  AnalyticsHistoricalBaselineResponse,
} from "@/lib/analytics/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(m: number, y: number): string {
  return `${MONTHS_SHORT[m]}${String(y).slice(2)}`;
}

function pct(v: number | null): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(1)}%`;
}

function num(v: number, d = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(v);
}

function delta(a: number, b: number): string {
  if (b === 0) return "—";
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ data, color, height = 48, width = 220 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data) * 0.9;
  const max = Math.max(...data) * 1.1 || 1;
  const range = max - min || 1;
  const padY = 4;
  const padX = 2;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const points = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * w;
    const y = padY + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxWidth: width, height }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path
        d={`M${points[0]} ${points.slice(1).map((p) => `L${p}`).join(" ")} L${padX + w},${padY + h} L${padX},${padY + h} Z`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last point dot */}
      {data.length > 0 && (
        <circle
          cx={padX + w}
          cy={padY + h - ((data[data.length - 1] - min) / range) * h}
          r={3}
          fill={color}
        />
      )}
    </svg>
  );
}

// ─── Bar Comparison ───────────────────────────────────────────────────────────

function CompareBar({ label, thai, foreign, unit }: { label: string; thai: number; foreign: number; unit: string }) {
  const maxVal = Math.max(thai, foreign) || 1;
  return (
    <div className="space-y-2">
      <div className="a-muted text-[10px] uppercase tracking-[0.14em]">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] w-12 shrink-0">🇹🇭 Thai</span>
          <div className="flex-1 h-5 rounded bg-[var(--a-bg-2)] overflow-hidden">
            <div
              className="h-full rounded bg-blue-500/70 transition-all"
              style={{ width: `${(thai / maxVal) * 100}%` }}
            />
          </div>
          <span className="a-mono text-[11px] w-16 text-right">{thai.toFixed(3)} {unit}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] w-12 shrink-0">🌍 Fgn</span>
          <div className="flex-1 h-5 rounded bg-[var(--a-bg-2)] overflow-hidden">
            <div
              className="h-full rounded bg-emerald-500/70 transition-all"
              style={{ width: `${(foreign / maxVal) * 100}%` }}
            />
          </div>
          <span className="a-mono text-[11px] w-16 text-right">{foreign.toFixed(3)} {unit}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HistoricalBaselineSection() {
  const [amenity, setAmenity] = useState<AnalyticsHistoricalAmenity[]>([]);
  const [linen, setLinen] = useState<AnalyticsHistoricalLinen[]>([]);
  const [roomtype, setRoomtype] = useState<AnalyticsHistoricalRoomtype[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLinenMonth, setSelectedLinenMonth] = useState<string>("2025-01");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch("/api/analytics/historical-baseline?year=2025").then((r) => r.json()),
      fetch("/api/analytics/historical-baseline?year=2026").then((r) => r.json()),
    ])
      .then(([r2025, r2026]: AnalyticsHistoricalBaselineResponse[]) => {
        if (cancelled) return;
        const a = [...(r2025.amenity ?? []), ...(r2026.amenity ?? [])];
        const l = [...(r2025.linen ?? []), ...(r2026.linen ?? [])];
        const rt = [...(r2025.roomtype ?? []), ...(r2026.roomtype ?? [])];
        setAmenity(a);
        setLinen(l);
        setRoomtype(rt);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load historical data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ─── Derived Data ──────────────────────────────────────────────────

  const sorted = useMemo(
    () => [...amenity].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month)),
    [amenity]
  );

  const waterTrend = useMemo(() => sorted.map((m) => m.water_usage_pct ?? 0), [sorted]);
  const coffeeTrend = useMemo(() => sorted.map((m) => m.coffee_usage_pct ?? 0), [sorted]);

  const totals = useMemo(() => {
    const thaiRN = sorted.reduce((s, m) => s + m.thai_room_nights, 0);
    const fgnRN = sorted.reduce((s, m) => s + m.foreign_room_nights, 0);
    const wThai = sorted.reduce((s, m) => s + m.water_thai_allocated_qty, 0);
    const wFgn = sorted.reduce((s, m) => s + m.water_foreign_allocated_qty, 0);
    const cThai = sorted.reduce((s, m) => s + m.coffee_thai_allocated_qty, 0);
    const cFgn = sorted.reduce((s, m) => s + m.coffee_foreign_allocated_qty, 0);
    return {
      thaiRN, fgnRN,
      waterThaiPerRN: thaiRN > 0 ? wThai / thaiRN : 0,
      waterFgnPerRN: fgnRN > 0 ? wFgn / fgnRN : 0,
      coffeeThaiPerRN: thaiRN > 0 ? cThai / thaiRN : 0,
      coffeeFgnPerRN: fgnRN > 0 ? cFgn / fgnRN : 0,
    };
  }, [sorted]);

  // YOY: Jan25 vs Jan26
  const yoy = useMemo(() => {
    const jan25 = sorted.find((m) => m.year === 2025 && m.month === 1);
    const jan26 = sorted.find((m) => m.year === 2026 && m.month === 1);
    if (!jan25 || !jan26) return null;
    return { prev: jan25, curr: jan26 };
  }, [sorted]);

  // Room type aggregated
  const rtAgg = useMemo(() => {
    const map = new Map<string, { rn: number; thai: number; fgn: number; water: number; coffee: number }>();
    for (const r of roomtype) {
      const key = r.room_type_code;
      const existing = map.get(key) || { rn: 0, thai: 0, fgn: 0, water: 0, coffee: 0 };
      existing.rn += r.room_nights;
      existing.thai += r.thai_nights;
      existing.fgn += r.foreign_nights;
      existing.water += r.water_allocated_qty;
      existing.coffee += r.coffee_allocated_qty;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].rn - a[1].rn)
      .map(([code, d]) => ({
        code,
        ...d,
        waterPerRN: d.rn > 0 ? d.water / d.rn : 0,
        coffeePerRN: d.rn > 0 ? d.coffee / d.rn : 0,
        thaiPct: d.rn > 0 ? (d.thai / d.rn) * 100 : 0,
      }));
  }, [roomtype]);

  // Linen for selected month
  const linenMonthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const l of linen) keys.add(`${l.year}-${String(l.month).padStart(2, "0")}`);
    return Array.from(keys).sort();
  }, [linen]);

  const linenForMonth = useMemo(() => {
    const [y, m] = selectedLinenMonth.split("-").map(Number);
    return linen
      .filter((l) => l.year === y && l.month === m)
      .sort((a, b) => (a.linen_item_number ?? 0) - (b.linen_item_number ?? 0));
  }, [linen, selectedLinenMonth]);

  const linenMonthTotal = useMemo(
    () => linenForMonth.reduce((s, l) => s + l.total_cost, 0),
    [linenForMonth]
  );

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section className="space-y-3 mt-6">
        <div className="h-6 w-48 rounded bg-[var(--a-bg-2)] animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="a-card h-48 animate-pulse bg-[var(--a-bg-2)]/40" />
          ))}
        </div>
      </section>
    );
  }

  if (error || sorted.length === 0) {
    if (error) {
      return (
        <div className="a-card p-4 mt-6 border-l-2 border-[var(--a-accent-amber)] text-sm">
          <div className="font-semibold">Historical Baseline Unavailable</div>
          <p className="a-secondary mt-1">{error}</p>
        </div>
      );
    }
    return null; // No historical data — silently hide
  }

  const avgWater = sorted.reduce((s, m) => s + (m.water_usage_pct ?? 0), 0) / sorted.length;
  const avgCoffee = sorted.reduce((s, m) => s + (m.coffee_usage_pct ?? 0), 0) / sorted.length;
  const totalRN = sorted.reduce((s, m) => s + m.total_room_nights, 0);

  return (
    <section className="mt-8 space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="a-muted text-[11px] uppercase tracking-[0.2em]">Phase 69 · Historical</div>
          <h2 className="text-xl font-semibold tracking-tight mt-0.5">Historical Baseline</h2>
          <p className="a-secondary text-[13px] mt-0.5">
            Jan 2025 — Mar 2026 · {num(totalRN)} room-nights · {sorted.length} months
          </p>
        </div>
      </div>

      {/* Row 1: Amenity Trend Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Water Trend */}
        <div className="a-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-lg mr-1.5">🚰</span>
              <span className="font-semibold text-sm">Water Usage</span>
            </div>
            <span className="a-mono text-xl font-semibold">{avgWater.toFixed(1)}%</span>
          </div>
          <Sparkline data={waterTrend} color="#3b82f6" />
          <div className="flex justify-between mt-2 a-muted text-[10px]">
            {sorted.length > 0 && <span>{monthLabel(sorted[0].month, sorted[0].year)}</span>}
            <span>avg of MAX</span>
            {sorted.length > 0 && <span>{monthLabel(sorted[sorted.length - 1].month, sorted[sorted.length - 1].year)}</span>}
          </div>
        </div>

        {/* Coffee Trend */}
        <div className="a-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-lg mr-1.5">☕</span>
              <span className="font-semibold text-sm">Coffee Usage</span>
            </div>
            <span className="a-mono text-xl font-semibold">{avgCoffee.toFixed(1)}%</span>
          </div>
          <Sparkline data={coffeeTrend} color="#f59e0b" />
          <div className="flex justify-between mt-2 a-muted text-[10px]">
            {sorted.length > 0 && <span>{monthLabel(sorted[0].month, sorted[0].year)}</span>}
            <span>avg of MAX — high variance</span>
            {sorted.length > 0 && <span>{monthLabel(sorted[sorted.length - 1].month, sorted[sorted.length - 1].year)}</span>}
          </div>
        </div>
      </div>

      {/* Row 2: Thai vs Foreign + YOY */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Thai vs Foreign */}
        <div className="a-card p-5 space-y-4">
          <div className="font-semibold text-sm">Thai vs Foreign — per Room-Night</div>
          <div className="flex items-center gap-3 text-xs a-secondary">
            <span>🇹🇭 {num(totals.thaiRN)} RN</span>
            <span>·</span>
            <span>🌍 {num(totals.fgnRN)} RN</span>
          </div>
          <CompareBar label="Water (bottles/RN)" thai={totals.waterThaiPerRN} foreign={totals.waterFgnPerRN} unit="" />
          <CompareBar label="Coffee (sachets/RN)" thai={totals.coffeeThaiPerRN} foreign={totals.coffeeFgnPerRN} unit="" />
          <div className="text-[11px] a-secondary border-t border-[var(--a-border)] pt-3 mt-2">
            Water: Thai {delta(totals.waterThaiPerRN, totals.waterFgnPerRN)} vs Foreign · Coffee: Thai {delta(totals.coffeeThaiPerRN, totals.coffeeFgnPerRN)} vs Foreign
          </div>
        </div>

        {/* YOY */}
        {yoy && (
          <div className="a-card p-5">
            <div className="font-semibold text-sm mb-4">YOY — Jan 2025 vs Jan 2026</div>
            <div className="space-y-3">
              {[
                { label: "Room-Nights", prev: yoy.prev.total_room_nights, curr: yoy.curr.total_room_nights },
                { label: "Thai RN", prev: yoy.prev.thai_room_nights, curr: yoy.curr.thai_room_nights },
                { label: "Foreign RN", prev: yoy.prev.foreign_room_nights, curr: yoy.curr.foreign_room_nights },
                { label: "Water %", prev: yoy.prev.water_usage_pct ?? 0, curr: yoy.curr.water_usage_pct ?? 0 },
                { label: "Coffee %", prev: yoy.prev.coffee_usage_pct ?? 0, curr: yoy.curr.coffee_usage_pct ?? 0 },
              ].map((row) => {
                const d = row.prev > 0 ? ((row.curr - row.prev) / row.prev) * 100 : 0;
                const isPositive = d > 0;
                return (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <span className="a-secondary">{row.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="a-muted text-xs">{num(row.prev)}</span>
                      <span className="a-muted">→</span>
                      <span className="a-mono font-medium">{num(row.curr)}</span>
                      <span
                        className={`a-mono text-xs font-medium px-1.5 py-0.5 rounded ${
                          isPositive
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-rose-500/10 text-rose-400"
                        }`}
                      >
                        {d >= 0 ? "+" : ""}{d.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Row 3: Room Type Breakdown */}
      {rtAgg.length > 0 && (
        <div className="a-card p-5">
          <div className="font-semibold text-sm mb-4">Room Type Breakdown — 15 Months Aggregated</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="a-muted text-[10px] uppercase tracking-[0.12em] border-b border-[var(--a-border)]">
                  <th className="text-left py-2 pr-3">Code</th>
                  <th className="text-right py-2 px-2">Room-Nights</th>
                  <th className="text-right py-2 px-2">Thai%</th>
                  <th className="text-right py-2 px-2">Water/RN</th>
                  <th className="text-right py-2 px-2">Coffee/RN</th>
                  <th className="text-right py-2 pl-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {rtAgg.map((r) => {
                  const sharePct = totalRN > 0 ? (r.rn / totalRN) * 100 : 0;
                  return (
                    <tr key={r.code} className="border-b border-[var(--a-border)]/50 hover:bg-[var(--a-bg-2)]/30">
                      <td className="py-2.5 pr-3">
                        <span className="a-mono font-semibold">{r.code}</span>
                      </td>
                      <td className="text-right py-2.5 px-2 a-mono">{num(r.rn)}</td>
                      <td className="text-right py-2.5 px-2 a-mono">{r.thaiPct.toFixed(0)}%</td>
                      <td className="text-right py-2.5 px-2 a-mono">{r.waterPerRN.toFixed(2)}</td>
                      <td className="text-right py-2.5 px-2 a-mono">
                        {r.coffeePerRN > 0 ? r.coffeePerRN.toFixed(2) : "—"}
                      </td>
                      <td className="text-right py-2.5 pl-2">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 rounded-full bg-[var(--a-bg-2)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--a-accent-cyan)]/60"
                              style={{ width: `${sharePct}%` }}
                            />
                          </div>
                          <span className="a-mono text-[11px] w-10 text-right">{sharePct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 4: Linen Cost by Month */}
      {linenMonthOptions.length > 0 && (
        <div className="a-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-sm">Linen Monthly Cost</div>
            <select
              value={selectedLinenMonth}
              onChange={(e) => setSelectedLinenMonth(e.target.value)}
              className="a-mono bg-[var(--a-bg-2)] border border-[var(--a-border)] rounded px-2 py-1 text-xs"
            >
              {linenMonthOptions.map((key) => {
                const [y, m] = key.split("-").map(Number);
                return (
                  <option key={key} value={key}>
                    {MONTHS_SHORT[m]} {y}
                  </option>
                );
              })}
            </select>
          </div>

          {linenForMonth.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="a-muted text-[10px] uppercase tracking-[0.12em] border-b border-[var(--a-border)]">
                      <th className="text-left py-2 pr-3">#</th>
                      <th className="text-left py-2 pr-3">Item</th>
                      <th className="text-right py-2 px-2">Sent</th>
                      <th className="text-right py-2 px-2">MAX</th>
                      <th className="text-right py-2 px-2">Usage%</th>
                      <th className="text-right py-2 px-2">฿/pc</th>
                      <th className="text-right py-2 pl-2">Total ฿</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linenForMonth.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--a-border)]/50 hover:bg-[var(--a-bg-2)]/30">
                        <td className="py-2 pr-3 a-muted text-xs">{l.linen_item_number}</td>
                        <td className="py-2 pr-3 text-xs">{l.linen_item_name_th || l.linen_item_name_en}</td>
                        <td className="text-right py-2 px-2 a-mono">{num(l.total_sent)}</td>
                        <td className="text-right py-2 px-2 a-mono a-muted">{l.max_capacity > 0 ? num(l.max_capacity) : "—"}</td>
                        <td className="text-right py-2 px-2 a-mono">{pct(l.linen_usage_pct)}</td>
                        <td className="text-right py-2 px-2 a-mono">{num(l.price_per_piece)}</td>
                        <td className="text-right py-2 pl-2 a-mono font-medium">{num(l.total_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--a-border)]">
                      <td colSpan={6} className="py-2 pr-3 font-semibold text-xs">Total</td>
                      <td className="text-right py-2 pl-2 a-mono font-semibold">฿{num(linenMonthTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : (
            <div className="a-secondary text-sm py-4 text-center">No linen data for this month</div>
          )}
        </div>
      )}

      {/* Monthly Detail Table */}
      <details className="a-card">
        <summary className="p-5 cursor-pointer select-none flex items-center justify-between">
          <span className="font-semibold text-sm">Monthly Detail — All 15 Months</span>
          <span className="a-muted text-xs">Click to expand ▾</span>
        </summary>
        <div className="px-5 pb-5 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="a-muted text-[10px] uppercase tracking-[0.12em] border-b border-[var(--a-border)]">
                <th className="text-left py-2 pr-2">Month</th>
                <th className="text-right py-2 px-1">RN</th>
                <th className="text-right py-2 px-1">Thai</th>
                <th className="text-right py-2 px-1">Fgn</th>
                <th className="text-right py-2 px-1">Thai%</th>
                <th className="text-right py-2 px-1">W Used</th>
                <th className="text-right py-2 px-1">W%</th>
                <th className="text-right py-2 px-1">C Used</th>
                <th className="text-right py-2 px-1">C%</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const thaiPct = m.total_room_nights > 0
                  ? ((m.thai_room_nights / m.total_room_nights) * 100).toFixed(0)
                  : "0";
                return (
                  <tr key={`${m.year}-${m.month}`} className="border-b border-[var(--a-border)]/30 hover:bg-[var(--a-bg-2)]/30">
                    <td className="py-1.5 pr-2 a-mono font-medium">{monthLabel(m.month, m.year)}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{m.total_room_nights}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{m.thai_room_nights}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{m.foreign_room_nights}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{thaiPct}%</td>
                    <td className="text-right py-1.5 px-1 a-mono">{m.water_used}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{pct(m.water_usage_pct)}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{m.coffee_used}</td>
                    <td className="text-right py-1.5 px-1 a-mono">{pct(m.coffee_usage_pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
