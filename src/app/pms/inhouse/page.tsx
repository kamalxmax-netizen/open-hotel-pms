"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import RoomMoveModal from "@/components/room-move-modal";
import ReservationDetailPage from "@/components/reservation-detail-page";
import DayUseExtendModal from "@/components/dayuse-extend-modal";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import LinkedExtensionModal from "@/components/linked-extension-modal";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatShortGroupCode } from "@/lib/group-label";
import { DayUseTimer } from "@/components/dayuse-timer";
import { resolveGuestLoyaltyVisual } from "@/lib/guest-loyalty";
import { groupLinkedStays } from "@/lib/linked-stay-ui";
import { LinkedStayBadge } from "@/components/linked-stay-badge";
import type { DayUseReservation, LinkedStaySegment } from "@/lib/types";

type InHouseReservation = {
    id: string;
    booking_code: string;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone?: string | null;
    source: "walkin" | "ota" | "direct" | "agent";
    room_number: string;
    room_type: string;
    room_type_id: string;
    checkin_date: string;
    checkout_date: string;
    checked_in_at?: string | null;
    nights_remaining: number;
    total_price: number;
    outstanding_balance?: number;
    vip_tier?: string | null;
    stay_count?: number;
    night_count?: number;
    main_stay_count?: number;
    main_night_count?: number;
    accompanying_stay_count?: number;
    accompanying_night_count?: number;
    open_traces_count: number;
    alert_count?: number;
    first_alert_message?: string | null;
    parent_reservation_id?: string | null;
    linked_segments?: LinkedStaySegment[] | null;
    linked_full_checkin?: string | null;
    linked_full_checkout?: string | null;
    linked_active_segment_id?: string | null;
};

type InHouseDayUseReservation = DayUseReservation & {
    room_number: string;
};

type OptionsState = {
    reservation: InHouseReservation;
    initialTab?: "traces" | "alerts" | "guest" | "loans";
};

function fmt(n: number) {
    return n.toLocaleString("th-TH");
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

export default function InHousePage() {
    const [reservations, setReservations] = useState<InHouseReservation[]>([]);
    const [dayUseReservations, setDayUseReservations] = useState<InHouseDayUseReservation[]>([]);
    const [businessDate, setBusinessDate] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [optionsState, setOptionsState] = useState<OptionsState | null>(null);
    const [moveReservation, setMoveReservation] = useState<InHouseReservation | null>(null);
    const [detailResId, setDetailResId] = useState<string | null>(null);
    const [detailMode, setDetailMode] = useState<"inhouse" | "checkout">("inhouse");
    const [showMoreMenu, setShowMoreMenu] = useState<string | null>(null);
    const [earlyCoTarget, setEarlyCoTarget] = useState<InHouseReservation | null>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (!(event.target as Element).closest(".more-menu-container")) {
                setShowMoreMenu(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    const [dayUseExtendTarget, setDayUseExtendTarget] = useState<InHouseDayUseReservation | null>(null);
    const [linkedExtensionReservation, setLinkedExtensionReservation] = useState<InHouseReservation | null>(null);
    const [toast, setToast] = useState("");
    const [plannedMoveCounts, setPlannedMoveCounts] = useState<Record<string, number>>({});
    const dayUseReservationsRef = useRef<InHouseDayUseReservation[]>([]);

    useEffect(() => {
        dayUseReservationsRef.current = dayUseReservations;
    }, [dayUseReservations]);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/inhouse");
            const data = await res.json();

            if (res.ok && data.success) {
                const nextReservations = (data.reservations ?? []) as InHouseReservation[];
                setReservations(nextReservations);
                setDayUseReservations((data.dayuse_reservations ?? []) as InHouseDayUseReservation[]);
                setBusinessDate(String(data.date ?? ""));
                void Promise.all(
                    nextReservations.map(async (reservation) => {
                        try {
                            const countRes = await fetch(`/api/bookings/${reservation.id}/planned-room-moves`, { cache: "no-store" });
                            const countPayload = await countRes.json().catch(() => ({}));
                            const count = Array.isArray(countPayload?.moves)
                                ? countPayload.moves.filter((row: any) => row.status === "planned").length
                                : 0;
                            return [reservation.id, count] as const;
                        } catch {
                            return [reservation.id, 0] as const;
                        }
                    })
                ).then((entries) => {
                    setPlannedMoveCounts(Object.fromEntries(entries));
                });
            } else {
                setError(data.error ?? "Failed to load in-house guests.");
            }
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDayUseTimersOnly = useCallback(async () => {
        try {
            const res = await fetch("/api/dayuse/status");
            const data = await res.json();
            if (data.success && data.rooms) {
                const activeByReservationId = new Map<string, { dayuse_expires_at: string }>();
                for (const room of data.rooms as Array<{ current_reservation?: { id?: string; dayuse_expires_at?: string } | null }>) {
                    if (room.current_reservation?.id) {
                        activeByReservationId.set(String(room.current_reservation.id), {
                            dayuse_expires_at: String(room.current_reservation.dayuse_expires_at ?? ""),
                        });
                    }
                }

                const current = dayUseReservationsRef.current;
                const shouldFullRefresh =
                    activeByReservationId.size !== current.length ||
                    current.some((reservation) => !activeByReservationId.has(reservation.id));

                if (shouldFullRefresh) {
                    void load();
                    return;
                }

                let changed = false;
                const next = current.map((reservation) => {
                    const incoming = activeByReservationId.get(reservation.id);
                    if (!incoming) return reservation;
                    if (incoming.dayuse_expires_at !== reservation.dayuse_expires_at) {
                        changed = true;
                        return { ...reservation, dayuse_expires_at: incoming.dayuse_expires_at };
                    }
                    return reservation;
                });

                if (changed) {
                    setDayUseReservations(next);
                }
            }
        } catch {
            // ignore
        }
    }, [load]);

    useEffect(() => {
        load();
        const interval = window.setInterval(loadDayUseTimersOnly, 60000);
        return () => window.clearInterval(interval);
    }, [load, loadDayUseTimersOnly]);

    function showToast(message: string) {
        setToast(message);
        setTimeout(() => setToast(""), 3000);
    }

    async function handleDayUseCheckout(id: string, roomNumber: string) {
        if (!confirm(`Are you sure you want to check out Day Use room ${roomNumber}?`)) return;
        try {
            const res = await fetch(`/api/dayuse/${id}/checkout`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                showToast("Day Use checked out.");
                load();
            } else {
                showToast(data.error ?? "Failed to check out Day Use.");
            }
        } catch {
            showToast("Network error.");
        }
    }

    function handleDayUseExtendSuccess(payload: { extension_charge: number; new_expires_at: string }) {
        setDayUseExtendTarget(null);
        showToast(`Day Use extended (+฿${fmt(payload.extension_charge)}).`);
        load();
    }

    const today = businessDate ? formatBusinessDate(businessDate) : new Date().toLocaleDateString("th-TH", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    // Group linked stays using the shared utility
    const mergedReservations = groupLinkedStays(reservations);

    return (
        <div className="space-y-5 w-full max-w-[90rem]">
            <NightAuditPendingPopup pageName="In-House" />
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">In-House</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{today}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load}>
                    ↻ Refresh
                </button>
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {loading && (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--bg-muted)]" />
                    ))}
                </div>
            )}

            {!loading && reservations.length === 0 && !error && (
                <div className="card p-12 text-center">
                    <p className="text-3xl mb-3">🛏️</p>
                    <p className="text-[var(--text-secondary)] font-medium">No in-house guests right now</p>
                    <p className="text-[var(--text-muted)] text-sm mt-1">Arrivals may not be checked-in yet.</p>
                </div>
            )}

            {!loading && reservations.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                    <span className="font-semibold text-[var(--text-table-cell)]">
                        {reservations.length} in-house guest{reservations.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-[var(--text-secondary)]">
                        {reservations.filter((r) => r.nights_remaining <= 1).length} leaving tomorrow/soon
                    </span>
                </div>
            )}

            {!loading && reservations.length > 0 && (
                <div className="card overflow-visible">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Room</th>
                                <th>Guest</th>
                                <th>Stay Dates</th>
                                <th>Nights Remaining</th>
                                <th>Total</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mergedReservations.map((merged) => {
                                const r = merged.active_reservation;
                                const hasOutstandingBalance = merged.all_reservations.some((item) => Number(item.outstanding_balance ?? 0) > 0);
                                const loyaltyVisual = resolveGuestLoyaltyVisual(r);

                                const displayCheckin = merged.is_linked ? merged.linked_full_checkin : r.checkin_date;
                                const displayCheckout = merged.is_linked ? merged.linked_full_checkout : r.checkout_date;

                                return (
                                    <tr key={merged.group_id} className={loyaltyVisual.rowClass}>
                                        <td>
                                            <div className="font-bold text-[var(--text-primary)]">Room {r.room_number}</div>
                                            <div className="text-xs text-[var(--text-muted)]">{r.room_type}</div>
                                        </td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className={`font-semibold ${hasOutstandingBalance ? "text-rose-600 dark:text-rose-400" : "text-[var(--text-primary)]"}`}
                                                >
                                                    {r.guest_name}
                                                </div>
                                                {r.booking_group_id && (
                                                    <Link
                                                        href={`/pms/groups?group_id=${r.booking_group_id}`}
                                                        className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-200 transition-colors"
                                                        title={r.group_name ?? "Open Group Booking"}
                                                    >
                                                        {formatShortGroupCode(r.group_code)}
                                                    </Link>
                                                )}
                                                {r.open_traces_count > 0 && (
                                                    <span
                                                        className="badge bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] dark:bg-amber-500/10 dark:text-amber-400"
                                                        title="Open Traces"
                                                    >
                                                        🟠 {r.open_traces_count}
                                                    </span>
                                                )}
                                                {(r.alert_count ?? 0) > 0 && (
                                                    <span
                                                        className="badge bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px] dark:bg-rose-500/10 dark:text-rose-400"
                                                        title={r.first_alert_message ?? "Alerts Present"}
                                                    >
                                                        🔴 {r.alert_count}
                                                    </span>
                                                )}
                                            </div>
                                            {r.phone && <div className="text-xs text-[var(--text-muted)]">{r.phone}</div>}
                                        </td>
                                        <td>
                                            <div className="text-sm">{displayCheckin}</div>
                                            <div className="text-xs text-[var(--text-muted)]">→ {displayCheckout}</div>
                                            {merged.is_linked && (
                                                <LinkedStayBadge segments={merged.linked_segments} activeSegmentId={merged.linked_active_segment_id} />
                                            )}
                                        </td>
                                        <td>
                                            <span
                                                className={`font-semibold ${merged.linked_nights_remaining <= 1 ? "text-amber-700" : "text-[var(--text-table-cell)]"}`}
                                            >
                                                {merged.linked_nights_remaining} night{merged.linked_nights_remaining !== 1 ? "s" : ""}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="font-semibold text-[var(--text-primary)]">฿{fmt(merged.linked_total_price)}</span>
                                        </td>
                                        <td>
                                            <div className="flex gap-1 flex-wrap items-center">
                                                <button
                                                    className="btn btn-secondary btn-sm min-w-[100px]"
                                                    onClick={() => {
                                                        setDetailMode("inhouse");
                                                        setDetailResId(r.id);
                                                    }}
                                                >
                                                    View Details
                                                </button>

                                                <button
                                                    className="btn btn-secondary btn-sm flex items-center gap-1"
                                                    onClick={() => setOptionsState({ reservation: r })}
                                                >
                                                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                                                    </svg>
                                                    Options
                                                </button>

                                                <div className="relative more-menu-container">
                                                    <button
                                                        className="btn btn-secondary btn-sm flex items-center gap-1"
                                                        onClick={() => setShowMoreMenu(prev => prev === r.id ? null : r.id)}
                                                    >
                                                        More
                                                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                    {showMoreMenu === r.id && (
                                                        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg py-1">
                                                            <button
                                                                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2 text-blue-600 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                                                onClick={() => { setShowMoreMenu(null); setMoveReservation(r); }}
                                                                disabled={!r.room_type_id || r.room_number === "—"}
                                                            >
                                                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                                                                </svg>
                                                                Move Room
                                                            </button>
                                                            {plannedMoveCounts[r.id] > 0 && (
                                                                <button
                                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2"
                                                                    onClick={() => { setShowMoreMenu(null); window.location.assign(`/pms/calendar?focus_reservation_id=${r.id}`); }}
                                                                >
                                                                    <svg className="h-4 w-4 text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                    </svg>
                                                                    Path ({plannedMoveCounts[r.id]})
                                                                </button>
                                                            )}
                                                            {r.room_type_id && (
                                                                <button
                                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2"
                                                                    onClick={() => { setShowMoreMenu(null); setLinkedExtensionReservation(r); }}
                                                                >
                                                                    <svg className="h-4 w-4 text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                                                    </svg>
                                                                    Extend Stay
                                                                </button>
                                                            )}
                                                            <hr className="my-1 border-[var(--border-default)]" />
                                                            <button
                                                                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2 text-amber-600"
                                                                onClick={() => {
                                                                    setShowMoreMenu(null);
                                                                    setEarlyCoTarget(r);
                                                                }}
                                                            >
                                                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                                                </svg>
                                                                Early Check-out
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Day Use Section */}
            {!loading && dayUseReservations.length > 0 && (
                <div className="mt-8 border-t-2 border-dashed border-[var(--border-default)] pt-6">
                    <div className="flex justify-between items-center mb-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-[var(--dayuse-text)]">Day Use In-House</p>
                    </div>
                    <div className="card overflow-hidden border-[var(--dayuse-border)]">
                        <table className="data-table">
                            <thead className="bg-[var(--dayuse-bg)] text-[var(--dayuse-text-secondary)]">
                                <tr>
                                    <th>Room</th>
                                    <th>Guest</th>
                                    <th>Time Remaining</th>
                                    <th>Rate</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dayUseReservations.map((r) => (
                                    <tr key={r.id} className="hover:bg-rose-50/50">
                                        <td>
                                            <div className="font-bold text-[var(--text-primary)]">Room {r.room_number}</div>
                                            <div className="text-[10px] uppercase font-bold text-[var(--dayuse-text)]">Day Use</div>
                                        </td>
                                        <td>
                                            <div className="font-semibold text-[var(--text-primary)]">{r.guest_name}</div>
                                            {r.phone && <div className="text-xs text-[var(--text-muted)]">{r.phone}</div>}
                                        </td>
                                        <td className="w-1/4 min-w-[140px]">
                                            <div className="bg-[var(--bg-surface)] border border-[var(--dayuse-border)] rounded-lg p-2 inline-block shadow-sm">
                                                <DayUseTimer expiresAt={r.dayuse_expires_at} />
                                            </div>
                                        </td>
                                        <td>
                                            <span className="font-semibold text-[var(--text-primary)]">฿{fmt(r.total_price)}</span>
                                        </td>
                                        <td>
                                            <div className="flex gap-2 flex-wrap">
                                                <button
                                                    className="btn btn-secondary btn-sm bg-[var(--bg-surface)] border-[var(--border-input)] text-[var(--text-table-cell)]"
                                                    onClick={() => setDayUseExtendTarget(r)}
                                                >
                                                    Extend
                                                </button>
                                                <button
                                                    className="btn btn-primary btn-sm bg-[var(--dayuse-text)] hover:bg-[var(--dayuse-text-secondary)] border-none shadow-md shadow-rose-600/20"
                                                    onClick={() => handleDayUseCheckout(r.id, r.room_number)}
                                                >
                                                    Check-Out
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {optionsState && (
                <ReservationOptionsPanel
                    reservationId={optionsState.reservation.id}
                    guestName={optionsState.reservation.guest_name}
                    checkinDate={optionsState.reservation.checkin_date}
                    checkoutDate={optionsState.reservation.checkout_date}
                    initialTab={optionsState.initialTab}
                    onClose={() => {
                        setOptionsState(null);
                        load();
                    }}
                />
            )}

            {moveReservation && (
                <RoomMoveModal
                    reservationId={moveReservation.id}
                    currentRoomNumber={moveReservation.room_number}
                    currentRoomTypeId={moveReservation.room_type_id}
                    checkinDate={moveReservation.checkin_date}
                    checkoutDate={moveReservation.checkout_date}
                    onClose={() => setMoveReservation(null)}
                    onSuccess={() => {
                        showToast(`✓ Room moved for ${moveReservation.guest_name}`);
                        setMoveReservation(null);
                        load();
                    }}
                />
            )}

            {linkedExtensionReservation && linkedExtensionReservation.room_type_id && (
                <LinkedExtensionModal
                    reservationId={linkedExtensionReservation.id}
                    guestName={linkedExtensionReservation.guest_name}
                    currentCheckoutDate={linkedExtensionReservation.checkout_date}
                    currentRoomTypeId={linkedExtensionReservation.room_type_id}
                    currentRoomNumber={linkedExtensionReservation.room_number}
                    onClose={() => setLinkedExtensionReservation(null)}
                    onSuccess={() => {
                        showToast(`✓ Linked walk-in extension created for ${linkedExtensionReservation.guest_name}`);
                        setLinkedExtensionReservation(null);
                        load();
                    }}
                />
            )}

            {/* Early Check-out Confirmation Dialog */}
            <Dialog open={!!earlyCoTarget} onOpenChange={(open) => { if (!open) setEarlyCoTarget(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            Early Check-out
                        </DialogTitle>
                        <DialogDescription className="space-y-2 pt-2">
                            <p><strong>{earlyCoTarget?.guest_name}</strong> — Room {earlyCoTarget?.room_number}</p>
                            <p>Original departure: <strong>{earlyCoTarget?.checkout_date}</strong></p>
                            <p className="text-amber-600">Guest is checking out early (before departure date). Unused nights will be removed.</p>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEarlyCoTarget(null)}>Cancel</button>
                        <button className="btn btn-warning btn-sm" onClick={() => {
                            if (earlyCoTarget) {
                                setDetailMode("checkout");
                                setDetailResId(earlyCoTarget.id);
                            }
                            setEarlyCoTarget(null);
                        }}>Proceed to Check-out</button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {detailResId && (
                <ReservationDetailPage
                    mode={detailMode}
                    reservationId={detailResId}
                    onClose={() => setDetailResId(null)}
                    onSuccess={() => {
                        setDetailResId(null);
                        load();
                    }}
                />
            )}

            {dayUseExtendTarget && (
                <DayUseExtendModal
                    reservationId={dayUseExtendTarget.id}
                    roomNumber={dayUseExtendTarget.room_number}
                    guestName={dayUseExtendTarget.guest_name}
                    onClose={() => setDayUseExtendTarget(null)}
                    onSuccess={handleDayUseExtendSuccess}
                />
            )}

            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">
                    {toast}
                </div>
            )}
        </div>
    );
}
