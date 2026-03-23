"use client";

import { forwardRef, useRef, useCallback, useMemo } from "react";
import type { 
    CalendarRoom, 
    CalendarRoomBlock, 
    CalendarPlannedMove, 
    CalendarReservation,
    DraftOverride
} from "@/lib/types";

/* ─── Constants ───────────────────────────────── */
export const SOURCE_COLOR: Record<string, { bar: string; text: string }> = {
    walkin: { bar: "bg-sky-500", text: "text-white" },
    ota: { bar: "bg-purple-500", text: "text-white" },
    direct: { bar: "bg-emerald-500", text: "text-white" },
    agent: { bar: "bg-amber-500", text: "text-[var(--text-primary)]" }
};
export const DEFAULT_COLOR = { bar: "bg-brand-500", text: "text-white" };

export const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in", ota: "OTA", direct: "Direct", agent: "Agent"
};

const COL_W = 44;   // px per day column
const ROW_H = 40;   // px per room row
const ROOM_COL_W = 120; // px for room label

/* ─── Helpers ─────────────────────────────────── */
function addDays(date: string, n: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function dayLabel(date: string) {
    const d = new Date(date + "T00:00:00");
    return { day: d.getDate(), dow: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d.getDay()] };
}

function isWeekend(date: string) {
    const d = new Date(date + "T00:00:00").getDay();
    return d === 0 || d === 6;
}

function resolveLinkHoverKey(res: CalendarReservation): string | null {
    if (res.linked_root_id) return `linked:${res.linked_root_id}`;
    if (res.booking_group_id) return `group:${res.booking_group_id}`;
    return null;
}

function splitConsecutiveNights(nights: string[]) {
    if (nights.length === 0) return [] as string[][];
    const sorted = Array.from(new Set(nights)).sort();
    const segments: string[][] = [];
    let current: string[] = [];

    for (const night of sorted) {
        if (current.length === 0) {
            current.push(night);
            continue;
        }
        const prevNight = current[current.length - 1];
        const expectedNext = addDays(prevNight, 1);
        if (night === expectedNext) {
            current.push(night);
            continue;
        }
        segments.push(current);
        current = [night];
    }

    if (current.length > 0) segments.push(current);
    return segments;
}

/* ─── Props ───────────────────────────────────── */
export type RoomGridProps = {
    isLoading: boolean;
    rooms: CalendarRoom[];
    blocks: CalendarRoomBlock[];
    plannedMoves: CalendarPlannedMove[];
    
    startDate: string;
    spanDays: number;
    days: string[];

    mode: "readonly" | "interactive";
    
    // Drag & Drop
    onBarDragStart?: (res: CalendarReservation, roomNumber: string, e: React.DragEvent, isShift: boolean) => void;
    onBarResizeStart?: (res: CalendarReservation, roomId: string, edge: "checkin" | "checkout", e: React.MouseEvent) => void;
    onCellDragOver?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDrop?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDragEnter?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDragLeave?: (roomId: string, date: string, e: React.DragEvent) => void;
    
    // Interactions
    onBarClick?: (res: CalendarReservation, roomNumber: string) => void;
    onCellClick?: (roomId: string, date: string) => void;
    isResizing?: boolean; // Disable draggable on bars while resize is active
    isPerNightMode?: boolean; // Disable resize handles in per-night mode
    
    // View State
    hoverGroupId?: string | null;
    focusReservationId?: string | null;
    onLinkHover?: (groupId: string | null) => void;
    onFocusReservation?: (resId: string | null) => void;
    
    draftOverrides?: DraftOverride[];

    // Drop target highlight (room row gets green border during drag)
    dropTargetRoomId?: string | null;
};

export const RoomGrid = forwardRef<HTMLDivElement, RoomGridProps>(function RoomGrid({
    isLoading,
    rooms,
    blocks,
    plannedMoves,
    startDate,
    spanDays,
    days,
    mode,
    onBarDragStart,
    onCellDragOver,
    onCellDrop,
    onCellDragEnter,
    onCellDragLeave,
    onBarClick,
    onCellClick,
    hoverGroupId,
    focusReservationId,
    onLinkHover,
    onFocusReservation,
    onBarResizeStart,
    isResizing = false,
    isPerNightMode = false,
    draftOverrides = [],
    dropTargetRoomId = null
}, scrollRef) {
    const frozenRef = useRef<HTMLDivElement>(null);

    // Sync frozen column scroll with grid scroll
    const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (frozenRef.current) {
            frozenRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
        }
    }, []);

    const today = new Date().toISOString().slice(0, 10);
    const endDate = addDays(startDate, spanDays - 1);
    const totalGridW = days.length * COL_W;
    
    const filteredRooms = rooms.filter((r) => !r.is_dayuse);
    const dayUseRooms = rooms.filter((r) => r.is_dayuse);

    function getBarsForRoom(room: CalendarRoom) {
        return room.reservations.flatMap((res) => {
            const solidNights = (res as any).solid_nights as string[] | undefined;
            const ghostNights = (res as any).ghost_nights as string[] | undefined;

            // nights to check
            const baseNights = solidNights || res.nights;
            const visibleNights = baseNights.filter(n => n >= startDate && n <= endDate).sort();

            if (visibleNights.length === 0) return [];

            // Group by both continuity AND state
            const segments: { nights: string[]; state: "ghost" | "solid" | "normal" }[] = [];
            let current: { nights: string[]; state: "ghost" | "solid" | "normal" } | null = null;

            for (const night of visibleNights) {
                const isGhost = ghostNights?.includes(night);
                const isSolid = !!solidNights;
                const state = isGhost ? "ghost" : (isSolid ? "solid" : "normal");

                if (!current) {
                    current = { nights: [night], state };
                } else {
                    const prevNight = current.nights[current.nights.length - 1];
                    const isConsecutive = addDays(prevNight, 1) === night;
                    if (isConsecutive && current.state === state) {
                        current.nights.push(night);
                    } else {
                        segments.push(current);
                        current = { nights: [night], state };
                    }
                }
            }
            if (current) segments.push(current);

            return segments.map((seg) => {
                const firstNight = seg.nights[0];
                const lastNight = seg.nights[seg.nights.length - 1];
                const startIdx = days.indexOf(firstNight);
                const spanCount = days.indexOf(lastNight) - startIdx + 1;

                if (startIdx < 0 || spanCount <= 0 || isNaN(spanCount)) return null;

                const isSegmentGhost = seg.state === "ghost";
                const isSegmentSolidPartial = seg.state === "solid";

                const clippedLeft = res.checkin_date < startDate && firstNight === startDate;
                const clippedRight = res.checkout_date > addDays(endDate, 1) && lastNight === endDate;

                return {
                    res,
                    startIdx,
                    spanCount,
                    clippedLeft,
                    clippedRight,
                    segmentKey: `${firstNight}__${lastNight}`,
                    isSegmentGhost,
                    isSegmentSolidPartial
                };
            }).filter((b): b is {
                res: CalendarReservation;
                startIdx: number;
                spanCount: number;
                clippedLeft: boolean;
                clippedRight: boolean;
                segmentKey: string;
                isSegmentGhost: boolean;
                isSegmentSolidPartial: boolean;
            } => b !== null);
        });
    }

    function getBlocksForRoom(room: CalendarRoom) {
        return blocks.filter(b => b.room_id === room.room_id).map(block => {
            if (block.end_date < startDate || block.start_date > endDate) return null;

            const bStart = block.start_date < startDate ? startDate : block.start_date;
            const bEnd = block.end_date > addDays(endDate, 1) ? addDays(endDate, 1) : block.end_date;

            const startIdx = days.indexOf(bStart);
            const spanCount = days.indexOf(addDays(bEnd, -1)) - startIdx + 1;

            if (startIdx < 0 || spanCount <= 0) return null;

            return { block, startIdx, spanCount };
        }).filter(Boolean) as { block: CalendarRoomBlock, startIdx: number, spanCount: number }[];
    }

    function getPlannedBarsForRoom(room: CalendarRoom) {
        return plannedMoves
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
            .filter(Boolean) as { move: CalendarPlannedMove; startIdx: number; spanCount: number }[];
    }

    function getPlannedReleaseBarsForRoom(room: CalendarRoom) {
        return plannedMoves
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
            .filter(Boolean) as { move: CalendarPlannedMove; startIdx: number; spanCount: number }[];
    }

    function renderHKBadge(status?: string | null) {
        if (!status) return null;
        let colorClass = "bg-slate-200";
        if (status === "dirty") colorClass = "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]";
        if (status === "in_progress") colorClass = "bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.6)]";
        if (status === "paused") colorClass = "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]";
        if (status === "approved" || status === "available") colorClass = "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]";
        
        return (
            <div className={`ml-auto w-2 h-2 rounded-full ${colorClass}`} title={`Housekeeping: ${status.replace("_", " ")}`} />
        );
    }

    const linkedConnections = useMemo(() => {
        const conns: React.ReactNode[] = [];
        if (mode !== "interactive") return conns;

        const groups = new Map<string, Array<{ roomId: string, resId: string, roomIndex: number, startIdx: number, spanCount: number }>>();

        filteredRooms.forEach((room, roomIndex) => {
            const bars = getBarsForRoom(room);
            bars.forEach(b => {
                const rootId = b.res.linked_root_id;
                if (rootId && (b.res as any).draft_state !== "ghost") {
                    if (!groups.has(rootId)) groups.set(rootId, []);
                    groups.get(rootId)!.push({
                        roomId: room.room_id,
                        resId: b.res.reservation_id,
                        roomIndex,
                        startIdx: b.startIdx,
                        spanCount: b.spanCount
                    });
                }
            });
        });

        groups.forEach((members, rootId) => {
            if (members.length < 2) return;
            members.sort((a, b) => a.roomIndex - b.roomIndex);

            for (let i = 0; i < members.length - 1; i++) {
                const m1 = members[i];
                const m2 = members[i+1];

                const x1 = m1.startIdx * COL_W + (m1.spanCount * COL_W) / 2;
                const y1 = m1.roomIndex * ROW_H + 34; // bottom of upper bar

                const x2 = m2.startIdx * COL_W + (m2.spanCount * COL_W) / 2;
                const y2 = m2.roomIndex * ROW_H + 6; // top of lower bar

                const isHovered = hoverGroupId === `linked:${rootId}`;

                conns.push(
                    <path
                        key={`conn-${rootId}-${i}`}
                        d={`M ${x1} ${y1} C ${x1} ${y1 + 15}, ${x2} ${y2 - 15}, ${x2} ${y2}`}
                        fill="none"
                        className={`transition-opacity ${isHovered ? "stroke-indigo-500 dark:stroke-indigo-400 opacity-100" : "stroke-indigo-300 dark:stroke-indigo-600 opacity-40"}`}
                        strokeWidth="2"
                        strokeDasharray="4 2"
                    />
                );
            }
        });

        return conns;
    }, [filteredRooms, mode, hoverGroupId, days, startDate, endDate]);

    return (
        <div className="card overflow-hidden h-full flex flex-col">
            <div className="flex flex-1 overflow-hidden">
                {/* Frozen room column — synced scroll via JS */}
                <div
                    ref={frozenRef}
                    className="flex-shrink-0 border-r border-[var(--border-default)] bg-[var(--bg-surface)] z-10 overflow-hidden"
                    style={{ width: ROOM_COL_W }}
                >
                    <div
                        className="flex items-center px-3 border-b border-[var(--border-default)] bg-[var(--bg-body)] text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] sticky top-0 z-20"
                        style={{ height: ROW_H }}
                    >
                        Room
                    </div>
                    {isLoading
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
                                        {!room.is_sellable && <span className="text-[9px] text-[var(--text-muted)]" title="Out of Order / Out of Service">🚧</span>}
                                        {renderHKBadge(room.hk_status)}
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
                                                {!room.is_sellable && <span className="text-[9px] text-[var(--text-muted)]" title="Out of Order / Out of Service">🚧</span>}
                                                {renderHKBadge(room.hk_status)}
                                            </div>
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                </div>

                {/* Scrollable grid */}
                <div ref={scrollRef} className="overflow-auto flex-1" onScroll={handleGridScroll}>
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
                        {isLoading ? (
                            Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="flex border-b border-[var(--border-subtle)]" style={{ height: ROW_H }}>
                                    {days.map((d) => (
                                        <div key={d} className="flex-shrink-0 border-r border-[var(--border-subtle)]" style={{ width: COL_W }} />
                                    ))}
                                </div>
                            ))
                        ) : (
                            <div className="relative">
                                {filteredRooms.map((room) => {
                                    const bars = getBarsForRoom(room);
                                    const roomBlocks = getBlocksForRoom(room);
                                    const plannedReleaseBars = getPlannedReleaseBarsForRoom(room);
                                    const plannedBars = getPlannedBarsForRoom(room);

                                    const isDropTarget = dropTargetRoomId === room.room_id;
                                    let dropTargetClasses = "";
                                    if (isDropTarget) {
                                        const isWarning = !room.is_sellable || room.hk_status === "dirty" || room.hk_status === "paused";
                                        if (isWarning) {
                                            dropTargetClasses = "ring-2 ring-inset ring-rose-400/70 bg-rose-50/20 dark:bg-rose-900/15";
                                        } else {
                                            dropTargetClasses = "ring-2 ring-inset ring-emerald-400/70 bg-emerald-50/20 dark:bg-emerald-900/15";
                                        }
                                    }

                                    return (
                                        <div key={room.room_id} data-room-row className={`relative flex border-b border-[var(--border-subtle)] ${dropTargetClasses}`} style={{ height: ROW_H }}>
                                            {days.map((day) => (
                                                <div
                                                    key={day}
                                                    data-droppable="true"
                                                    data-room-id={room.room_id}
                                                    data-date={day}
                                                    className={`flex-shrink-0 border-r border-[var(--border-subtle)] cursor-pointer transition-colors ${
                                                        day === today 
                                                            ? "bg-brand-50/40 hover:bg-brand-200/50 dark:bg-brand-900/30 dark:hover:bg-brand-900/50" 
                                                            : isWeekend(day) 
                                                                ? "bg-rose-50/30 hover:bg-rose-200/40 dark:bg-rose-900/15 dark:hover:bg-rose-900/30" 
                                                                : "hover:bg-slate-200/50 dark:hover:bg-white/5"
                                                    } ${!room.is_sellable ? "bg-[var(--bg-surface-hover)]/60" : ""}`}
                                                    style={{ width: COL_W, height: ROW_H }}
                                                    onClick={() => onCellClick?.(room.room_id, day)}
                                                    onDragEnter={(e) => {
                                                        if (mode === "interactive") onCellDragEnter?.(room.room_id, day, e);
                                                    }}
                                                    onDragOver={(e) => {
                                                        if (mode === "interactive") {
                                                            e.preventDefault(); // needed to allow drop
                                                            onCellDragOver?.(room.room_id, day, e);
                                                        }
                                                    }}
                                                    onDragLeave={(e) => {
                                                        if (mode === "interactive") onCellDragLeave?.(room.room_id, day, e);
                                                    }}
                                                    onDrop={(e) => {
                                                        if (mode === "interactive") {
                                                            e.preventDefault();
                                                            onCellDrop?.(room.room_id, day, e);
                                                        }
                                                    }}
                                                    title={room.is_sellable ? `Room ${room.room_number} on ${day}` : undefined}
                                                />
                                            ))}

                                            {roomBlocks.map(({ block, startIdx, spanCount }) => {
                                                const isOOO = block.block_type === "OOO";
                                                const color = isOOO ? "bg-rose-200 border-rose-400 text-rose-800 dark:bg-rose-500/30 dark:border-rose-500/50 dark:text-rose-200" : "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-200";
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
                                                            onFocusReservation?.(move.reservation_id);
                                                        }}
                                                        className={`absolute rounded-md border-2 border-dashed px-2 text-[10px] font-semibold text-indigo-700 transition z-20 ${move.do_not_move ? "border-rose-400 bg-rose-100/85 text-rose-700 dark:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300" : "border-indigo-400 bg-indigo-100/85 dark:bg-indigo-500/20 dark:border-indigo-500/40 dark:text-indigo-300"} ${shouldFade ? "opacity-10" : "opacity-95"} ${isFocused ? "shadow-[0_0_0_2px_rgba(99,102,241,0.18)]" : ""}`}
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
                                                            onFocusReservation?.(move.reservation_id);
                                                        }}
                                                        className={`absolute rounded-md border-2 border-dashed px-2 text-[10px] font-semibold transition z-[15] ${
                                                            move.do_not_move
                                                                ? "border-orange-400 bg-orange-100/85 text-orange-800 dark:bg-orange-500/20 dark:border-orange-500/40 dark:text-orange-300"
                                                                : "border-amber-400 bg-amber-100/80 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-300"
                                                        } ${shouldFade ? "opacity-10" : "opacity-95"} ${isFocused ? "shadow-[0_0_0_2px_rgba(251,191,36,0.18)]" : ""}`}
                                                        style={{ left, width, top: 2, height: ROW_H - 4 }}
                                                        title={`${move.guest_name ?? "Guest"} · release Room ${move.from_room_number ?? "?"} for planned move ${move.start_date} → ${move.end_date} · target Room ${move.to_room_number ?? "?"}`}
                                                    >
                                                        {width > 92 ? `Move → ${move.to_room_number ?? "?"}` : null}
                                                    </button>
                                                );
                                            })}

                                            {getBarsForRoom(room).map((b) => {
                                                if (!b) return null;
                                                const { res, startIdx, spanCount, clippedLeft, clippedRight, segmentKey, isSegmentGhost, isSegmentSolidPartial } = b;
                                                const isCheckedOut = res.status === "checked_out";
                                                const sc = isCheckedOut ? { bar: "bg-[var(--bg-muted)]", text: "text-[var(--text-secondary)]" } : (SOURCE_COLOR[res.source] ?? DEFAULT_COLOR);
                                                const linkHoverKey = resolveLinkHoverKey(res);
                                                const isGroupFocused = !focusReservationId && Boolean(hoverGroupId) && linkHoverKey === hoverGroupId;
                                                const shouldFadeGroup = focusReservationId
                                                    ? res.reservation_id !== focusReservationId
                                                    : Boolean(hoverGroupId) && linkHoverKey !== hoverGroupId;
                                                
                                                // Check Draft Overrides (whole move)
                                                const draftStatus = draftOverrides.find(d => d.reservation_id === res.reservation_id && d.room_id === room.room_id && !d.nights)?.type;
                                                const isWholeGhost = draftStatus === "ghost";
                                                const isWholeSolid = draftStatus === "solid";

                                                const isGhost = isWholeGhost || isSegmentGhost;
                                                const isSolid = isWholeSolid || isSegmentSolidPartial;

                                                const left = startIdx * COL_W + (clippedLeft ? 0 : 2);
                                                const width = spanCount * COL_W - (clippedLeft ? 0 : 2) - (clippedRight ? 0 : 2);
                                                
                                                const canInteract = mode === "interactive" && !res.do_not_move && !isCheckedOut && !isGhost;
                                                const isDraggable = canInteract && !isResizing;

                                                let defaultClasses = `absolute top-1.5 rounded-md text-[10px] font-semibold flex items-center whitespace-nowrap px-2 shadow-sm transition z-10 ${clippedLeft ? "rounded-l-none" : ""} ${clippedRight ? "rounded-r-none" : ""}`;
                                                
                                                if (isGhost) {
                                                    defaultClasses += ` border-2 border-dashed border-[var(--border-strong)] opacity-30 cursor-default`;
                                                } else if (isSolid) {
                                                    defaultClasses += ` ${sc.bar} ${sc.text} ring-2 ring-brand-400 brightness-90 shadow-md cursor-grab`;
                                                } else {
                                                    defaultClasses += ` ${sc.bar} ${sc.text} ${shouldFadeGroup ? "opacity-10" : isCheckedOut ? "opacity-60 cursor-default" : "hover:brightness-110"}`;
                                                    if (isDraggable) defaultClasses += " cursor-ns-resize"; // Vertical drag hint
                                                }

                                                if ((isGroupFocused || res.reservation_id === focusReservationId) && !isGhost) {
                                                    defaultClasses += " ring-2 ring-indigo-300 brightness-110";
                                                }

                                                return (
                                                    <div
                                                        key={`${res.reservation_id}-${room.room_id}-${segmentKey}`}
                                                        className={defaultClasses}
                                                        style={{ left, width, height: ROW_H - 12, top: 6 }}
                                                        draggable={isDraggable}
                                                        onDragStart={(e) => {
                                                            if (isDraggable) onBarDragStart?.(res, room.room_number, e, false);
                                                        }}
                                                        onDragOver={(e) => {
                                                            if (mode === "interactive") {
                                                                e.preventDefault();
                                                                e.dataTransfer.dropEffect = "move";
                                                                // Resolve date from cursor position for accurate per-night targeting
                                                                const rect = e.currentTarget.closest('[data-room-row]')?.getBoundingClientRect();
                                                                const resolvedDate = rect ? (days[Math.floor((e.clientX - rect.left) / COL_W)] || days[startIdx] || '') : (days[startIdx] || '');
                                                                onCellDragOver?.(room.room_id, resolvedDate, e);
                                                            }
                                                        }}
                                                        onDragEnter={(e) => {
                                                            if (mode === "interactive") {
                                                                const rect = e.currentTarget.closest('[data-room-row]')?.getBoundingClientRect();
                                                                const resolvedDate = rect ? (days[Math.floor((e.clientX - rect.left) / COL_W)] || days[startIdx] || '') : (days[startIdx] || '');
                                                                onCellDragEnter?.(room.room_id, resolvedDate, e);
                                                            }
                                                        }}
                                                        onDragLeave={(e) => {
                                                            if (mode === "interactive") onCellDragLeave?.(room.room_id, days[startIdx] || '', e);
                                                        }}
                                                        onDrop={(e) => {
                                                            if (mode === "interactive") {
                                                                e.preventDefault();
                                                                // Calculate actual date from mouse X position (not bar start)
                                                                // This is critical for per-night mode: dropping on an existing bar
                                                                // should resolve to the cell column under the cursor
                                                                const rect = e.currentTarget.closest('[data-room-row]')?.getBoundingClientRect();
                                                                if (rect) {
                                                                    const relX = e.clientX - rect.left;
                                                                    const colIdx = Math.floor(relX / COL_W);
                                                                    const resolvedDate = days[colIdx] || days[startIdx] || '';
                                                                    onCellDrop?.(room.room_id, resolvedDate, e);
                                                                } else {
                                                                    onCellDrop?.(room.room_id, days[startIdx] || '', e);
                                                                }
                                                            }
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onBarClick?.(res, room.room_number);
                                                        }}
                                                        onMouseEnter={() => onLinkHover?.(linkHoverKey)}
                                                        onMouseLeave={() => onLinkHover?.(null)}
                                                        onFocus={() => onLinkHover?.(linkHoverKey)}
                                                    >
                                                        {isSegmentSolidPartial && <span className="mr-1 px-1 bg-white/20 rounded text-[8px] uppercase font-bold tracking-wider">Plan</span>}
                                                        
                                                        {/* Reservation Text */}
                                                        {width > 60 && (
                                                            <span className={`truncate flex-1 flex items-center gap-1 ${isGhost ? "line-through" : ""}`}>
                                                                {isCheckedOut && <span className="opacity-80 flex-shrink-0">✓</span>}
                                                                <span className="truncate">{res.guest_name || res.booking_code}</span>
                                                                {isCheckedOut && width > 120 && <span className="ml-1 text-[8px] bg-white/20 rounded px-1 flex-shrink-0">CO</span>}
                                                            </span>
                                                        )}

                                                        {(res.alert_count ?? 0) > 0 && !isGhost && width > 30 && (
                                                            <span
                                                                className={`absolute bottom-1 right-1 h-2 w-2 rounded-full border border-white/80 ${
                                                                    res.alert_severity === "critical"
                                                                        ? "bg-rose-500"
                                                                        : res.alert_severity === "warning"
                                                                            ? "bg-amber-400"
                                                                            : "bg-sky-400"
                                                                }`}
                                                                title={res.first_alert_message ?? "Alert"}
                                                            />
                                                        )}

                                                        {/* Resize Handles — hidden in per-night mode, use canInteract so they stay visible during resize */}
                                                        {mode === "interactive" && canInteract && !isPerNightMode && !clippedLeft && res.is_linked_first && (
                                                            <div
                                                                draggable={false}
                                                                className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 group"
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    e.preventDefault();
                                                                    onBarResizeStart?.(res, room.room_id, "checkin", e);
                                                                }}
                                                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            >
                                                                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-white/0 group-hover:bg-white/40 transition-colors rounded-l" />
                                                                <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/50 group-hover:bg-white rounded-full transition-colors" />
                                                            </div>
                                                        )}
                                                        {mode === "interactive" && canInteract && !isPerNightMode && !clippedRight && res.is_linked_last && (
                                                            <div
                                                                draggable={false}
                                                                className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 group"
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    e.preventDefault();
                                                                    onBarResizeStart?.(res, room.room_id, "checkout", e);
                                                                }}
                                                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            >
                                                                <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-white/0 group-hover:bg-white/40 transition-colors rounded-r" />
                                                                <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-white/50 group-hover:bg-white rounded-full transition-colors" />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}

                                {/* SVG Line Layer for Linked Stays */}
                                {linkedConnections.length > 0 && (
                                    <svg className="absolute top-0 left-0 pointer-events-none z-[15]" style={{ width: totalGridW, height: filteredRooms.length * ROW_H }}>
                                        {linkedConnections}
                                    </svg>
                                )}

                                {dayUseRooms.length > 0 && (
                                    <>
                                        <div className="flex border-b border-t border-[var(--border-default)] bg-[var(--bg-body)]" style={{ height: ROW_H }}>
                                            <div className="px-2 flex items-center text-[10px] font-bold uppercase tracking-wide text-[var(--dayuse-text)]">Day Use</div>
                                        </div>
                                        {dayUseRooms.map((room) => {
                                            const roomBlocks = getBlocksForRoom(room);
                                            return (
                                                <div key={room.room_id} className="relative flex border-b border-[var(--border-subtle)] bg-rose-50/10 hover:bg-rose-200/30 dark:bg-rose-900/10 dark:hover:bg-rose-900/25 transition-colors" style={{ height: ROW_H }}>
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
                                                        const color = isOOO ? "bg-rose-200 border-rose-400 text-rose-800 dark:bg-rose-500/30 dark:border-rose-500/50 dark:text-rose-200" : "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-200";
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
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
