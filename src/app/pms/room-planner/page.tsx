"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, addDays } from "date-fns";
import { RoomGrid, SOURCE_COLOR, SOURCE_LABEL } from "@/components/room-grid";
import { UnassignedSidebar } from "@/components/room-planner/unassigned-sidebar";
import { useDraftEngine } from "@/components/room-planner/use-draft-engine";
import { ReviewPanel } from "@/components/room-planner/review-panel";
import type { CalendarData, CalendarReservation, CalendarRoom } from "@/lib/types";
import { Undo2, X } from "lucide-react";
import { formatDateRangeDisplay } from "@/lib/date-display";

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

function checkSwapEligibility(
    resA: CalendarReservation,
    resB: CalendarReservation,
    roomA: CalendarRoom,
    roomB: CalendarRoom,
): string | null {
    if (roomA.room_type_id !== roomB.room_type_id) return "Cannot swap: different room types";
    if (resA.checked_in_at) return "Cannot swap: source booking already checked in (use Move)";
    if (resB.checked_in_at) return "Cannot swap: target booking already checked in";
    if (resA.do_not_move) return "Cannot swap: source booking locked (Do Not Move)";
    if (resB.do_not_move) return "Cannot swap: target booking locked (Do Not Move)";
    if (resA.status === "checked_out") return "Cannot swap: source booking checked out";
    if (resB.status === "checked_out") return "Cannot swap: target booking checked out";
    return null;
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
    const mouseDragPayloadRef = useRef<{
        type: "ASSIGNED" | "UNASSIGNED";
        reservation_id: string;
        from_room_id?: string;
        linked_root_id?: string | null;
        booking_code?: string;
    } | null>(null);

    /* ─── Linked group hover highlight ─── */
    const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);

    /* ─── Swap-by-button state ─── */
    // swapSource: the booking selected as source for swap (step 1: click bar → popover → "Swap")
    const isShiftDragRef = useRef(false);
    /* ─── Per-Night Move Mode toggle ─── */
    const [perNightMode, setPerNightMode] = useState(false);
    const perNightModeRef = useRef(false);
    useEffect(() => { perNightModeRef.current = perNightMode; }, [perNightMode]);
    const [perNightDrafts, setPerNightDrafts] = useState<Map<string, string>>(new Map());
    const [perNightHistory, setPerNightHistory] = useState<string[]>([]);

    /* ─── Shift key detection removed — Per-Night mode uses toggle button only ─── */
    const shiftHeldRef = useRef(false); // Kept for backward compat but always false
    useEffect(() => {
        return () => {
        };
    }, []);
    const [resizingState, setResizingState] = useState<{
        resId: string;
        roomId: string;
        edge: "checkin" | "checkout";
        startX: number;
        originalDate: string;
        currentDate: string;
    } | null>(null);

    const [otaPriceModal, setOtaPriceModal] = useState<{
        reservation: CalendarReservation;
        fromRoomId: string;
        toRoomId: string;
        nights: string[];
    } | null>(null);
    const [swapSource, setSwapSource] = useState<{
        res: CalendarReservation;
        roomId: string;
        roomNumber: string;
    } | null>(null);
    // barPopover: which bar's popover is visible
    const [barPopover, setBarPopover] = useState<{
        res: CalendarReservation;
        roomId: string;
        roomNumber: string;
    } | null>(null);

    const { 
        actions, overrides, commitAction, commitSwap, undo, clearDrafts, hasDrafts, 
        commitExtend, commitShorten, commitMoveNights 
    } = useDraftEngine();

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

    /* ─── All reservations lookup (original data) ─── */
    const allReservations = useMemo(() => {
        const map = new Map<string, CalendarReservation>();
        if (!data) return map;
        for (const room of data.rooms) {
            for (const res of room.reservations) {
                map.set(res.reservation_id, res);
            }
        }
        for (const res of data.unassigned || []) {
            map.set(res.reservation_id, res);
        }
        return map;
    }, [data]);

    /* ─── Apply draft overrides to the data ─── */
    const mergedData = useMemo(() => {
        if (!data) return null;

        const sourceRooms = visibleRooms;
        // Even without drafts, we might have perNightDrafts
        if (!hasDrafts && perNightDrafts.size === 0) {
            // Still need to mark linked positions for resize handles
            const preMarkedRooms = JSON.parse(JSON.stringify(sourceRooms)) as typeof sourceRooms;
            const allRes = preMarkedRooms.flatMap(r => r.reservations);
            for (const res of allRes) {
                if (res.linked_root_id) {
                    const group = allRes
                        .filter(r => r.linked_root_id === res.linked_root_id)
                        .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
                    res.is_linked_first = res.reservation_id === group[0]?.reservation_id;
                    res.is_linked_last = res.reservation_id === group[group.length - 1]?.reservation_id;
                } else {
                    res.is_linked_first = true;
                    res.is_linked_last = true;
                }
            }
            return { ...data, rooms: preMarkedRooms };
        }

        const clonedRooms = JSON.parse(JSON.stringify(sourceRooms)) as typeof sourceRooms;
        const clonedUnassigned: CalendarReservation[] = JSON.parse(JSON.stringify(data.unassigned || []));

        // Create a local map of cloned reservations for mergedData to modify
        const localAllRes = new Map<string, CalendarReservation>();
        for (const room of clonedRooms) {
            for (const res of room.reservations) {
                localAllRes.set(res.reservation_id, res);
            }
        }
        for (const res of clonedUnassigned) {
            localAllRes.set(res.reservation_id, res);
        }

        // 1. Apply EXTEND / SHORTEN date changes first
        for (const action of actions) {
            const res = localAllRes.get(action.reservation_id);
            if (!res) continue;

            if (action.type === "EXTEND" || action.type === "SHORTEN") {
                if (action.new_checkout_date) {
                    res.checkout_date = action.new_checkout_date;
                    res.nights = generateNights(res.checkin_date, res.checkout_date);
                }
                if (action.new_checkin_date) {
                    res.checkin_date = action.new_checkin_date;
                    res.nights = generateNights(res.checkin_date, res.checkout_date);
                }
            }
        }

        // Track which reservations have solid overrides (assigned somewhere)
        const hasSolidOverride = new Set(
            overrides.filter(o => o.type === "solid").map(o => o.reservation_id)
        );

        // 2. Apply Engine Overrides (Swap, Move Whole)
        for (const override of overrides) {
            const res = localAllRes.get(override.reservation_id);
            if (!res) continue;

            if (override.type === "ghost") {
                if (override.nights) {
                    res.ghost_nights = override.nights;
                } else {
                    (res as any).draft_state = "ghost";
                }

                if (!hasSolidOverride.has(override.reservation_id) && !override.nights) {
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
                    if (override.nights) {
                        solidCopy.solid_nights = override.nights;
                        (solidCopy as any).draft_state = "solid_partial";
                    } else {
                        (solidCopy as any).draft_state = "solid";
                    }
                    targetRoom.reservations.push(solidCopy);

                    if (!override.nights) {
                        const unassignedIdx = clonedUnassigned.findIndex(u => u.reservation_id === res.reservation_id);
                        if (unassignedIdx !== -1) {
                            clonedUnassigned.splice(unassignedIdx, 1);
                        }
                    }
                }
            }
        }

        // 3. Apply Local Per-Night Drafts (Phase 45 Stable)
        perNightDrafts.forEach((targetRoomId, key) => {
            const [resId, date] = key.split("::");
            const resObj = localAllRes.get(resId);
            if (!resObj) return;

            // Mark GHOST in source
            if (!resObj.ghost_nights) resObj.ghost_nights = [];
            if (!resObj.ghost_nights.includes(date)) resObj.ghost_nights.push(date);

            // Mark SOLID in target
            const targetRoom = clonedRooms.find(r => r.room_id === targetRoomId);
            if (targetRoom) {
                const existingDraft = targetRoom.reservations.find(r => r.reservation_id === resId && (r as any).draft_state === "solid_partial");
                if (existingDraft) {
                    if (!existingDraft.solid_nights) existingDraft.solid_nights = [];
                    if (!existingDraft.solid_nights.includes(date)) existingDraft.solid_nights.push(date);
                } else {
                    const solidCopy = { ...resObj, draft_state: "solid_partial", solid_nights: [date], ghost_nights: [] };
                    targetRoom.reservations.push(solidCopy as any);
                }
            }
        });

        // 4. Final Linked Stay Positions
        const allResWithDrafts = clonedRooms.flatMap(r => r.reservations);
        for (const res of allResWithDrafts) {
            if (res.linked_root_id) {
                const group = allResWithDrafts
                    .filter(r => r.linked_root_id === res.linked_root_id)
                    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
                res.is_linked_first = res.reservation_id === group[0]?.reservation_id;
                res.is_linked_last = res.reservation_id === group[group.length - 1]?.reservation_id;
            } else {
                res.is_linked_first = true;
                res.is_linked_last = true;
            }
        }

        return { ...data, rooms: clonedRooms, unassigned: clonedUnassigned };
    }, [data, visibleRooms, hasDrafts, overrides, actions, perNightDrafts, generateNights]);

    // Helper to generate nights array (local date math — avoids UTC shift)
    function generateNights(start: string, end: string): string[] {
        const nights: string[] = [];
        const [sy, sm, sd] = start.split("-").map(Number);
        const [ey, em, ed] = end.split("-").map(Number);
        let curr = new Date(sy, sm - 1, sd);
        const stop = new Date(ey, em - 1, ed);
        while (curr < stop) {
            const y = curr.getFullYear();
            const m = String(curr.getMonth() + 1).padStart(2, "0");
            const d = String(curr.getDate()).padStart(2, "0");
            nights.push(`${y}-${m}-${d}`);
            curr.setDate(curr.getDate() + 1);
        }
        return nights;
    }

    // Helper to get linked group reservations
    const getLinkedGroupReservations = useCallback((linkedRootId: string): CalendarReservation[] => {
        if (!mergedData) return [];
        const allRes = [...(mergedData.unassigned || []), ...mergedData.rooms.flatMap(r => r.reservations)];
        return allRes.filter(res => res.linked_root_id === linkedRootId)
            .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
    }, [mergedData]);

    // Helper to build Plan Move intents from per-night assignments
    const buildPlanMovesFromNights = useCallback((resId: string, _nights: string[], drafts: Map<string, string>) => {
        const res = allReservations.get(resId);
        if (!res) return [];

        const originalRoomId = data?.rooms.find(r => r.reservations.some(x => x.reservation_id === resId))?.room_id;
        if (!originalRoomId) return [];

        // Helper: add 1 day to a date string (for exclusive end_date)
        // MUST use local date math — .toISOString() converts to UTC and loses a day in UTC+7
        const addDay = (d: string) => {
            const [y, m, day] = d.split("-").map(Number);
            const dt = new Date(y, m - 1, day + 1);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        };

        const stayAssignments = res.nights.map((date: string) => {
            const draftRoomId = drafts.get(`${resId}::${date}`);
            return { date, room_id: draftRoomId || originalRoomId };
        });

        // Build plan moves only for room transitions that differ from original
        const plans: { start_date: string; end_date: string; from_room_id: string; to_room_id: string }[] = [];
        let currentPlan: typeof plans[0] | null = null;

        for (let i = 0; i < stayAssignments.length; i++) {
            const curr = stayAssignments[i];
            const isOriginal = curr.room_id === originalRoomId;

            if (!isOriginal) {
                // This night moves to a different room
                if (currentPlan && currentPlan.to_room_id === curr.room_id) {
                    // Extend current plan (consecutive nights to same room)
                    currentPlan.end_date = addDay(curr.date); // exclusive
                } else {
                    // Close previous plan if any
                    if (currentPlan) plans.push(currentPlan);
                    currentPlan = {
                        start_date: curr.date,
                        end_date: addDay(curr.date), // exclusive
                        from_room_id: originalRoomId,
                        to_room_id: curr.room_id
                    };
                }
            } else {
                // Back to original room — close any active plan
                if (currentPlan) {
                    plans.push(currentPlan);
                    currentPlan = null;
                }
            }
        }
        if (currentPlan) plans.push(currentPlan);
        return plans;
    }, [data, allReservations]);

    const handleSavePerNightMoves = async () => {
        setLoading(true);
        try {
            const resIds = Array.from(new Set(Array.from(perNightDrafts.keys()).map(k => k.split("::")[0])));
            for (const resId of resIds) {
                const res = allReservations.get(resId);
                if (!res) continue;
                const intents = buildPlanMovesFromNights(resId, res.nights, perNightDrafts);
                if (intents.length === 0) continue;

                // Use batch API to create all plans at once → rebuild path only once at the end
                const resp = await fetch(`/api/bookings/${resId}/planned-room-moves/batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        moves: intents.map(intent => {
                            const room = data?.rooms.find(r => r.room_id === intent.to_room_id);
                            return {
                                start_date: intent.start_date,
                                end_date: intent.end_date,
                                to_room_id: intent.to_room_id,
                                to_room_type_id: Number(room?.room_type_id),
                                move_reason: "per-night-plan",
                                pricing_policy: "keep_rtc"
                            };
                        })
                    })
                });
                if (!resp.ok) {
                    const body = await resp.json().catch(() => ({}));
                    throw new Error(body.error || `Failed to create plan moves (${resp.status})`);
                }
            }
            setPerNightDrafts(new Map());
            setPerNightHistory([]);
            setShowReview(false);
            alert("✅ Plan moves created. กรุณาตรวจสอบ Plan Move อีกครั้งในหน้า Plan Move");
            load();
        } catch (e: any) { alert(e.message); } finally { setLoading(false); }
    };

    /* ─── Drag handlers ─── */
    const handleDragStartUnassigned = (e: React.DragEvent<HTMLDivElement>, res: CalendarReservation) => {
        const payload = JSON.stringify({
            type: "UNASSIGNED",
            reservation_id: res.reservation_id,
            booking_code: res.booking_code,
            linked_root_id: res.linked_root_id
        });
        e.dataTransfer.setData("application/json", payload);
        e.dataTransfer.setData("text/plain", payload);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleBarDragStart = (res: CalendarReservation, roomNumber: string, e: React.DragEvent, _isShift: boolean) => {
        // Per-night mode: Shift key (via reliable keydown listener) OR toggle button
        isShiftDragRef.current = perNightModeRef.current;
        // Failsafe: if resize state got stuck, clear it before drag starts.
        if (resizingState) setResizingState(null);
        // Find the current room_id for this reservation
        const currentRoom = mergedData?.rooms.find(r => r.room_number === roomNumber);
        const payload = JSON.stringify({
            type: "ASSIGNED",
            reservation_id: res.reservation_id,
            from_room_id: currentRoom?.room_id ?? "",
            linked_root_id: res.linked_root_id
        });
        e.dataTransfer.setData("application/json", payload);
        e.dataTransfer.setData("text/plain", payload);
        e.dataTransfer.effectAllowed = "move";
    };

    // Fallback for environments where HTML5 drag events are unreliable.
    // This does NOT change move logic; it only preserves drag intent payload.
    const handleBarMouseDown = useCallback((res: CalendarReservation, roomNumber: string, e: React.MouseEvent) => {
        if (e.button !== 0) return; // left-click only
        const currentRoom = mergedData?.rooms.find(r => r.room_number === roomNumber);
        mouseDragPayloadRef.current = {
            type: "ASSIGNED",
            reservation_id: res.reservation_id,
            from_room_id: currentRoom?.room_id ?? "",
            linked_root_id: res.linked_root_id,
        };
    }, [mergedData]);

    useEffect(() => {
        const clearMousePayload = () => {
            mouseDragPayloadRef.current = null;
        };
        window.addEventListener("mouseup", clearMousePayload);
        return () => window.removeEventListener("mouseup", clearMousePayload);
    }, []);

    const handleBarResizeStart = useCallback((res: CalendarReservation, roomId: string, edge: "checkin" | "checkout", e: React.MouseEvent) => {
        // Guard: linked stay middle segments
        if (res.linked_root_id) {
            const group = getLinkedGroupReservations(res.linked_root_id);
            const isFirst = res.reservation_id === group[0]?.reservation_id;
            const isLast = res.reservation_id === group[group.length - 1]?.reservation_id;
            
            if (edge === "checkin" && !isFirst) {
                alert("Cannot resize check-in of a middle segment in a Linked Stay.");
                return;
            }
            if (edge === "checkout" && !isLast) {
                alert("Cannot resize check-out of a middle segment in a Linked Stay.");
                return;
            }
        }

        setResizingState({
            resId: res.reservation_id,
            roomId,
            edge,
            startX: e.clientX,
            originalDate: edge === "checkin" ? res.checkin_date : res.checkout_date,
            currentDate: edge === "checkin" ? res.checkin_date : res.checkout_date
        });
    }, [mergedData, getLinkedGroupReservations]);

    useEffect(() => {
        if (!resizingState) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - resizingState.startX;
            const deltaDays = Math.round(deltaX / 44); // COL_W = 44
            
            if (deltaDays === 0) {
                setResizingState(prev => prev ? { ...prev, currentDate: prev.originalDate } : null);
                return;
            }

            const d = new Date(resizingState.originalDate + "T00:00:00");
            d.setDate(d.getDate() + deltaDays);
            const newDate = d.toISOString().split("T")[0];
            
            setResizingState(prev => prev ? { ...prev, currentDate: newDate } : null);
        };

        const handleMouseUp = () => {
            if (resizingState.currentDate !== resizingState.originalDate) {
                const res = mergedData?.rooms.flatMap(r => r.reservations).find(x => x.reservation_id === resizingState.resId);
                if (res) {
                    const isExtend = resizingState.edge === "checkin" 
                        ? resizingState.currentDate < resizingState.originalDate
                        : resizingState.currentDate > resizingState.originalDate;
                    
                    if (isExtend) {
                        commitExtend(res.reservation_id, 
                            resizingState.edge === "checkout" ? resizingState.currentDate : undefined,
                            resizingState.edge === "checkin" ? resizingState.currentDate : undefined
                        );
                    } else {
                        commitShorten(res.reservation_id, 
                            resizingState.edge === "checkout" ? resizingState.currentDate : undefined,
                            resizingState.edge === "checkin" ? resizingState.currentDate : undefined
                        );
                    }
                }
            }
            setResizingState(null);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [resizingState, mergedData, commitExtend, commitShorten]);

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
    const isRoomDroppable = useCallback((roomId: string, reservationId: string, dropDate?: string): string | null => {
        const targetRoom = mergedData?.rooms.find(r => r.room_id === roomId);
        if (!targetRoom) return "Room not found";

        // Block drop onto non-sellable rooms (OOO/Renovation)
        if (!targetRoom.is_sellable) return "Room is out of order / renovation";

        // Block drop onto rooms with active OOO/OOS blocks overlapping the reservation dates
        const res = (() => {
            for (const room of mergedData?.rooms ?? []) {
                const found = room.reservations.find(r => r.reservation_id === reservationId);
                if (found) return found;
            }
            return (mergedData?.unassigned ?? []).find(r => r.reservation_id === reservationId);
        })();

        if (res) {
            // HK guard should only apply when move can become effective "today".
            // Future planning should not be blocked by today's HK status.
            const hk = targetRoom.hk_status;
            if (hk === "dirty" || hk === "in_progress" || hk === "paused") {
                const touchesToday = dropDate ? dropDate <= today : (res.checked_in_at ? true : res.checkin_date <= today);
                if (touchesToday) {
                    return `Room is not ready (HK status: ${hk === "in_progress" ? "cleaning in progress" : hk})`;
                }
            }
        }

        if (res && mergedData?.blocks) {
            const addOneDay = (date: string) => {
                const [y, m, d] = date.split("-").map(Number);
                const dt = new Date(y, m - 1, d + 1);
                return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
            };
            const hasBlockConflict = mergedData.blocks.some(block => {
                if (block.room_id !== roomId) return false;

                // Per-night drop: check overlap for that specific stay night only.
                if (dropDate) {
                    const nightEnd = addOneDay(dropDate);
                    return !(block.end_date <= dropDate || block.start_date >= nightEnd);
                }

                // Whole move / assign: check overlap for the booking span.
                return !(block.end_date < res.checkin_date || block.start_date >= res.checkout_date);
            });
            if (hasBlockConflict) return "Room has an active OOO/OOS block during this stay";
        }

        return null; // droppable
    }, [mergedData, today]);

    const handleCellDrop = (roomId: string, date: string, e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null); // Clear highlight on drop
        try {
            const rawPayload =
                e.dataTransfer.getData("application/json") ||
                e.dataTransfer.getData("text/plain");

            if (!rawPayload) {
                alert("Drag payload is empty. กรุณาลองลากใหม่อีกครั้ง");
                return;
            }

            const payload = JSON.parse(rawPayload);

            // Guard: check target room
            const blockReason = isRoomDroppable(roomId, payload.reservation_id, date);
            if (blockReason) {
                alert(blockReason);
                return;
            }

            if (payload.type === "UNASSIGNED") {
                if (payload.linked_root_id) {
                     const members = mergedData?.unassigned?.filter(u => u.linked_root_id === payload.linked_root_id) || [];
                     if (members.length > 0) {
                         members.forEach(m => commitAction("ASSIGN", m.reservation_id, undefined, roomId));
                         return;
                     }
                }
                commitAction("ASSIGN", payload.reservation_id, undefined, roomId);
            } else if (payload.type === "ASSIGNED") {
                const override = overrides.find(o => o.reservation_id === payload.reservation_id && o.type === "solid");
                const currentRoomId = override ? override.room_id : mergedData?.rooms.find(r => r.reservations.some(x => x.reservation_id === payload.reservation_id))?.room_id;

                // ─── Per-Night Mode: handle BEFORE the same-room gate ───
                // Use original DB room (not merged/override) for per-night source
                const originalDbRoomId = data?.rooms.find(r => r.reservations.some(x => x.reservation_id === payload.reservation_id))?.room_id;
                if ((currentRoomId || originalDbRoomId) && perNightModeRef.current) {
                    // Use allReservations (original DB data) to get full nights array
                    const sourceRes = allReservations.get(payload.reservation_id);
                    if (!sourceRes) return;

                    const dropDate = date;
                    if (!sourceRes.nights.includes(dropDate)) {
                        alert(`This booking doesn't have a night on ${dropDate}`);
                        return;
                    }

                    // Guard: linked stay — block (Phase 46)
                    if (sourceRes.linked_root_id) {
                        alert("Per-Night move ยังไม่รองรับ Linked Stay — ใช้ Move Whole แทน");
                        return;
                    }

                    // Guard: checked-in + first night
                    if (sourceRes.checked_in_at && dropDate === sourceRes.nights[0]) {
                        alert("Cannot plan-move the first night of a checked-in booking. Use Move Whole first.");
                        return;
                    }

                    // Guard: past nights
                    if (dropDate < today) {
                        alert("Cannot plan-move past nights.");
                        return;
                    }

                    // Get the original DB room for this reservation (from raw data, not merged)
                    const originalRoomId = originalDbRoomId || data?.rooms.find(r =>
                        r.reservations.some(x => x.reservation_id === sourceRes.reservation_id)
                    )?.room_id;

                    // Update local per-night drafts
                    setPerNightDrafts(prev => {
                        const next = new Map(prev);
                        const key = `${sourceRes.reservation_id}::${dropDate}`;

                        // If dropping back to original room and this night has no draft → no-op
                        if (roomId === originalRoomId && !prev.has(key)) return next;

                        // If dropping back to original room and draft exists → remove draft (cancel this night's plan)
                        if (roomId === originalRoomId && prev.has(key)) {
                            next.delete(key);
                            return next;
                        }

                        next.set(key, roomId);
                        setPerNightHistory(h => [...h, key]);
                        return next;
                    });
                    return;
                }

                // ─── Normal Mode: same-room gate ───
                if (currentRoomId && currentRoomId !== roomId) {
                    let groupMembers: CalendarReservation[] = [];
                    const sourceRes = mergedData?.rooms.flatMap(r => r.reservations).find(x => x.reservation_id === payload.reservation_id);

                    if (payload.linked_root_id) {
                        // Whole move: move the entire linked stay
                        groupMembers = getLinkedGroupReservations(payload.linked_root_id);
                    } else {
                        if (sourceRes) groupMembers = [sourceRes];
                    }

                    if (groupMembers.length === 0) return;

                    const targetRoom = mergedData?.rooms.find(r => r.room_id === roomId);
                    const sourceRoom = mergedData?.rooms.find(r => r.room_id === currentRoomId);
                    
                    if (targetRoom) {
                        const overlapping = targetRoom.reservations.filter(r => {
                            if ((r as any).draft_state === "ghost") return false;
                            if (groupMembers.some(m => m.reservation_id === r.reservation_id)) return false;

                            // Date overlap check for ALL group members
                            return groupMembers.some(m => !(m.checkout_date <= r.checkin_date || m.checkin_date >= r.checkout_date));
                        });

                        if (overlapping.length > 0) {
                            if (groupMembers.length > 1) {
                                alert("Cannot swap Linked Stays. Target room must be completely empty for the entire duration.");
                                return;
                            }

                            const sourceRes = groupMembers[0];

                            // Check swap eligibility for ALL overlapping bookings
                            for (const conflictRes of overlapping) {
                                if (sourceRoom && targetRoom) {
                                    const reason = checkSwapEligibility(sourceRes, conflictRes, sourceRoom, targetRoom);
                                    if (reason) {
                                        alert(reason);
                                        return;
                                    }
                                }
                            }

                            // ─── Post-swap conflict check ───
                            // After swap: overlapping bookings move to sourceRoom, sourceRes moves to targetRoom.
                            // Check 1: Do overlapping bookings conflict with OTHER bookings in sourceRoom?
                            const otherInSource = sourceRoom?.reservations.filter(r => {
                                if ((r as any).draft_state === "ghost") return false;
                                if (r.reservation_id === sourceRes.reservation_id) return false;
                                return true;
                            }) ?? [];

                            for (const movingRes of overlapping) {
                                for (const stayingRes of otherInSource) {
                                    const hasConflict = !(movingRes.checkout_date <= stayingRes.checkin_date || movingRes.checkin_date >= stayingRes.checkout_date);
                                    if (hasConflict) {
                                        alert(`Cannot swap: ${movingRes.guest_name || movingRes.booking_code || 'target booking'} would conflict with ${stayingRes.guest_name || stayingRes.booking_code || 'existing booking'} in Room ${sourceRoom!.room_number} (${formatDateRangeDisplay(stayingRes.checkin_date, stayingRes.checkout_date, { separator: " - " })})`);
                                        return;
                                    }
                                }
                            }

                            // Check 2: Does sourceRes conflict with OTHER bookings remaining in targetRoom?
                            const otherInTarget = targetRoom.reservations.filter(r => {
                                if ((r as any).draft_state === "ghost") return false;
                                if (overlapping.some(o => o.reservation_id === r.reservation_id)) return false;
                                if (r.reservation_id === sourceRes.reservation_id) return false;
                                return true;
                            });

                            for (const stayingRes of otherInTarget) {
                                const hasConflict = !(sourceRes.checkout_date <= stayingRes.checkin_date || sourceRes.checkin_date >= stayingRes.checkout_date);
                                if (hasConflict) {
                                    alert(`Cannot swap: ${sourceRes.guest_name || sourceRes.booking_code || 'source booking'} would conflict with ${stayingRes.guest_name || stayingRes.booking_code || 'existing booking'} in Room ${targetRoom.room_number} (${formatDateRangeDisplay(stayingRes.checkin_date, stayingRes.checkout_date, { separator: " - " })})`);
                                    return;
                                }
                            }

                            // Multi-booking confirmation
                            if (overlapping.length > 1) {
                                const names = overlapping.map(r => r.guest_name || r.booking_code || r.reservation_id.slice(0, 8)).join(", ");
                                if (!confirm(`Swap will move ${overlapping.length + 1} bookings:\n\n• ${sourceRes.guest_name || sourceRes.booking_code || 'Source'} → Room ${targetRoom.room_number}\n• ${names} → Room ${sourceRoom!.room_number}\n\nProceed?`)) {
                                    return;
                                }
                            }

                            // Execute swap: source ↔ all overlapping
                            if (sourceRoom) {
                                const [primary, ...additionalIds] = overlapping.map(r => r.reservation_id);
                                commitSwap(
                                    sourceRes.reservation_id, currentRoomId,
                                    primary, roomId,
                                    additionalIds.length > 0 ? additionalIds : undefined
                                );
                                return;
                            }
                        }
                    }

                    // Proceed to MOVE ALL group members (normal whole-move)
                    groupMembers.forEach(m => {
                        const over = overrides.find(o => o.reservation_id === m.reservation_id && o.type === "solid");
                        const mCurrentRoomId = over ? over.room_id : mergedData?.rooms.find(r => r.reservations.some(x => x.reservation_id === m.reservation_id))?.room_id;
                        if (mCurrentRoomId && mCurrentRoomId !== roomId) {
                            commitAction("MOVE_WHOLE", m.reservation_id, mCurrentRoomId, roomId);
                        }
                    });
                }
            }
        } catch (err) {
            console.error("Drop failed", err);
            alert("Drop failed. กรุณาลองอีกครั้ง");
        } finally {
            isShiftDragRef.current = false;
        }
    };

    const handleCellMouseUp = useCallback((roomId: string, date: string) => {
        const payload = mouseDragPayloadRef.current;
        if (!payload) return;

        const fakeEvent = {
            preventDefault: () => { },
            dataTransfer: {
                getData: (type: string) => (type === "application/json" ? JSON.stringify(payload) : "")
            }
        } as unknown as React.DragEvent;

        handleCellDrop(roomId, date, fakeEvent);
        mouseDragPayloadRef.current = null;
    }, [handleCellDrop]);

    /* ─── Bar click handler — popover + swap-by-button ─── */
    const handleBarClick = useCallback((res: CalendarReservation, roomNumber: string) => {
        // Find room_id from roomNumber
        const room = mergedData?.rooms.find(r => r.room_number === roomNumber);
        if (!room) return;

        // If we're in swap-select mode (source already picked), this click is selecting the target
        if (swapSource) {
            // Can't swap with yourself
            if (res.reservation_id === swapSource.res.reservation_id) {
                setSwapSource(null);
                return;
            }
            // Ghost bars can't be swap targets
            if ((res as any).draft_state === "ghost") return;

            const sourceRoom = mergedData?.rooms.find(r => r.room_id === swapSource.roomId);
            const targetRoom = room;
            if (!sourceRoom || !targetRoom) return;

            // Check swap eligibility
            const reason = checkSwapEligibility(swapSource.res, res, sourceRoom, targetRoom);
            if (reason) {
                alert(reason);
                setSwapSource(null);
                return;
            }

            // Post-swap conflict check: target booking(s) moving to source room
            const overlapping = targetRoom.reservations.filter(r => {
                if ((r as any).draft_state === "ghost") return false;
                if (r.reservation_id === swapSource.res.reservation_id) return false;
                return !(swapSource.res.checkout_date <= r.checkin_date || swapSource.res.checkin_date >= r.checkout_date);
            });

            // Check target bookings vs other bookings in source room
            const otherInSource = sourceRoom.reservations.filter(r => {
                if ((r as any).draft_state === "ghost") return false;
                if (r.reservation_id === swapSource.res.reservation_id) return false;
                return true;
            });

            for (const movingRes of overlapping) {
                for (const stayingRes of otherInSource) {
                    const hasConflict = !(movingRes.checkout_date <= stayingRes.checkin_date || movingRes.checkin_date >= stayingRes.checkout_date);
                    if (hasConflict) {
                        alert(`Cannot swap: ${movingRes.guest_name || movingRes.booking_code || 'target booking'} would conflict with ${stayingRes.guest_name || stayingRes.booking_code || 'existing booking'} in Room ${sourceRoom.room_number}`);
                        setSwapSource(null);
                        return;
                    }
                }
            }

            // Check source booking vs other bookings remaining in target room
            const otherInTarget = targetRoom.reservations.filter(r => {
                if ((r as any).draft_state === "ghost") return false;
                if (overlapping.some(o => o.reservation_id === r.reservation_id)) return false;
                if (r.reservation_id === swapSource.res.reservation_id) return false;
                return true;
            });

            for (const stayingRes of otherInTarget) {
                const hasConflict = !(swapSource.res.checkout_date <= stayingRes.checkin_date || swapSource.res.checkin_date >= stayingRes.checkout_date);
                if (hasConflict) {
                    alert(`Cannot swap: ${swapSource.res.guest_name || swapSource.res.booking_code || 'source booking'} would conflict with ${stayingRes.guest_name || stayingRes.booking_code || 'existing booking'} in Room ${targetRoom.room_number}`);
                    setSwapSource(null);
                    return;
                }
            }

            // Multi-booking confirmation
            if (overlapping.length > 1) {
                const names = overlapping.map(r => r.guest_name || r.booking_code || r.reservation_id.slice(0, 8)).join(", ");
                if (!confirm(`Swap will move ${overlapping.length + 1} bookings:\n\n• ${swapSource.res.guest_name || swapSource.res.booking_code || 'Source'} → Room ${targetRoom.room_number}\n• ${names} → Room ${sourceRoom.room_number}\n\nProceed?`)) {
                    setSwapSource(null);
                    return;
                }
            }

            // Execute the swap
            if (overlapping.length > 0) {
                const [primary, ...additionalIds] = overlapping.map(r => r.reservation_id);
                commitSwap(
                    swapSource.res.reservation_id, swapSource.roomId,
                    primary, room.room_id,
                    additionalIds.length > 0 ? additionalIds : undefined
                );
            } else {
                // Clicked a non-overlapping bar — can't swap
                alert("Cannot swap: bookings do not overlap on any dates.");
            }
            setSwapSource(null);
            return;
        }

        // Normal click → toggle popover
        if (barPopover?.res.reservation_id === res.reservation_id && barPopover?.roomId === room.room_id) {
            setBarPopover(null);
        } else {
            setBarPopover({ res, roomId: room.room_id, roomNumber });
        }
    }, [mergedData, swapSource, barPopover, overrides, commitSwap]);

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
                    {(hasDrafts || perNightDrafts.size > 0) && (
                        <>
                            <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                                {hasDrafts ? `${actions.length} drafted change${actions.length > 1 ? "s" : ""}` : `${perNightDrafts.size} per-night move${perNightDrafts.size > 1 ? "s" : ""}`}
                            </span>
                            <button 
                                className="btn btn-outline btn-sm text-rose-600 hover:bg-rose-50 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-950/30" 
                                onClick={() => {
                                    clearDrafts();
                                    setPerNightDrafts(new Map());
                                    setPerNightHistory([]);
                                }}
                            >
                                Discard All
                            </button>
                            <button 
                                className="btn btn-outline btn-sm" 
                                onClick={() => {
                                    if (perNightDrafts.size > 0 && perNightHistory.length > 0) {
                                        const lastKey = perNightHistory[perNightHistory.length - 1];
                                        setPerNightDrafts(prev => {
                                            const next = new Map(prev);
                                            next.delete(lastKey);
                                            return next;
                                        });
                                        setPerNightHistory(h => h.slice(0, -1));
                                    } else {
                                        undo();
                                    }
                                }}
                            >
                                <Undo2 size={14} className="mr-1" /> Undo
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

                {/* Per-Night Move Mode toggle */}
                <button
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                        perNightMode
                            ? "bg-amber-500 text-white shadow-sm ring-2 ring-amber-300"
                            : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-amber-50 hover:border-amber-300 dark:hover:bg-amber-950/30"
                    }`}
                    onClick={() => setPerNightMode(prev => !prev)}
                    title="Per-Night Move: เปิดโหมดลากย้ายแยกรายคืน (สร้าง Plan Move)"
                >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                    {perNightMode ? "Per-Night ●" : "Per-Night"}
                </button>

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

            {/* Per-Night Mode banner */}
            {perNightMode && !swapSource && (
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                        <span className="font-semibold">Per-Night Move Mode</span>
                        <span className="text-amber-600 dark:text-amber-400">— ลาก booking ไปห้องอื่น จะย้ายแยกรายคืน (ไม่ใช่ทั้งก้อน)</span>
                    </div>
                    <button
                        className="btn btn-outline btn-sm text-amber-700 border-amber-300 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-600 dark:hover:bg-amber-900/50"
                        onClick={() => setPerNightMode(false)}
                    >
                        Exit Per-Night Mode
                    </button>
                </div>
            )}

            {/* Swap select mode banner */}
            {swapSource && (
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-800 animate-in slide-in-from-top duration-200">
                    <div className="flex items-center gap-2 text-sm text-indigo-800 dark:text-indigo-200">
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-500 text-white text-xs font-bold">1</span>
                        <span className="font-semibold">{swapSource.res.guest_name || swapSource.res.booking_code}</span>
                        <span className="text-indigo-500 dark:text-indigo-400">(Room {swapSource.roomNumber})</span>
                        <span className="mx-1">→</span>
                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-200 dark:bg-indigo-700 text-indigo-700 dark:text-indigo-200 text-xs font-bold">2</span>
                        <span className="text-indigo-600 dark:text-indigo-300">Click a booking to swap with</span>
                    </div>
                    <button
                        className="btn btn-outline btn-sm text-indigo-700 border-indigo-300 hover:bg-indigo-100 dark:text-indigo-300 dark:border-indigo-600 dark:hover:bg-indigo-900/50"
                        onClick={() => setSwapSource(null)}
                    >
                        Cancel Swap
                    </button>
                </div>
            )}

            {/* Bar popover (click booking bar → actions) */}
            {barPopover && !swapSource && (() => {
                const res = barPopover.res;
                const isGhost = (res as any).draft_state === "ghost";
                const isCheckedOut = res.status === "checked_out";
                const isCheckedIn = Boolean(res.checked_in_at);
                const isLocked = Boolean(res.do_not_move);
                const canSwap = !isGhost && !isCheckedOut && !isCheckedIn && !isLocked;

                // Check if booking has plan moves
                const bookingPlans = (mergedData?.planned_moves ?? []).filter(
                    pm => pm.reservation_id === res.reservation_id
                );
                const hasPlans = bookingPlans.length > 0;
                const isLinked = Boolean(res.linked_root_id);

                const handleCancelAllPlans = async () => {
                    const linkedRootId = res.linked_root_id;
                    const confirmMsg = isLinked
                        ? `⚠️ Booking นี้เป็น Linked Stay\n\nCancel Plan Move จะ Unlink อัตโนมัติ\nต้องไป Link ใหม่เองภายหลัง\n\n` +
                          `ยกเลิก Plan Move ทั้งหมด ${bookingPlans.length} รายการ?\n\n` +
                          bookingPlans.map(p => `• ${p.start_date} → ${p.end_date} (→ Room ${p.to_room_number || '?'})`).join("\n") +
                          `\n\nดำเนินการ?`
                        : `ยกเลิก Plan Move ทั้งหมด ${bookingPlans.length} รายการ ของ ${res.guest_name || res.booking_code}?\n\n` +
                          bookingPlans.map(p => `• ${p.start_date} → ${p.end_date} (→ Room ${p.to_room_number || '?'})`).join("\n") +
                          `\n\nBooking จะกลับไปห้องเดิมทั้งหมด\nดำเนินการ?`;

                    if (!confirm(confirmMsg)) return;

                    setBarPopover(null);
                    setLoading(true);
                    try {
                        // Step 1: Cancel all plan moves FIRST
                        // (Unlink API requires no pending plans, so cancel must come first)
                        let cancelledCount = 0;
                        for (const plan of bookingPlans) {
                            const resp = await fetch(
                                `/api/bookings/${res.reservation_id}/planned-room-moves/${plan.id}/cancel`,
                                {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        override_note: "Cancel all plans from Room Planner",
                                        confirm_float_conflicts: true,
                                    }),
                                }
                            );
                            if (!resp.ok) {
                                const body = await resp.json().catch(() => ({}));
                                if (body.error?.includes("float") || body.requires_confirmation) {
                                    alert(
                                        `ยกเลิก Plan ${plan.start_date}→${plan.end_date} ไม่ได้:\n` +
                                        `ห้องเดิมเต็ม — กรุณาไปแก้ไขที่หน้า Plan Move แทน`
                                    );
                                    break;
                                }
                                throw new Error(body.error || `Cancel failed (${resp.status})`);
                            }
                            cancelledCount++;
                        }

                        // Step 2: If linked AND all plans cancelled → Unlink
                        if (isLinked && linkedRootId && cancelledCount === bookingPlans.length) {
                            const unlinkId = res.parent_reservation_id
                                ? res.reservation_id  // Child → unlink child
                                : linkedRootId;        // Parent → unlink from root
                            const unlinkResp = await fetch(
                                `/api/bookings/${unlinkId}/link-stay`,
                                {
                                    method: "DELETE",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        note: "Auto-unlink after Plan Move cancel from Room Planner",
                                    }),
                                }
                            );
                            if (!unlinkResp.ok) {
                                const body = await unlinkResp.json().catch(() => ({}));
                                // Plans already cancelled, warn about unlink failure
                                alert(`✅ Plan Move ยกเลิกแล้ว แต่ Unlink ไม่สำเร็จ:\n${body.error || unlinkResp.status}\n\nกรุณาไป Unlink เองที่หน้า Booking Detail`);
                                load();
                                return;
                            }
                        }

                        const successMsg = isLinked
                            ? "✅ ยกเลิก Plan Move + Unlink เรียบร้อย\n⚠️ กรุณาไป Link ใหม่ถ้าต้องการ"
                            : "✅ ยกเลิก Plan Move ทั้งหมดเรียบร้อย";
                        alert(successMsg);
                        load();
                    } catch (e: any) {
                        alert(e.message);
                        load(); // Reload even on error to reflect partial changes
                    } finally {
                        setLoading(false);
                    }
                };

                return (
                    <div className="fixed inset-0 z-40" onClick={() => setBarPopover(null)}>
                        <div
                            className="absolute z-50 bg-[var(--bg-surface)] rounded-lg shadow-xl ring-1 ring-[var(--border-default)] p-3 min-w-[220px] animate-in fade-in zoom-in-95 duration-150"
                            style={{
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="mb-2">
                                <div className="font-semibold text-sm text-[var(--text-primary)]">{res.guest_name}</div>
                                <div className="text-xs text-[var(--text-secondary)]">
                                    Room {barPopover.roomNumber} · {res.booking_code} · {formatDateRangeDisplay(res.checkin_date, res.checkout_date)}
                                </div>
                                {hasPlans && (
                                    <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                                        {bookingPlans.length} Plan Move{bookingPlans.length > 1 ? "s" : ""}
                                    </div>
                                )}
                            </div>
                            <div className="border-t border-[var(--border-subtle)] pt-2 space-y-1">
                                {/* Swap button */}
                                <button
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors ${
                                        canSwap
                                            ? "hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                                            : "opacity-40 cursor-not-allowed text-[var(--text-muted)]"
                                    }`}
                                    disabled={!canSwap}
                                    onClick={() => {
                                        if (!canSwap) return;
                                        setSwapSource({ res, roomId: barPopover.roomId, roomNumber: barPopover.roomNumber });
                                        setBarPopover(null);
                                    }}
                                >
                                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
                                    Swap with...
                                </button>
                                {!canSwap && (
                                    <div className="text-[10px] text-[var(--text-muted)] px-3">
                                        {isCheckedIn ? "Checked in — cannot swap" : isCheckedOut ? "Checked out" : isLocked ? "Locked (Do Not Move)" : "Cannot swap"}
                                    </div>
                                )}

                                {/* Cancel All Plans button */}
                                {hasPlans && (
                                    <button
                                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400"
                                        onClick={handleCancelAllPlans}
                                    >
                                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                        Cancel All Plans ({bookingPlans.length})
                                    </button>
                                )}
                                {hasPlans && isLinked && (
                                    <div className="text-[10px] text-amber-600 dark:text-amber-400 px-3">
                                        ⚠️ Linked Stay — Cancel จะ Unlink อัตโนมัติ
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

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
                        hoverGroupId={hoverGroupId}
                        onLinkHover={setHoverGroupId}
                        onBarDragStart={handleBarDragStart}
                        onBarResizeStart={handleBarResizeStart}
                        onCellDragEnter={handleCellDragEnter}
                        onCellDragOver={handleCellDragOver}
                        onCellDragLeave={handleCellDragLeave}
                        onCellDrop={handleCellDrop}
                        onCellMouseUp={handleCellMouseUp}
                        onBarClick={handleBarClick}
                        onBarMouseDown={handleBarMouseDown}
                        onFocusReservation={id => setHoverGroupId(id ? `res:${id}` : null)}
                        focusReservationId={swapSource?.res.reservation_id ?? null}
                        isResizing={resizingState !== null}
                        isPerNightMode={perNightMode}
                    />
                </div>

                {/* Unassigned Sidebar — Right side */}
                <UnassignedSidebar
                    reservations={mergedData?.unassigned ?? []}
                    onDragStart={handleDragStartUnassigned}
                    onDropToPool={handleDropToPool}
                />
            </div>

            {otaPriceModal && (
                <OTAPriceModal
                    reservation={otaPriceModal.reservation}
                    nights={otaPriceModal.nights}
                    onClose={() => setOtaPriceModal(null)}
                    onConfirm={(pricing) => {
                        commitMoveNights(
                            otaPriceModal.reservation.reservation_id,
                            otaPriceModal.fromRoomId,
                            otaPriceModal.toRoomId,
                            otaPriceModal.nights,
                            pricing
                        );
                        setOtaPriceModal(null);
                    }}
                />
            )}

            {showReview && perNightDrafts.size > 0 && (
                <PerNightReviewPanel
                    onClose={() => setShowReview(false)}
                    perNightDrafts={perNightDrafts}
                    allReservations={allReservations}
                    rooms={data?.rooms ?? []}
                    buildIntents={buildPlanMovesFromNights}
                    onConfirm={handleSavePerNightMoves}
                    loading={loading}
                />
            )}
            {showReview && perNightDrafts.size === 0 && (
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

function OTAPriceModal({ reservation, nights, onClose, onConfirm }: { 
    reservation: CalendarReservation; 
    nights: string[]; 
    onClose: () => void; 
    onConfirm: (pricing: { stay_date: string; price: number }[]) => void;
}) {
    const [prices, setPrices] = useState<Record<string, string>>({});

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-[var(--border-subtle)] bg-brand-50/30 dark:bg-brand-900/10">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">OTA Manual Pricing</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">OTA nights require manual rates for the target room.</p>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-auto">
                    {nights.map(date => (
                        <div key={date} className="flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-[var(--text-primary)]">{date}</span>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">฿</span>
                                <input
                                    type="number"
                                    className="form-input pl-6 pr-3 py-1.5 text-right font-semibold"
                                    placeholder="0.00"
                                    value={prices[date] || ""}
                                    onChange={e => setPrices(prev => ({ ...prev, [date]: e.target.value }))}
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-6 bg-[var(--bg-body)] flex justify-end gap-3">
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button 
                        className="btn btn-primary px-8"
                        onClick={() => {
                            const result = nights.map(date => ({
                                stay_date: date,
                                price: parseFloat(prices[date] || "0")
                            }));
                            onConfirm(result);
                        }}
                    >
                        Apply Move
                    </button>
                </div>
            </div>
        </div>
    );
}

function PerNightReviewPanel({ 
    onClose, perNightDrafts, allReservations, rooms, buildIntents, onConfirm, loading 
}: {
    onClose: () => void;
    perNightDrafts: Map<string, string>;
    allReservations: Map<string, CalendarReservation>;
    rooms: CalendarRoom[];
    buildIntents: (resId: string, nights: string[], drafts: Map<string, string>) => any[];
    onConfirm: () => void;
    loading: boolean;
}) {
    const resIds = Array.from(new Set(Array.from(perNightDrafts.keys()).map(k => k.split("::")[0])));
    
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl border border-[var(--border-default)] w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">Review Plan Moves (Per-Night)</h3>
                        <p className="text-xs text-[var(--text-secondary)] mt-1">Review the room transitions that will be scheduled.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
                </div>
                
                <div className="p-6 space-y-6 max-h-[60vh] overflow-auto">
                    {resIds.map(resId => {
                        const res = allReservations.get(resId);
                        if (!res) return null;
                        const intents = buildIntents(resId, res.nights, perNightDrafts);
                        
                        return (
                            <div key={resId} className="space-y-3">
                                <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
                                    <span className="font-bold text-sm text-brand-600">{res.guest_name || res.booking_code}</span>
                                    <span className="text-xs text-[var(--text-muted)]">({formatDateRangeDisplay(res.checkin_date, res.checkout_date, { separator: " - " })})</span>
                                </div>
                                <div className="space-y-2">
                                    {intents.length === 0 ? (
                                        <p className="text-xs text-[var(--text-muted)] italic pl-4">No room changes scheduled.</p>
                                    ) : (
                                        intents.map((intent, idx) => {
                                            const toRoom = rooms.find(r => r.room_id === intent.to_room_id);
                                            const fromRoom = rooms.find(r => r.room_id === intent.from_room_id);
                                            return (
                                                <div key={idx} className="flex items-center gap-4 pl-4 text-xs">
                                                    <span className="w-20 text-[var(--text-secondary)] font-mono">{intent.start_date}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-700">Room {fromRoom?.room_number}</span>
                                                        <span className="text-gray-400">→</span>
                                                        <span className="px-2 py-0.5 bg-brand-50 text-brand-700 font-bold border border-brand-200 rounded">Room {toRoom?.room_number}</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                
                <div className="p-6 bg-[var(--bg-body)] flex justify-end gap-3 border-t border-[var(--border-subtle)]">
                    <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
                    <button 
                        className="btn btn-primary px-8 flex items-center gap-2" 
                        onClick={onConfirm}
                        disabled={loading || resIds.length === 0}
                    >
                        {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        Confirm & Create Plan Moves
                    </button>
                </div>
            </div>
        </div>
    );
}
