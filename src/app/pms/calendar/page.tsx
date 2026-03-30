"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReservationDetailPage from "@/components/reservation-detail-page";
import PmsModal from "@/components/pms-modal";
import ReservationOptionsPanel from "@/components/reservation-options-panel";
import AssignRoomModal from "@/components/assign-room-modal";
import CancelFeeModal, { type CancelFeePayload } from "@/components/cancel-fee-modal";
import NightAuditPendingPopup from "@/components/night-audit-pending-popup";
import { formatShortGroupCode } from "@/lib/group-label";
import { formatDateDisplay, formatDateRangeDisplay } from "@/lib/date-display";
import { RoomGrid, SOURCE_COLOR, SOURCE_LABEL, DEFAULT_COLOR } from "@/components/room-grid";
import type { 
    CalendarReservation as Reservation,
    CalendarRoom,
    CalendarRoomBlock as RoomBlock,
    CalendarData,
    CalendarPlannedMove as PlannedMove
} from "@/lib/types";
import { Settings as SettingsIcon } from "lucide-react";

/* ─── Helpers ─────────────────────────────────── */
function addDays(date: string, n: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): string[] {
    const days: string[] = [];
    let cur = start;
    while (cur <= end) {
        days.push(cur);
        cur = addDays(cur, 1);
    }
    return days;
}

function fmt(n: number) { return n.toLocaleString("th-TH"); }

function dayLabel(date: string) {
    const d = new Date(date + "T00:00:00");
    return { day: d.getDate(), dow: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()] };
}

function isWeekend(date: string) {
    const d = new Date(date + "T00:00:00").getDay();
    return d === 0 || d === 6;
}

function normalizeRoomTypeToken(value: string): string {
    return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function compareRoomNumber(a: string, b: string): number {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function getRoomTypeSortRank(room: CalendarRoom): number {
    if (room.is_dayuse) return 60;

    const token = normalizeRoomTypeToken(`${room.room_type_code ?? ""} ${room.room_type ?? ""}`);
    if (token.includes("standard") || token.startsWith("std") || token.includes("superior")) return 10;
    if (token.includes("deluxe") || token.startsWith("dlx")) return 20;
    if (token.includes("junior") || token.startsWith("jr")) return 30;
    if (token.includes("3beds") || token.includes("3bed") || token.includes("threebeds") || token.includes("triple")) return 40;
    if (token.includes("family") || token.startsWith("fam")) return 50;
    return 55;
}

function getRoomTypeFilterKey(room: CalendarRoom): string {
    if (room.is_dayuse) return "day_use";
    const code = String(room.room_type_code ?? "").trim().toLowerCase();
    if (code) return `code:${code}`;
    return `name:${normalizeRoomTypeToken(room.room_type ?? "unknown")}`;
}

function getRoomTypeLabel(room: CalendarRoom): string {
    if (room.is_dayuse) return "Day Use";
    return String(room.room_type ?? room.room_type_code ?? "Unknown");
}

function resolveLinkHoverKey(res: Reservation): string | null {
    if (res.linked_root_id) return `linked:${res.linked_root_id}`;
    if (res.booking_group_id) return `group:${res.booking_group_id}`;
    return null;
}

/* ─── Reservation Detail Modal ────────────────── */
function ReservationDetail({
    res,
    roomNumber,
    onClose,
    onEdit,
    onSwap,
    onRefresh
}: {
    res: Reservation;
    roomNumber: string;
    onClose: () => void;
    onEdit: () => void;
    onSwap: () => void;
    onRefresh: () => void;
}) {
    const [cancelling, setCancelling] = useState(false);
    const [msg, setMsg] = useState("");
    const [showOptions, setShowOptions] = useState(false);
    const [showCancelFeeModal, setShowCancelFeeModal] = useState(false);

    function handleCancelClick() {
        setShowCancelFeeModal(true);
    }

    async function executeCancel(payload: CancelFeePayload) {
        setCancelling(true);
        setShowCancelFeeModal(false);
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

            const r = await fetch(`/api/bookings/${res.reservation_id}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });
            if (r.ok) {
                setMsg("Cancelled.");
                onRefresh();
                setTimeout(onClose, 1000);
            } else {
                const d = await r.json();
                setMsg(d.error ?? "Error.");
            }
        } finally {
            setCancelling(false);
        }
    }

    const nights = Math.round(
        (new Date(res.checkout_date).getTime() - new Date(res.checkin_date).getTime()) / 86400000
    );
    const sc = SOURCE_COLOR[res.source] ?? DEFAULT_COLOR;

    const isCheckedOut = res.status === "checked_out";
    const isCheckedIn = Boolean(res.checked_in_at);
    const canSwap = !isCheckedOut && !isCheckedIn && Boolean(roomNumber && roomNumber !== "—");

    return (
        <>
            <PmsModal title={`Reservation — Room ${roomNumber}`} size="md" onClose={onClose}
                footer={
                    <div className="flex gap-2 w-full">
                        {!isCheckedOut && (
                            <button className="btn btn-danger btn-sm" onClick={handleCancelClick} disabled={cancelling}>
                                {cancelling ? "…" : "Cancel Booking"}
                            </button>
                        )}
                        <button
                            className="btn btn-secondary btn-sm flex items-center gap-1.5"
                            onClick={() => setShowOptions(true)}
                            title="Traces, Alerts, Guest Profile, Loan Items"
                        >
                            <SettingsIcon className="w-3.5 h-3.5" />
                            Options
                        </button>
                        {canSwap && (
                            <button className="btn btn-secondary flex-1" onClick={onSwap}>
                                Swap
                            </button>
                        )}
                        {!isCheckedOut && (
                            <button className="btn btn-primary flex-1" onClick={onEdit}>Edit</button>
                        )}
                        {isCheckedOut && (
                            <span className="flex-1 flex items-center justify-center text-sm font-semibold text-emerald-600 bg-emerald-50 rounded-lg border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                                ✓ Checked Out
                            </span>
                        )}
                    </div>
                }
            >
                <div className="space-y-4">
                    {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">{msg}</div>}

                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className={`text-xl font-bold ${isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>{res.guest_name}</p>
                            {res.phone && <p className="text-sm text-[var(--text-secondary)]">{res.phone}</p>}
                            {res.booking_group_id && (
                                <Link
                                    href={`/pms/groups?group_id=${res.booking_group_id}`}
                                    className="inline-flex mt-1 badge bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30"
                                    title={res.group_name ?? "Open Group Booking"}
                                >
                                    {formatShortGroupCode(res.group_code)}
                                </Link>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {isCheckedOut && (
                                <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 dark:bg-emerald-500/20 dark:text-emerald-400">✓ CO</span>
                            )}
                            <span className={`badge ${sc.bar} ${sc.text} px-3 py-1 ${isCheckedOut ? "opacity-50" : ""}`}>
                                {SOURCE_LABEL[res.source] ?? res.source}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-[var(--bg-body)] border border-[var(--border-default)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Check-in</p>
                            <p className="font-bold text-[var(--text-primary)]">{formatDateDisplay(res.checkin_date)}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--bg-body)] border border-[var(--border-default)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Check-out</p>
                            <p className="font-bold text-[var(--text-primary)]">{formatDateDisplay(res.checkout_date)}</p>
                        </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-[var(--border-subtle)] pt-3">
                        <span className="text-sm text-[var(--text-secondary)]">{nights} night{nights !== 1 ? "s" : ""}</span>
                        <span className="text-2xl font-extrabold text-brand-700">฿{fmt(res.total_price)}</span>
                    </div>

                    <div className="text-xs text-[var(--text-muted)]">Code: {res.booking_code}</div>
                    {res.note && (
                        <div
                            className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
                            title={res.note}
                        >
                            📝 {res.note}
                        </div>
                    )}
                </div>
            </PmsModal>

            {/* Reservation Options Panel (Traces / Alerts / Guest Profile / Loan Items) */}
            {showOptions && (
                <ReservationOptionsPanel
                    reservationId={res.reservation_id}
                    guestName={res.guest_name}
                    checkinDate={res.checkin_date}
                    checkoutDate={res.checkout_date}
                    onClose={() => setShowOptions(false)}
                />
            )}

            <CancelFeeModal
                isOpen={showCancelFeeModal}
                reservationId={res.reservation_id}
                guestName={res.guest_name}
                onClose={() => {
                    if (!cancelling) setShowCancelFeeModal(false);
                }}
                onConfirm={executeCancel}
            />
        </>
    );
}

/* ─── Cell width ──────────────────────────────── */
const COL_W = 44;   // px per day column
const ROW_H = 40;   // px per room row
const ROOM_COL_W = 120; // px for room label

/* ─── Main Calendar Page ──────────────────────── */
function CalendarPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const today = new Date().toISOString().slice(0, 10);
    const [startDate, setStartDate] = useState(today);
    const [spanDays, setSpanDays] = useState(21);
    const endDate = addDays(startDate, spanDays - 1);

    const [data, setData] = useState<CalendarData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showReno, setShowReno] = useState(false);
    const [roomTypeFilter, setRoomTypeFilter] = useState("all");
    const [showMoveRelatedOnly, setShowMoveRelatedOnly] = useState(false);
    const [showActivityOnly, setShowActivityOnly] = useState(false);
    const [roomSort, setRoomSort] = useState<"room_type" | "room_number_asc" | "room_number_desc">("room_type");
    const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
    const [focusReservationId, setFocusReservationId] = useState<string | null>(searchParams.get("focus_reservation_id"));

    const [selectedRes, setSelectedRes] = useState<{ res: Reservation; roomNumber: string } | null>(null);
    const [detailMode, setDetailMode] = useState<"create" | "edit" | null>(null);
    const [detailResId, setDetailResId] = useState<string | undefined>();
    const [detailRoomNumber, setDetailRoomNumber] = useState<string | undefined>();
    const [detailInitialRoomTypeId, setDetailInitialRoomTypeId] = useState<string | undefined>();
    const [detailInitialCheckinDate, setDetailInitialCheckinDate] = useState<string | undefined>();
    const [detailInitialCheckoutDate, setDetailInitialCheckoutDate] = useState<string | undefined>();
    const [assignModal, setAssignModal] = useState<Reservation | null>(null);
    const [swapModal, setSwapModal] = useState<{ res: Reservation; roomNumber: string } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setFocusReservationId(searchParams.get("focus_reservation_id"));
    }, [searchParams]);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                start: startDate,
                end: endDate,
            });
            if (focusReservationId) {
                params.set("focus_reservation_id", focusReservationId);
            }
            const res = await fetch(`/api/calendar?${params.toString()}`);
            const d = await res.json();
            if (d.success) setData(d);
            else setError(d.error ?? "Failed to load.");
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, focusReservationId]);

    useEffect(() => { load(); }, [load]);

    // Scroll to today on first load
    useEffect(() => {
        if (!loading && scrollRef.current) {
            const todayIdx = dateRange(startDate, endDate).indexOf(today);
            if (todayIdx > 0) {
                scrollRef.current.scrollLeft = todayIdx * COL_W - 60;
            }
        }
    }, [loading, startDate, endDate, today]);

    const days = dateRange(startDate, endDate);
    const roomTypeOptions = (() => {
        const options = new Map<string, { value: string; label: string; rank: number }>();
        for (const room of data?.rooms ?? []) {
            const value = getRoomTypeFilterKey(room);
            if (!options.has(value)) {
                options.set(value, {
                    value,
                    label: getRoomTypeLabel(room),
                    rank: getRoomTypeSortRank(room),
                });
            }
        }
        return Array.from(options.values()).sort((a, b) => {
            const rankDiff = a.rank - b.rank;
            if (rankDiff !== 0) return rankDiff;
            return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
        });
    })();

    const moveRelatedRoomIds = (() => {
        const ids = new Set<string>();
        for (const move of data?.planned_moves ?? []) {
            if (move.from_room_id_snapshot) ids.add(String(move.from_room_id_snapshot));
            if (move.to_room_id) ids.add(String(move.to_room_id));
        }
        return ids;
    })();

    const hasBlockActivity = (room: CalendarRoom): boolean => {
        return (data?.blocks ?? []).some((block) => {
            if (block.room_id !== room.room_id) return false;
            return !(block.end_date < startDate || block.start_date > endDate);
        });
    };

    const hasReservationActivity = (room: CalendarRoom): boolean => {
        return room.reservations.some((res) => res.nights.some((night) => night >= startDate && night <= endDate));
    };

    const hasMoveActivity = (room: CalendarRoom): boolean => {
        if (moveRelatedRoomIds.has(room.room_id)) return true;
        return (data?.planned_moves ?? []).some((move) => {
            if (move.end_date <= startDate || move.start_date > endDate) return false;
            return move.to_room_id === room.room_id || move.from_room_id_snapshot === room.room_id;
        });
    };

    const compareRooms = (a: CalendarRoom, b: CalendarRoom): number => {
        if (roomSort === "room_number_asc") {
            return compareRoomNumber(a.room_number, b.room_number);
        }
        if (roomSort === "room_number_desc") {
            return compareRoomNumber(b.room_number, a.room_number);
        }
        const rankDiff = getRoomTypeSortRank(a) - getRoomTypeSortRank(b);
        if (rankDiff !== 0) return rankDiff;
        return compareRoomNumber(a.room_number, b.room_number);
    };

    const visibleRooms = [...(data?.rooms ?? [])]
        .sort(compareRooms)
        .filter((room) => {
            if (!showReno && !room.is_sellable) return false;
            if (roomTypeFilter !== "all" && getRoomTypeFilterKey(room) !== roomTypeFilter) return false;
            if (showMoveRelatedOnly && !hasMoveActivity(room)) return false;
            if (showActivityOnly && !(hasReservationActivity(room) || hasBlockActivity(room) || hasMoveActivity(room))) return false;
            return true;
        });

    const filteredRooms = visibleRooms.filter((r) => !r.is_dayuse);
    const dayUseRooms = visibleRooms.filter((r) => r.is_dayuse);
    const visibleReservationCount = visibleRooms.reduce((acc, room) => acc + room.reservations.length, 0);



    const focusedMove = focusReservationId
        ? (data?.planned_moves ?? []).find((move) => move.reservation_id === focusReservationId) ?? null
        : null;

    function syncFocus(nextReservationId: string | null) {
        const next = new URLSearchParams(searchParams.toString());
        if (nextReservationId) {
            next.set("focus_reservation_id", nextReservationId);
        } else {
            next.delete("focus_reservation_id");
        }
        const query = next.toString();
        router.replace(query ? `/pms/calendar?${query}` : "/pms/calendar", { scroll: false });
        setFocusReservationId(nextReservationId);
    }

    const totalGridW = days.length * COL_W;

    return (
        <div className="flex flex-col gap-4 max-w-full">
            <NightAuditPendingPopup pageName="Calendar" />
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Front Desk</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Booking Calendar</h1>
                </div>
                <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                        setDetailMode("create");
                        setDetailResId(undefined);
                        setDetailRoomNumber(undefined);
                        setDetailInitialRoomTypeId(undefined);
                        setDetailInitialCheckinDate(undefined);
                        setDetailInitialCheckoutDate(undefined);
                    }}
                >
                    + New Booking
                </button>
            </div>

            {/* Controls */}
            <div className="card p-3 flex flex-wrap items-center gap-3">
                {/* Prev/Next */}
                <div className="flex items-center gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(addDays(startDate, -7))}>‹ Week</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(today)}>Today</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(addDays(startDate, 7))}>Week ›</button>
                </div>

                {/* Date picker */}
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">From</label>
                    <input
                        type="date"
                        className="form-input py-1 text-sm w-36"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                    />
                </div>

                {/* Span selector */}
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">View</label>
                    {[7, 14, 21, 30].map((n) => (
                        <button
                            key={n}
                            onClick={() => setSpanDays(n)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${spanDays === n
                                ? "border-brand-400 bg-brand-600 text-white"
                                : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                }`}
                        >
                            {n}D
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">Room Type</label>
                    <select
                        className="form-select py-1 text-sm w-44"
                        value={roomTypeFilter}
                        onChange={(e) => setRoomTypeFilter(e.target.value)}
                    >
                        <option value="all">All Types</option>
                        {roomTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">Sort</label>
                    <select
                        className="form-select py-1 text-sm w-52"
                        value={roomSort}
                        onChange={(e) => setRoomSort(e.target.value as "room_type" | "room_number_asc" | "room_number_desc")}
                    >
                        <option value="room_type">Room Type (Std → Day Use)</option>
                        <option value="room_number_asc">Room Number (Low → High)</option>
                        <option value="room_number_desc">Room Number (High → Low)</option>
                    </select>
                </div>

                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
                    <input
                        type="checkbox"
                        checked={showMoveRelatedOnly}
                        onChange={(e) => setShowMoveRelatedOnly(e.target.checked)}
                        className="rounded"
                    />
                    Move-related only (Before/After)
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
                    <input
                        type="checkbox"
                        checked={showActivityOnly}
                        onChange={(e) => setShowActivityOnly(e.target.checked)}
                        className="rounded"
                    />
                    Activity only
                </label>

                {/* Renovation toggle */}
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-[var(--text-secondary)] ml-auto">
                    <input type="checkbox" checked={showReno} onChange={(e) => setShowReno(e.target.checked)} className="rounded" />
                    Show Renovation
                </label>

                {/* Legend */}
                <div className="flex items-center gap-2 ml-2">
                    {Object.entries(SOURCE_COLOR).map(([src, c]) => (
                        <span key={src} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                            <span className={`inline-block h-2.5 w-5 rounded-sm ${c.bar}`} />
                            {SOURCE_LABEL[src]}
                        </span>
                    ))}
                    <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                        <span className="inline-block h-2.5 w-5 rounded-sm bg-rose-200 border border-rose-400 dark:bg-rose-500/30 dark:border-rose-500/50" />
                        Blocked (OOO)
                    </span>
                </div>
            </div>

            {focusReservationId && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 dark:bg-indigo-500/10 dark:border-indigo-500/20">
                    <div>
                        <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
                            Focused Move Path{focusedMove?.booking_code ? ` — ${focusedMove.booking_code}` : ""}
                        </p>
                        <p className="text-xs text-indigo-700 mt-1 dark:text-indigo-400">
                            {focusedMove
                                ? `${focusedMove.guest_name ?? "Guest"} · planned move path is highlighted across room rows and dates.`
                                : "Reservation focus is active. Other reservations are faded for path review."}
                        </p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => syncFocus(null)}>
                        Clear Focus
                    </button>
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400 px-4 py-3 text-sm text-rose-700">{error}</div>
            )}

            {!error && data?.unassigned && data.unassigned.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between dark:bg-amber-500/10 dark:border-amber-500/20">
                    <div className="flex items-center gap-3">
                        <span className="text-xl">⚠️</span>
                        <div>
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-400">
                                {data.unassigned.length} reservation{data.unassigned.length !== 1 ? "s" : ""} need{data.unassigned.length === 1 ? "s" : ""} room assignment
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-500/80">These bookings are floating. Please assign them a specific physical room.</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5 ml-4">
                        {data.unassigned.map(res => (
                            <div key={res.reservation_id} className="flex items-center gap-3 bg-[var(--bg-surface)] px-3 py-1.5 rounded border border-amber-100 shadow-sm text-sm dark:border-amber-500/30">
                                <span className="font-bold text-[var(--text-primary)]">{res.guest_name}</span>
                                <span className="text-[var(--text-muted)]">·</span>
                                <span className="text-brand-600 font-semibold">{res.room_type}</span>
                                <span className="text-[var(--text-muted)]">·</span>
                                <span className="text-[var(--text-secondary)]">{formatDateRangeDisplay(res.checkin_date, res.checkout_date, { withYear: false })}</span>
                                <button className="btn btn-primary btn-sm ml-auto" onClick={() => setAssignModal(res)}>
                                    Assign Room →
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            <RoomGrid
                ref={scrollRef}
                isLoading={loading}
                rooms={visibleRooms}
                blocks={data?.blocks ?? []}
                plannedMoves={data?.planned_moves ?? []}
                startDate={startDate}
                spanDays={spanDays}
                days={days}
                mode="readonly"
                hoverGroupId={hoverGroupId}
                focusReservationId={focusReservationId}
                onLinkHover={setHoverGroupId}
                onFocusReservation={syncFocus}
                onBarClick={(res, roomNumber) => setSelectedRes({ res, roomNumber })}
                onCellClick={(roomId, date) => {
                    const room = visibleRooms.find(r => r.room_id === roomId);
                    if (!room || !room.is_sellable) return;
                    setDetailMode("create");
                    setDetailResId(undefined);
                    setDetailRoomNumber(room.room_number);
                    setDetailInitialRoomTypeId(room.room_type_id || undefined);
                    setDetailInitialCheckinDate(date);
                    setDetailInitialCheckoutDate(addDays(date, 1));
                }}
            />

            {/* Summary footer */}
            {
                data && !loading && (
                    <div className="border-t border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-2 flex gap-6 text-xs text-[var(--text-secondary)]">
                        <span>{visibleRooms.filter((r) => r.is_sellable).length} sellable rooms</span>
                        <span>{visibleRooms.length} visible room(s)</span>
                        <span>
                            {visibleReservationCount} reservation(s) in view
                        </span>
                        <span>{startDate} → {endDate}</span>
                    </div>
                )
            }

        {/* Reservation Detail Modal */ }
    {
        selectedRes && (
            <ReservationDetail
                res={selectedRes.res}
                roomNumber={selectedRes.roomNumber}
                onClose={() => setSelectedRes(null)}
                onEdit={() => {
                    setDetailMode("edit");
                    setDetailResId(selectedRes.res.reservation_id);
                    setDetailRoomNumber(selectedRes.roomNumber);
                    setDetailInitialRoomTypeId(undefined);
                    setDetailInitialCheckinDate(undefined);
                    setDetailInitialCheckoutDate(undefined);
                    setSelectedRes(null);
                }}
                onSwap={() => {
                    const payload = selectedRes;
                    setSelectedRes(null);
                    if (!payload) return;
                    setSwapModal({ res: payload.res, roomNumber: payload.roomNumber });
                }}
                onRefresh={load}
            />
        )
    }

    {/* Reservation Detail Page (edit/create) */ }
    {
        detailMode && (
            <ReservationDetailPage
                mode={detailMode}
                reservationId={detailResId}
                roomNumber={detailRoomNumber}
                initialRoomTypeId={detailInitialRoomTypeId}
                initialCheckinDate={detailInitialCheckinDate}
                initialCheckoutDate={detailInitialCheckoutDate}
                onClose={() => {
                    setDetailMode(null);
                    setDetailResId(undefined);
                    setDetailRoomNumber(undefined);
                    setDetailInitialRoomTypeId(undefined);
                    setDetailInitialCheckinDate(undefined);
                    setDetailInitialCheckoutDate(undefined);
                }}
                onSuccess={() => {
                    setDetailMode(null);
                    setDetailResId(undefined);
                    setDetailRoomNumber(undefined);
                    setDetailInitialRoomTypeId(undefined);
                    setDetailInitialCheckinDate(undefined);
                    setDetailInitialCheckoutDate(undefined);
                    load();
                }}
            />
        )
    }

    {/* Assign Room Modal */ }
    {
        assignModal && (
            <AssignRoomModal
                reservationId={assignModal.reservation_id}
                roomTypeId={assignModal.room_type_id}
                roomTypeName={assignModal.room_type}
                guestName={assignModal.guest_name}
                checkinDate={assignModal.checkin_date}
                checkoutDate={assignModal.checkout_date}
                onClose={() => setAssignModal(null)}
                onSuccess={() => {
                    setAssignModal(null);
                    load();
                }}
            />
        )
    }

    {
        swapModal && (
            <AssignRoomModal
                reservationId={swapModal.res.reservation_id}
                roomTypeId={swapModal.res.room_type_id}
                roomTypeName={swapModal.res.room_type}
                guestName={swapModal.res.guest_name}
                checkinDate={swapModal.res.checkin_date}
                checkoutDate={swapModal.res.checkout_date}
                mode="swap"
                currentRoomNumber={swapModal.roomNumber}
                onClose={() => setSwapModal(null)}
                onSuccess={() => {
                    setSwapModal(null);
                    load();
                }}
            />
        )
    }

            </div >
            );
}

export default function CalendarPage() {
    return (
        <Suspense fallback={<div className="max-w-full" />}>
            <CalendarPageInner />
        </Suspense>
    );
}
