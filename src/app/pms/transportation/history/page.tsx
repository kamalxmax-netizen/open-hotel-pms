"use client";

import { Fragment, useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────
interface TransferRow {
    id: string;
    guest_name: string;
    booking_code?: string;
    room_number?: string;
    transfer_type: string;
    service_mode: string;
    pickup_datetime: string;
    pickup_location: string;
    dropoff_location: string;
    pax: number;
    driver_id?: string;
    driver_name?: string;
    driver_phone?: string;
    boat_company_name?: string;
    selling_price: number | null;
    cost_price: number | null;
    actual_price: number | null;
    driver_fee: number | null;
    driver_commission: number | null;
    net_commission: number | null;
    payment_status: string;
    status: string;
    staff_note?: string | null;
}

interface Voucher {
    id: string;
    voucher_number: string;
    guest_name: string;
    route_description: string | null;
    departure_time: string | null;
    pier_name: string | null;
    boat_company_name: string | null;
    pickup_time: string | null;
    pickup_location: string | null;
    driver_name: string | null;
    driver_phone: string | null;
    vehicle_info: string | null;
    special_instructions: string | null;
}

const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    confirmed: "bg-blue-100 text-blue-800",
    driver_assigned: "bg-indigo-100 text-indigo-800",
    in_progress: "bg-green-100 text-green-800",
    completed: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-800",
    no_show: "bg-gray-100 text-gray-800",
};

const TYPE_ICONS: Record<string, string> = {
    airport_pickup: "✈️", airport_dropoff: "✈️", hotel_to_anywhere: "🚗", bus_ferry_pickup: "⛵", ticket_only: "🎫",
};

const CANCELLABLE = ["pending", "confirmed", "driver_assigned"];
const COMPLETABLE = ["in_progress"];
const IN_PROGRESS_LEAD_MINUTES = 30;

function formatDate(dt: string) {
    try { return new Date(dt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }); }
    catch { return "—"; }
}
function formatTime(dt: string) {
    try { return new Date(dt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
    catch { return "—"; }
}

function canStartInProgressNow(pickupDatetime: string): boolean {
    const pickupMs = new Date(pickupDatetime).getTime();
    if (Number.isNaN(pickupMs)) return false;
    return Date.now() >= pickupMs - IN_PROGRESS_LEAD_MINUTES * 60 * 1000;
}

function formatBangkokDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

function earliestInProgressLabel(pickupDatetime: string): string {
    const pickupMs = new Date(pickupDatetime).getTime();
    if (Number.isNaN(pickupMs)) return "invalid pickup time";
    return formatBangkokDateTime(new Date(pickupMs - IN_PROGRESS_LEAD_MINUTES * 60 * 1000).toISOString());
}

// ─── Rating form ──────────────────────────────────────
function RatingForm({ transferId, onSaved }: { transferId: string; onSaved: () => void }) {
    const [punct, setPunct] = useState(5);
    const [value, setValue] = useState(5);
    const [service, setService] = useState(5);
    const [comment, setComment] = useState("");
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/transportation/ratings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ transfer_id: transferId, score_punctuality: punct, score_value: value, score_service: service, comment: comment.trim() || null }),
            });
            const json = await res.json();
            if (json.success) { setDone(true); onSaved(); }
            else alert(json.error ?? "Failed to save rating");
        } finally { setSaving(false); }
    }

    if (done) return <p className="text-xs text-emerald-600 font-medium">✓ Rating saved</p>;

    return (
        <form onSubmit={submit} className="mt-3 pt-3 border-t border-[var(--border-default)]">
            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Rate Driver Performance</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
                {[["Punctuality", punct, setPunct], ["Value", value, setValue], ["Service", service, setService]].map(([label, val, set]) => (
                    <div key={label as string}>
                        <label className="block text-[10px] text-[var(--text-muted)] mb-1">{label as string}</label>
                        <select value={val as number} onChange={e => (set as any)(parseInt(e.target.value))}
                            className="w-full px-2 py-1 border border-[var(--border-input)] rounded-lg text-xs focus:ring-1 focus:ring-blue-500">
                            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}
                        </select>
                    </div>
                ))}
            </div>
            <textarea rows={1} value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional comment…"
                className="w-full px-2 py-1 border border-[var(--border-input)] rounded-lg text-xs mb-2 focus:ring-1 focus:ring-blue-500" />
            <button type="submit" disabled={saving} className="px-3 py-1 bg-amber-500 text-white rounded-lg text-xs hover:bg-amber-600 disabled:opacity-60">
                {saving ? "Saving…" : "Submit Rating"}
            </button>
        </form>
    );
}

// ─── Row expand panel ──────────────────────────────────
function ExpandedRow({ transfer, onRefresh }: { transfer: TransferRow; onRefresh: () => void }) {
    const [voucher, setVoucher] = useState<Voucher | null>(null);
    const [loadingVoucher, setLoadingVoucher] = useState(true);
    const [updatingStatus, setUpdatingStatus] = useState(false);

    useEffect(() => {
        setLoadingVoucher(true);
        fetch(`/api/transportation/vouchers?transfer_id=${transfer.id}`)
            .then(r => r.json())
            .then(j => { if (j.success) setVoucher(j.voucher); })
            .catch(() => { })
            .finally(() => setLoadingVoucher(false));
    }, [transfer.id]);

    async function setStatus(newStatus: string) {
        const payload: Record<string, unknown> = { status: newStatus };
        if (newStatus === "cancelled") {
            const reason = window.prompt("Cancel reason (required):", "");
            if (!reason || !reason.trim()) {
                alert("Cancel reason is required.");
                return;
            }
            payload.cancel_reason = reason.trim();
        }
        if (!confirm(`Change status to "${newStatus}"?`)) return;
        setUpdatingStatus(true);
        try {
            const res = await fetch(`/api/transportation/transfers/${transfer.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (json.success) onRefresh();
            else alert(json.error ?? "Failed");
        } finally {
            setUpdatingStatus(false);
        }
    }

    const canStartNow = canStartInProgressNow(transfer.pickup_datetime);
    const earliestStart = earliestInProgressLabel(transfer.pickup_datetime);
    const showInProgressStartButton = transfer.status === "confirmed" || transfer.status === "driver_assigned";

    return (
        <tr>
            <td colSpan={10} className="bg-[var(--bg-body)] px-6 py-4 border-b border-[var(--border-default)]">
                <div className="grid grid-cols-2 gap-6 text-sm">
                    {/* Left: details */}
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-1">Transfer Details</p>
                        <p><span className="text-[var(--text-muted)]">Pickup Time:</span> {formatBangkokDateTime(transfer.pickup_datetime)}</p>
                        <p><span className="text-[var(--text-muted)]">Mode:</span> {transfer.service_mode.replace(/_/g, " ")}</p>
                        <p><span className="text-[var(--text-muted)]">Pax:</span> {transfer.pax}</p>
                        <p><span className="text-[var(--text-muted)]">Pickup:</span> {transfer.pickup_location} → {transfer.dropoff_location}</p>
                        {transfer.driver_name && <p><span className="text-[var(--text-muted)]">Driver:</span> {transfer.driver_name}{transfer.driver_phone ? ` · ${transfer.driver_phone}` : ""}</p>}
                        {transfer.actual_price != null && <p><span className="text-[var(--text-muted)]">Actual Price:</span> ฿{transfer.actual_price.toLocaleString()}</p>}
                        {transfer.driver_fee != null && <p><span className="text-[var(--text-muted)]">Driver Fee:</span> ฿{transfer.driver_fee.toLocaleString()}</p>}
                        {transfer.driver_commission != null && <p><span className="text-[var(--text-muted)]">Driver Commission:</span> ฿{transfer.driver_commission.toLocaleString()}</p>}
                        {transfer.staff_note && <p><span className="text-[var(--text-muted)]">Note:</span> {transfer.staff_note}</p>}

                        {/* Status actions */}
                        <div className="flex flex-wrap gap-2 mt-2">
                            {COMPLETABLE.includes(transfer.status) && (
                                <button onClick={() => setStatus("completed")} disabled={updatingStatus}
                                    className="px-3 py-1 text-xs bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-200 disabled:opacity-50">
                                    ✓ Mark Completed
                                </button>
                            )}
                            {CANCELLABLE.includes(transfer.status) && (
                                <button onClick={() => setStatus("cancelled")} disabled={updatingStatus}
                                    className="px-3 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
                                    ✕ Cancel Transfer
                                </button>
                            )}
                            {showInProgressStartButton && (
                                <button
                                    onClick={() => setStatus("in_progress")}
                                    disabled={updatingStatus || !canStartNow}
                                    title={canStartNow ? "Start now" : `Can start from ${earliestStart} (Asia/Bangkok)`}
                                    className="px-3 py-1 text-xs bg-green-100 text-green-700 border border-green-300 rounded-lg hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    ▶ Start In Progress
                                </button>
                            )}
                            {transfer.status === "in_progress" && (
                                <button onClick={() => setStatus("no_show")} disabled={updatingStatus}
                                    className="px-3 py-1 text-xs bg-gray-100 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                                    No Show
                                </button>
                            )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                            Edit booking is available on Daily Board page as popup.
                        </p>
                        {showInProgressStartButton && !canStartNow && (
                            <p className="text-[11px] text-amber-700">
                                In Progress allowed from {earliestStart} (Asia/Bangkok). If schedule changed, edit pickup time first.
                            </p>
                        )}

                        {/* Driver rating (completed + has driver) */}
                        {transfer.status === "completed" && transfer.driver_id && (
                            <RatingForm transferId={transfer.id} onSaved={onRefresh} />
                        )}
                    </div>

                    {/* Right: voucher */}
                    <div>
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">Voucher</p>
                        {loadingVoucher ? (
                            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                        ) : !voucher ? (
                            <p className="text-xs text-[var(--text-muted)] italic">No voucher found</p>
                        ) : (
                            <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 space-y-1 text-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="font-mono font-bold text-blue-700">{voucher.voucher_number}</p>
                                    <button onClick={() => window.print()} className="px-2 py-1 text-xs border border-[var(--border-input)] rounded-lg hover:bg-[var(--bg-body)]">🖨️ Print</button>
                                </div>
                                {voucher.route_description && <p><span className="text-[var(--text-muted)]">Route:</span> {voucher.route_description}</p>}
                                {voucher.departure_time && <p><span className="text-[var(--text-muted)]">Departs:</span> {voucher.departure_time}</p>}
                                {voucher.pier_name && <p><span className="text-[var(--text-muted)]">Pier:</span> {voucher.pier_name}</p>}
                                {voucher.pickup_time && <p><span className="text-[var(--text-muted)]">Pickup:</span> {voucher.pickup_time}</p>}
                                {voucher.driver_name && <p><span className="text-[var(--text-muted)]">Driver:</span> {voucher.driver_name}</p>}
                                {voucher.vehicle_info && <p><span className="text-[var(--text-muted)]">Vehicle:</span> {voucher.vehicle_info}</p>}
                                {voucher.special_instructions && <p className="text-xs text-amber-700 mt-2 bg-amber-50 rounded p-2">{voucher.special_instructions}</p>}
                            </div>
                        )}
                    </div>
                </div>
            </td>
        </tr>
    );
}

// ─── Main History Page ─────────────────────────────────
export default function TransferHistoryPage() {
    const [transfers, setTransfers] = useState<TransferRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; });
    const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
    const [statusFilter, setStatusFilter] = useState("");
    const [searchQ, setSearchQ] = useState("");

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (dateFrom) params.set("date_from", dateFrom);
            if (dateTo) params.set("date_to", dateTo);
            if (statusFilter) params.set("status", statusFilter);
            if (searchQ.trim()) params.set("q", searchQ.trim());
            params.set("limit", "100");
            const res = await fetch(`/api/transportation/transfers?${params}`);
            const json = await res.json();
            if (json.success) { setTransfers(json.transfers ?? []); setTotal(json.total ?? 0); }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, [dateFrom, dateTo, statusFilter, searchQ]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalRevenue = transfers.reduce((s, t) => s + (t.selling_price ?? 0), 0);
    const totalCommission = transfers.reduce((s, t) => s + (t.net_commission ?? 0), 0);

    return (
        <div className="p-6 max-w-[1400px] mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Transfer History</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Full archive with status management, ratings, and vouchers</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[var(--text-secondary)]">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-[var(--text-secondary)]">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm focus:ring-2 focus:ring-blue-500">
                    <option value="">All Status</option>
                    {["completed", "cancelled", "no_show", "pending", "confirmed", "driver_assigned", "in_progress"].map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                    ))}
                </select>
                <input type="text" placeholder="Search guest…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm w-44 focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Summary */}
            <div className="flex items-center gap-6 mb-4 px-4 py-3 bg-[var(--bg-body)] rounded-xl text-sm">
                <span className="text-[var(--text-secondary)]">Results: <strong>{total}</strong></span>
                <span className="text-[var(--text-secondary)]">Revenue: <strong className="text-emerald-700 font-mono">฿{totalRevenue.toLocaleString()}</strong></span>
                <span className="text-[var(--text-secondary)]">Net Commission: <strong className="text-blue-700 font-mono">฿{totalCommission.toLocaleString()}</strong></span>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                </div>
            ) : transfers.length === 0 ? (
                <div className="text-center py-20 text-[var(--text-muted)]">
                    <p className="text-lg">No transfers found for this period</p>
                </div>
            ) : (
                <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] overflow-hidden shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Date</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Time</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Guest</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Route</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Driver</th>
                                <th className="px-4 py-3 text-right font-semibold text-[var(--text-secondary)]">Sell ฿</th>
                                <th className="px-4 py-3 text-right font-semibold text-[var(--text-secondary)]">Cost ฿</th>
                                <th className="px-4 py-3 text-right font-semibold text-[var(--text-secondary)]">Net ฿</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transfers.map(t => (
                                <Fragment key={t.id}>
                                    <tr
                                        className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-body)] transition-colors cursor-pointer ${expandedId === t.id ? "bg-blue-50" : ""}`}
                                        onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                                        <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{formatDate(t.pickup_datetime)}</td>
                                        <td className="px-4 py-3 font-mono font-semibold">{formatTime(t.pickup_datetime)}</td>
                                        <td className="px-4 py-3 text-lg">{TYPE_ICONS[t.transfer_type] ?? "🚗"}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-[var(--text-primary)]">{t.guest_name}</p>
                                            {t.booking_code && <p className="text-xs text-[var(--text-muted)] font-mono">{t.booking_code}</p>}
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-table-cell)] truncate max-w-[160px]">{t.pickup_location} → {t.dropoff_location}</td>
                                        <td className="px-4 py-3 text-[var(--text-secondary)]">{t.driver_name ?? <span className="text-slate-300">—</span>}</td>
                                        <td className="px-4 py-3 text-right font-mono">{t.selling_price != null ? t.selling_price.toLocaleString() : "—"}</td>
                                        <td className="px-4 py-3 text-right font-mono text-[var(--text-muted)]">{t.cost_price != null ? t.cost_price.toLocaleString() : "—"}</td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-blue-700">{t.net_commission != null ? t.net_commission.toLocaleString() : "—"}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? "bg-gray-100"}`}>
                                                {t.status.replace(/_/g, " ")}
                                            </span>
                                        </td>
                                    </tr>
                                    {expandedId === t.id && <ExpandedRow transfer={t} onRefresh={fetchData} />}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
