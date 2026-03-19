import type { LinkedStaySegment } from "./types";

export interface LinkableReservation {
    id: string;
    parent_reservation_id?: string | null;
    linked_segments?: LinkedStaySegment[] | null;
    linked_full_checkin?: string | null;
    linked_full_checkout?: string | null;
    linked_active_segment_id?: string | null;
    total_price: number;
    nights_remaining?: number;
    nights_count?: number;
    checkin_date: string;
    checkout_date: string;
    [key: string]: any;
}

export type MergedGroup<T extends LinkableReservation> = {
    is_linked: boolean;
    group_id: string;
    active_reservation: T;
    all_reservations: T[];
    linked_segments: LinkedStaySegment[];
    linked_full_checkin: string;
    linked_full_checkout: string;
    linked_total_price: number;
    linked_nights_remaining: number;
    linked_nights_count?: number;
    linked_active_segment_id: string;
};

function sortSegments(segments: LinkedStaySegment[]): LinkedStaySegment[] {
    return [...segments].sort((left, right) => {
        const checkinCmp = String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
        if (checkinCmp !== 0) return checkinCmp;
        if (Boolean(left.is_parent) !== Boolean(right.is_parent)) return left.is_parent ? -1 : 1;
        const checkoutCmp = String(left.checkout_date ?? "").localeCompare(String(right.checkout_date ?? ""));
        if (checkoutCmp !== 0) return checkoutCmp;
        return String(left.reservation_id ?? "").localeCompare(String(right.reservation_id ?? ""));
    });
}

function statusScore(status: string | null | undefined): number {
    const normalized = String(status ?? "").toLowerCase();
    if (normalized === "active") return 4;
    if (normalized === "checked_out") return 3;
    if (normalized === "cancelled") return 2;
    if (normalized === "no_show") return 1;
    return 0;
}

function normalizeLinkedSegments(items: LinkableReservation[]): LinkedStaySegment[] {
    const all = items.flatMap((item) => item.linked_segments ?? []);
    if (all.length === 0) return [];

    const byReservationId = new Map<string, LinkedStaySegment>();
    for (const segment of all) {
        const reservationId = String(segment?.reservation_id ?? "");
        if (!reservationId) continue;
        const previous = byReservationId.get(reservationId);
        if (!previous || statusScore(segment.status) > statusScore(previous.status)) {
            byReservationId.set(reservationId, segment);
        }
    }

    return sortSegments(Array.from(byReservationId.values()));
}

export function groupLinkedStays<T extends LinkableReservation>(reservations: T[]): MergedGroup<T>[] {
    const groups = new Map<string, T[]>();
    
    for (const res of reservations) {
        const groupId = res.parent_reservation_id || res.id;
        if (!groups.has(groupId)) {
            groups.set(groupId, []);
        }
        groups.get(groupId)!.push(res);
    }

    const merged: MergedGroup<T>[] = [];
    
    for (const [groupId, items] of groups.entries()) {
        const isLinked = items.length > 1 || (items[0].linked_segments && items[0].linked_segments.length > 1);
        
        if (!isLinked) {
            const res = items[0];
            merged.push({
                is_linked: false,
                group_id: groupId,
                active_reservation: res,
                all_reservations: [res],
                linked_segments: [],
                linked_full_checkin: res.checkin_date || "",
                linked_full_checkout: res.checkout_date || "",
                linked_total_price: res.total_price,
                linked_nights_remaining: res.nights_remaining || 0,
                linked_nights_count: res.nights_count || 0,
                linked_active_segment_id: res.id
            });
            continue;
        }

        const linkedSegments = normalizeLinkedSegments(items);
        const activeSegmentId = items.find((item) => item.linked_active_segment_id)?.linked_active_segment_id;
        const activeReservation = items.find(r => r.id === activeSegmentId) || items[items.length - 1]; // fallback to last if active not found in array
        const linkedFullCheckin = items
            .map((item) => item.linked_full_checkin || item.checkin_date)
            .filter(Boolean)
            .sort()[0] || "";
        const linkedCheckoutCandidates = items
            .map((item) => item.linked_full_checkout || item.checkout_date)
            .filter(Boolean)
            .sort();
        const linkedFullCheckout = linkedCheckoutCandidates.length > 0 ? linkedCheckoutCandidates[linkedCheckoutCandidates.length - 1] : "";
        
        merged.push({
            is_linked: true,
            group_id: groupId,
            active_reservation: activeReservation as T,
            all_reservations: items,
            linked_segments: linkedSegments,
            linked_full_checkin: linkedFullCheckin,
            linked_full_checkout: linkedFullCheckout,
            linked_total_price: items.reduce((sum, r) => sum + (r.total_price || 0), 0),
            linked_nights_remaining: items.reduce((sum, r) => sum + (r.nights_remaining || 0), 0), // sum of remaining nights
            linked_nights_count: items.reduce((sum, r) => sum + (r.nights_count || 0), 0),
            linked_active_segment_id: activeSegmentId || activeReservation.id
        });
    }

    return merged;
}
