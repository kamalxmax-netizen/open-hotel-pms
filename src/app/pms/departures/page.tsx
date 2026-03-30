"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReservationDetailPage from "@/components/reservation-detail-page";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import LinkedExtensionModal from "@/components/linked-extension-modal";
import LateCheckoutFeeModal, { PolicyFeePayload } from "@/components/late-checkout-fee-modal";
import { formatShortGroupCode } from "@/lib/group-label";
import { DayUseTimer } from "@/components/dayuse-timer";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import { resolveGuestLoyaltyVisual } from "@/lib/guest-loyalty";
import { groupLinkedStays } from "@/lib/linked-stay-ui";
import { LinkedStayBadge } from "@/components/linked-stay-badge";
import type { DayUseReservation, LinkedStaySegment } from "@/lib/types";
import { formatDateDisplay } from "@/lib/date-display";

type NightlyItem = { date: string; price: number };

type Departure = {
    id: string;
    booking_code: string;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone?: string | null;
    source: string;
    status: string;           // 'active' | 'checked_out'
    checkin_date: string;
    checkout_date: string;
    total_price: number;
    outstanding_balance?: number;
    note?: string | null;
    room_number: string;
    room_type: string;
    room_type_id?: string | null;
    nights_count: number;
    nightly_breakdown: NightlyItem[];
    vip_tier?: string | null;
    stay_count?: number;
    night_count?: number;
    main_stay_count?: number;
    main_night_count?: number;
    accompanying_stay_count?: number;
    accompanying_night_count?: number;
    parent_reservation_id?: string | null;
    linked_segments?: LinkedStaySegment[] | null;
    linked_full_checkin?: string | null;
    linked_full_checkout?: string | null;
    linked_active_segment_id?: string | null;
};

type DayUseDeparture = DayUseReservation & {
    room_number: string;
    status: string;
};

const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in", ota: "OTA", direct: "Direct", agent: "Agent"
};

function fmt(n: number) { return n.toLocaleString("th-TH"); }

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

export default function DeparturesPage() {
    const [departures, setDepartures] = useState<Departure[]>([]);
    const [dayUseDepartures, setDayUseDepartures] = useState<DayUseDeparture[]>([]);
    const [businessDate, setBusinessDate] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [checkoutResId, setCheckoutResId] = useState<string | null>(null);
    const [optionsState, setOptionsState] = useState<{ reservation: Departure; initialTab?: "traces" | "alerts" | "guest" | "loans" } | null>(null);
    const [linkedExtensionReservation, setLinkedExtensionReservation] = useState<Departure | null>(null);
    const [lateCheckoutReservation, setLateCheckoutReservation] = useState<Departure | null>(null);
    const [lateCheckoutSuggestedFee, setLateCheckoutSuggestedFee] = useState(0);
    const [lateCheckoutAfter1600, setLateCheckoutAfter1600] = useState(false);
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
    const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/departures");
            const d = await res.json();
            if (d.success) {
                setDepartures((d.departures ?? []) as Departure[]);
                setDayUseDepartures((d.dayuse_departures ?? []) as DayUseDeparture[]);
                setBusinessDate(String(d.date ?? ""));
            }
            else setError(d.error ?? "Failed to load departures.");
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(""), 3500);
    }

    function getBangkokTimeHHmm(date = new Date()): string {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Bangkok",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(date);
        const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
        const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
        return `${hour}:${minute}`;
    }

    function resolveLastNightRate(departure: Departure): number {
        const nights = Array.isArray(departure.nightly_breakdown) ? departure.nightly_breakdown : [];
        const sorted = [...nights].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const lastNight = sorted[sorted.length - 1];
        if (lastNight && Number.isFinite(Number(lastNight.price))) {
            return Number(lastNight.price);
        }
        const fallbackNights = Number(departure.nights_count ?? 0);
        if (fallbackNights > 0) {
            return Number(departure.total_price ?? 0) / fallbackNights;
        }
        return Number(departure.total_price ?? 0);
    }

    function openLateCheckoutModal(departure: Departure) {
        const nowHHmm = getBangkokTimeHHmm();
        const isAfter1600 = nowHHmm >= "16:01";
        const lastNightRate = resolveLastNightRate(departure);
        setLateCheckoutAfter1600(isAfter1600);
        setLateCheckoutSuggestedFee(isAfter1600 ? lastNightRate : lastNightRate * 0.5);
        setLateCheckoutReservation(departure);
    }

    async function handleLateCheckoutConfirm(payload: PolicyFeePayload | null) {
        if (!lateCheckoutReservation?.id) return;
        if (!payload) {
            setLateCheckoutReservation(null);
            showToast("Late C/O pre-approve cancelled.");
            return;
        }
        try {
            const response = await fetch(`/api/bookings/${lateCheckoutReservation.id}/late-checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    amount: payload.amount,
                    payment_method: payload.payment_method,
                    note: payload.note,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result?.success === false) {
                showToast(result?.error ?? "Failed to save Late C/O.");
                return;
            }
            showToast(result?.note_appended ? "✓ Late C/O saved + note appended" : "✓ Late C/O saved");
            setLateCheckoutReservation(null);
            load();
        } catch {
            showToast("Network error.");
        }
    }

    function handleCheckoutSuccess() {
        if (checkoutResId) {
            setDoneIds((prev) => new Set([...prev, checkoutResId]));
        }
        setCheckoutResId(null);
        showToast("✓ Checked out successfully");
        load();
    }

    async function handleDayUseCheckout(id: string, roomNumber: string) {
        if (!confirm(`Are you sure you want to check out Day Use room ${roomNumber}?`)) return;
        try {
            const res = await fetch(`/api/dayuse/${id}/checkout`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                setDoneIds((prev) => new Set([...prev, id]));
                showToast("✓ Day Use checked out");
                load();
            } else {
                showToast(data.error ?? "Failed to check out Day Use.");
            }
        } catch {
            showToast("Network error.");
        }
    }

    const today = businessDate ? formatBusinessDate(businessDate) : new Date().toLocaleDateString("th-TH", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const mergedDepartures = groupLinkedStays(departures);

    return (
        <div className="space-y-5 w-full max-w-[90rem]">
            <NightAuditPendingPopup pageName="Departures" />
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Departures</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{today}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
            )}

            {loading && (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--bg-muted)]" />)}
                </div>
            )}

            {!loading && departures.length === 0 && !error && (
                <div className="card p-12 text-center">
                    <p className="text-3xl mb-3">🏁</p>
                    <p className="text-[var(--text-secondary)] font-medium">No departures today</p>
                </div>
            )}

            {!loading && departures.length > 0 && (
                <>
                    <div className="flex items-center gap-4 text-sm">
                        <span className="font-semibold text-[var(--text-table-cell)]">{departures.length} departure{departures.length !== 1 ? "s" : ""}</span>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span className="text-emerald-600 font-semibold">{doneIds.size} checked out</span>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span className="text-amber-600 font-semibold">{departures.length - doneIds.size} pending</span>
                    </div>

                    <div className="card overflow-visible">
                        <table className="data-table table-fixed w-full">
                            <thead>
                                <tr>
                                    <th className="w-[12%]">Room</th>
                                    <th className="w-[21%]">Guest</th>
                                    <th className="w-[10%]">Source</th>
                                    <th className="w-[21%]">Stay</th>
                                    <th className="w-[10%]">Total</th>
                                    <th className="w-[26%]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mergedDepartures.map((merged) => {
                                    const d = merged.active_reservation;
                                    const isCheckedOut = d.status === "checked_out" || doneIds.has(d.id);
                                    const hasOutstandingBalance = merged.all_reservations.some((item) => Number(item.outstanding_balance ?? 0) > 0);
                                    const loyaltyVisual = resolveGuestLoyaltyVisual(d);
                                    
                                    const displayCheckin = merged.is_linked ? merged.linked_full_checkin : d.checkin_date;
                                    const displayCheckout = merged.is_linked ? merged.linked_full_checkout : d.checkout_date;
                                    const displayNights = merged.is_linked ? merged.linked_nights_count : d.nights_count;
                                    
                                    return (
                                        <tr key={merged.group_id} className={isCheckedOut ? "opacity-50 bg-[var(--bg-body)] [&>td]:bg-[var(--bg-body)]" : loyaltyVisual.rowClass}>
                                            <td>
                                                <div className="font-bold text-[var(--text-primary)]">Room {d.room_number}</div>
                                                <div className="text-xs text-[var(--text-muted)]">{d.room_type}</div>
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div
                                                        className={`font-semibold min-w-0 flex-1 truncate ${hasOutstandingBalance ? "text-rose-600 dark:text-rose-400" : isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}
                                                        title={d.guest_name}
                                                    >
                                                        {d.guest_name}
                                                    </div>
                                                    {d.booking_group_id && (
                                                            <Link
                                                                href={`/pms/groups?group_id=${d.booking_group_id}`}
                                                                className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400 hover:bg-indigo-200 transition-colors"
                                                                title={d.group_name ?? "Open Group Booking"}
                                                            >
                                                            {formatShortGroupCode(d.group_code)}
                                                        </Link>
                                                    )}
                                                </div>
                                                {d.phone && <div className="text-xs text-[var(--text-muted)]">{d.phone}</div>}
                                            </td>
                                            <td>
                                                <span className="badge bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] text-xs">
                                                    {SOURCE_LABEL[d.source] ?? d.source}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="text-sm">{formatDateDisplay(displayCheckin)} → {formatDateDisplay(displayCheckout)}</div>
                                                <div className="text-xs text-[var(--text-muted)] mt-0.5">{displayNights} night{displayNights !== 1 ? "s" : ""}</div>
                                                {merged.is_linked && (
                                                    <LinkedStayBadge segments={merged.linked_segments} activeSegmentId={merged.linked_active_segment_id} />
                                                )}
                                            </td>
                                            <td>
                                                <span className={`font-bold ${isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>฿{fmt(merged.linked_total_price)}</span>
                                            </td>
                                            <td>
                                                {isCheckedOut ? (
                                                    <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">✓ Checked Out</span>
                                                ) : (
                                                    <div className="flex gap-1 flex-wrap items-center">
                                                        <button
                                                            className="btn btn-primary btn-sm bg-rose-600 hover:bg-rose-700 border-none min-w-[100px]"
                                                            onClick={() => setCheckoutResId(d.id)}
                                                        >
                                                            Check-out
                                                        </button>
                                                        
                                                        <button
                                                            className="btn btn-secondary btn-sm flex items-center gap-1"
                                                            onClick={() => setOptionsState({ reservation: d })}
                                                        >
                                                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                                                            </svg>
                                                            Options
                                                        </button>
                                                        {d.room_type && (
                                                            <div className="relative more-menu-container">
                                                                <button 
                                                                    className="btn btn-secondary btn-sm flex items-center gap-1"
                                                                    onClick={() => setShowMoreMenu(prev => prev === d.id ? null : d.id)}
                                                                >
                                                                    More
                                                                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                                                                    </svg>
                                                                </button>
                                                                {showMoreMenu === d.id && (
                                                                    <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg py-1">
                                                                        <button
                                                                            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2"
                                                                            onClick={() => { setShowMoreMenu(null); setLinkedExtensionReservation(d); }}
                                                                        >
                                                                            <svg className="h-4 w-4 text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor">
                                                                                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                                                            </svg>
                                                                            Extend Stay
                                                                        </button>
                                                                        <button
                                                                            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-body)] flex items-center gap-2 text-indigo-600"
                                                                            onClick={() => { setShowMoreMenu(null); openLateCheckoutModal(d); }}
                                                                        >
                                                                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12a.75.75 0 00-1.5 0v4.19l-2.22 1.48a.75.75 0 10.84 1.24l2.55-1.7a.75.75 0 00.33-.62V6z" clipRule="evenodd" />
                                                                            </svg>
                                                                            Late C/O
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Day Use Section */}
            {!loading && dayUseDepartures.length > 0 && (
                <div className="mt-8 border-t-2 border-dashed border-[var(--border-default)] pt-6">
                    <div className="flex justify-between items-center mb-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-[var(--dayuse-text)]">Day Use Departures</p>
                    </div>
                    <div className="card overflow-hidden border-[var(--dayuse-border)]">
                        <table className="data-table table-fixed w-full">
                            <thead className="bg-[var(--dayuse-bg)] text-[var(--dayuse-text-secondary)]">
                                <tr>
                                    <th className="w-[14%]">Room</th>
                                    <th className="w-[34%]">Guest</th>
                                    <th className="w-[22%]">Time / Status</th>
                                    <th className="w-[12%]">Revenue</th>
                                    <th className="w-[18%]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dayUseDepartures.map((d) => {
                                    const isCheckedOut = d.status === "checked_out" || doneIds.has(d.id);
                                    return (
                                        <tr key={d.id} className={isCheckedOut ? "opacity-50 bg-[var(--bg-body)]" : "bg-rose-50/20"}>
                                            <td>
                                                <div className="font-bold text-[var(--text-primary)]">Room {d.room_number}</div>
                                                <div className="text-[10px] uppercase font-bold text-[var(--dayuse-text)]">Day Use</div>
                                            </td>
                                            <td>
                                                <div className="font-semibold text-[var(--text-primary)] truncate">{d.guest_name}</div>
                                                {d.phone && <div className="text-xs text-[var(--text-muted)]">{d.phone}</div>}
                                            </td>
                                            <td>
                                                {isCheckedOut ? (
                                                    <span className="badge bg-[var(--bg-muted)] text-[var(--text-secondary)] text-xs">Closed Session</span>
                                                ) : (
                                                    <div className="bg-[var(--bg-surface)] border border-[var(--dayuse-border)] rounded-lg p-1.5 inline-block shadow-sm scale-90 origin-left">
                                                        <DayUseTimer expiresAt={d.dayuse_expires_at} />
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`font-bold ${isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
                                                    ฿{fmt(d.total_price ?? d.rate ?? 0)}
                                                </span>
                                            </td>
                                            <td>
                                                {isCheckedOut ? (
                                                    <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">✓ Checked Out</span>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm bg-[var(--dayuse-text)] hover:bg-[var(--dayuse-text-secondary)] border-none shadow-md shadow-rose-600/20"
                                                        onClick={() => handleDayUseCheckout(d.id, d.room_number)}
                                                    >
                                                        Check-out
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Checkout Detail Page */}
            {checkoutResId && (
                <ReservationDetailPage
                    mode="checkout"
                    reservationId={checkoutResId}
                    onClose={() => setCheckoutResId(null)}
                    onSuccess={handleCheckoutSuccess}
                />
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

            {linkedExtensionReservation && (
                <LinkedExtensionModal
                    reservationId={linkedExtensionReservation.id}
                    source={linkedExtensionReservation.source}
                    guestName={linkedExtensionReservation.guest_name}
                    currentCheckoutDate={linkedExtensionReservation.checkout_date}
                    currentRoomTypeId={String(linkedExtensionReservation.room_type_id ?? "")}
                    currentRoomNumber={linkedExtensionReservation.room_number}
                    onClose={() => setLinkedExtensionReservation(null)}
                    onSuccess={() => {
                        showToast(`✓ Linked walk-in extension created for ${linkedExtensionReservation.guest_name}`);
                        setLinkedExtensionReservation(null);
                        load();
                    }}
                />
            )}

            <LateCheckoutFeeModal
                isOpen={Boolean(lateCheckoutReservation)}
                isAfter1600={lateCheckoutAfter1600}
                suggestedFee={lateCheckoutSuggestedFee}
                onClose={() => setLateCheckoutReservation(null)}
                onExtendStay={() => {
                    setLateCheckoutReservation(null);
                    showToast("Please extend stay first, then continue checkout.");
                }}
                onConfirm={(payload) => { void handleLateCheckoutConfirm(payload); }}
            />

            {/* Toast */}
            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">{toast}</div>
            )}
        </div>
    );
}
