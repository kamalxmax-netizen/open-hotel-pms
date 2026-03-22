"use client";

import { forwardRef, useRef, useCallback } from "react";
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
    onBarDragStart?: (res: CalendarReservation, roomNumber: string, e: React.DragEvent) => void;
    onCellDragOver?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDrop?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDragEnter?: (roomId: string, date: string, e: React.DragEvent) => void;
    onCellDragLeave?: (roomId: string, date: string, e: React.DragEvent) => void;
    
    // Interactions
    onBarClick?: (res: CalendarReservation, roomNumber: string) => void;
    onCellClick?: (roomId: string, date: string) => void;
    
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
            res: CalendarReservation;
            startIdx: number;
            spanCount: number;
            clippedLeft: boolean;
            clippedRight: boolean;
        }[];
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
                            <>
                                {filteredRooms.map((room) => {
                                    const bars = getBarsForRoom(room);
                                    const roomBlocks = getBlocksForRoom(room);
                                    const plannedReleaseBars = getPlannedReleaseBarsForRoom(room);
                                    const plannedBars = getPlannedBarsForRoom(room);
                                    return (
                                        <div key={room.room_id} className={`relative flex border-b border-[var(--border-subtle)] ${dropTargetRoomId === room.room_id ? "ring-2 ring-inset ring-emerald-400/70 bg-emerald-50/20 dark:bg-emerald-900/15" : ""}`} style={{ height: ROW_H }}>
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

                                            {bars.map(({ res, startIdx, spanCount, clippedLeft, clippedRight }) => {
                                                const isCheckedOut = res.status === "checked_out";
                                                const sc = isCheckedOut ? { bar: "bg-[var(--bg-muted)]", text: "text-[var(--text-secondary)]" } : (SOURCE_COLOR[res.source] ?? DEFAULT_COLOR);
                                                const linkHoverKey = resolveLinkHoverKey(res);
                                                const isGroupFocused = !focusReservationId && Boolean(hoverGroupId) && linkHoverKey === hoverGroupId;
                                                const shouldFadeGroup = focusReservationId
                                                    ? res.reservation_id !== focusReservationId
                                                    : Boolean(hoverGroupId) && linkHoverKey !== hoverGroupId;
                                                
                                                // Check Draft Overrides
                                                const draftStatus = draftOverrides.find(d => d.reservation_id === res.reservation_id && d.room_id === room.room_id)?.type;
                                                const isGhost = draftStatus === "ghost";
                                                const isSolid = draftStatus === "solid";

                                                const left = startIdx * COL_W + (clippedLeft ? 0 : 2);
                                                const width = spanCount * COL_W - (clippedLeft ? 0 : 2) - (clippedRight ? 0 : 2);
                                                
                                                const isDraggable = mode === "interactive" && !res.do_not_move && !isCheckedOut && !isGhost;

                                                let defaultClasses = `absolute top-1.5 rounded-md text-[10px] font-semibold overflow-hidden whitespace-nowrap px-2 shadow-sm transition z-10 ${clippedLeft ? "rounded-l-none" : ""} ${clippedRight ? "rounded-r-none" : ""}`;
                                                
                                                if (isGhost) {
                                                    defaultClasses += ` border-2 border-dashed border-[var(--border-strong)] opacity-30 cursor-default`;
                                                } else if (isSolid) {
                                                    defaultClasses += ` ${sc.bar} ${sc.text} ring-2 ring-brand-400 brightness-90 shadow-md cursor-grab`;
                                                } else {
                                                    defaultClasses += ` ${sc.bar} ${sc.text} ${shouldFadeGroup ? "opacity-10" : isCheckedOut ? "opacity-60 cursor-default" : "hover:brightness-110"}`;
                                                    if (isDraggable) defaultClasses += " cursor-ns-resize"; // Vertical drag only
                                                }

                                                if ((isGroupFocused || res.reservation_id === focusReservationId) && !isGhost) {
                                                    defaultClasses += " ring-2 ring-indigo-300 brightness-110";
                                                }

                                                return (
                                                    <div
                                                        key={`${res.reservation_id}-${room.room_id}`}
                                                        draggable={isDraggable}
                                                        onDragStart={(e) => {
                                                            if (isDraggable) onBarDragStart?.(res, room.room_number, e);
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onBarClick?.(res, room.room_number);
                                                        }}
                                                        onMouseEnter={() => onLinkHover?.(linkHoverKey)}
                                                        onMouseLeave={() => onLinkHover?.(null)}
                                                        onFocus={() => onLinkHover?.(linkHoverKey)}
                                                        onBlur={() => onLinkHover?.(null)}
                                                        className={defaultClasses}
                                                        style={{ left, width, height: ROW_H - 12, transform: isGroupFocused ? "scaleY(1.08)" : undefined, transformOrigin: "center" }}
                                                        title={`${isCheckedOut ? "✓ CO " : ""}${res.guest_name} · ${res.checkin_date} → ${res.checkout_date}${res.group_code ? ` · ${res.group_code}` : ""}${res.first_alert_message ? ` · Alert: ${res.first_alert_message}` : ""}`}
                                                    >
                                                        {width > 60 ? (
                                                            <span className={`flex items-center gap-1 ${isGhost ? "line-through" : ""}`}>
                                                                {isCheckedOut && <span className="opacity-80">✓</span>}
                                                                {res.guest_name}
                                                                {isCheckedOut && width > 120 && <span className="ml-1 text-[9px] bg-[var(--bg-surface)]/30 rounded px-1">CO</span>}
                                                                {isSolid && <span className="ml-1 px-1 rounded bg-black/20 text-[8px] uppercase tracking-wider">Moved</span>}
                                                            </span>
                                                        ) : null}
                                                        {(res.alert_count ?? 0) > 0 && !isGhost && (
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
                                                    </div>
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
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});
