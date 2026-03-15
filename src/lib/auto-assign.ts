/**
 * Auto-Assign Scoring Engine
 * Phase E — Room Detail & Auto-Assign System
 *
 * Scores each candidate room for a given reservation and returns
 * ranked recommendations with score breakdowns.
 *
 * v2: Added proximity scoring (floor_number + sort_order + wing)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type HKStatus = "dirty" | "in_progress" | "cleaned" | "approved" | "paused";

export type ScoringWeights = {
    w_preference: number; // default 40
    w_bed: number;        // default 25
    w_quality: number;    // default 20
    w_balance: number;    // default 10
    w_hk: number;         // default 5
};

export type CandidateRoom = {
    id: string;
    room_number: string;
    room_type_id: number;
    max_guests: number;
    extra_guest_charge: number;
    features: string[];            // feature codes assigned to this room
    beds: { type: string; qty: number }[];
    quality_score: number | null;  // null = no detail entered yet
    total_nights: number;          // cumulative nights from room_stay_history
    hk_status: HKStatus | null;   // today's HK task status
    last_checkout_date?: string;   // ISO date of last guest checkout (for ETA tiebreak)
    // ── Proximity fields (from rooms table) ────────────────────
    floor_number: number | null;
    sort_order: number | null;     // bay position from stair (1 = closest)
    wing: "L" | "R" | "C" | null; // left / right / center corridor
};

export type ReservationForAssign = {
    id: string;
    room_type_id: number;
    adults: number;
    children: number;          // children who count as guests (≥ 110cm or 2nd free child)
    preferences: string[];     // feature codes requested by guest
    checkin_date: string;
    checkin_time?: string;     // ETA e.g. "08:00"
    guest_name: string;
    /** Already-assigned rooms in this batch (for proximity boost on multi-room bookings) */
    companion_rooms?: { floor_number: number | null; sort_order: number | null }[];
};

export type RoomScore = {
    room_id: string;
    room_number: string;
    total_score: number;      // 0–100
    rank: number;
    extra_charge_flag: boolean;
    requires_admin: boolean;  // guests > max_guests + 1
    breakdown: {
        preference: number;   // 0–40
        bed: number;          // 0–25
        quality: number;      // 0–20
        balance: number;      // 0–10
        hk: number;           // 0–5
        proximity: number;    // 0–5 (bonus for nearby companion rooms)
    };
    reasons: string[];        // human-readable explanation
};

// ── Scoring Helpers ─────────────────────────────────────────────────────────

const HK_POINTS: Record<string, number> = {
    approved: 1.0,
    cleaned: 0.8,
    paused: 0.4,
    in_progress: 0.2,
    dirty: 0.0,
};

/** Bed match: does the room's beds accommodate the guest count well? */
function calcBedScore(beds: CandidateRoom["beds"], guestCount: number): number {
    if (beds.length === 0) return 0;

    const totalCapacity = beds.reduce((sum, b) => {
        const perBed = b.type === "KING" ? 2 : b.type === "QUEEN" ? 2 : 1;
        return sum + perBed * b.qty;
    }, 0);

    if (totalCapacity >= guestCount) return 1.0;
    if (totalCapacity >= guestCount - 1) return 0.6;
    return 0.2;
}

/** Preference match: ratio of matched prefs to total requested */
function calcPrefScore(roomFeatures: string[], requested: string[]): number {
    if (requested.length === 0) return 1.0;
    const matched = requested.filter(p => roomFeatures.includes(p)).length;
    return matched / requested.length;
}

/** HK status points (0–1) */
function calcHKScore(status: HKStatus | null): number {
    if (!status) return 0.5;
    return HK_POINTS[status] ?? 0;
}

/** Early ETA tiebreaker */
function etaTiebreakerBonus(room: CandidateRoom, etaTime?: string): number {
    if (!etaTime) return 0;
    const [hour] = etaTime.split(":").map(Number);
    if (hour > 12) return 0;
    return room.last_checkout_date ? 0.5 : 0;
}

/**
 * Proximity score — bonus when this room is near companion rooms
 * already assigned in the same batch (multi-room booking).
 *
 * Rules (5m per bay):
 *   - Same floor + |sort_order_diff| <= 1 → full bonus (next door / across corridor)
 *   - Same floor + |sort_order_diff| <= 2 → half bonus (within 10m)
 *   - Different floor → 0
 *
 * Returns 0.0–1.0 (scaled by w_proximity in caller)
 */
function calcProximityScore(
    room: CandidateRoom,
    companions: ReservationForAssign["companion_rooms"]
): number {
    if (!companions || companions.length === 0) return 0;
    if (room.floor_number === null || room.sort_order === null) return 0;

    let best = 0;
    for (const comp of companions) {
        if (comp.floor_number === null || comp.sort_order === null) continue;
        if (comp.floor_number !== room.floor_number) continue;
        const diff = Math.abs(comp.sort_order - room.sort_order);
        if (diff <= 1) best = Math.max(best, 1.0);  // next door or across corridor
        else if (diff <= 2) best = Math.max(best, 0.5); // within 10m
    }
    return best;
}

// ── Main Scoring Function ───────────────────────────────────────────────────

/** Fixed proximity weight (bonus, doesn't reduce other weights) */
const W_PROXIMITY = 5;

export function scoreRooms(
    candidates: CandidateRoom[],
    reservation: ReservationForAssign,
    weights: ScoringWeights
): RoomScore[] {
    const totalGuests = reservation.adults + reservation.children;
    const avgNights = candidates.length > 0
        ? candidates.reduce((s, r) => s + r.total_nights, 0) / candidates.length
        : 0;

    const hasCompanions = (reservation.companion_rooms?.length ?? 0) > 0;

    const scored: RoomScore[] = [];

    for (const room of candidates) {
        // ── Hard reject / admin flag ──────────────────────────
        const requiresAdmin = totalGuests > room.max_guests + 1;
        const extraCharge = totalGuests > room.max_guests && totalGuests <= room.max_guests + 1;

        if (requiresAdmin) {
            scored.push({
                room_id: room.id,
                room_number: room.room_number,
                total_score: -1,
                rank: 999,
                extra_charge_flag: false,
                requires_admin: true,
                breakdown: { preference: 0, bed: 0, quality: 0, balance: 0, hk: 0, proximity: 0 },
                reasons: [`Requires admin: ${totalGuests} guests exceeds max ${room.max_guests}+1`],
            });
            continue;
        }

        const reasons: string[] = [];

        // ── 1. Preference score (0 → w_preference pts) ────────
        const prefRatio = calcPrefScore(room.features, reservation.preferences);
        const prefScore = prefRatio * weights.w_preference;
        if (prefRatio === 1 && reservation.preferences.length > 0)
            reasons.push(`✓ All ${reservation.preferences.length} preferences matched`);
        else if (prefRatio > 0)
            reasons.push(`⚠ ${Math.round(prefRatio * reservation.preferences.length)}/${reservation.preferences.length} prefs matched`);
        else if (reservation.preferences.length > 0)
            reasons.push("✗ No preferences matched");

        // ── 2. Bed match (0 → w_bed pts) ──────────────────────
        const bedRatio = calcBedScore(room.beds, totalGuests);
        const bedScore = bedRatio * weights.w_bed;
        if (bedRatio === 1) reasons.push("✓ Beds sufficient");
        else if (bedRatio > 0) reasons.push("⚠ Beds slightly short");
        else reasons.push("✗ Bed capacity low");

        // ── 3. Quality score (0 → w_quality pts) ──────────────
        const qScore = room.quality_score ?? 5;
        const qualScore = (qScore / 10) * weights.w_quality;
        reasons.push(`Room quality: ${qScore.toFixed(1)}/10`);

        // ── 4. Usage balance (disabled if quality < 6) ─────────
        let balScore = 0;
        if (qScore >= 6 && avgNights > 0) {
            const balRatio = Math.max(0, 1 - room.total_nights / (avgNights * 1.5));
            balScore = balRatio * weights.w_balance;
            if (balRatio > 0.5) reasons.push("✓ Less-used room (balance)");
        } else if (qScore < 6) {
            reasons.push("⚠ Low quality — balance score disabled");
        }

        // ── 5. HK status (0 → w_hk pts) ──────────────────────
        const hkRatio = calcHKScore(room.hk_status);
        const hkScore = hkRatio * weights.w_hk;
        if (room.hk_status === "approved" || room.hk_status === "cleaned")
            reasons.push("✓ Room is clean");
        else if (room.hk_status === "dirty")
            reasons.push("✗ Room is dirty");

        // ── 6. Proximity bonus (0 → W_PROXIMITY pts) ──────────
        const proxRatio = calcProximityScore(room, reservation.companion_rooms);
        const proxScore = proxRatio * W_PROXIMITY;
        if (hasCompanions) {
            if (proxRatio >= 1.0) {
                reasons.push(`✓ Adjacent to companion room (F${room.floor_number})`);
            } else if (proxRatio >= 0.5) {
                reasons.push(`✓ Near companion room within 10m (F${room.floor_number})`);
            } else if (room.floor_number !== null) {
                reasons.push(`— Different location from companion (F${room.floor_number})`);
            }
        }

        // ── ETA tiebreaker micro-bonus ─────────────────────────
        const etaBonus = etaTiebreakerBonus(room, reservation.checkin_time);
        if (etaBonus > 0) reasons.push("✓ Early checkout — ready sooner");

        const total = prefScore + bedScore + qualScore + balScore + hkScore + proxScore + etaBonus;

        scored.push({
            room_id: room.id,
            room_number: room.room_number,
            total_score: Math.round(total * 10) / 10,
            rank: 0,
            extra_charge_flag: extraCharge,
            requires_admin: false,
            breakdown: {
                preference: Math.round(prefScore * 10) / 10,
                bed: Math.round(bedScore * 10) / 10,
                quality: Math.round(qualScore * 10) / 10,
                balance: Math.round(balScore * 10) / 10,
                hk: Math.round(hkScore * 10) / 10,
                proximity: Math.round(proxScore * 10) / 10,
            },
            reasons,
        });
    }

    // Sort: admin-required last, then by score descending
    scored.sort((a, b) => {
        if (a.requires_admin && !b.requires_admin) return 1;
        if (!a.requires_admin && b.requires_admin) return -1;
        return b.total_score - a.total_score;
    });

    scored.forEach((s, i) => { s.rank = i + 1; });

    return scored;
}

// ── Default weights loader ──────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: ScoringWeights = {
    w_preference: 40,
    w_bed: 25,
    w_quality: 20,
    w_balance: 10,
    w_hk: 5,
};
