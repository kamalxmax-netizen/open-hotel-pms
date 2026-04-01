"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import AssignRoomModal from "@/components/assign-room-modal";
import AutoAssignResultsModal from "@/components/auto-assign-results-modal";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import { formatShortGroupCode } from "@/lib/group-label";
import { resolveGuestLoyaltyVisual } from "@/lib/guest-loyalty";
import { LinkedStayBadge } from "@/components/linked-stay-badge";
import type { LinkedStay } from "@/lib/types";
import { formatDateDisplay } from "@/lib/date-display";

const ReservationDetailPage = dynamic(() => import("@/components/reservation-detail-page"), {
    loading: () => null,
});

type Arrival = {
    id: string;
    booking_code: string;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone?: string | null;
    source: string;
    checkin_date: string;
    checkout_date: string;
    checkin_time?: string | null;
    no_show_fee?: number | null;
    note?: string | null;
    total_price: number;
    room_number: string;
    room_type_id: string;
    room_type: string;
    nights: number;
    vip_tier?: string | null;
    stay_count?: number;
    night_count?: number;
    main_stay_count?: number;
    main_night_count?: number;
    accompanying_stay_count?: number;
    accompanying_night_count?: number;
    open_traces_count: number;
    alerts: string[];
    alert_count?: number;
    first_alert_message?: string | null;
    do_not_move_assigned_room?: boolean;
    do_not_move_reason?: string | null;
    linked_stay?: LinkedStay | null;
};

type NoShowPaymentMethod = "cash" | "transfer" | "credit_card";

const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in", ota: "OTA", direct: "Direct", agent: "Agent"
};

const SOURCE_COLOR: Record<string, string> = {
    walkin: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
    ota: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
    direct: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    agent: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
};

function fmt(n: number) {
    return Number(n ?? 0).toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatB(val: number | undefined | null) {
    if (val === undefined || val === null) return "฿0.00";
    return `฿${Number(val).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseMoneyInput(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * 100) / 100;
}

function formatBusinessDate(dateString: string): string {
    if (!dateString) return "";
    const parsed = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return dateString;
    return parsed.toLocaleDateString("th-TH", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

export default function ArrivalsPage() {
    const [arrivals, setArrivals] = useState<Arrival[]>([]);
    const [searchQ, setSearchQ] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [checkinResId, setCheckinResId] = useState<string | null>(null);
    const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
    const [noShowIds, setNoShowIds] = useState<Set<string>>(new Set());
    const [businessDate, setBusinessDate] = useState("");
    const [toast, setToast] = useState("");
    const [optionsArrival, setOptionsArrival] = useState<Arrival | null>(null);
    const [assignArrival, setAssignArrival] = useState<Arrival | null>(null);
    const [swapArrival, setSwapArrival] = useState<Arrival | null>(null);
    const [showMoreMenu, setShowMoreMenu] = useState<string | null>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (!(event.target as Element).closest(".more-menu-container")) {
                setShowMoreMenu(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    const [markNoShowArrival, setMarkNoShowArrival] = useState<Arrival | null>(null);
    const [chargeAmountInput, setChargeAmountInput] = useState("0");
    const [paymentMethod, setPaymentMethod] = useState<NoShowPaymentMethod>("cash");
    const [actionLoading, setActionLoading] = useState(false);
    const [autoAssigning, setAutoAssigning] = useState(false);
    const [assignResults, setAssignResults] = useState<any[] | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/arrivals");
            const d = await res.json();
            if (d.success) {
                setArrivals(d.arrivals);
                setBusinessDate(String(d.date ?? ""));
            }
            else setError(d.error ?? "Failed to load arrivals.");
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(""), 3000);
    }

    function handleCheckin(arrival: Arrival) {
        if (arrival.room_number === "—") {
            alert("Please assign a room before checking in.");
            return;
        }
        setCheckinResId(arrival.id);
    }

    function handleNoShow(arrival: Arrival) {
        setChargeAmountInput("0");
        setPaymentMethod("cash");
        setMarkNoShowArrival(arrival);
    }

    async function handleMarkNoShowConfirm() {
        if (!markNoShowArrival) return;
        const feeAmount = parseMoneyInput(chargeAmountInput);
        if (feeAmount === null) {
            showToast("Error: Invalid charge amount.");
            return;
        }

        setActionLoading(true);
        const reservationId = markNoShowArrival.id;
        const guestName = markNoShowArrival.guest_name;
        try {
            const res = await fetch(`/api/night-audit/no-shows/${reservationId}/mark`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fee_amount: feeAmount,
                    payment_method: paymentMethod,
                }),
            });
            const d = await res.json();
            if (res.ok && d.success) {
                setNoShowIds((prev) => new Set([...prev, reservationId]));
                setMarkNoShowArrival(null);
                await load();
                const feeNote = (Number(d.fee_amount ?? 0) > 0) ? ` (charged ${formatB(d.fee_amount)})` : "";
                showToast(`⚠ ${guestName} marked as No-Show${feeNote}`);
            } else {
                showToast(`Error: ${d.error ?? "Failed to mark no-show."}`);
            }
        } catch {
            showToast("Network error.");
        } finally {
            setActionLoading(false);
        }
    }

    async function handleAutoAssign() {
        if (!confirm("Automatically assign rooms to all unassigned arrivals?")) return;
        setAutoAssigning(true);
        try {
            const res = await fetch("/api/bookings/auto-assign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(businessDate ? { date: businessDate } : {})
            });
            const d = await res.json();
            if (d.success) {
                setAssignResults(d.results);
                load();
            } else {
                showToast(`Error: ${d.error}`);
            }
        } catch {
            showToast("Network error.");
        } finally {
            setAutoAssigning(false);
        }
    }

    const today = businessDate ? formatBusinessDate(businessDate) : new Date().toLocaleDateString("th-TH", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const normalizedQ = searchQ.trim().toLowerCase();
    const filteredArrivals = normalizedQ
        ? arrivals.filter((a) => {
            const bookingCode = a.booking_code?.toLowerCase() ?? "";
            const guestName = a.guest_name?.toLowerCase() ?? "";
            const phone = a.phone?.toLowerCase() ?? "";
            const otaRef = (a as Arrival & { ota_ref?: string | null }).ota_ref?.toLowerCase() ?? "";
            return (
                bookingCode.includes(normalizedQ) ||
                guestName.includes(normalizedQ) ||
                phone.includes(normalizedQ) ||
                otaRef.includes(normalizedQ)
            );
        })
        : arrivals;

    return (
        <div className="space-y-5 w-full max-w-[90rem]">
            <NightAuditPendingPopup pageName="Arrivals" />
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Arrivals</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{today}</p>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                    <div className="relative min-w-[260px]">
                        <input
                            className="form-input"
                            placeholder="Search name / phone / booking / OTA ref"
                            value={searchQ}
                            onChange={(e) => setSearchQ(e.target.value)}
                        />
                    </div>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={handleAutoAssign}
                        disabled={autoAssigning || arrivals.filter(a => a.room_number === "—").length === 0}
                    >
                        {autoAssigning ? "…" : "🪄 Auto-Assign All"}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={load}>
                        ↻ Refresh
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--bg-muted)]" />
                    ))}
                </div>
            )}

            {/* Empty */}
            {!loading && arrivals.length === 0 && !error && (
                <div className="card p-12 text-center">
                    <p className="text-3xl mb-3">🎉</p>
                    <p className="text-[var(--text-secondary)] font-medium">No arrivals on this business date</p>
                    <p className="text-[var(--text-muted)] text-sm mt-1">All caught up!</p>
                </div>
            )}

            {!loading && arrivals.length > 0 && filteredArrivals.length === 0 && (
                <div className="card p-12 text-center">
                    <p className="text-[var(--text-secondary)] font-medium">No arrivals match this search</p>
                    <p className="text-[var(--text-muted)] text-sm mt-1">Try guest name, phone, booking code, or OTA ref.</p>
                </div>
            )}

            {/* Summary bar */}
            {!loading && arrivals.length > 0 && filteredArrivals.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                    <span className="font-semibold text-[var(--text-table-cell)]">{filteredArrivals.length} arrival{filteredArrivals.length !== 1 ? "s" : ""}</span>
                    {filteredArrivals.length !== arrivals.length && (
                        <>
                            <span className="text-[var(--text-muted)]">/ {arrivals.length} total</span>
                        </>
                    )}
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-emerald-600 font-semibold">{filteredArrivals.filter((a) => doneIds.has(a.id)).length} checked in</span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-amber-600 font-semibold">{filteredArrivals.filter((a) => !doneIds.has(a.id)).length} waiting</span>
                </div>
            )}

            {/* Arrivals table */}
            {!loading && filteredArrivals.length > 0 && (
                <div className="card overflow-visible">
                    <table className="data-table table-fixed w-full">
                        <thead>
                            <tr>
                                <th className="w-[11%]">Room</th>
                                <th className="w-[18%]">Guest</th>
                                <th className="w-[10%]">Source</th>
                                <th className="w-[12%]">Stay</th>
                                <th className="w-[10%]">C/I Time</th>
                                <th className="w-[10%]">Total</th>
                                <th className="w-[29%]">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredArrivals.map((a) => {
                                const done = doneIds.has(a.id);
                                const isNoShow = noShowIds.has(a.id);
                                const loyaltyVisual = resolveGuestLoyaltyVisual(a);
                                const stayCheckin = a.linked_stay?.full_checkin ?? a.checkin_date;
                                const stayCheckout = a.linked_stay?.full_checkout ?? a.checkout_date;
                                const stayNights = a.linked_stay?.full_nights ?? a.nights;
                                return (
                                    <tr
                                        key={a.id}
                                        className={done ? "opacity-50 bg-[var(--bg-body)] [&>td]:bg-[var(--bg-body)]" : isNoShow ? "bg-[var(--bg-body)] [&>td]:bg-[var(--bg-body)]" : loyaltyVisual.rowClass}
                                    >
                                        <td>
                                            <div className="font-bold text-[var(--text-primary)]">Room {a.room_number}</div>
                                            <div className="text-xs text-[var(--text-muted)]">{a.room_type}</div>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className="font-semibold text-[var(--text-primary)] min-w-0 flex-1 truncate" title={a.guest_name}>
                                                    {a.guest_name}
                                                </div>
                                                {a.booking_group_id && (
                                                    <Link
                                                        href={`/pms/groups?group_id=${a.booking_group_id}`}
                                                        className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-200 transition-colors"
                                                        title={a.group_name ?? "Open Group Booking"}
                                                    >
                                                        {formatShortGroupCode(a.group_code)}
                                                    </Link>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                                {(a.alert_count ?? a.alerts?.length ?? 0) > 0 && (
                                                    <span className="badge bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] dark:bg-rose-500/10 dark:text-rose-400" title={a.first_alert_message ?? "Alerts Present"}>
                                                        🔴 {a.alert_count ?? a.alerts.length}
                                                    </span>
                                                )}
                                                {a.do_not_move_assigned_room && (
                                                    <span
                                                        className="badge bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 text-[10px] dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"
                                                        title={a.do_not_move_reason || "Assigned room is locked"}
                                                    >
                                                        🔒 Do Not Move
                                                    </span>
                                                )}
                                                {a.open_traces_count > 0 && (
                                                    <span className="badge bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] dark:bg-amber-500/10 dark:text-amber-400" title="Open Traces">
                                                        🟠 {a.open_traces_count}
                                                    </span>
                                                )}
                                            </div>
                                            {a.phone && <div className="text-xs text-[var(--text-muted)]">{a.phone}</div>}
                                        </td>
                                        <td>
                                            <span className={`badge ${SOURCE_COLOR[a.source] ?? "bg-[var(--bg-muted)] text-[var(--text-secondary)]"}`}>
                                                {SOURCE_LABEL[a.source] ?? a.source}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="text-sm">{formatDateDisplay(stayCheckin)}</div>
                                            <div className="text-xs text-[var(--text-muted)]">→ {formatDateDisplay(stayCheckout)} ({stayNights}N)</div>
                                            {a.linked_stay && (
                                                <div className="mt-1" title="Linked stay / in-house move segment">
                                                    <LinkedStayBadge
                                                        segments={a.linked_stay.segments}
                                                        activeSegmentId={a.linked_stay.active_segment_id || a.id}
                                                    />
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {a.checkin_time ? (
                                                <span className="text-sm font-semibold text-amber-700">{a.checkin_time}</span>
                                            ) : (
                                                <span className="text-xs text-[var(--text-muted)]">—</span>
                                            )}
                                        </td>
                                        <td>
                                            <span className="font-semibold text-[var(--text-primary)]">฿{fmt(a.total_price)}</span>
                                        </td>
                                        <td>
                                            {done ? (
                                                <div className="flex gap-2 items-center">
                                                    <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">✓ Checked In</span>
                                                    <button className="btn btn-secondary btn-sm flex items-center gap-1" onClick={() => setOptionsArrival(a)}>
                                                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.179.972.413 1.416.697l1.394-.599a1 1 0 011.118.23l.962.962a1 1 0 01.23 1.118l-.6 1.394c.285.444.519.919.697 1.416l1.474.295A1 1 0 0119 10.68v1.36a1 1 0 01-.804.98l-1.473.295c-.179.497-.413.972-.697 1.416l.599 1.394a1 1 0 01-.23 1.118l-.962.962a1 1 0 01-1.118.23l-1.394-.6c-.444.285-.919.519-1.416.697l-.295 1.474A1 1 0 0110.68 19H9.32a1 1 0 01-.98-.804l-.295-1.473a7.957 7.957 0 01-1.416-.697l-1.394.599a1 1 0 01-1.118-.23l-.962-.962a1 1 0 01-.23-1.118l.6-1.394a7.957 7.957 0 01-.697-1.416l-1.474-.295A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.179-.497.413-.972.697-1.416l-.599-1.394a1 1 0 01.23-1.118l.962-.962a1 1 0 011.118-.23l1.394.6c.444-.285.919-.519 1.416-.697l.295-1.474z" clipRule="evenodd" />
                                                            <path fillRule="evenodd" d="M10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                                                        </svg>
                                                        Options
                                                    </button>
                                                </div>
                                            ) : isNoShow ? (
                                                <span className="badge bg-[var(--bg-muted)] text-[var(--text-secondary)]">No-Show</span>
                                            ) : (
                                                <div className="flex gap-1 items-center">
                                                    {a.room_number === "—" ? (
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => setAssignArrival(a)}
                                                        >
                                                            Assign Room
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => handleCheckin(a)}
                                                        >
                                                            Check-in
                                                        </button>
                                                    )}

                                                    <button
                                                        className="btn btn-secondary btn-sm flex items-center gap-1"
                                                        onClick={() => setOptionsArrival(a)}
                                                    >
                                                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                                                        </svg>
                                                        Options
                                                    </button>

                                                    <div className="relative more-menu-container">
                                                        <button
                                                            className="btn btn-secondary btn-sm flex items-center gap-1"
                                                            onClick={() => setShowMoreMenu(prev => prev === a.id ? null : a.id)}
                                                        >
                                                            More
                                                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                                            </svg>
                                                        </button>
                                                        {showMoreMenu === a.id && (
                                                            <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg py-1">
                                                                {a.room_number !== "—" && (
                                                                    <button
                                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2"
                                                                        onClick={() => { setShowMoreMenu(null); setSwapArrival(a); }}
                                                                    >
                                                                        🔄 Swap Room
                                                                    </button>
                                                                )}
                                                                {a.room_number !== "—" && <hr className="my-1 border-[var(--border-default)]" />}
                                                                <button
                                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2 text-rose-600"
                                                                    onClick={() => { setShowMoreMenu(null); handleNoShow(a); }}
                                                                >
                                                                    🚫 No-Show
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Options Panel */}
            {optionsArrival && (
                <ReservationOptionsPanel
                    reservationId={optionsArrival.id}
                    guestName={optionsArrival.guest_name}
                    checkinDate={optionsArrival.checkin_date}
                    checkoutDate={optionsArrival.checkout_date}
                    onClose={() => {
                        setOptionsArrival(null);
                        load(); // refresh alerts/traces after closing
                    }}
                />
            )}

            {/* Assign Room Modal */}
            {assignArrival && (
                <AssignRoomModal
                    reservationId={assignArrival.id}
                    roomTypeId={assignArrival.room_type_id}
                    roomTypeName={assignArrival.room_type}
                    guestName={assignArrival.guest_name}
                    checkinDate={assignArrival.checkin_date}
                    checkoutDate={assignArrival.checkout_date}
                    onClose={() => setAssignArrival(null)}
                    onSuccess={() => {
                        setAssignArrival(null);
                        load();
                        showToast(`✓ Room assigned to ${assignArrival.guest_name}`);
                    }}
                />
            )}

            {swapArrival && (
                <AssignRoomModal
                    reservationId={swapArrival.id}
                    roomTypeId={swapArrival.room_type_id}
                    roomTypeName={swapArrival.room_type}
                    guestName={swapArrival.guest_name}
                    checkinDate={swapArrival.checkin_date}
                    checkoutDate={swapArrival.checkout_date}
                    mode="swap"
                    currentRoomNumber={swapArrival.room_number}
                    onClose={() => setSwapArrival(null)}
                    onSuccess={() => {
                        setSwapArrival(null);
                        load();
                        showToast(`✓ Room swapped for ${swapArrival.guest_name}`);
                    }}
                />
            )}

            {/* Auto Assign Results Modal */}
            {assignResults && (
                <AutoAssignResultsModal
                    results={assignResults}
                    onClose={() => setAssignResults(null)}
                />
            )}

            {/* Check-in Detail Page */}
            {checkinResId && (
                <ReservationDetailPage
                    mode="checkin"
                    reservationId={checkinResId}
                    onClose={() => setCheckinResId(null)}
                    onSuccess={async () => {
                        const activeReservationId = checkinResId;
                        let isCheckedIn = false;

                        if (activeReservationId) {
                            try {
                                const statusRes = await fetch(`/api/bookings/${activeReservationId}`);
                                const statusData = await statusRes.json().catch(() => null);
                                isCheckedIn = Boolean(statusData?.success && statusData?.reservation?.checked_in_at);
                            } catch {
                                // Keep conservative fallback below.
                            }
                        }

                        if (activeReservationId) {
                            setDoneIds((prev) => {
                                const next = new Set(prev);
                                if (isCheckedIn) next.add(activeReservationId);
                                else next.delete(activeReservationId);
                                return next;
                            });
                        }

                        showToast(isCheckedIn ? "✓ Checked in successfully" : "✓ Draft saved");
                        setCheckinResId(null);
                        await load();
                    }}
                />
            )}

            {/* Mark No-Show Dialog */}
            {markNoShowArrival && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-sm rounded-xl bg-[var(--bg-surface)] p-6 shadow-lg">
                        <h3 className="text-lg font-bold text-rose-700 mb-2">Mark as No-Show?</h3>
                        <div className="mb-6 space-y-3">
                            <p className="text-sm text-[var(--text-secondary)]">
                                Enter charge amount for <span className="font-semibold text-[var(--text-primary)]">{markNoShowArrival.guest_name}</span>. Default is 0 (no charge).
                            </p>
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-table-cell)] mb-1">Charge Amount (THB)</label>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="w-full rounded-lg border border-[var(--border-input)] p-2 text-sm bg-[var(--bg-surface)]"
                                    value={chargeAmountInput}
                                    onChange={(e) => setChargeAmountInput(e.target.value)}
                                    disabled={actionLoading}
                                />
                            </div>
                            <label className="block text-xs font-semibold text-[var(--text-table-cell)] mb-1">Charge From</label>
                            <select
                                className="w-full rounded-lg border border-[var(--border-input)] p-2 text-sm bg-[var(--bg-surface)]"
                                value={paymentMethod}
                                onChange={(e) => setPaymentMethod(e.target.value as NoShowPaymentMethod)}
                                disabled={actionLoading}
                            >
                                <option value="cash">Cash</option>
                                <option value="transfer">Bank Transfer</option>
                                <option value="credit_card">Credit Card</option>
                            </select>
                        </div>

                        <div className="flex flex-col sm:flex-row justify-end gap-3">
                            <button
                                onClick={() => setMarkNoShowArrival(null)}
                                disabled={actionLoading}
                                className="w-full sm:w-auto justify-center rounded-lg border border-[var(--border-input)] px-4 py-2 text-sm font-medium text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleMarkNoShowConfirm}
                                disabled={actionLoading}
                                className="w-full sm:w-auto justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {actionLoading ? "Processing..." : "Confirm No-Show"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">
                    {toast}
                </div>
            )}
        </div>
    );
}
