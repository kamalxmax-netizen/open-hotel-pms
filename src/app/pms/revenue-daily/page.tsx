"use client";

import { useCallback, useEffect, useState } from "react";

/* ─── Types ─────────────────────────────────────────── */
type RevenueDailyRoom = {
    room_number: string | null;
    floor_number: number;
    is_occupied: boolean;
    nightly_price: number;
    guest_name: string | null;
    booking_code: string | null;
    source: string | null;
    night_label: string | null;
};

type RevenueDailyDayUse = {
    room_number: string;
    sessions: number;
    revenue: number;
};

type RevenueDailyExtraCharge = {
    id: string | null;
    room_number: string | null;
    amount: number;
    note: string | null;
    tx_type: "payment" | "refund";
    booking_code: string | null;
    guest_name: string | null;
    is_record_only: boolean;
};

type RevenueDailySummary = {
    total_revenue: number;
    room_revenue: number;
    dayuse_revenue: number;
    extra_revenue: number;
    pos_revenue: number;
    occupied_rooms: number;
    occupancy_pct: number;
    adr: number;
    revpar: number;
};

type RevenueDailyData = {
    success: boolean;
    business_date: string;
    sellable_rooms: number;
    rooms: RevenueDailyRoom[];
    dayuse: RevenueDailyDayUse[];
    extra_charges?: RevenueDailyExtraCharge[];
    pos_total: number;
    summary: RevenueDailySummary;
    error?: string;
};

/* ─── Helpers ───────────────────────────────────────── */

function fmt(n: number) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtMoney(n: number) {
    return `฿${fmt(n)}`;
}

function fmtSignedMoney(n: number) {
    const prefix = n < 0 ? "-" : "";
    return `${prefix}฿${fmt(Math.abs(n))}`;
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

/* ─── Components ────────────────────────────────────── */
function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="card p-4 flex flex-col items-center justify-center text-center">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest mb-1">{label}</div>
            <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
            {sub && <div className="text-xs text-[var(--text-muted)] mt-1">{sub}</div>}
        </div>
    );
}

/* ─── Page ──────────────────────────────────────────── */
export default function RevenueDailyPage() {
    const [date, setDate] = useState("");
    const [data, setData] = useState<RevenueDailyData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [floorFilter, setFloorFilter] = useState<string>("all");
    const [showMode, setShowMode] = useState<"occupied" | "all">("occupied");
    const [showDayUse, setShowDayUse] = useState(true);
    const [showPos, setShowPos] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const query = date ? `?date=${encodeURIComponent(date)}` : "";
            const res = await fetch(`/api/reports/revenue-daily${query}`);
            const d = await res.json();
            if (d.success) {
                setData(d);
                if (!date && typeof d.business_date === "string" && d.business_date) {
                    setDate(d.business_date);
                }
            }
            else setError(d.error ?? "Failed to load report");
        } catch {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { load(); }, [load]);

    // Data Filtering & Grouping
    const rooms = data?.rooms ?? [];

    // Apply filters
    const filteredRooms = rooms.filter(r => {
        if (floorFilter !== "all" && String(r.floor_number) !== floorFilter) return false;
        if (showMode === "occupied" && !r.is_occupied) return false;
        return true;
    });

    const floors = Array.from(new Set(filteredRooms.map(r => r.floor_number))).sort((a, b) => b - a);

    const dUserRooms = data?.dayuse ?? [];
    const extraChargeRows = data?.extra_charges ?? [];

    const roomsTotal = floors.reduce((sum, floor) => sum + filteredRooms.filter(r => r.floor_number === floor).reduce((acc, r) => acc + (r.nightly_price || 0), 0), 0);
    const duTotal = showDayUse ? (data?.summary.dayuse_revenue || 0) : 0;
    const extraTotal = data?.summary.extra_revenue || 0;
    const posTotal = showPos ? (data?.pos_total || 0) : 0;
    const totalDisplayed = roomsTotal + duTotal + extraTotal + posTotal;

    return (
        <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Revenue Daily Summary</h1>
                    <p className="text-sm text-[var(--text-secondary)]">Per-room breakdown of hotel revenue.</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="date"
                        className="input max-w-[160px] cursor-pointer"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                        {loading ? "..." : "🔄 Refresh"}
                    </button>
                </div>
            </div>

            {error && <div className="bg-rose-50 text-rose-700 p-4 rounded-lg border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">{error}</div>}

            {/* Controls */}
            <div className="card p-3 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">Floor:</span>
                    <select
                        className="input py-1.5 px-3 text-sm"
                        value={floorFilter}
                        onChange={(e) => setFloorFilter(e.target.value)}
                    >
                        <option value="all">All</option>
                        <option value="3">3</option>
                        <option value="2">2</option>
                        <option value="1">1</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">Show:</span>
                    <select
                        className="input py-1.5 px-3 text-sm"
                        value={showMode}
                        onChange={(e) => setShowMode(e.target.value as "occupied" | "all")}
                    >
                        <option value="occupied">Occupied Only</option>
                        <option value="all">All non-blocked</option>
                    </select>
                </div>

                <div className="flex items-center gap-4 border-l border-[var(--border-default)] pl-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--bg-body)] p-1 rounded transition-colors">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={showDayUse} onChange={(e) => setShowDayUse(e.target.checked)} />
                        <span className="font-medium text-[var(--text-table-cell)]">Day Use</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-[var(--bg-body)] p-1 rounded transition-colors">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={showPos} onChange={(e) => setShowPos(e.target.checked)} />
                        <span className="font-medium text-[var(--text-table-cell)]">POS</span>
                    </label>
                </div>
            </div>

            {/* KPIs */}
            {data && (
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                    <KpiTile
                        label="Total Revenue"
                        value={fmtMoney(data.summary.total_revenue + (showPos ? data.summary.pos_revenue : 0))}
                    />
                    <KpiTile
                        label="Extra Charge"
                        value={fmtMoney(data.summary.extra_revenue)}
                        sub="Posted charges"
                    />
                    <KpiTile
                        label="Occupied Rooms"
                        value={`${data.summary.occupied_rooms} / ${data.sellable_rooms}`}
                        sub="Overnight stays only"
                    />
                    <KpiTile
                        label="Occupancy %"
                        value={`${data.summary.occupancy_pct}%`}
                    />
                    <KpiTile
                        label="ADR"
                        value={fmtMoney(data.summary.adr)}
                    />
                    <KpiTile
                        label="RevPAR"
                        value={fmtMoney(data.summary.revpar)}
                        sub="Overnight rooms only"
                    />
                </div>
            )}

            {/* Table */}
            {data && (
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-[var(--bg-body)] text-[var(--text-secondary)] uppercase text-xs font-bold border-b border-[var(--border-default)]">
                                <tr>
                                    <th className="px-4 py-3">Room</th>
                                    <th className="px-4 py-3 text-right">Rate</th>
                                    <th className="px-4 py-3">Source</th>
                                    <th className="px-4 py-3">Night</th>
                                    <th className="px-4 py-3 w-full">Guest</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {floors.map(floor => {
                                    const floorRooms = filteredRooms.filter(r => r.floor_number === floor);
                                    const floorRevenue = floorRooms.reduce((acc, r) => acc + (r.nightly_price || 0), 0);
                                    const floorOccupied = floorRooms.filter(r => r.is_occupied).length;

                                    return (
                                        <div key={floor} className="contents">
                                            {/* Floor Header */}
                                            <tr>
                                                <td colSpan={5} className="px-4 py-2 bg-[var(--bg-body)] font-bold text-[var(--text-table-cell)] border-b border-[var(--border-default)]">
                                                    FLOOR {floor}
                                                </td>
                                            </tr>
                                            {/* Rooms */}
                                            {floorRooms.map((r, index) => (
                                                <tr key={r.room_number ?? `room-${floor}-${index}`} className={`hover:bg-[var(--bg-body)] transition-colors ${!r.is_occupied ? "text-[var(--text-muted)] bg-[var(--bg-body)]/50" : ""}`}>
                                                    <td className="px-4 py-3 font-medium">
                                                        {r.room_number}
                                                        {r.is_occupied && <span className="ml-2 inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" title="Occupied" />}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-semibold">
                                                        {!r.is_occupied ? "—" : (r.nightly_price === 0 ? <span className="text-xs bg-[var(--bg-muted)] text-[var(--text-table-cell)] px-2 py-0.5 rounded-full uppercase tracking-wider">Comp</span> : fmtMoney(r.nightly_price))}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {r.is_occupied && r.source ? (
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`w-2 h-2 rounded-full ${SOURCE_COLOR[r.source.toLowerCase()] || "bg-slate-400"}`} />
                                                                {SOURCE_LABEL[r.source.toLowerCase()] || r.source}
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                                                        {r.is_occupied ? r.night_label : null}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {r.is_occupied ? (
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-[var(--text-primary)]">{r.guest_name || "Unknown"}</span>
                                                                {r.booking_code && <span className="text-xs text-[var(--text-muted)]">({r.booking_code})</span>}
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                            ))}
                                            {/* Floor Subtotal */}
                                            <tr className="bg-[var(--bg-body)]/50 text-xs text-[var(--text-secondary)]">
                                                <td colSpan={5} className="px-4 py-2 pl-6">
                                                    (subtotal: <span className="font-semibold">{fmtMoney(floorRevenue)}</span> · {floorOccupied} occupied)
                                                </td>
                                            </tr>
                                        </div>
                                    );
                                })}

                                {showDayUse && dUserRooms.length > 0 && (() => {
                                    return (
                                        <>
                                            <tr>
                                                <td colSpan={5} className="px-4 py-2 bg-rose-50/50 font-bold text-rose-800 border-b border-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25">
                                                    DAY USE
                                                </td>
                                            </tr>
                                            {dUserRooms.map(du => (
                                                <tr key={`du-${du.room_number}`} className="hover:bg-[var(--bg-body)]">
                                                    <td className="px-4 py-3 font-medium">{du.room_number}</td>
                                                    <td className="px-4 py-3 text-right font-semibold">{fmtMoney(du.revenue)}</td>
                                                    <td className="px-4 py-3 text-[var(--text-secondary)]">—</td>
                                                    <td className="px-4 py-3 text-[var(--text-secondary)]">{du.sessions} sess</td>
                                                    <td className="px-4 py-3 font-semibold text-[var(--text-primary)] text-sm">Day Use Daily Revenue</td>
                                                </tr>
                                            ))}
                                            <tr className="bg-rose-50/30 text-xs text-rose-600/70 dark:bg-rose-500/5 dark:text-rose-400/60">
                                                <td colSpan={5} className="px-4 py-2 pl-6">
                                                    (subtotal: <span className="font-semibold">{fmtMoney(data.summary.dayuse_revenue)}</span>)
                                                </td>
                                            </tr>
                                        </>
                                    );
                                })()}

                                {(data.summary.extra_revenue !== 0 || extraChargeRows.length > 0) && (
                                    <>
                                        <tr>
                                            <td colSpan={5} className="px-4 py-2 bg-sky-50/50 font-bold text-sky-800 border-b border-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25">
                                                EXTRA CHARGE
                                            </td>
                                        </tr>
                                        {extraChargeRows.length > 0 ? (
                                            extraChargeRows.map((charge, index) => (
                                                <tr key={charge.id ?? `extra-${index}`} className="hover:bg-[var(--bg-body)]">
                                                    <td className="px-4 py-3 font-medium text-[var(--text-table-cell)]">
                                                        {charge.room_number ?? "Unassigned"}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-semibold">{fmtSignedMoney(charge.amount)}</td>
                                                    <td className="px-4 py-3 text-[var(--text-secondary)]">Extra Charge</td>
                                                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                                                        {charge.is_record_only ? "Record only" : charge.tx_type}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-semibold text-[var(--text-primary)]">
                                                                {charge.note || "Posted folio charge"}
                                                            </span>
                                                            {charge.guest_name && <span className="text-xs text-[var(--text-muted)]">{charge.guest_name}</span>}
                                                            {charge.booking_code && <span className="text-xs text-[var(--text-muted)]">({charge.booking_code})</span>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr className="hover:bg-[var(--bg-body)]">
                                                <td className="px-4 py-3 font-medium text-[var(--text-table-cell)]">Extra Charge</td>
                                                <td className="px-4 py-3 text-right font-semibold">{fmtMoney(data.summary.extra_revenue)}</td>
                                                <td className="px-4 py-3 text-[var(--text-secondary)]" colSpan={3}>Posted folio charges, including unpaid post-only charges</td>
                                            </tr>
                                        )}
                                        <tr className="bg-sky-50/30 text-xs text-sky-600/70 dark:bg-sky-500/5 dark:text-sky-400/60">
                                            <td colSpan={5} className="px-4 py-2 pl-6">
                                                (subtotal: <span className="font-semibold">{fmtMoney(data.summary.extra_revenue)}</span>)
                                            </td>
                                        </tr>
                                    </>
                                )}

                                {showPos && data.pos_total > 0 && (() => {
                                    return (
                                        <>
                                            <tr>
                                                <td colSpan={5} className="px-4 py-2 bg-amber-50/50 font-bold text-amber-800 border-b border-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25">
                                                    POS / F&B
                                                </td>
                                            </tr>
                                            <tr className="hover:bg-[var(--bg-body)]">
                                                <td className="px-4 py-3 font-medium text-[var(--text-table-cell)]">POS</td>
                                                <td className="px-4 py-3 text-right font-semibold">{fmtMoney(data.pos_total)}</td>
                                                <td className="px-4 py-3" colSpan={3}></td>
                                            </tr>
                                        </>
                                    )
                                })()}

                            </tbody>
                            <tfoot className="bg-[var(--bg-muted)] border-t-2 border-[var(--border-input)]">
                                <tr>
                                    <td className="px-4 py-4 font-black text-[var(--text-primary)] text-lg uppercase tracking-wider">
                                        Total
                                    </td>
                                    <td className="px-4 py-4 text-right font-black text-brand-700 text-xl">
                                        {fmtMoney(totalDisplayed)}
                                    </td>
                                    <td colSpan={3}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
