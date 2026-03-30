"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReservationDetailPage from "@/components/reservation-detail-page";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import { formatShortGroupCode } from "@/lib/group-label";
import CancelFeeModal, { type CancelFeePayload } from "@/components/cancel-fee-modal";
import { LinkedStayBadge } from "@/components/linked-stay-badge";
import type { LinkedStaySegment } from "@/lib/types";
import { formatDateDisplay } from "@/lib/date-display";

/* ─── Types ───────────────────────────────────── */
type ResStatus = "active" | "cancelled" | "checked_out" | "no_show";

type Reservation = {
    id: string;
    booking_code: string;
    booking_group_id?: string | null;
    parent_reservation_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone?: string | null;
    source: string;
    status: ResStatus;
    checkin_date: string;
    checkout_date: string;
    checkin_time?: string | null;
    checked_in_at?: string | null;
    checked_out_at?: string | null;
    note?: string | null;
    total_price: number;
    created_at: string;
    room_number: string;
    room_type: string;
    nights: number;
    linked_segments?: LinkedStaySegment[] | null;
    linked_full_checkin?: string | null;
    linked_full_checkout?: string | null;
    linked_active_segment_id?: string | null;
};

/* ─── Display helpers ─────────────────────────── */
const STATUS_STYLE: Record<ResStatus, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
    cancelled: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400",
    checked_out: "bg-[var(--bg-surface-hover)] text-[var(--text-muted)] dark:bg-emerald-500/15 dark:text-emerald-400",
    no_show: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
};
const STATUS_LABEL: Record<ResStatus, string> = {
    active: "Active",
    cancelled: "Cancelled",
    checked_out: "Checked Out",
    no_show: "No Show"
};
const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in", ota: "OTA", direct: "Direct", agent: "Agent"
};
const SOURCE_COLOR: Record<string, string> = {
    walkin: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400",
    ota: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
    direct: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
    agent: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
};
const STATUS_SORT_RANK: Record<ResStatus, number> = {
    active: 0,
    checked_out: 1,
    cancelled: 2,
    no_show: 3
};

function fmt(n: number) { return n.toLocaleString("th-TH"); }

function toBangkokDateInput(value: Date): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(value);
}

function toBangkokTime(value?: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("th-TH", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);
}

/* ─── Main Page ───────────────────────────────── */
export default function ReservationsPage() {
    const defaultStatus = "active";
    const defaultDateFrom = toBangkokDateInput(new Date());
    const defaultDateTo = toBangkokDateInput(new Date());

    // Filters
    const [q, setQ] = useState("");
    const [status, setStatus] = useState(defaultStatus);
    const [source, setSource] = useState("");
    const [dateFrom, setDateFrom] = useState(defaultDateFrom);
    const [dateTo, setDateTo] = useState(defaultDateTo);
    const [page, setPage] = useState(1);

    // Data
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Modals
    const [detailMode, setDetailMode] = useState<"create" | "edit" | null>(null);
    const [detailResId, setDetailResId] = useState<string | undefined>();
    const [detailPrefill, setDetailPrefill] = useState<{
        roomTypeId?: string;
        checkinDate?: string;
        checkoutDate?: string;
    }>({});
    const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);
    const [toast, setToast] = useState("");

    const PAGE_SIZE = 30;
    const hasAnyFilter = Boolean(
        q.trim() ||
        source ||
        status !== defaultStatus ||
        dateFrom !== defaultDateFrom ||
        dateTo !== defaultDateTo
    );

    function clearFilters() {
        setQ("");
        setStatus(defaultStatus);
        setSource("");
        setDateFrom(defaultDateFrom);
        setDateTo(defaultDateTo);
        setPage(1);
    }

    const load = useCallback(async (pg = page) => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (status && status !== "all") params.set("status", status);
            if (source) params.set("source", source);
            if (dateFrom) params.set("date_from", dateFrom);
            if (dateTo) params.set("date_to", dateTo);
            params.set("page", String(pg));

            const res = await fetch(`/api/reservations?${params.toString()}`);
            const d = await res.json();
            if (d.success) {
                const sortedReservations = [...(d.reservations ?? [])].sort((a: Reservation, b: Reservation) => {
                    const checkinDiff = String(a.checkin_date).localeCompare(String(b.checkin_date));
                    if (checkinDiff !== 0) return checkinDiff;
                    const rankDiff = STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status];
                    if (rankDiff !== 0) return rankDiff;
                    return String(a.created_at).localeCompare(String(b.created_at));
                });
                setReservations(sortedReservations);
                setTotal(d.total);
            } else {
                setError(d.error ?? "Failed to load.");
            }
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, [q, status, source, dateFrom, dateTo, page]);

    // Load on mount
    useEffect(() => { load(1); setPage(1); }, [q, status, source, dateFrom, dateTo]); // eslint-disable-line

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const openReservationId = params.get("open");
        const isNewReservation = params.get("new") === "1";
        if (!openReservationId) return;
        if (isNewReservation) return;
        setDetailMode("edit");
        setDetailResId(openReservationId);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("new") !== "1") return;
        setDetailMode("create");
        setDetailResId(undefined);
        setDetailPrefill({
            roomTypeId: params.get("room_type_id") ?? undefined,
            checkinDate: params.get("checkin_date") ?? undefined,
            checkoutDate: params.get("checkout_date") ?? undefined,
        });
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete("new");
        cleaned.searchParams.delete("room_type_id");
        cleaned.searchParams.delete("room_type_name");
        cleaned.searchParams.delete("checkin_date");
        cleaned.searchParams.delete("checkout_date");
        window.history.replaceState({}, "", cleaned.toString());
    }, []);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    }

    function handleCancel(res: Reservation) {
        setCancelTarget(res);
    }

    async function executeCancel(payload: CancelFeePayload) {
        if (!cancelTarget) return;
        setCancelSubmitting(true);
        try {
            const bodyPayload: Record<string, unknown> = {
                cancel_reason: payload.cancel_reason,
            };
            if (payload.fee_amount && payload.fee_amount > 0) {
                bodyPayload.fee_amount = payload.fee_amount;
                if (payload.fee_collect_method) {
                    bodyPayload.fee_collect_method = payload.fee_collect_method;
                }
                bodyPayload.fee_note = payload.fee_note?.trim() || undefined;
            }
            if (payload.refund_method) bodyPayload.refund_method = payload.refund_method;
            if (payload.refund_note?.trim()) bodyPayload.refund_note = payload.refund_note.trim();

            const r = await fetch(`/api/bookings/${cancelTarget.id}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
                showToast(`✓ Cancelled: ${cancelTarget.guest_name}`);
                setCancelTarget(null);
                load(page);
            } else {
                showToast(`Error: ${d.error ?? "Failed to cancel booking."}`);
            }
        } catch {
            showToast("Network error.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="space-y-5 w-full max-w-[90rem]">
            <NightAuditPendingPopup pageName="Reservations" />
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Reservations</h1>
                    {total > 0 && !loading && (
                        <p className="text-sm text-[var(--text-muted)] mt-1">{total.toLocaleString()} reservation{total !== 1 ? "s" : ""}</p>
                    )}
                </div>
                <button className="btn btn-primary" onClick={() => { setDetailMode("create"); setDetailResId(undefined); }}>+ New Booking</button>
            </div>

            {/* Filter bar */}
            <div className="card p-4 flex flex-wrap gap-3 items-end">
                {/* Search */}
                <div className="flex-1 min-w-[180px]">
                    <label className="form-label">Guest Name</label>
                    <div className="relative">
                        <input
                            className="form-input"
                            placeholder="Search name…"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                </div>

                {/* Status */}
                <div>
                    <label className="form-label">Status</label>
                    <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="checked_out">Checked Out</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="no_show">No Show</option>
                    </select>
                </div>

                {/* Source */}
                <div>
                    <label className="form-label">Source</label>
                    <select className="form-select" value={source} onChange={(e) => setSource(e.target.value)}>
                        <option value="">All Sources</option>
                        <option value="walkin">Walk-in</option>
                        <option value="ota">OTA</option>
                        <option value="direct">Direct</option>
                        <option value="agent">Agent</option>
                    </select>
                </div>

                {/* Date range */}
                <div>
                    <label className="form-label">Date From</label>
                    <input
                        type="date"
                        className="form-input"
                        value={dateFrom}
                        onChange={(e) => {
                            const next = e.target.value;
                            setDateFrom(next);
                            if (next && dateTo && dateTo < next) {
                                setDateTo(next);
                            }
                        }}
                    />
                </div>
                <div>
                    <label className="form-label">Date To</label>
                    <input
                        type="date"
                        className="form-input"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(e) => setDateTo(e.target.value)}
                    />
                </div>

                {/* Clear */}
                {hasAnyFilter && (
                    <button
                        className="btn btn-ghost btn-sm self-end"
                        onClick={clearFilters}
                    >
                        ✕ Clear
                    </button>
                )}
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            )}

            {/* Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-6 space-y-2">
                        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--bg-muted)]" />)}
                    </div>
                ) : reservations.length === 0 ? (
                    <div className="p-12 text-center">
                        <p className="text-3xl mb-2">📋</p>
                        <p className="text-[var(--text-muted)] font-medium">No reservations found</p>
                        <p className="text-[var(--text-muted)] text-sm mt-1">Try adjusting your filters</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Room</th>
                                <th>Guest</th>
                                <th>Source</th>
                                <th>Check-in</th>
                                <th>Check-out</th>
                                <th>Nights</th>
                                <th>Total</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reservations.map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <div className="font-bold text-[var(--text-primary)]">Room {r.room_number}</div>
                                        <div className="text-xs text-[var(--text-muted)]">{r.room_type}</div>
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-2">
                                            <div className="font-semibold text-[var(--text-primary)]">{r.guest_name}</div>
                                            {r.booking_group_id && (
                                                <Link
                                                    href={`/pms/groups?group_id=${r.booking_group_id}`}
                                                    className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-500/30 transition-colors"
                                                    title={r.group_name ?? "Open Group Booking"}
                                                >
                                                    {formatShortGroupCode(r.group_code)}
                                                </Link>
                                            )}
                                        </div>
                                        {r.linked_segments && r.linked_segments.length > 0 && (
                                            <LinkedStayBadge
                                                segments={r.linked_segments}
                                                activeSegmentId={r.linked_active_segment_id ?? r.id}
                                            />
                                        )}
                                        {r.phone && <div className="text-xs text-[var(--text-muted)]">{r.phone}</div>}
                                    </td>
                                    <td>
                                        <span className={`badge ${SOURCE_COLOR[r.source] ?? "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"}`}>
                                            {SOURCE_LABEL[r.source] ?? r.source}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="text-sm font-medium">{formatDateDisplay(r.checkin_date)}</div>
                                        {toBangkokTime(r.checked_in_at) ? (
                                            <div className="text-xs text-emerald-600">C/I {toBangkokTime(r.checked_in_at)}</div>
                                        ) : (
                                            r.checkin_time && <div className="text-xs text-emerald-600">{r.checkin_time}</div>
                                        )}
                                    </td>
                                    <td>
                                        <div className="text-sm font-medium">{formatDateDisplay(r.checkout_date)}</div>
                                        {toBangkokTime(r.checked_out_at) && (
                                            <div className="text-xs text-rose-600">{toBangkokTime(r.checked_out_at)}</div>
                                        )}
                                    </td>
                                    <td className="text-sm text-center font-medium">{r.nights}</td>
                                    <td>
                                        <span className="font-semibold text-[var(--text-primary)]">฿{fmt(r.total_price)}</span>
                                    </td>
                                    <td>
                                        <span className={`badge ${STATUS_STYLE[r.status]}`}>
                                            {STATUS_LABEL[r.status] ?? r.status}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="flex gap-1">
                                            {r.status === "active" && (
                                                <>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => { setDetailMode("edit"); setDetailResId(r.id); }}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="btn btn-danger btn-sm bg-rose-600 border-rose-600 hover:bg-rose-700 dark:bg-rose-500/30 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/40"
                                                        disabled={cancelSubmitting && cancelTarget?.id === r.id}
                                                        onClick={() => handleCancel(r)}
                                                    >
                                                        {cancelSubmitting && cancelTarget?.id === r.id ? "..." : "Cancel"}
                                                    </button>
                                                </>
                                            )}
                                            {r.status !== "active" && (
                                                <>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => { setDetailMode("edit"); setDetailResId(r.id); }}
                                                    >
                                                        View
                                                    </button>
                                                    <span className="text-xs text-[var(--text-muted)]">{r.booking_code}</span>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">
                        Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                    </span>
                    <div className="flex gap-1">
                        <button
                            className="btn btn-secondary btn-sm"
                            disabled={page <= 1}
                            onClick={() => { setPage(page - 1); load(page - 1); }}
                        >
                            ‹ Prev
                        </button>
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((pg) => (
                            <button
                                key={pg}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${pg === page
                                        ? "border-brand-400 bg-brand-600 text-white"
                                        : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                    }`}
                                onClick={() => { setPage(pg); load(pg); }}
                            >
                                {pg}
                            </button>
                        ))}
                        <button
                            className="btn btn-secondary btn-sm"
                            disabled={page >= totalPages}
                            onClick={() => { setPage(page + 1); load(page + 1); }}
                        >
                            Next ›
                        </button>
                    </div>
                </div>
            )}

            {/* Reservation Detail Page */}
            {detailMode && (
                <ReservationDetailPage
                    mode={detailMode}
                    reservationId={detailResId}
                    initialRoomTypeId={detailMode === "create" ? detailPrefill.roomTypeId : undefined}
                    initialCheckinDate={detailMode === "create" ? detailPrefill.checkinDate : undefined}
                    initialCheckoutDate={detailMode === "create" ? detailPrefill.checkoutDate : undefined}
                    onClose={() => {
                        setDetailMode(null);
                        setDetailResId(undefined);
                        setDetailPrefill({});
                    }}
                    onSuccess={() => {
                        setDetailMode(null);
                        setDetailResId(undefined);
                        setDetailPrefill({});
                        showToast(detailMode === "create" ? "✓ Booking created!" : "✓ Booking updated!");
                        load(page);
                    }}
                />
            )}

            <CancelFeeModal
                isOpen={Boolean(cancelTarget)}
                reservationId={cancelTarget?.id ?? ""}
                guestName={cancelTarget?.guest_name ?? "Reservation"}
                onClose={() => {
                    if (!cancelSubmitting) setCancelTarget(null);
                }}
                onConfirm={executeCancel}
            />

            {/* Toast */}
            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">{toast}</div>
            )}
        </div>
    );
}
