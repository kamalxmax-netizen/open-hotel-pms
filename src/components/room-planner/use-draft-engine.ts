"use client";

import { useState, useMemo, useCallback } from "react";
import type { DraftAction, DraftActionType, DraftOverride } from "@/lib/types";

export function useDraftEngine() {
    const [actions, setActions] = useState<DraftAction[]>([]);

    const commitAction = useCallback((
        type: DraftActionType,
        reservationId: string,
        fromRoomId?: string,
        toRoomId?: string,
        swapPairId?: string
    ) => {
        setActions(prev => {
            const newAction: DraftAction = {
                id: crypto.randomUUID(),
                type,
                reservation_id: reservationId,
                from_room_id: fromRoomId,
                to_room_id: toRoomId,
                created_at: Date.now(),
                swap_pair_id: swapPairId
            };
            return [...prev, newAction];
        });
    }, []);

    const commitSwap = useCallback((
        resIdA: string, roomIdA: string,
        resIdB: string, roomIdB: string,
        additionalTargetResIds?: string[]
    ) => {
        const swapId = crypto.randomUUID();
        commitAction("MOVE_WHOLE", resIdA, roomIdA, roomIdB, swapId);
        commitAction("MOVE_WHOLE", resIdB, roomIdB, roomIdA, swapId);
        if (additionalTargetResIds) {
            for (const extraResId of additionalTargetResIds) {
                commitAction("MOVE_WHOLE", extraResId, roomIdB, roomIdA, swapId);
            }
        }
    }, [commitAction]);

    const commitMoveNights = useCallback((
        reservationId: string,
        fromRoomId: string,
        toRoomId: string,
        affectedNights: string[],
        otaNightOverrides?: { stay_date: string; price: number }[]
    ) => {
        setActions(prev => [
            ...prev,
            {
                id: crypto.randomUUID(),
                type: "MOVE_NIGHTS",
                reservation_id: reservationId,
                from_room_id: fromRoomId,
                to_room_id: toRoomId,
                affected_nights: affectedNights,
                ota_night_overrides: otaNightOverrides,
                created_at: Date.now(),
            }
        ]);
    }, []);

    const commitExtend = useCallback((
        reservationId: string,
        newCheckoutDate?: string,
        newCheckinDate?: string
    ) => {
        setActions(prev => [
            ...prev,
            {
                id: crypto.randomUUID(),
                type: "EXTEND",
                reservation_id: reservationId,
                new_checkout_date: newCheckoutDate,
                new_checkin_date: newCheckinDate,
                created_at: Date.now(),
            }
        ]);
    }, []);

    const commitShorten = useCallback((
        reservationId: string,
        newCheckoutDate?: string,
        newCheckinDate?: string
    ) => {
        setActions(prev => [
            ...prev,
            {
                id: crypto.randomUUID(),
                type: "SHORTEN",
                reservation_id: reservationId,
                new_checkout_date: newCheckoutDate,
                new_checkin_date: newCheckinDate,
                created_at: Date.now(),
            }
        ]);
    }, []);

    const undo = useCallback(() => {
        setActions(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.swap_pair_id) {
                return prev.filter(a => a.swap_pair_id !== last.swap_pair_id);
            }
            return prev.slice(0, -1);
        });
    }, []);

    const clearDrafts = useCallback(() => {
        setActions([]);
    }, []);

    // Compute the net "overrides" mapping reservation_id -> DraftOverride[]
    const overridesByRes = useMemo(() => {
        const resStates = new Map<string, {
            originalRoomId?: string | null;
            perNightAssignments: Map<string, string | null>;
            isUnassigned: boolean;
            isNewlyAssigned: boolean;
        }>();

        for (const action of actions) {
            const resId = action.reservation_id;
            const state = resStates.get(resId) ?? {
                originalRoomId: action.from_room_id,
                perNightAssignments: new Map<string, string | null>(),
                isUnassigned: false,
                isNewlyAssigned: action.type === "ASSIGN"
            };

            if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN") {
                state.isUnassigned = false;
                state.perNightAssignments.clear();
                state.perNightAssignments.set("*", action.to_room_id!); 
            } else if (action.type === "UNASSIGN") {
                state.isUnassigned = true;
                state.perNightAssignments.clear();
            } else if (action.type === "MOVE_NIGHTS") {
                state.isUnassigned = false;
                if (action.affected_nights) {
                    for (const night of action.affected_nights) {
                        state.perNightAssignments.set(night, action.to_room_id!);
                    }
                }
            }

            resStates.set(resId, state);
        }

        const overrides: DraftOverride[] = [];
        
        for (const [resId, state] of resStates.entries()) {
            if (state.isUnassigned) {
                if (state.originalRoomId) {
                    overrides.push({ reservation_id: resId, type: "ghost", room_id: state.originalRoomId });
                }
                continue;
            }

            const catchAllRoomId = state.perNightAssignments.get("*");
            
            if (catchAllRoomId) {
                if (catchAllRoomId !== state.originalRoomId) {
                    if (state.originalRoomId && !state.isNewlyAssigned) {
                        overrides.push({ reservation_id: resId, type: "ghost", room_id: state.originalRoomId });
                    }
                    overrides.push({ reservation_id: resId, type: "solid", room_id: catchAllRoomId });
                }
            } else if (state.perNightAssignments.size > 0) {
                const nightsByRoom = new Map<string, string[]>();
                for (const [night, roomId] of state.perNightAssignments.entries()) {
                    if (!roomId) continue;
                    const list = nightsByRoom.get(roomId) ?? [];
                    list.push(night);
                    nightsByRoom.set(roomId, list);
                }

                const allMovedNights = Array.from(state.perNightAssignments.keys());
                if (state.originalRoomId) {
                    overrides.push({
                        reservation_id: resId,
                        type: "ghost",
                        room_id: state.originalRoomId,
                        nights: allMovedNights
                    });
                }

                for (const [roomId, nights] of nightsByRoom.entries()) {
                    overrides.push({
                        reservation_id: resId,
                        type: "solid",
                        room_id: roomId,
                        nights
                    });
                }
            }
        }

        return overrides;
    }, [actions]);

    return {
        actions,
        overrides: overridesByRes,
        commitAction,
        commitSwap,
        commitMoveNights,
        commitExtend,
        commitShorten,
        undo,
        clearDrafts,
        hasDrafts: actions.length > 0
    };
}
