"use client";

import { useCallback, useEffect, useState } from "react";

/* ─── Types ─────────────────────────────────────────── */
type DayRow = {
    date: string;
    revenue: number;
    occupied: number;
    occ_pct: number;
};

type SourceRow = {
    source: "walkin" | "ota" | "direct" | "agent";
    nights: number;
    revenue: number;
    share_pct: number;
};

type RevenueData = {
    start_date: string;
    end_date: string;
    day_count: number;
    sellable_rooms: number;
    kpi: {
        total_revenue: number;
        occupied_nights: number;
        room_nights: number;
        occupancy_pct: number;
        adr: number;
        revpar: number;
    };
    by_source: SourceRow[];
    by_day: DayRow[];
};

// ★ Phase 11A: Transfer revenue reference data
type TransferRefRow = {
    transfer_id: string;
    reservation_id: string | null;
    guest_name: string | null;
    booking_code: string | null;
    route: string | null;
    selling_price: number;
    cost_price: number;
    margin: number;
    commission: number;
    status: string;
    date: string;
};

type TransferRefData = {
    kpis: {
        gross_sell: number;
        total_cost: number;
        gross_margin: number;
        commission_payable: number;
        net_margin: number;
    };
    transfers: TransferRefRow[];
};

/* ─── helpers ────────────────────────────────────────── */
function toLocalDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: string, n: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toLocalDate(d);
}

function today() { return toLocalDate(new Date()); }

function fmt(n: number) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtMoney(n: number) {
    return `฿${fmt(n)}`;
}

const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in",
    ota: "OTA",
    direct: "Direct",
    agent: "Agent"
};

const SOURCE_COLOR: Record<string, string> = {
    walkin: "bg-sky-500",
    ota: "bg-violet-500",
    direct: "bg-emerald-500",
    agent: "bg-amber-500"
};

const SOURCE_LIGHT: Record<string, string> = {
    walkin: "bg-sky-50 text-sky-700 border-sky-200",
    ota: "bg-violet-50 text-violet-700 border-violet-200",
    direct: "bg-emerald-50 text-emerald-700 border-emerald-200",
    agent: "bg-amber-50 text-amber-700 border-amber-200"
};

/* ─── KPI Tile ───────────────────────────────────────── */
function KpiTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className={`card p-4 flex flex-col gap-1 ${color ?? ""}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
            <p className="text-2xl font-bold text-slate-900 leading-tight">{value}</p>
            {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
    );
}

/* ─── Occupancy Bar ──────────────────────────────────── */
function OccBar({ pct }: { pct: number }) {
    const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-brand-500" : "bg-rose-400";
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
        </div>
    );
}

/* ─── View Toggle ────────────────────────────────────── */
type ViewMode = "summary" | "detail";
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
    return (
        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            <button
                onClick={() => onChange("summary")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${view === "summary" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
            >Summary</button>
            <button
                onClick={() => onChange("detail")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${view === "detail" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
            >Transfer Reference</button>
        </div>
    );
}

/* ─── Main page ──────────────────────────────────────── */
const PRESETS = [
    { label: "Today", days: 0 },
    { label: "Yesterday", days: -1 },
    { label: "Last 7D", days: -6 },
    { label: "Last 30D", days: -29 }
];

export default function RevenuePage() {
    const t = today();
    const [startDate, setStartDate] = useState(t);
    const [endDate, setEndDate] = useState(t);
    const [data, setData] = useState<RevenueData | null>(null);
    const [transferRef, setTransferRef] = useState<TransferRefData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [preset, setPreset] = useState(0);
    const [view, setView] = useState<ViewMode>("summary");

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            // Fetch hotel revenue (existing)
            const res = await fetch(`/api/revenue?start=${startDate}&end=${endDate}`);
            const d = await res.json();
            if (d.success) setData(d);
            else setError(d.error ?? "Failed to load data");

            // ★ Phase 11A: Fetch transfer revenue reference
            try {
                const tRes = await fetch(`/api/accounting/transfer-report?date_from=${startDate}&date_to=${endDate}`);
                const tData = await tRes.json();
                if (tData.success) setTransferRef(tData);
            } catch {
                // Transfer report may not exist yet — that's OK
            }
        } catch { setError("Network error"); }
        finally { setLoading(false); }
    }, [startDate, endDate]);

    useEffect(() => { load(); }, [load]);

    function applyPreset(idx: number) {
        setPreset(idx);
        const p = PRESETS[idx];
        const s = addDays(t, p.days);
        setStartDate(s);
        setEndDate(t);
        if (p.days === -1) setEndDate(addDays(t, -1));
    }

    const kpi = data?.kpi;

    /* Revenue % bar max = highest day revenue */
    const maxRev = Math.max(...(data?.by_day.map((d) => d.revenue) ?? [1]), 1);

    return (
        <div className="flex flex-col gap-5 max-w-full">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Revenue</p>
                    <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Revenue Report</h1>
                    {data && (
                        <p className="text-sm text-slate-400 mt-0.5">
                            {startDate === endDate ? startDate : `${startDate} → ${endDate}`}
                            &nbsp;·&nbsp;{data.sellable_rooms} sellable rooms
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <ViewToggle view={view} onChange={setView} />
                    <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
                </div>
            </div>

            {/* Date controls */}
            <div className="card p-3 flex flex-wrap items-center gap-3">
                <div className="flex gap-1">
                    {PRESETS.map((p, i) => (
                        <button key={i} onClick={() => applyPreset(i)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition
                ${preset === i ? "border-brand-400 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                        >{p.label}</button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">From</label>
                    <input type="date" className="form-input py-1 text-sm w-36" value={startDate}
                        onChange={(e) => { setStartDate(e.target.value); setPreset(-1); }} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">To</label>
                    <input type="date" className="form-input py-1 text-sm w-36" value={endDate}
                        onChange={(e) => { setEndDate(e.target.value); setPreset(-1); }} />
                </div>
            </div>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {/* ═══ SUMMARY VIEW ═══ */}
            {view === "summary" && (
                <>
                    {/* KPI Tiles */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                        {loading ? Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="card p-4 animate-pulse">
                                <div className="h-2 w-16 rounded bg-slate-200 mb-3" />
                                <div className="h-6 w-20 rounded bg-slate-200" />
                            </div>
                        )) : <>
                            <KpiTile label="Hotel Revenue" value={kpi ? fmtMoney(kpi.total_revenue) : "—"} sub={`${data?.day_count}d · Room + POS`} />
                            <KpiTile label="Rooms Sold" value={kpi ? fmt(kpi.occupied_nights) : "—"} sub={`of ${kpi?.room_nights ?? "—"} avail.`} />
                            <KpiTile label="Occupancy" value={kpi ? `${kpi.occupancy_pct.toFixed(1)}%` : "—"}
                                sub={kpi && (kpi.occupancy_pct >= 80 ? "🟢 High" : kpi.occupancy_pct >= 50 ? "🟡 Medium" : "🔴 Low")} />
                            <KpiTile label="ADR" value={kpi ? fmtMoney(kpi.adr) : "—"} sub="Avg Daily Rate" />
                            <KpiTile label="RevPAR" value={kpi ? fmtMoney(kpi.revpar) : "—"} sub="Rev Per Avail Room" />
                            <KpiTile label="Avg/Day" value={kpi && data ? fmtMoney(Math.round(kpi.total_revenue / data.day_count)) : "—"} sub="Revenue per day" />
                        </>}
                    </div>

                    {/* Source Breakdown + Day Chart side by side */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                        {/* Source Breakdown */}
                        <div className="card p-4 lg:col-span-2">
                            <h2 className="text-sm font-bold text-slate-700 mb-3">Revenue by Source</h2>
                            {loading ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 4 }).map((_, i) => (
                                        <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {(data?.by_source ?? []).map((s) => (
                                        <div key={s.source}
                                            className={`rounded-xl border p-3 flex items-center gap-3 ${SOURCE_LIGHT[s.source]}`}
                                        >
                                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SOURCE_COLOR[s.source]}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-bold">{SOURCE_LABEL[s.source]}</span>
                                                    <span className="text-sm font-bold">{fmtMoney(s.revenue)}</span>
                                                </div>
                                                <div className="flex items-center justify-between text-xs opacity-70 mt-0.5">
                                                    <span>{s.nights} nights</span>
                                                    <span>{s.share_pct.toFixed(1)}% of total</span>
                                                </div>
                                                {/* Share bar */}
                                                <div className="mt-1.5 h-1.5 rounded-full bg-black/10 overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${SOURCE_COLOR[s.source]}`}
                                                        style={{ width: `${Math.min(s.share_pct, 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Daily Breakdown Table */}
                        <div className="card p-4 lg:col-span-3 overflow-hidden">
                            <h2 className="text-sm font-bold text-slate-700 mb-3">Daily Breakdown</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100">
                                            <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                                            <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Revenue</th>
                                            <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide pr-2">Rooms</th>
                                            <th className="pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide min-w-[120px]">Occupancy</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            Array.from({ length: 7 }).map((_, i) => (
                                                <tr key={i} className="border-b border-slate-50">
                                                    <td className="py-2"><div className="h-3 w-20 rounded bg-slate-200 animate-pulse" /></td>
                                                    <td className="py-2 text-right"><div className="h-3 w-14 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                                                    <td className="py-2 text-right pr-2"><div className="h-3 w-8 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                                                    <td className="py-2"><div className="h-2 w-full rounded-full bg-slate-200 animate-pulse" /></td>
                                                </tr>
                                            ))
                                        ) : (
                                            (data?.by_day ?? []).map((day) => {
                                                const d = new Date(day.date + "T00:00:00");
                                                const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
                                                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                                const isToday = day.date === t;
                                                return (
                                                    <tr key={day.date} className={`border-b border-slate-50 ${isToday ? "bg-brand-50" : isWeekend ? "bg-rose-50/40" : ""}`}>
                                                        <td className="py-2 pr-3">
                                                            <span className={`text-xs font-semibold mr-1.5 ${isWeekend ? "text-rose-500" : "text-slate-400"}`}>{dow}</span>
                                                            <span className={`text-sm font-semibold ${isToday ? "text-brand-700" : "text-slate-700"}`}>{day.date}</span>
                                                            {isToday && <span className="ml-1.5 text-[9px] rounded bg-brand-100 text-brand-600 px-1 py-0.5 font-bold">TODAY</span>}
                                                        </td>
                                                        <td className="py-2 text-right font-semibold text-slate-800">
                                                            {day.revenue > 0 ? fmtMoney(day.revenue) : <span className="text-slate-300">—</span>}
                                                        </td>
                                                        <td className="py-2 text-right pr-3 text-slate-600 text-sm">{day.occupied}/{data?.sellable_rooms ?? "?"}</td>
                                                        <td className="py-2"><OccBar pct={day.occ_pct} /></td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    {!loading && data && (
                                        <tfoot>
                                            <tr className="border-t-2 border-slate-200">
                                                <td className="pt-2 text-xs font-bold text-slate-500 uppercase">Total</td>
                                                <td className="pt-2 text-right font-bold text-slate-900">{fmtMoney(kpi?.total_revenue ?? 0)}</td>
                                                <td className="pt-2 text-right pr-3 font-bold text-slate-700">{kpi?.occupied_nights}</td>
                                                <td className="pt-2">
                                                    <OccBar pct={kpi?.occupancy_pct ?? 0} />
                                                </td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Revenue bar chart (visual only) */}
                    {!loading && data && data.by_day.length > 1 && (
                        <div className="card p-4">
                            <h2 className="text-sm font-bold text-slate-700 mb-3">Revenue Bar Chart</h2>
                            <div className="flex items-end gap-1 h-24 overflow-x-auto">
                                {data.by_day.map((day) => {
                                    const h = maxRev > 0 ? (day.revenue / maxRev) * 100 : 0;
                                    const d = new Date(day.date + "T00:00:00");
                                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                    const isToday = day.date === t;
                                    return (
                                        <div key={day.date} className="flex flex-col items-center gap-1 flex-1 min-w-[28px] group" title={`${day.date}: ${fmtMoney(day.revenue)}`}>
                                            <div className="w-full flex items-end" style={{ height: 80 }}>
                                                <div
                                                    className={`w-full rounded-t-sm transition-all
                        ${isToday ? "bg-brand-500" : isWeekend ? "bg-rose-400" : "bg-slate-300"}
                        group-hover:brightness-90`}
                                                    style={{ height: `${Math.max(h, day.revenue > 0 ? 4 : 0)}%` }}
                                                />
                                            </div>
                                            <span className={`text-[9px] font-semibold ${isWeekend ? "text-rose-500" : "text-slate-400"}`}>
                                                {d.getDate()}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex gap-3 mt-2 text-xs text-slate-400">
                                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-brand-500 inline-block" />Today</span>
                                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-rose-400 inline-block" />Weekend</span>
                                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-300 inline-block" />Weekday</span>
                            </div>
                        </div>
                    )}

                    {/* ★ Phase 11A: Transfer Revenue Reference (not counted in Hotel Revenue) */}
                    <div className="card p-4 border-l-4 border-l-amber-400">
                        <div className="flex items-center gap-2 mb-3">
                            <h2 className="text-sm font-bold text-slate-700">Transfer Revenue Reference</h2>
                            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold uppercase">Separate</span>
                        </div>
                        <p className="text-xs text-slate-400 mb-3">
                            Transfer revenue is tracked separately and not included in Hotel Revenue totals above.
                        </p>
                        {transferRef ? (
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                <div className="bg-amber-50 rounded-lg p-3">
                                    <p className="text-[10px] font-semibold text-amber-600 uppercase">Gross Sell</p>
                                    <p className="text-lg font-bold text-amber-800">{fmtMoney(transferRef.kpis.gross_sell)}</p>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Cost</p>
                                    <p className="text-lg font-bold text-slate-700">{fmtMoney(transferRef.kpis.total_cost)}</p>
                                </div>
                                <div className="bg-emerald-50 rounded-lg p-3">
                                    <p className="text-[10px] font-semibold text-emerald-600 uppercase">Margin</p>
                                    <p className="text-lg font-bold text-emerald-700">{fmtMoney(transferRef.kpis.gross_margin)}</p>
                                </div>
                                <div className="bg-violet-50 rounded-lg p-3">
                                    <p className="text-[10px] font-semibold text-violet-600 uppercase">Commission</p>
                                    <p className="text-lg font-bold text-violet-700">{fmtMoney(transferRef.kpis.commission_payable)}</p>
                                </div>
                                <div className="bg-blue-50 rounded-lg p-3">
                                    <p className="text-[10px] font-semibold text-blue-600 uppercase">Net Margin</p>
                                    <p className="text-lg font-bold text-blue-700">{fmtMoney(transferRef.kpis.net_margin)}</p>
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 italic">No transfer data available for this period.</p>
                        )}
                    </div>
                </>
            )}

            {/* ═══ TRANSFER REFERENCE DETAIL VIEW ═══ */}
            {view === "detail" && (
                <div className="card p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-sm font-bold text-slate-700">Transfer Revenue Detail</h2>
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-bold uppercase">Not in Hotel Revenue</span>
                    </div>

                    {/* Transfer KPIs */}
                    {transferRef && (
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                            <div className="bg-amber-50 rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-amber-600 uppercase">Gross Sell</p>
                                <p className="text-lg font-bold text-amber-800">{fmtMoney(transferRef.kpis.gross_sell)}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-slate-500 uppercase">Cost</p>
                                <p className="text-lg font-bold text-slate-700">{fmtMoney(transferRef.kpis.total_cost)}</p>
                            </div>
                            <div className="bg-emerald-50 rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-emerald-600 uppercase">Margin</p>
                                <p className="text-lg font-bold text-emerald-700">{fmtMoney(transferRef.kpis.gross_margin)}</p>
                            </div>
                            <div className="bg-violet-50 rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-violet-600 uppercase">Commission</p>
                                <p className="text-lg font-bold text-violet-700">{fmtMoney(transferRef.kpis.commission_payable)}</p>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3">
                                <p className="text-[10px] font-semibold text-blue-600 uppercase">Net Margin</p>
                                <p className="text-lg font-bold text-blue-700">{fmtMoney(transferRef.kpis.net_margin)}</p>
                            </div>
                        </div>
                    )}

                    {/* Transfer Detail Table */}
                    {transferRef && transferRef.transfers.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase">Date</th>
                                        <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase">Guest</th>
                                        <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase">Booking</th>
                                        <th className="text-left pb-2 text-xs font-semibold text-slate-400 uppercase">Route</th>
                                        <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase">Sell</th>
                                        <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase">Cost</th>
                                        <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase">Margin</th>
                                        <th className="text-right pb-2 text-xs font-semibold text-slate-400 uppercase">Commission</th>
                                        <th className="text-center pb-2 text-xs font-semibold text-slate-400 uppercase">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transferRef.transfers.map((row) => {
                                        const statusColor = row.status === "completed" ? "bg-emerald-100 text-emerald-700"
                                            : row.status === "cancelled" ? "bg-rose-100 text-rose-700"
                                                : "bg-slate-100 text-slate-600";
                                        return (
                                            <tr key={row.transfer_id} className="border-b border-slate-50 hover:bg-slate-50">
                                                <td className="py-2 text-xs text-slate-500">{row.date}</td>
                                                <td className="py-2 font-semibold text-slate-700">{row.guest_name ?? "—"}</td>
                                                <td className="py-2 text-xs text-slate-500">{row.booking_code ?? "—"}</td>
                                                <td className="py-2 text-xs text-slate-600">{row.route ?? "—"}</td>
                                                <td className="py-2 text-right font-semibold text-slate-800">{fmtMoney(row.selling_price)}</td>
                                                <td className="py-2 text-right text-slate-500">{fmtMoney(row.cost_price)}</td>
                                                <td className="py-2 text-right font-semibold text-emerald-700">{fmtMoney(row.margin)}</td>
                                                <td className="py-2 text-right text-violet-600">{fmtMoney(row.commission)}</td>
                                                <td className="py-2 text-center">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${statusColor}`}>{row.status}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-slate-200">
                                        <td colSpan={4} className="pt-2 text-xs font-bold text-slate-500 uppercase">Total ({transferRef.transfers.length} transfers)</td>
                                        <td className="pt-2 text-right font-bold text-slate-900">{fmtMoney(transferRef.kpis.gross_sell)}</td>
                                        <td className="pt-2 text-right font-bold text-slate-600">{fmtMoney(transferRef.kpis.total_cost)}</td>
                                        <td className="pt-2 text-right font-bold text-emerald-700">{fmtMoney(transferRef.kpis.gross_margin)}</td>
                                        <td className="pt-2 text-right font-bold text-violet-700">{fmtMoney(transferRef.kpis.commission_payable)}</td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 italic py-4 text-center">No transfer data for this period.</p>
                    )}
                </div>
            )}
        </div>
    );
}
