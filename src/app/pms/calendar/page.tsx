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

/* ─── Types ───────────────────────────────────── */
type Reservation = {
    reservation_id: string;
    booking_code: string;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    guest_name: string;
    phone: string | null;
    source: string;
    status: string;           // 'active' | 'checked_out'
    checkin_date: string;
    checkout_date: string;
    total_price: number;
    note: string | null;
    nights: string[];
    alert_count?: number;
    first_alert_message?: string | null;
    alert_severity?: "info" | "warning" | "critical" | null;
    room_type_id: string;
    room_type: string;
};

type CalendarRoom = {
    room_id: string;
    room_number: string;
    room_type: string;
    room_type_code: string;
    is_sellable: boolean;
    closure_reason: string | null;
    is_dayuse?: boolean;
    reservations: Reservation[];
};

type RoomBlock = {
    id: string;
    room_id: string;
    block_type: "OOO" | "OOS";
    start_date: string;
    end_date: string;
    reason: string;
};

type CalendarData = {
    success: boolean;
    start_date: string;
    end_date: string;
    rooms: CalendarRoom[];
    unassigned?: Reservation[];
    blocks?: RoomBlock[];
    planned_moves?: PlannedMove[];
};

type PlannedMove = {
    id: string;
    reservation_id: string;
    booking_code: string | null;
    guest_name: string | null;
    checkin_date: string | null;
    checkout_date: string | null;
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    start_date: string;
    end_date: string;
    from_room_id_snapshot: string | null;
    from_room_number: string | null;
    to_room_id: string;
    to_room_number: string | null;
    to_room_type_id: number;
    move_reason: string | null;
    pricing_policy: string;
    do_not_move: boolean;
    status: string;
};

/* ─── Constants ───────────────────────────────── */
const SOURCE_COLOR: Record<string, { bar: string; text: string }> = {
    walkin: { bar: "bg-sky-500", text: "text-white" },
    ota: { bar: "bg-purple-500", text: "text-white" },
    direct: { bar: "bg-emerald-500", text: "text-white" },
    agent: { bar: "bg-amber-500", text: "text-[var(--text-primary)]" }
};
const DEFAULT_COLOR = { bar: "bg-brand-500", text: "text-white" };

const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in", ota: "OTA", direct: "Direct", agent: "Agent"
};

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

/* ─── Reservation Detail Modal ────────────────── */
function ReservationDetail({
    res,
    roomNumber,
    onClose,
    onEdit,
    onRefresh
}: {
    res: Reservation;
    roomNumber: string;
    onClose: () => void;
    onEdit: () => void;
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
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowOptions(true)}
                            title="Traces, Alerts, Guest Profile, Loan Items"
                        >
                            ⋯ Options
                        </button>
                        <button className="btn btn-secondary flex-1" onClick={onClose}>Close</button>
                        {!isCheckedOut && (
                            <button className="btn btn-primary flex-1" onClick={onEdit}>Edit</button>
                        )}
                        {isCheckedOut && (
                            <span className="flex-1 flex items-center justify-center text-sm font-semibold text-emerald-600 bg-emerald-50 rounded-lg border border-emerald-200">
                                ✓ Checked Out
                            </span>
                        )}
                    </div>
                }
            >
                <div className="space-y-4">
                    {msg && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className={`text-xl font-bold ${isCheckedOut ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>{res.guest_name}</p>
                            {res.phone && <p className="text-sm text-[var(--text-secondary)]">{res.phone}</p>}
                            {res.booking_group_id && (
                                <Link
                                    href={`/pms/groups?group_id=${res.booking_group_id}`}
                                    className="inline-flex mt-1 badge bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                                    title={res.group_name ?? "Open Group Booking"}
                                >
                                    {formatShortGroupCode(res.group_code)}
                                </Link>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {isCheckedOut && (
                                <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5">✓ CO</span>
                            )}
                            <span className={`badge ${sc.bar} ${sc.text} px-3 py-1 ${isCheckedOut ? "opacity-50" : ""}`}>
                                {SOURCE_LABEL[res.source] ?? res.source}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-[var(--bg-body)] border border-[var(--border-default)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Check-in</p>
                            <p className="font-bold text-[var(--text-primary)]">{res.checkin_date}</p>
                        </div>
                        <div className="rounded-lg bg-[var(--bg-body)] border border-[var(--border-default)] px-3 py-2">
                            <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Check-out</p>
                            <p className="font-bold text-[var(--text-primary)]">{res.checkout_date}</p>
                        </div>
                    </div>

                    <div className="flex justify-between items-center border-t border-[var(--border-subtle)] pt-3">
                        <span className="text-sm text-[var(--text-secondary)]">{nights} night{nights !== 1 ? "s" : ""}</span>
                        <span className="text-2xl font-extrabold text-brand-700">฿{fmt(res.total_price)}</span>
                    </div>

                    <div className="text-xs text-[var(--text-muted)]">Code: {res.booking_code}</div>
                    {res.note && (
                        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">📝 {res.note}</div>
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
    const [assignModal, setAssignModal] = useState<Reservation | null>(null);

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
            if (move.status !== "planned") continue;
            if (move.from_room_id_snapshot) ids.add(move.from_room_id_snapshot);
            if (move.to_room_id) ids.add(move.to_room_id);
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

    const hasMoveActivity = (room: CalendarRoom): boolean => moveRelatedRoomIds.has(room.room_id);

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

    // Map: room_id → reservations that overlap days range (keyed by first night in range)
    // Build bar segments: for each room, find reservations and compute bar position
    function getBarsForRoom(room: CalendarRoom) {
        return room.reservations.map((res) => {
            const visibleNights = res.nights.filter((n) => n >= startDate && n <= endDate);
            if (visibleNights.length === 0) return null;

            const firstNight = visibleNights[0];
            const lastNight = visibleNights[visibleNights.length - 1];

            const startIdx = days.indexOf(firstNight);
            const spanCount = days.indexOf(lastNight) - startIdx + 1;

            const clippedLeft = res.checkin_date < startDate;
            const clippedRight = res.checkout_date > addDays(endDate, 1);

            return { res, startIdx, spanCount, clippedLeft, clippedRight };
        }).filter(Boolean) as {
            res: Reservation;
            startIdx: number;
            spanCount: number;
            clippedLeft: boolean;
            clippedRight: boolean;
        }[];
    }

    function getBlocksForRoom(room: CalendarRoom) {
        return (data?.blocks ?? []).filter(b => b.room_id === room.room_id).map(block => {
            if (block.end_date < startDate || block.start_date > endDate) return null;

            const bStart = block.start_date < startDate ? startDate : block.start_date;
            const bEnd = block.end_date > addDays(endDate, 1) ? addDays(endDate, 1) : block.end_date;

            const startIdx = days.indexOf(bStart);
            const spanCount = days.indexOf(addDays(bEnd, -1)) - startIdx + 1;

            if (startIdx < 0 || spanCount <= 0) return null;

            return { block, startIdx, spanCount };
        }).filter(Boolean) as { block: RoomBlock, startIdx: number, spanCount: number }[];
    }

    function getPlannedBarsForRoom(room: CalendarRoom) {
        return (data?.planned_moves ?? [])
            .filter((move) => move.status === "planned" && move.to_room_id === room.room_id)
            .map((move) => {
                if (move.end_date <= startDate || move.start_date > endDate) return null;
                const visibleStart = move.start_date < startDate ? startDate : move.start_date;
                const visibleEndExclusive = move.end_date > addDays(endDate, 1) ? addDays(endDate, 1) : move.end_date;
                const startIdx = days.indexOf(visibleStart);
                const lastVisibleNight = addDays(visibleEndExclusive, -1);
                const spanCount = days.indexOf(lastVisibleNight) - startIdx + 1;
                if (startIdx < 0 || spanCount <= 0) return null;
                return { move, startIdx, spanCount };
            })
            .filter(Boolean) as { move: PlannedMove; startIdx: number; spanCount: number }[];
    }

    function getPlannedReleaseBarsForRoom(room: CalendarRoom) {
        return (data?.planned_moves ?? [])
            .filter((move) => move.status === "planned" && move.from_room_id_snapshot === room.room_id)
            .map((move) => {
                if (move.end_date <= startDate || move.start_date > endDate) return null;
                const visibleStart = move.start_date < startDate ? startDate : move.start_date;
                const visibleEndExclusive = move.end_date > addDays(endDate, 1) ? addDays(endDate, 1) : move.end_date;
                const startIdx = days.indexOf(visibleStart);
                const lastVisibleNight = addDays(visibleEndExclusive, -1);
                const spanCount = days.indexOf(lastVisibleNight) - startIdx + 1;
                if (startIdx < 0 || spanCount <= 0) return null;
                return { move, startIdx, spanCount };
            })
            .filter(Boolean) as { move: PlannedMove; startIdx: number; spanCount: number }[];
    }

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
                <button className="btn btn-primary btn-sm" onClick={() => { setDetailMode("create"); setDetailResId(undefined); setDetailRoomNumber(undefined); }}>+ New Booking</button>
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
                        <span className="inline-block h-2.5 w-5 rounded-sm bg-rose-200 border border-rose-400" />
                        Blocked (OOO)
                    </span>
                </div>
            </div>

            {focusReservationId && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-indigo-900">
                            Focused Move Path{focusedMove?.booking_code ? ` — ${focusedMove.booking_code}` : ""}
                        </p>
                        <p className="text-xs text-indigo-700 mt-1">
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
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-xl">⚠️</span>
                        <div>
                            <p className="text-sm font-bold text-amber-800">
                                {data.unassigned.length} reservation{data.unassigned.length !== 1 ? "s" : ""} need{data.unassigned.length === 1 ? "s" : ""} room assignment
                            </p>
                            <p className="text-xs text-amber-700">These bookings are floating. Please assign them a specific physical room.</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5 ml-4">
                        {data.unassigned.map(res => (
                            <div key={res.reservation_id} className="flex items-center gap-3 bg-[var(--bg-surface)] px-3 py-1.5 rounded border border-amber-100 shadow-sm text-sm">
                                <span className="font-bold text-[var(--text-primary)]">{res.guest_name}</span>
                                <span className="text-[var(--text-muted)]">·</span>
                                <span className="text-brand-600 font-semibold">{res.room_type}</span>
                                <span className="text-[var(--text-muted)]">·</span>
                                <span className="text-[var(--text-secondary)]">{res.checkin_date} </span>
                                <button className="btn btn-primary btn-sm ml-auto" onClick={() => setAssignModal(res)}>
                                    Assign Room →
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Gantt Grid */}
            <div className="card overflow-hidden">
                <div className="flex">
                    {/* Frozen room column */}
                    <div
                        className="flex-shrink-0 border-r border-[var(--border-default)] bg-[var(--bg-surface)] z-10"
                        style={{ width: ROOM_COL_W }}
                    >
                        {/* Header cell */}
                        <div
                            className="flex items-center px-3 border-b border-[var(--border-default)] bg-[var(--bg-body)] text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]"
                            style={{ height: ROW_H }}
                        >
                            Room
                        </div>
                        {loading
                            ? Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="flex items-center px-3 border-b border-[var(--border-subtle)]" style={{ height: ROW_H }}>
                                    <div className="h-3 w-20 rounded bg-[var(--bg-muted)] animate-pulse" />
                                </div>
                            ))
                            : (
                                <>
                                    {filteredRooms.map((room) => (
                                        <div
                                            key={room.room_id}
                                            className="flex items-center gap-1.5 px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                                            style={{ height: ROW_H }}
                                        >
                                            <span className="text-sm font-bold text-[var(--text-primary)]">{room.room_number}</span>
                                            <span className="text-[9px] text-[var(--text-muted)] truncate">{room.room_type_code || room.room_type.slice(0, 2)}</span>
                                            {!room.is_sellable && <span className="text-[9px] text-[var(--text-muted)]">🚧</span>}
                                        </div>
                                    ))}
                                    {dayUseRooms.length > 0 && (
                                        <>
                                            <div
                                                className="flex items-center px-3 border-b border-t border-[var(--border-default)] bg-[var(--bg-body)] text-[10px] font-bold uppercase tracking-wide text-[var(--dayuse-text)]"
                                                style={{ height: ROW_H }}
                                            >
                                                Day Use
                                            </div>
                                            {dayUseRooms.map((room) => (
                                                <div
                                                    key={room.room_id}
                                                    className="flex items-center gap-1.5 px-3 border-b border-[var(--border-subtle)] bg-rose-50/20 dark:bg-rose-900/10"
                                                    style={{ height: ROW_H }}
                                                >
                                                    <span className="text-sm font-bold text-[var(--text-primary)]">{room.room_number}</span>
                                                    <span className="text-[9px] text-[var(--dayuse-text)] font-bold uppercase truncate">Day Use</span>
                                                    {!room.is_sellable && <span className="text-[9px] text-[var(--text-muted)]">🚧</span>}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}
                    </div>

                    {/* Scrollable grid */}
                    <div ref={scrollRef} className="overflow-x-auto flex-1">
                        <div style={{ width: totalGridW, minWidth: totalGridW }}>
                            {/* Date header */}
                            <div
                                className="flex border-b border-[var(--border-default)] bg-[var(--bg-body)] sticky top-0 z-10"
                                style={{ height: ROW_H }}
                            >
                                {days.map((day) => {
                                    const { day: d, dow } = dayLabel(day);
                                    const isToday = day === today;
                                    const weekend = isWeekend(day);
                                    return (
                                        <div
                                            key={day}
                                            className={`flex-shrink-0 flex flex-col items-center justify-center border-r border-[var(--border-default)] text-center select-none ${isToday ? "bg-brand-50 dark:bg-brand-900/40" : weekend ? "bg-rose-50/40 dark:bg-rose-900/20" : ""
                                                }`}
                                            style={{ width: COL_W }}
                                        >
                                            <span className={`text-[9px] font-semibold ${weekend ? "text-rose-400" : "text-[var(--text-muted)]"}`}>{dow}</span>
                                            <span className={`text-sm font-bold leading-none ${isToday ? "text-brand-700" : weekend ? "text-rose-500" : "text-[var(--text-table-cell)]"}`}>{d}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Room rows */}
                            {loading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <div key={i} className="flex border-b border-[var(--border-subtle)]" style={{ height: ROW_H }}>
                                        {days.map((d) => (
                                            <div key={d} className="flex-shrink-0 border-r border-[var(--border-subtle)]" style={{ width: COL_W }} />
                                        ))}
                                    </div>
                                ))
                            ) : (
                                <>
                                    {filteredRooms.map((room) => {
                                        const bars = getBarsForRoom(room);
                                        const roomBlocks = getBlocksForRoom(room);
                                        const plannedReleaseBars = getPlannedReleaseBarsForRoom(room);
                                        const plannedBars = getPlannedBarsForRoom(room);
                                        return (
                                            <div key={room.room_id} className="relative flex border-b border-[var(--border-subtle)]" style={{ height: ROW_H }}>
                                                {days.map((day) => (
                                                    <div
                                                        key={day}
                                                        className={`flex-shrink-0 border-r border-[var(--border-subtle)] cursor-pointer transition-colors ${
                                                            day === today ? "bg-brand-50/30 dark:bg-brand-900/30" : isWeekend(day) ? "bg-rose-50/20 dark:bg-rose-900/15" : "hover:bg-[var(--bg-body)]"
                                                        } ${!room.is_sellable ? "bg-[var(--bg-surface-hover)]/60" : ""}`}
                                                        style={{ width: COL_W, height: ROW_H }}
                                                        onClick={() => {
                                                            if (!room.is_sellable) return;
                                                            setDetailMode("create");
                                                            setDetailResId(undefined);
                                                            setDetailRoomNumber(room.room_number);
                                                        }}
                                                        title={room.is_sellable ? `New booking in Room ${room.room_number} on ${day}` : undefined}
                                                    />
                                                ))}

                                                {roomBlocks.map(({ block, startIdx, spanCount }) => {
                                                    const isOOO = block.block_type === "OOO";
                                                    const color = isOOO ? "bg-rose-200 border-rose-400 text-rose-800" : "bg-amber-100 border-amber-300 text-amber-800";
                                                    const left = startIdx * COL_W;
                                                    const width = spanCount * COL_W;
                                                    return (
                                                        <div
                                                            key={block.id}
                                                            className={`absolute top-0 bottom-0 border-x border-y-0 ${color} z-0 opacity-80 flex flex-col justify-center px-1 overflow-hidden select-none pointer-events-none`}
                                                            style={{ left, width, zIndex: 5 }}
                                                            title={`Blocked (${block.block_type}): ${block.reason}`}
                                                        >
                                                            <div className="absolute inset-0 bg-stripe-pattern opacity-10" />
                                                            <span className="text-[10px] font-bold leading-none truncate relative z-10">
                                                                {isOOO ? "OOO" : "OOS"} - {block.reason}
                                                            </span>
                                                        </div>
                                                    );
                                                })}

                                                {plannedBars.map(({ move, startIdx, spanCount }) => {
                                                    const shouldFade = Boolean(focusReservationId) && move.reservation_id !== focusReservationId;
                                                    const isFocused = move.reservation_id === focusReservationId;
                                                    const left = startIdx * COL_W + 2;
                                                    const width = spanCount * COL_W - 4;
                                                    return (
                                                        <button
                                                            key={`planned-${move.id}`}
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                syncFocus(move.reservation_id);
                                                            }}
                                                            className={`absolute rounded-md border-2 border-dashed px-2 text-[10px] font-semibold text-indigo-700 transition z-20 ${move.do_not_move ? "border-rose-400 bg-rose-100/85 text-rose-700" : "border-indigo-400 bg-indigo-100/85"} ${shouldFade ? "opacity-10" : "opacity-95"} ${isFocused ? "shadow-[0_0_0_2px_rgba(99,102,241,0.18)]" : ""}`}
                                                            style={{ left, width, top: 2, height: ROW_H - 4 }}
                                                            title={`${move.guest_name ?? "Guest"} · planned ${move.start_date} → ${move.end_date} · Room ${move.to_room_number ?? "?"}`}
                                                        >
                                                            {width > 92 ? `Move ← ${move.from_room_number ?? "?"}` : null}
                                                        </button>
                                                    );
                                                })}

                                                {plannedReleaseBars.map(({ move, startIdx, spanCount }) => {
                                                    const shouldFade = Boolean(focusReservationId) && move.reservation_id !== focusReservationId;
                                                    const isFocused = move.reservation_id === focusReservationId;
                                                    const left = startIdx * COL_W + 2;
                                                    const width = spanCount * COL_W - 4;
                                                    return (
                                                        <button
                                                            key={`planned-release-${move.id}`}
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                syncFocus(move.reservation_id);
                                                            }}
                                                            className={`absolute rounded-md border-2 border-dashed px-2 text-[10px] font-semibold transition z-[15] ${
                                                                move.do_not_move
                                                                    ? "border-orange-400 bg-orange-100/85 text-orange-800"
                                                                    : "border-amber-400 bg-amber-100/80 text-amber-800"
                                                            } ${shouldFade ? "opacity-10" : "opacity-95"} ${isFocused ? "shadow-[0_0_0_2px_rgba(251,191,36,0.18)]" : ""}`}
                                                            style={{ left, width, top: 2, height: ROW_H - 4 }}
                                                            title={`${move.guest_name ?? "Guest"} · release Room ${move.from_room_number ?? "?"} for planned move ${move.start_date} → ${move.end_date} · target Room ${move.to_room_number ?? "?"}`}
                                                        >
                                                            {width > 92 ? `Move → ${move.to_room_number ?? "?"}` : null}
                                                        </button>
                                                    );
                                                })}

                                                {bars.map(({ res, startIdx, spanCount, clippedLeft, clippedRight }) => {
                                                    const isCheckedOut = res.status === "checked_out";
                                                    const sc = isCheckedOut ? { bar: "bg-[var(--bg-muted)]", text: "text-[var(--text-secondary)]" } : (SOURCE_COLOR[res.source] ?? DEFAULT_COLOR);
                                                    const groupId = res.booking_group_id ? String(res.booking_group_id) : null;
                                                    const isGroupFocused = !focusReservationId && Boolean(hoverGroupId) && groupId === hoverGroupId;
                                                    const shouldFadeGroup = focusReservationId
                                                        ? res.reservation_id !== focusReservationId
                                                        : Boolean(hoverGroupId) && groupId !== hoverGroupId;
                                                    const left = startIdx * COL_W + (clippedLeft ? 0 : 2);
                                                    const width = spanCount * COL_W - (clippedLeft ? 0 : 2) - (clippedRight ? 0 : 2);
                                                    return (
                                                        <button
                                                            key={res.reservation_id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setSelectedRes({ res, roomNumber: room.room_number });
                                                            }}
                                                            onMouseEnter={() => setHoverGroupId(groupId)}
                                                            onMouseLeave={() => setHoverGroupId(null)}
                                                            onFocus={() => setHoverGroupId(groupId)}
                                                            onBlur={() => setHoverGroupId(null)}
                                                            className={`absolute top-1.5 rounded-md ${sc.bar} ${sc.text} text-[10px] font-semibold overflow-hidden whitespace-nowrap px-2 shadow-sm transition z-10 ${
                                                                shouldFadeGroup ? "opacity-10" : isCheckedOut ? "opacity-60 cursor-default" : "hover:brightness-110"
                                                            } ${(isGroupFocused || res.reservation_id === focusReservationId) ? "ring-2 ring-indigo-300 brightness-110" : ""} ${clippedLeft ? "rounded-l-none" : ""} ${
                                                                clippedRight ? "rounded-r-none" : ""
                                                            }`}
                                                            style={{ left, width, height: ROW_H - 12, transform: isGroupFocused ? "scaleY(1.08)" : undefined, transformOrigin: "center" }}
                                                            title={`${isCheckedOut ? "✓ CO " : ""}${res.guest_name} · ${res.checkin_date} → ${res.checkout_date}${res.group_code ? ` · ${res.group_code}` : ""}${res.first_alert_message ? ` · Alert: ${res.first_alert_message}` : ""}`}
                                                        >
                                                            {width > 60 ? (
                                                                <span className="flex items-center gap-1">
                                                                    {isCheckedOut && <span className="opacity-80">✓</span>}
                                                                    {res.guest_name}
                                                                    {isCheckedOut && width > 120 && <span className="ml-1 text-[9px] bg-[var(--bg-surface)]/30 rounded px-1">CO</span>}
                                                                </span>
                                                            ) : null}
                                                            {(res.alert_count ?? 0) > 0 && (
                                                                <span
                                                                    className={`absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border border-white/80 ${
                                                                        res.alert_severity === "critical"
                                                                            ? "bg-rose-500"
                                                                            : res.alert_severity === "warning"
                                                                                ? "bg-amber-400"
                                                                                : "bg-sky-400"
                                                                    }`}
                                                                    title={res.first_alert_message ?? "Alert"}
                                                                />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}

                                    {dayUseRooms.length > 0 && (
                                        <>
                                            <div className="flex border-b border-t border-[var(--border-default)] bg-[var(--bg-body)]" style={{ height: ROW_H }}>
                                                <div className="px-2 flex items-center text-[10px] font-bold uppercase tracking-wide text-[var(--dayuse-text)]">Day Use</div>
                                            </div>
                                            {dayUseRooms.map((room) => {
                                                const roomBlocks = getBlocksForRoom(room);
                                                return (
                                                    <div key={room.room_id} className="relative flex border-b border-[var(--border-subtle)] bg-rose-50/10 hover:bg-rose-50/20 dark:bg-rose-900/10 dark:hover:bg-rose-900/15 transition-colors" style={{ height: ROW_H }}>
                                                        {days.map((day) => {
                                                            const hasRes = room.reservations.some((r) => r.nights.includes(day));
                                                            return (
                                                                <div
                                                                    key={day}
                                                                    className={`flex flex-col items-center justify-center flex-shrink-0 border-r border-[var(--border-subtle)] cursor-not-allowed ${!room.is_sellable ? "bg-[var(--bg-surface-hover)]/60" : ""}`}
                                                                    style={{ width: COL_W, height: ROW_H }}
                                                                    title="Use Room Diary board for Day Use actions"
                                                                >
                                                                    {hasRes && <div className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />}
                                                                </div>
                                                            );
                                                        })}

                                                        {roomBlocks.map(({ block, startIdx, spanCount }) => {
                                                            const isOOO = block.block_type === "OOO";
                                                            const color = isOOO ? "bg-rose-200 border-rose-400 text-rose-800" : "bg-amber-100 border-amber-300 text-amber-800";
                                                            const left = startIdx * COL_W;
                                                            const width = spanCount * COL_W;
                                                            return (
                                                                <div
                                                                    key={block.id}
                                                                    className={`absolute top-0 bottom-0 border-x border-y-0 ${color} z-0 opacity-80 flex flex-col justify-center px-1 overflow-hidden select-none pointer-events-none`}
                                                                    style={{ left, width, zIndex: 5 }}
                                                                    title={`Blocked (${block.block_type}): ${block.reason}`}
                                                                >
                                                                    <div className="absolute inset-0 bg-stripe-pattern opacity-10" />
                                                                    <span className="text-[10px] font-bold leading-none truncate relative z-10">
                                                                        {isOOO ? "OOO" : "OOS"} - {block.reason}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

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
        </div >

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
                    setSelectedRes(null);
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
                onClose={() => { setDetailMode(null); setDetailResId(undefined); setDetailRoomNumber(undefined); }}
                onSuccess={() => { setDetailMode(null); setDetailResId(undefined); setDetailRoomNumber(undefined); load(); }}
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
