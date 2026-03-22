"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, addDays } from "date-fns";
import { RoomGrid, SOURCE_COLOR, SOURCE_LABEL } from "@/components/room-grid";
import { UnassignedSidebar } from "@/components/room-planner/unassigned-sidebar";
import { useDraftEngine } from "@/components/room-planner/use-draft-engine";
import { ReviewPanel } from "@/components/room-planner/review-panel";
import type { CalendarData, CalendarReservation, CalendarRoom } from "@/lib/types";

/* ─── Room filter helpers (same as Calendar) ─── */
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

export default function RoomPlannerPage() {
    const today = format(new Date(), "yyyy-MM-dd");
    const [startDate, setStartDate] = useState(today);
    const [spanDays, setSpanDays] = useState(14);

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<CalendarData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showReview, setShowReview] = useState(false);

    /* ─── Filters (matching Calendar) ─── */
    const [roomTypeFilter, setRoomTypeFilter] = useState("all");
    const [roomSort, setRoomSort] = useState<"room_type" | "room_number_asc" | "room_number_desc">("room_type");
    const [showReno, setShowReno] = useState(false);
    const [showActivityOnly, setShowActivityOnly] = useState(false);

    /* ─── Drag highlight state ─── */
    const [dropTarget, setDropTarget] = useState<{ roomId: string; date: string } | null>(null);

    const { actions, overrides, commitAction, undo, clearDrafts, hasDrafts } = useDraftEngine();

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const endDate = format(addDays(new Date(startDate), spanDays), "yyyy-MM-dd");
            const res = await fetch(`/api/calendar?start=${startDate}&end=${endDate}`);
            if (!res.ok) throw new Error("Failed to load planner data");
            const json = await res.json();
            if (!json.success) throw new Error(json.error || "Failed to load planner data");
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [startDate, spanDays]);

    useEffect(() => {
        load();
    }, [load]);

    /* ─── Room Type filter options ─── */
    const roomTypeOptions = useMemo(() => {
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
    }, [data?.rooms]);

    /* ─── Activity check ─── */
    const hasReservationActivity = useCallback((room: CalendarRoom): boolean => {
        const endDate = format(addDays(new Date(startDate), spanDays - 1), "yyyy-MM-dd");
        return room.reservations.some((res) => res.nights.some((night) => night >= startDate && night <= endDate));
    }, [startDate, spanDays]);

    const hasBlockActivity = useCallback((room: CalendarRoom): boolean => {
        const endDate = format(addDays(new Date(startDate), spanDays - 1), "yyyy-MM-dd");
        return (data?.blocks ?? []).some((block) => {
            if (block.room_id !== room.room_id) return false;
            return !(block.end_date < startDate || block.start_date > endDate);
        });
    }, [data?.blocks, startDate, spanDays]);

    /* ─── Visible rooms (filtered + sorted) ─── */
    const visibleRooms = useMemo(() => {
        const compareRooms = (a: CalendarRoom, b: CalendarRoom): number => {
            if (roomSort === "room_number_asc") return compareRoomNumber(a.room_number, b.room_number);
            if (roomSort === "room_number_desc") return compareRoomNumber(b.room_number, a.room_number);
            const rankDiff = getRoomTypeSortRank(a) - getRoomTypeSortRank(b);
            if (rankDiff !== 0) return rankDiff;
            return compareRoomNumber(a.room_number, b.room_number);
        };

        return [...(data?.rooms ?? [])]
            .sort(compareRooms)
            .filter((room) => {
                // Fix 1: Always hide non-sellable rooms unless showReno is on
                if (!showReno && !room.is_sellable) return false;
                // Hide day-use rooms from planner (they can't be overnight-assigned)
                if (room.is_dayuse) return false;
                if (roomTypeFilter !== "all" && getRoomTypeFilterKey(room) !== roomTypeFilter) return false;
                if (showActivityOnly && !(hasReservationActivity(room) || hasBlockActivity(room))) return false;
                return true;
            });
    }, [data?.rooms, showReno, roomTypeFilter, roomSort, showActivityOnly, hasReservationActivity, hasBlockActivity]);

    /* ─── Apply draft overrides to the data ─── */
    const mergedData = useMemo(() => {
        if (!data) return null;

        const sourceRooms = visibleRooms;
        if (!hasDrafts) {
            return {
                ...data,
                rooms: sourceRooms,
            };
        }

        const clonedRooms = JSON.parse(JSON.stringify(sourceRooms)) as typeof sourceRooms;
        const clonedUnassigned: CalendarReservation[] = JSON.parse(JSON.stringify(data.unassigned || []));

        const allReservations = new Map<string, CalendarReservation>();
        for (const room of clonedRooms) {
            for (const res of room.reservations) {
                allReservations.set(res.reservation_id, res);
            }
        }
        for (const res of clonedUnassigned) {
            allReservations.set(res.reservation_id, res);
        }

        // Track which reservations have solid overrides (assigned somewhere)
        const hasSolidOverride = new Set(
            overrides.filter(o => o.type === "solid").map(o => o.reservation_id)
        );

        for (const override of overrides) {
            const res = allReservations.get(override.reservation_id);
            if (!res) continue;

            if (override.type === "ghost") {
                (res as any).draft_state = "ghost";

                // If ghost but no solid → UNASSIGN: move to unassigned list
                if (!hasSolidOverride.has(override.reservation_id)) {
                    const alreadyInUnassigned = clonedUnassigned.some(u => u.reservation_id === res.reservation_id);
                    if (!alreadyInUnassigned) {
                        const unassignedCopy = { ...res };
                        (unassignedCopy as any).draft_state = "unassign_draft";
                        clonedUnassigned.push(unassignedCopy);
                    }
                }
            } else if (override.type === "solid") {
                const targetRoom = clonedRooms.find(r => r.room_id === override.room_id);
                if (targetRoom) {
                    const solidCopy = { ...res };
                    (solidCopy as any).draft_state = "solid";
                    targetRoom.reservations.push(solidCopy);

                    // Remove from unassigned if it was there
                    const unassignedIdx = clonedUnassigned.findIndex(u => u.reservation_id === res.reservation_id);
                    if (unassignedIdx !== -1) {
                        clonedUnassigned.splice(unassignedIdx, 1);
                    }
                }
            }
        }

        return {
            ...data,
            rooms: clonedRooms,
            unassigned: clonedUnassigned,
        };
    }, [data, visibleRooms, hasDrafts, overrides]);

    /* ─── Drag handlers ─── */
    const handleDragStartUnassigned = (e: React.DragEvent<HTMLDivElement>, res: CalendarReservation) => {
        e.dataTransfer.setData("application/json", JSON.stringify({
            type: "UNASSIGNED",
            reservation_id: res.reservation_id,
            booking_code: res.booking_code
        }));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleBarDragStart = (res: CalendarReservation, roomNumber: string, e: React.DragEvent) => {
        // Find the current room_id for this reservation
        const currentRoom = mergedData?.rooms.find(r => r.reservations.some(x => x.reservation_id === res.reservation_id));
        e.dataTransfer.setData("application/json", JSON.stringify({
            type: "ASSIGNED",
            reservation_id: res.reservation_id,
            from_room_id: currentRoom?.room_id ?? "",
        }));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleCellDragEnter = useCallback((roomId: string, date: string, e: React.DragEvent) => {
        setDropTarget({ roomId, date });
    }, []);

    const handleCellDragOver = useCallback((roomId: string, date: string, e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }, []);

    const handleCellDragLeave = useCallback((roomId: string, date: string, e: React.DragEvent) => {
        // Only clear if we're leaving the current drop target
        // (not just entering a child element)
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const currentTarget = e.currentTarget as HTMLElement;
        if (relatedTarget && currentTarget.contains(relatedTarget)) return;
        setDropTarget(prev => {
            if (prev?.roomId === roomId && prev?.date === date) return null;
            return prev;
        });
    }, []);

    /* ─── Drop guard: check if target room is droppable ─── */
    const isRoomDroppable = useCallback((roomId: string, reservationId: string): string | null => {
        const targetRoom = mergedData?.rooms.find(r => r.room_id === roomId);
        if (!targetRoom) return "Room not found";

        // Block drop onto non-sellable rooms (OOO/Renovation)
        if (!targetRoom.is_sellable) return "Room is out of order / renovation";

        // Block drop onto dirty / in-progress rooms
        const hk = targetRoom.hk_status;
        if (hk === "dirty" || hk === "in_progress" || hk === "paused") {
            return `Room is not ready (HK status: ${hk === "in_progress" ? "cleaning in progress" : hk})`;
        }

        // Block drop onto rooms with active OOO/OOS blocks overlapping the reservation dates
        const res = (() => {
            for (const room of mergedData?.rooms ?? []) {
                const found = room.reservations.find(r => r.reservation_id === reservationId);
                if (found) return found;
            }
            return (mergedData?.unassigned ?? []).find(r => r.reservation_id === reservationId);
        })();

        if (res && mergedData?.blocks) {
            const hasBlockConflict = mergedData.blocks.some(block => {
                if (block.room_id !== roomId) return false;
                // Check if block dates overlap with reservation dates
                return !(block.end_date < res.checkin_date || block.start_date >= res.checkout_date);
            });
            if (hasBlockConflict) return "Room has an active OOO/OOS block during this stay";
        }

        return null; // droppable
    }, [mergedData]);

    const handleCellDrop = (roomId: string, date: string, e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null); // Clear highlight on drop
        try {
            const payload = JSON.parse(e.dataTransfer.getData("application/json"));

            // Guard: check target room
            const blockReason = isRoomDroppable(roomId, payload.reservation_id);
            if (blockReason) {
                alert(blockReason);
                return;
            }

            if (payload.type === "UNASSIGNED") {
                commitAction("ASSIGN", payload.reservation_id, undefined, roomId);
            } else if (payload.type === "ASSIGNED") {
                const override = overrides.find(o => o.reservation_id === payload.reservation_id && o.type === "solid");
                const currentRoomId = override ? override.room_id : mergedData?.rooms.find(r => r.reservations.some(x => x.reservation_id === payload.reservation_id))?.room_id;

                if (currentRoomId && currentRoomId !== roomId) {
                    commitAction("MOVE_WHOLE", payload.reservation_id, currentRoomId, roomId);
                }
            }
        } catch (err) {
            console.error("Drop failed", err);
        }
    };

    /* ─── Drop to pool (UNASSIGN) ─── */
    const handleDropToPool = useCallback((reservationId: string, fromRoomId: string) => {
        if (!fromRoomId) {
            // Find the room from merged data
            const room = mergedData?.rooms.find(r => r.reservations.some(x => x.reservation_id === reservationId));
            if (room) {
                commitAction("UNASSIGN", reservationId, room.room_id);
            }
        } else {
            commitAction("UNASSIGN", reservationId, fromRoomId);
        }
    }, [mergedData, commitAction]);

    const days = useMemo(
        () => Array.from({ length: spanDays }).map((_, i) => format(addDays(new Date(startDate), i), "yyyy-MM-dd")),
        [startDate, spanDays]
    );

    const sellableCount = visibleRooms.filter(r => r.is_sellable).length;

    return (
        <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-[var(--bg-body)]">
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-default)] z-20">
                <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Room Planner</h1>

                <div className="flex items-center gap-3">
                    {hasDrafts && (
                        <>
                            <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                                {actions.length} drafted change{actions.length > 1 ? "s" : ""}
                            </span>
                            <button className="btn btn-outline btn-sm text-rose-600 hover:bg-rose-50 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-950/30" onClick={clearDrafts}>
                                Discard All
                            </button>
                            <button className="btn btn-outline btn-sm" onClick={undo}>
                                Undo
                            </button>
                            <button className="btn btn-primary btn-sm px-6" onClick={() => setShowReview(true)}>
                                Review & Save
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Filter Bar — includes date navigation + filters */}
            <div className="flex-shrink-0 flex flex-wrap items-center gap-3 px-6 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-default)]">
                {/* Date navigation */}
                <div className="flex items-center gap-1">
                    <button className="btn btn-outline btn-sm" onClick={() => setStartDate(format(addDays(new Date(startDate), -7), "yyyy-MM-dd"))}>‹ Week</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setStartDate(today)}>Today</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setStartDate(format(addDays(new Date(startDate), 7), "yyyy-MM-dd"))}>Week ›</button>
                </div>
                <input
                    type="date"
                    className="form-input py-1 text-sm w-36"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                />
                <div className="flex items-center gap-1">
                    {[7, 14, 21, 30].map((n) => (
                        <button
                            key={n}
                            onClick={() => setSpanDays(n)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                                spanDays === n
                                    ? "border-brand-400 bg-brand-600 text-white"
                                    : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                            }`}
                        >
                            {n}D
                        </button>
                    ))}
                </div>
                <div className="h-5 w-px bg-[var(--border-default)]" />
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
                        <option value="room_type">Room Type (Std → Family)</option>
                        <option value="room_number_asc">Room Number (Low → High)</option>
                        <option value="room_number_desc">Room Number (High → Low)</option>
                    </select>
                </div>

                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">
                    <input
                        type="checkbox"
                        checked={showActivityOnly}
                        onChange={(e) => setShowActivityOnly(e.target.checked)}
                        className="rounded"
                    />
                    Activity only
                </label>

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
                </div>

                <span className="text-xs text-[var(--text-muted)]">{sellableCount} rooms</span>
            </div>

            {error && (
                <div className="p-4 m-4 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 rounded-lg border border-rose-200 dark:border-rose-900/50">
                    {error}
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Grid Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    <RoomGrid
                        isLoading={loading}
                        rooms={mergedData?.rooms ?? []}
                        blocks={mergedData?.blocks ?? []}
                        plannedMoves={mergedData?.planned_moves ?? []}
                        startDate={startDate}
                        spanDays={spanDays}
                        days={days}
                        mode="interactive"
                        draftOverrides={overrides}
                        dropTargetRoomId={dropTarget?.roomId ?? null}
                        onBarDragStart={handleBarDragStart}
                        onCellDragEnter={handleCellDragEnter}
                        onCellDragOver={handleCellDragOver}
                        onCellDragLeave={handleCellDragLeave}
                        onCellDrop={handleCellDrop}
                    />
                </div>

                {/* Unassigned Sidebar — Right side */}
                <UnassignedSidebar
                    reservations={mergedData?.unassigned ?? []}
                    onDragStart={handleDragStartUnassigned}
                    onDropToPool={handleDropToPool}
                />
            </div>

            {showReview && (
                <ReviewPanel
                    actions={actions}
                    onClose={() => setShowReview(false)}
                    onSuccess={() => {
                        setShowReview(false);
                        clearDrafts();
                        load();
                    }}
                />
            )}
        </div>
    );
}
