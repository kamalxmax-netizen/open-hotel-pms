"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import RoomMoveModal from "@/components/room-move-modal";
import ReservationDetailPage from "@/components/reservation-detail-page";
import DayUseExtendModal from "@/components/dayuse-extend-modal";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import LinkedExtensionModal from "@/components/linked-extension-modal";
import { formatShortGroupCode } from "@/lib/group-label";
import { DayUseTimer } from "@/components/dayuse-timer";
import type { DayUseReservation } from "@/lib/types";
import { resolveGuestLoyaltyVisual } from "@/lib/guest-loyalty";

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

    return (
        <div className="space-y-5 w-full max-w-[90rem]">
            <NightAuditPendingPopup pageName="In-House" />
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-slate-900 mt-0.5">In-House</h1>
                    <p className="text-sm text-slate-500 mt-1">{today}</p>
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
                        <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
                    ))}
                </div>
            )}

            {!loading && reservations.length === 0 && !error && (
                <div className="card p-12 text-center">
                    <p className="text-3xl mb-3">🛏️</p>
                    <p className="text-slate-500 font-medium">No in-house guests right now</p>
                    <p className="text-slate-400 text-sm mt-1">Arrivals may not be checked-in yet.</p>
                </div>
            )}

            {!loading && reservations.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                    <span className="font-semibold text-slate-700">
                        {reservations.length} in-house guest{reservations.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">
                        {reservations.filter((r) => r.nights_remaining <= 1).length} leaving tomorrow/soon
                    </span>
                </div>
            )}

            {!loading && reservations.length > 0 && (
                <div className="card overflow-hidden">
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
                            {reservations.map((r) => {
                                const loyaltyVisual = resolveGuestLoyaltyVisual(r);
                                return (
                                <tr key={r.id} className={loyaltyVisual.rowClass}>
                                    <td>
                                        <div className="font-bold text-slate-900">Room {r.room_number}</div>
                                        <div className="text-xs text-slate-400">{r.room_type}</div>
                                    </td>
                                    <td>
                                        <div className="flex items-center gap-2">
                                            <div className="font-semibold text-slate-800">{r.guest_name}</div>
                                            {r.booking_group_id && (
                                                <Link
                                                    href={`/pms/groups?group_id=${r.booking_group_id}`}
                                                    className="badge bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                                                    title={r.group_name ?? "Open Group Booking"}
                                                >
                                                    {formatShortGroupCode(r.group_code)}
                                                </Link>
                                            )}
                                            {r.open_traces_count > 0 && (
                                                <span
                                                    className="badge bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px]"
                                                    title="Open Traces"
                                                >
                                                    🟠 {r.open_traces_count}
                                                </span>
                                            )}
                                            {(r.alert_count ?? 0) > 0 && (
                                                <span
                                                    className="badge bg-rose-100 text-rose-700 px-1.5 py-0.5 text-[10px]"
                                                    title={r.first_alert_message ?? "Alerts Present"}
                                                >
                                                    🔴 {r.alert_count}
                                                </span>
                                            )}
                                        </div>
                                        {r.phone && <div className="text-xs text-slate-400">{r.phone}</div>}
                                    </td>
                                    <td>
                                        <div className="text-sm">{r.checkin_date}</div>
                                        <div className="text-xs text-slate-400">→ {r.checkout_date}</div>
                                    </td>
                                    <td>
                                        <span
                                            className={`font-semibold ${r.nights_remaining <= 1 ? "text-amber-700" : "text-slate-700"}`}
                                        >
                                            {r.nights_remaining} night{r.nights_remaining !== 1 ? "s" : ""}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="font-semibold text-slate-800">฿{fmt(r.total_price)}</span>
                                    </td>
                                    <td>
                                        <div className="flex gap-1 flex-wrap">
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setDetailResId(r.id)}
                                            >
                                                View Details
                                            </button>
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => setMoveReservation(r)}
                                                disabled={!r.room_type_id || r.room_number === "—"}
                                            >
                                                Move Room
                                            </button>
                                            {plannedMoveCounts[r.id] > 0 && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => window.location.assign(`/pms/calendar?focus_reservation_id=${r.id}`)}
                                                >
                                                    Path ({plannedMoveCounts[r.id]})
                                                </button>
                                            )}
                                            {r.room_type_id && r.source === "ota" && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setLinkedExtensionReservation(r)}
                                                >
                                                    Extend Stay
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setOptionsState({ reservation: r })}
                                            >
                                                ⋯ Options
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Day Use Section */}
            {!loading && dayUseReservations.length > 0 && (
                <div className="mt-8 border-t-2 border-dashed border-slate-200 pt-6">
                    <div className="flex justify-between items-center mb-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-[#e11d48]">Day Use In-House</p>
                    </div>
                    <div className="card overflow-hidden border-[#fecdd3]">
                        <table className="data-table">
                            <thead className="bg-[#fff1f2] text-[#be123c]">
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
                                            <div className="font-bold text-slate-900">Room {r.room_number}</div>
                                            <div className="text-[10px] uppercase font-bold text-[#e11d48]">Day Use</div>
                                        </td>
                                        <td>
                                            <div className="font-semibold text-slate-800">{r.guest_name}</div>
                                            {r.phone && <div className="text-xs text-slate-400">{r.phone}</div>}
                                        </td>
                                        <td className="w-1/4 min-w-[140px]">
                                            <div className="bg-white border border-[#fecdd3] rounded-lg p-2 inline-block shadow-sm">
                                                <DayUseTimer expiresAt={r.dayuse_expires_at} />
                                            </div>
                                        </td>
                                        <td>
                                            <span className="font-semibold text-slate-800">฿{fmt(r.total_price)}</span>
                                        </td>
                                        <td>
                                            <div className="flex gap-2 flex-wrap">
                                                <button
                                                    className="btn btn-secondary btn-sm bg-white border-slate-300 text-slate-700"
                                                    onClick={() => setDayUseExtendTarget(r)}
                                                >
                                                    Extend
                                                </button>
                                                <button
                                                    className="btn btn-primary btn-sm bg-[#e11d48] hover:bg-[#be123c] border-none shadow-md shadow-rose-600/20"
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

            {detailResId && (
                <ReservationDetailPage
                    mode="inhouse"
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
