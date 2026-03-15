"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReservationDetailPage from "@/components/reservation-detail-page";
import { formatShortGroupCode } from "@/lib/group-label";
import { DayUseTimer } from "@/components/dayuse-timer";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import type { DayUseReservation } from "@/lib/types";
import { resolveGuestLoyaltyVisual } from "@/lib/guest-loyalty";

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
    note?: string | null;
    room_number: string;
    room_type: string;
    nights_count: number;
    nightly_breakdown: NightlyItem[];
    vip_tier?: string | null;
    stay_count?: number;
    night_count?: number;
    main_stay_count?: number;
    main_night_count?: number;
    accompanying_stay_count?: number;
    accompanying_night_count?: number;
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
    const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
    const [toast, setToast] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/departures");
            const d = await res.json();
            if (d.success) {
                setDepartures(d.departures ?? []);
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
                    {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />)}
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

                    <div className="card overflow-hidden">
                        <table className="data-table table-fixed w-full">
                            <thead>
                                <tr>
                                    <th className="w-[12%]">Room</th>
                                    <th className="w-[21%]">Guest</th>
                                    <th className="w-[10%]">Source</th>
                                    <th className="w-[26%]">Stay</th>
                                    <th className="w-[13%]">Total</th>
                                    <th className="w-[18%]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {departures.map((d) => {
                                    const isCheckedOut = d.status === "checked_out" || doneIds.has(d.id);
                                    const loyaltyVisual = resolveGuestLoyaltyVisual(d);
                                    return (
                                        <tr key={d.id} className={isCheckedOut ? "opacity-50 bg-slate-50 [&>td]:bg-slate-50" : loyaltyVisual.rowClass}>
                                            <td>
                                                <div className="font-bold text-[var(--text-primary)]">Room {d.room_number}</div>
                                                <div className="text-xs text-[var(--text-muted)]">{d.room_type}</div>
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div
                                                        className={`font-semibold min-w-0 flex-1 truncate ${isCheckedOut ? "text-[var(--text-muted)]" : "text-slate-800"}`}
                                                        title={d.guest_name}
                                                    >
                                                        {d.guest_name}
                                                    </div>
                                                    {d.booking_group_id && (
                                                        <Link
                                                            href={`/pms/groups?group_id=${d.booking_group_id}`}
                                                            className="badge bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                                                            title={d.group_name ?? "Open Group Booking"}
                                                        >
                                                            {formatShortGroupCode(d.group_code)}
                                                        </Link>
                                                    )}
                                                </div>
                                                {d.phone && <div className="text-xs text-[var(--text-muted)]">{d.phone}</div>}
                                            </td>
                                            <td>
                                                <span className="badge bg-slate-100 text-slate-600 text-xs">
                                                    {SOURCE_LABEL[d.source] ?? d.source}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="text-sm">{d.checkin_date} → {d.checkout_date}</div>
                                                <div className="text-xs text-[var(--text-muted)]">{d.nights_count} night{d.nights_count !== 1 ? "s" : ""}</div>
                                            </td>
                                            <td>
                                                <span className={`font-bold ${isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>฿{fmt(d.total_price)}</span>
                                            </td>
                                            <td>
                                                {isCheckedOut ? (
                                                    <span className="badge bg-emerald-100 text-emerald-700">✓ Checked Out</span>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => setCheckoutResId(d.id)}
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
                </>
            )}

            {/* Day Use Section */}
            {!loading && dayUseDepartures.length > 0 && (
                <div className="mt-8 border-t-2 border-dashed border-[var(--border-default)] pt-6">
                    <div className="flex justify-between items-center mb-4">
                        <p className="text-sm font-bold uppercase tracking-widest text-[#e11d48]">Day Use Departures</p>
                    </div>
                    <div className="card overflow-hidden border-[#fecdd3]">
                        <table className="data-table table-fixed w-full">
                            <thead className="bg-[#fff1f2] text-[#be123c]">
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
                                        <tr key={d.id} className={isCheckedOut ? "opacity-50 bg-slate-50" : "bg-rose-50/20"}>
                                            <td>
                                                <div className="font-bold text-[var(--text-primary)]">Room {d.room_number}</div>
                                                <div className="text-[10px] uppercase font-bold text-[#e11d48]">Day Use</div>
                                            </td>
                                            <td>
                                                <div className="font-semibold text-slate-800 truncate">{d.guest_name}</div>
                                                {d.phone && <div className="text-xs text-[var(--text-muted)]">{d.phone}</div>}
                                            </td>
                                            <td>
                                                {isCheckedOut ? (
                                                    <span className="badge bg-[var(--bg-muted)] text-[var(--text-secondary)] text-xs">Closed Session</span>
                                                ) : (
                                                    <div className="bg-[var(--bg-surface)] border border-[#fecdd3] rounded-lg p-1.5 inline-block shadow-sm scale-90 origin-left">
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
                                                    <span className="badge bg-emerald-100 text-emerald-700">✓ Checked Out</span>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary btn-sm bg-[#e11d48] hover:bg-[#be123c] border-none shadow-md shadow-rose-600/20"
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

            {/* Toast */}
            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">{toast}</div>
            )}
        </div>
    );
}
