"use client";

import { useState, useMemo, useCallback } from "react";
import type { DraftAction, DraftActionType, DraftOverride } from "@/lib/types";

export function useDraftEngine() {
    const [actions, setActions] = useState<DraftAction[]>([]);

    const commitAction = useCallback((
        type: DraftActionType,
        reservationId: string,
        fromRoomId?: string,
        toRoomId?: string
    ) => {
        setActions(prev => {
            // If the booking is already moved/assigned in draft, we just append the new action
            // Or we could try to collapse them? For an audit trail, appending is safer.
            // But for simple "Undo", appending is also fine.
            const newAction: DraftAction = {
                id: crypto.randomUUID(),
                type,
                reservation_id: reservationId,
                from_room_id: fromRoomId,
                to_room_id: toRoomId,
                created_at: Date.now()
            };
            return [...prev, newAction];
        });
    }, []);

    const undo = useCallback(() => {
        setActions(prev => prev.slice(0, -1));
    }, []);

    const clearDrafts = useCallback(() => {
        setActions([]);
    }, []);

    // Compute the net "overrides" mapping reservation_id -> DraftOverride[]
    // We only care about the final location of a reservation in the draft state.
    const overridesByRes = useMemo(() => {
        const result = new Map<string, {
            originalRoomId?: string | null;
            currentRoomId?: string | null;
            isUnassigned?: boolean;
            isNewlyAssigned?: boolean;
        }>();

        for (const action of actions) {
            const resId = action.reservation_id;
            const state = result.get(resId) ?? {
                originalRoomId: action.from_room_id, // captures first known location
                currentRoomId: action.from_room_id
            };

            if (action.type === "MOVE_WHOLE" || action.type === "ASSIGN") {
                state.currentRoomId = action.to_room_id;
                state.isUnassigned = false;
                if (action.type === "ASSIGN") {
                    state.isNewlyAssigned = true;
                }
            } else if (action.type === "UNASSIGN") {
                state.currentRoomId = null;
                state.isUnassigned = true;
            }

            result.set(resId, state);
        }

        const overrides: DraftOverride[] = [];
        
        for (const [resId, state] of result.entries()) {
            // Ignore if it moved back to its original location
            if (state.originalRoomId === state.currentRoomId && !state.isUnassigned) {
                continue;
            }

            // Ghost for the original location (only if it had one)
            if (state.originalRoomId && !state.isNewlyAssigned) {
                overrides.push({
                    reservation_id: resId,
                    type: "ghost",
                    room_id: state.originalRoomId
                });
            }

            // Solid for the new location (only if it's currently assigned somewhere)
            if (state.currentRoomId && !state.isUnassigned) {
                overrides.push({
                    reservation_id: resId,
                    type: "solid",
                    room_id: state.currentRoomId
                });
            }
        }

        return overrides;
    }, [actions]);

    return {
        actions,
        overrides: overridesByRes,
        commitAction,
        undo,
        clearDrafts,
        hasDrafts: actions.length > 0
    };
}
