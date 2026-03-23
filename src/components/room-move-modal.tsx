"use client";

import { useEffect, useMemo, useState } from "react";
import PmsModal from "./pms-modal";
import { addDays } from "@/lib/dates";

type RoomMoveModalProps = {
    reservationId: string;
    currentRoomNumber: string;
    currentRoomTypeId: string;
    checkinDate?: string;
    checkoutDate: string;
    assignedLockActive?: boolean;
    assignedLockReason?: string | null;
    assignedLockRoomNumber?: string | null;
    onClose: () => void;
    onSuccess: () => void;
};

type RoomTypeOption = {
    id: string;
    name_en: string;
    sort_order?: number | null;
};

type RoomOption = {
    id: string;
    room_number: string;
    room_type_id: string;
    room_type_name?: string | null;
};

type AvailabilityRow = {
    room_type_id: number | string;
    name?: string;
    rate_per_night?: number;
    total_for_stay?: number;
};

type RateInfo = {
    name: string;
    rate_per_night: number;
    total_for_stay: number;
};

type PricingPolicy = "keep_rtc" | "reprice_grid" | "reprice_grid_discount";
type DiscountType = "percent" | "fixed";
type MoveTab = "move_now" | "plan_move";

type PlannedMove = {
    id: string;
    start_date: string;
    end_date: string;
    from_room_number?: string | null;
    to_room_type_id: number;
    to_room_id: string;
    to_room_number: string | null;
    move_reason: string;
    pricing_policy: PricingPolicy;
    discount_type: DiscountType | null;
    discount_value: number | null;
    discount_reason: string | null;
    do_not_move: boolean;
    do_not_move_note: string | null;
    status: "planned" | "executed" | "cancelled";
  };

function toLocalDate(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function toNumber(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
    return Number(value.toFixed(2));
}

function applyDiscount(value: number, discountType: DiscountType, discountValue: number): number {
    if (discountType === "percent") {
        return round2(Math.max(0, value * (1 - discountValue / 100)));
    }
    return round2(Math.max(0, value - discountValue));
}

function fmtMoney(value: number) {
    return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isDateWithinRange(date: string, startDate: string, endDate: string) {
    return date >= startDate && date < endDate;
}

function countNightsBetween(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function formatNightCount(nights: number) {
    return `${nights} night${nights !== 1 ? "s" : ""}`;
}

function policyLabel(policy: PricingPolicy) {
    if (policy === "reprice_grid") return "Rate Grid";
    if (policy === "reprice_grid_discount") return "Rate Grid + Discount";
    return "Keep RTC";
}

function buildConflictPrompt(conflicts: Array<{ booking_code?: string | null; guest_name?: string | null; room_number?: string | null; stay_dates?: string[] }>) {
    const preview = conflicts
        .slice(0, 5)
        .map((conflict) => {
            const bookingCode = conflict.booking_code ?? "Unknown booking";
            const guestName = conflict.guest_name ?? "Guest";
            const room = conflict.room_number ? `Room ${conflict.room_number}` : "Float";
            const stayRange =
                Array.isArray(conflict.stay_dates) && conflict.stay_dates.length > 0
                    ? `${conflict.stay_dates[0]} → ${conflict.stay_dates[conflict.stay_dates.length - 1]}`
                    : "future dates";
            return `• ${bookingCode} · ${guestName} · ${room} · ${stayRange}`;
        })
        .join("\n");
    const more = conflicts.length > 5 ? `\n…and ${conflicts.length - 5} more reservation(s).` : "";
    return `This change will float reservation(s) that depend on the released room.\n\n${preview}${more}\n\nConfirm and float conflicts?`;
}

function parseOverlapSegmentRange(message: string): { start: string; end: string } | null {
    const match = message.match(/segment\s+(\d{4}-\d{2}-\d{2})\s*[→-]\s*(\d{4}-\d{2}-\d{2})/u);
    if (!match) return null;
    return { start: match[1], end: match[2] };
}

function loadMetaTypes(list: any[] | undefined): RoomTypeOption[] {
    return (list ?? []).map((row) => ({
        id: String(row.id),
        name_en: String(row.name_en ?? row.code ?? `Type ${row.id}`),
        sort_order: row.sort_order ?? null,
    }));
}

export default function RoomMoveModal({
    reservationId,
    currentRoomNumber,
    currentRoomTypeId,
    checkinDate,
    checkoutDate,
    assignedLockActive = false,
    assignedLockReason = null,
    assignedLockRoomNumber = null,
    onClose,
    onSuccess,
}: RoomMoveModalProps) {
    const today = toLocalDate(new Date());
    const tomorrow = addDays(today, 1);
    const firstStayMoveDate = checkinDate ? addDays(checkinDate, 1) : tomorrow;
    const earliestPlanStart = firstStayMoveDate > tomorrow ? firstStayMoveDate : tomorrow;
    const latestPlanStart = addDays(checkoutDate, -1);
    const initialPlanEnd = countNightsBetween(earliestPlanStart, checkoutDate) > 0 ? addDays(earliestPlanStart, 1) : checkoutDate;

    const [activeTab, setActiveTab] = useState<MoveTab>("move_now");
    const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
    const [plannedMoves, setPlannedMoves] = useState<PlannedMove[]>([]);

    const [nowRoomTypeId, setNowRoomTypeId] = useState(currentRoomTypeId);
    const [nowRooms, setNowRooms] = useState<RoomOption[]>([]);
    const [nowRoomId, setNowRoomId] = useState("");
    const [nowReason, setNowReason] = useState("");
    const [nowPricingPolicy, setNowPricingPolicy] = useState<PricingPolicy>("keep_rtc");
    const [nowDiscountType, setNowDiscountType] = useState<DiscountType>("percent");
    const [nowDiscountValue, setNowDiscountValue] = useState("0");
    const [nowDiscountReason, setNowDiscountReason] = useState("");
    const [overrideAssignedNote, setOverrideAssignedNote] = useState("");
    const [overridePlannedNote, setOverridePlannedNote] = useState("");

    const [planEditingId, setPlanEditingId] = useState<string | null>(null);
    const [planStartDate, setPlanStartDate] = useState(earliestPlanStart);
    const [planEndDate, setPlanEndDate] = useState(initialPlanEnd);
    const [planRoomTypeId, setPlanRoomTypeId] = useState(currentRoomTypeId);
    const [planRooms, setPlanRooms] = useState<RoomOption[]>([]);
    const [planRoomId, setPlanRoomId] = useState("");
    const [planReason, setPlanReason] = useState("");
    const [planPricingPolicy, setPlanPricingPolicy] = useState<PricingPolicy>("keep_rtc");
    const [planDiscountType, setPlanDiscountType] = useState<DiscountType>("percent");
    const [planDiscountValue, setPlanDiscountValue] = useState("0");
    const [planDiscountReason, setPlanDiscountReason] = useState("");
    const [planDoNotMove, setPlanDoNotMove] = useState(false);
    const [planDoNotMoveNote, setPlanDoNotMoveNote] = useState("");
    const [planOverrideNote, setPlanOverrideNote] = useState("");

    const [ratesByType, setRatesByType] = useState<Record<string, RateInfo>>({});
    const [planRatesByType, setPlanRatesByType] = useState<Record<string, RateInfo>>({});

    const [loadingMeta, setLoadingMeta] = useState(true);
    const [loadingNowRooms, setLoadingNowRooms] = useState(true);
    const [loadingPlanRooms, setLoadingPlanRooms] = useState(false);
    const [loadingMoves, setLoadingMoves] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saveNotice, setSaveNotice] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    const effectiveTodayMove = useMemo(
        () => plannedMoves.find((row) => row.status === "planned" && isDateWithinRange(today, row.start_date, row.end_date)) ?? null,
        [plannedMoves, today]
    );

    const futurePlannedMoves = useMemo(
        () => plannedMoves.filter((row) => row.status === "planned"),
        [plannedMoves]
    );

    const nowSelectedRoom = useMemo(
        () => nowRooms.find((room) => room.id === nowRoomId) ?? null,
        [nowRooms, nowRoomId]
    );
    const planSelectedRoom = useMemo(
        () => planRooms.find((room) => room.id === planRoomId) ?? null,
        [planRooms, planRoomId]
    );

    const nowRemainingNights = useMemo(() => {
        const start = new Date(`${today}T00:00:00`);
        const end = new Date(`${checkoutDate}T00:00:00`);
        return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    }, [today, checkoutDate]);

    const clampedPlanStartDate = useMemo(() => {
        if (!planStartDate) return earliestPlanStart;
        if (planStartDate < earliestPlanStart) return earliestPlanStart;
        if (planStartDate > latestPlanStart) return latestPlanStart;
        return planStartDate;
    }, [planStartDate, earliestPlanStart, latestPlanStart]);

    const clampedPlanEndDate = useMemo(() => {
        const minimumEnd = addDays(clampedPlanStartDate, 1);
        if (!planEndDate) return minimumEnd > checkoutDate ? checkoutDate : minimumEnd;
        if (planEndDate <= clampedPlanStartDate) return minimumEnd > checkoutDate ? checkoutDate : minimumEnd;
        if (planEndDate > checkoutDate) return checkoutDate;
        return planEndDate;
    }, [planEndDate, clampedPlanStartDate, checkoutDate]);

    const planRemainingNights = useMemo(() => {
        if (!clampedPlanStartDate || !clampedPlanEndDate) return 0;
        return countNightsBetween(clampedPlanStartDate, clampedPlanEndDate);
    }, [clampedPlanStartDate, clampedPlanEndDate]);

    useEffect(() => {
        let active = true;
        async function loadMeta() {
            setLoadingMeta(true);
            try {
                const [metaRes, rateRes] = await Promise.all([
                    fetch("/api/booking-meta"),
                    fetch(`/api/availability?checkin=${today}&checkout=${checkoutDate}`),
                ]);

                const metaJson = await metaRes.json().catch(() => ({}));
                if (active && metaRes.ok && metaJson.success && Array.isArray(metaJson.roomTypes)) {
                    setRoomTypes(loadMetaTypes(metaJson.roomTypes));
                }

                const rateJson = await rateRes.json().catch(() => ({}));
                if (active && rateRes.ok && rateJson.success && Array.isArray(rateJson.availability)) {
                    const nextMap: Record<string, RateInfo> = {};
                    for (const row of rateJson.availability as AvailabilityRow[]) {
                        const key = String(row.room_type_id);
                        nextMap[key] = {
                            name: row.name ?? "",
                            rate_per_night: toNumber(row.rate_per_night),
                            total_for_stay: toNumber(row.total_for_stay),
                        };
                    }
                    setRatesByType(nextMap);
                }
            } finally {
                if (active) setLoadingMeta(false);
            }
        }

        loadMeta();
        return () => {
            active = false;
        };
    }, [today, checkoutDate]);

    useEffect(() => {
        if (activeTab !== "plan_move" || planEditingId) return;
        let nextStart = planStartDate;
        if (!nextStart || nextStart < earliestPlanStart) {
            nextStart = earliestPlanStart;
        }
        if (nextStart > latestPlanStart) {
            nextStart = latestPlanStart;
        }

        let nextEnd = planEndDate;
        const minimumEnd = addDays(nextStart, 1);
        if (!nextEnd || nextEnd <= nextStart || nextEnd < minimumEnd) {
            nextEnd = minimumEnd;
        }
        if (nextEnd > checkoutDate) {
            nextEnd = checkoutDate;
        }

        if (nextStart !== planStartDate) {
            setPlanStartDate(nextStart);
        }
        if (nextEnd !== planEndDate) {
            setPlanEndDate(nextEnd);
        }
    }, [activeTab, planEditingId, planStartDate, planEndDate, earliestPlanStart, latestPlanStart, checkoutDate]);

    async function loadPlannedMoves() {
        setLoadingMoves(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/planned-room-moves`);
            const payload = await res.json().catch(() => ({}));
            if (res.ok && payload.success) {
                setPlannedMoves((payload.moves ?? []) as PlannedMove[]);
            } else {
                setError(payload.error ?? "Failed to load planned room moves.");
            }
        } catch {
            setError("Network error while loading planned room moves.");
        } finally {
            setLoadingMoves(false);
        }
    }

    useEffect(() => {
        void loadPlannedMoves();
    }, [reservationId]);

    useEffect(() => {
        if (!effectiveTodayMove) {
            setNowRoomTypeId(currentRoomTypeId);
            return;
        }
        setNowRoomTypeId(String(effectiveTodayMove.to_room_type_id));
        setNowReason(effectiveTodayMove.move_reason);
        setNowPricingPolicy(effectiveTodayMove.pricing_policy);
        setNowDiscountType((effectiveTodayMove.discount_type ?? "percent") as DiscountType);
        setNowDiscountValue(String(effectiveTodayMove.discount_value ?? 0));
        setNowDiscountReason(effectiveTodayMove.discount_reason ?? "");
        setNowRoomId(effectiveTodayMove.to_room_id);
    }, [effectiveTodayMove, currentRoomTypeId]);

    useEffect(() => {
        let active = true;
        async function loadRooms() {
            setLoadingNowRooms(true);
            const query = new URLSearchParams({
                checkin: today,
                checkout: checkoutDate,
                room_type_id: nowRoomTypeId,
                exclude_reservation_id: reservationId,
                reservation_id: reservationId,
            });
            try {
                const res = await fetch(`/api/available-rooms?${query.toString()}`);
                const payload = await res.json().catch(() => ({}));
                const sourceList = Array.isArray(payload?.rooms)
                    ? payload.rooms
                    : Array.isArray(payload?.available_rooms)
                        ? payload.available_rooms
                        : Array.isArray(payload?.availableRooms)
                            ? payload.availableRooms
                            : [];
                const parsed = sourceList
                    .map((row: any) => ({
                        id: String(row.id ?? row.room_id ?? ""),
                        room_number: String(row.room_number ?? ""),
                        room_type_id: String(row.room_type_id ?? nowRoomTypeId),
                        room_type_name: row.room_type_name ?? row.room_type ?? row.room_types?.name_en ?? null,
                    }))
                    .filter((row: RoomOption) => row.id && row.room_number && row.room_number !== currentRoomNumber);

                if (active) {
                    const withEffective = effectiveTodayMove && !parsed.some((row: RoomOption) => row.id === effectiveTodayMove.to_room_id)
                        ? [{
                            id: effectiveTodayMove.to_room_id,
                            room_number: effectiveTodayMove.to_room_number ?? "Planned room",
                            room_type_id: String(effectiveTodayMove.to_room_type_id),
                            room_type_name: null,
                        }, ...parsed]
                        : parsed;
                    setNowRooms(withEffective);
                    if (!withEffective.some((row: RoomOption) => row.id === nowRoomId)) {
                        setNowRoomId(withEffective[0]?.id ?? effectiveTodayMove?.to_room_id ?? "");
                    }
                }
            } catch {
                if (active) setError("Network error while loading available rooms.");
            } finally {
                if (active) setLoadingNowRooms(false);
            }
        }

        void loadRooms();
        return () => {
            active = false;
        };
    }, [today, checkoutDate, nowRoomTypeId, reservationId, currentRoomNumber, effectiveTodayMove, nowRoomId]);

    useEffect(() => {
        let active = true;
        async function loadPlanRoomsAndRates() {
            if (!planStartDate || !planEndDate || planEndDate <= planStartDate) {
                setPlanRooms([]);
                setPlanRatesByType({});
                return;
            }
            setLoadingPlanRooms(true);
            const rangeCheckout = planEndDate;
            const query = new URLSearchParams({
                checkin: planStartDate,
                checkout: rangeCheckout,
                room_type_id: planRoomTypeId,
                exclude_reservation_id: reservationId,
                reservation_id: reservationId,
            });
            if (planEditingId) query.set("exclude_plan_id", planEditingId);
            try {
                const [roomRes, rateRes] = await Promise.all([
                    fetch(`/api/available-rooms?${query.toString()}`),
                    fetch(`/api/availability?checkin=${planStartDate}&checkout=${rangeCheckout}`),
                ]);
                const roomPayload = await roomRes.json().catch(() => ({}));
                const ratePayload = await rateRes.json().catch(() => ({}));

                const sourceList = Array.isArray(roomPayload?.rooms)
                    ? roomPayload.rooms
                    : Array.isArray(roomPayload?.available_rooms)
                        ? roomPayload.available_rooms
                        : Array.isArray(roomPayload?.availableRooms)
                            ? roomPayload.availableRooms
                            : [];
                const parsedRooms = sourceList
                    .map((row: any) => ({
                        id: String(row.id ?? row.room_id ?? ""),
                        room_number: String(row.room_number ?? ""),
                        room_type_id: String(row.room_type_id ?? planRoomTypeId),
                        room_type_name: row.room_type_name ?? row.room_type ?? row.room_types?.name_en ?? null,
                    }))
                    .filter((row: RoomOption) => row.id && row.room_number);

                const nextRates: Record<string, RateInfo> = {};
                if (rateRes.ok && ratePayload.success && Array.isArray(ratePayload.availability)) {
                    for (const row of ratePayload.availability as AvailabilityRow[]) {
                        const key = String(row.room_type_id);
                        nextRates[key] = {
                            name: row.name ?? "",
                            rate_per_night: toNumber(row.rate_per_night),
                            total_for_stay: toNumber(row.total_for_stay),
                        };
                    }
                }

                if (active) {
                    if (planEditingId) {
                        const editingMove = plannedMoves.find((row) => row.id === planEditingId);
                        if (editingMove && !parsedRooms.some((row: RoomOption) => row.id === editingMove.to_room_id)) {
                            parsedRooms.unshift({
                                id: editingMove.to_room_id,
                                room_number: editingMove.to_room_number ?? "Planned room",
                                room_type_id: String(editingMove.to_room_type_id),
                                room_type_name: null,
                            });
                        }
                    }
                    setPlanRooms(parsedRooms);
                    setPlanRatesByType(nextRates);
                    if (!parsedRooms.some((row: RoomOption) => row.id === planRoomId)) {
                        setPlanRoomId(parsedRooms[0]?.id ?? "");
                    }
                }
            } catch {
                if (active) setError("Network error while loading planned move options.");
            } finally {
                if (active) setLoadingPlanRooms(false);
            }
        }

        void loadPlanRoomsAndRates();
        return () => {
            active = false;
        };
    }, [planStartDate, planEndDate, planRoomTypeId, reservationId, planEditingId, plannedMoves, planRoomId]);

    const moveNowDiff = useMemo(() => {
        const currentRate = ratesByType[currentRoomTypeId];
        const nextRate = ratesByType[nowRoomTypeId];
        if (!currentRate || !nextRate) return null;
        return {
            current_total: currentRate.total_for_stay,
            next_total: nextRate.total_for_stay,
            current_per_night: currentRate.rate_per_night,
            next_per_night: nextRate.rate_per_night,
        };
    }, [ratesByType, currentRoomTypeId, nowRoomTypeId]);

    const planDiff = useMemo(() => {
        const currentRate = planRatesByType[currentRoomTypeId] ?? ratesByType[currentRoomTypeId];
        const nextRate = planRatesByType[planRoomTypeId] ?? ratesByType[planRoomTypeId];
        if (!currentRate || !nextRate) return null;
        return {
            current_total: currentRate.total_for_stay,
            next_total: nextRate.total_for_stay,
            current_per_night: currentRate.rate_per_night,
            next_per_night: nextRate.rate_per_night,
        };
    }, [planRatesByType, ratesByType, currentRoomTypeId, planRoomTypeId]);

    const moveNowPreview = useMemo(() => {
        if (!moveNowDiff) return null;
        const discount = Math.max(0, toNumber(nowDiscountValue));
        let finalTotal = round2(moveNowDiff.current_total);
        if (nowPricingPolicy === "reprice_grid") {
            finalTotal = round2(moveNowDiff.next_total);
        } else if (nowPricingPolicy === "reprice_grid_discount") {
            if (nowDiscountType === "fixed") {
                finalTotal = round2(Math.max(0, moveNowDiff.next_total - discount * nowRemainingNights));
            } else {
                finalTotal = applyDiscount(moveNowDiff.next_total, nowDiscountType, discount);
            }
        }
        return {
            finalTotal,
            delta: round2(finalTotal - moveNowDiff.current_total),
        };
    }, [moveNowDiff, nowPricingPolicy, nowDiscountType, nowDiscountValue, nowRemainingNights]);

    const planPreview = useMemo(() => {
        if (!planDiff) return null;
        const discount = Math.max(0, toNumber(planDiscountValue));
        let finalTotal = round2(planDiff.current_total);
        if (planPricingPolicy === "reprice_grid") {
            finalTotal = round2(planDiff.next_total);
        } else if (planPricingPolicy === "reprice_grid_discount") {
            if (planDiscountType === "fixed") {
                finalTotal = round2(Math.max(0, planDiff.next_total - discount * planRemainingNights));
            } else {
                finalTotal = applyDiscount(planDiff.next_total, planDiscountType, discount);
            }
        }
        return {
            finalTotal,
            delta: round2(finalTotal - planDiff.current_total),
        };
    }, [planDiff, planPricingPolicy, planDiscountType, planDiscountValue, planRemainingNights]);

    function resetPlanForm(nextStartDate?: string) {
        const boundedStart = nextStartDate
            ? nextStartDate < earliestPlanStart
                ? earliestPlanStart
                : nextStartDate > latestPlanStart
                    ? latestPlanStart
                    : nextStartDate
            : earliestPlanStart;
        const boundedEnd = countNightsBetween(boundedStart, checkoutDate) > 0 ? addDays(boundedStart, 1) : checkoutDate;
        setShowValidation(false);
        setPlanEditingId(null);
        setPlanStartDate(boundedStart);
        setPlanEndDate(boundedEnd);
        setPlanRoomTypeId(currentRoomTypeId);
        setPlanRoomId("");
        setPlanReason("");
        setPlanPricingPolicy("keep_rtc");
        setPlanDiscountType("percent");
        setPlanDiscountValue("0");
        setPlanDiscountReason("");
        setPlanDoNotMove(false);
        setPlanDoNotMoveNote("");
        setOverrideAssignedNote("");
        setPlanOverrideNote("");
    }

    function populatePlanForm(move: PlannedMove) {
        setShowValidation(false);
        setSaveNotice("");
        setActiveTab("plan_move");
        setPlanEditingId(move.id);
        setPlanStartDate(move.start_date);
        setPlanEndDate(move.end_date);
        setPlanRoomTypeId(String(move.to_room_type_id));
        setPlanRoomId(move.to_room_id);
        setPlanReason(move.move_reason);
        setPlanPricingPolicy(move.pricing_policy);
        setPlanDiscountType((move.discount_type ?? "percent") as DiscountType);
        setPlanDiscountValue(String(move.discount_value ?? 0));
        setPlanDiscountReason(move.discount_reason ?? "");
        setPlanDoNotMove(Boolean(move.do_not_move));
        setPlanDoNotMoveNote(move.do_not_move_note ?? "");
        setOverrideAssignedNote("");
        setPlanOverrideNote("");
    }

    async function handleMoveNow() {
        setShowValidation(true);
        if (effectiveTodayMove) {
            await handleExecutePlan(effectiveTodayMove.id);
            return;
        }
        if (!nowRoomId) {
            setError("Please select a new room.");
            return;
        }
        if (!nowReason.trim()) {
            setError("Please provide a reason for room move.");
            return;
        }
        const discountNumeric = Math.max(0, toNumber(nowDiscountValue));
        if (nowPricingPolicy === "reprice_grid_discount") {
            if (!(discountNumeric > 0)) {
                setError("Please enter discount value greater than 0.");
                return;
            }
            if (nowDiscountType === "percent" && discountNumeric > 100) {
                setError("Percent discount cannot exceed 100.");
                return;
            }
            if (!nowDiscountReason.trim()) {
                setError("Please provide discount reason.");
                return;
            }
        }
        if (futurePlannedMoves.length > 0 && !overridePlannedNote.trim()) {
            setError("Please provide override note before moving immediately while planned moves exist.");
            return;
        }
        if (assignedLockActive && !overrideAssignedNote.trim()) {
            setError("Please provide override note before moving a locked room.");
            return;
        }

        setSaving(true);
        setError("");
        setSaveNotice("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/move-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    new_room_id: nowRoomId,
                    reason: nowReason.trim(),
                    pricing_policy: nowPricingPolicy,
                    discount_type: nowPricingPolicy === "reprice_grid_discount" ? nowDiscountType : undefined,
                    discount_value: nowPricingPolicy === "reprice_grid_discount" ? discountNumeric : undefined,
                    discount_reason: nowPricingPolicy === "reprice_grid_discount" ? nowDiscountReason.trim() : undefined,
                    override_assigned_note: assignedLockActive ? overrideAssignedNote.trim() : undefined,
                    override_planned_note: futurePlannedMoves.length > 0 ? overridePlannedNote.trim() : undefined,
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(payload?.error ?? "Could not move room.");
                return;
            }
            onSuccess();
        } catch {
            setError("Network error.");
        } finally {
            setSaving(false);
        }
    }

    async function handleSavePlan(confirmFloatConflicts = false) {
        setShowValidation(true);
        if (!planStartDate || !planEndDate) {
            setError("Please choose planned move dates.");
            return;
        }
        if (!planRoomId) {
            setError("Please select target room.");
            return;
        }
        if (!planReason.trim()) {
            setError("Please provide move reason.");
            return;
        }
        const discountNumeric = Math.max(0, toNumber(planDiscountValue));
        if (planPricingPolicy === "reprice_grid_discount") {
            if (!(discountNumeric > 0)) {
                setError("Please enter discount value greater than 0.");
                return;
            }
            if (planDiscountType === "percent" && discountNumeric > 100) {
                setError("Percent discount cannot exceed 100.");
                return;
            }
            if (!planDiscountReason.trim()) {
                setError("Please provide discount reason.");
                return;
            }
        }
        if (planDoNotMove && !planDoNotMoveNote.trim()) {
            setError("Do Not Move requires a note.");
            return;
        }
        if (planEditingId) {
            const editing = plannedMoves.find((row) => row.id === planEditingId);
            if (editing?.do_not_move && !planOverrideNote.trim()) {
                setError("Locked planned move requires override note before editing.");
                return;
            }
        }
        if (assignedLockActive && !overrideAssignedNote.trim()) {
            setError("Please provide override note before changing a locked room.");
            return;
        }

        setSaving(true);
        setError("");
        setSaveNotice("");
        try {
            const nightLabel = formatNightCount(countNightsBetween(clampedPlanStartDate, clampedPlanEndDate));
            const body = {
                start_date: clampedPlanStartDate,
                end_date: clampedPlanEndDate,
                to_room_type_id: Number(planRoomTypeId),
                to_room_id: planRoomId,
                move_reason: planReason.trim(),
                pricing_policy: planPricingPolicy,
                discount_type: planPricingPolicy === "reprice_grid_discount" ? planDiscountType : undefined,
                discount_value: planPricingPolicy === "reprice_grid_discount" ? discountNumeric : undefined,
                discount_reason: planPricingPolicy === "reprice_grid_discount" ? planDiscountReason.trim() : undefined,
                do_not_move: planDoNotMove,
                do_not_move_note: planDoNotMove ? planDoNotMoveNote.trim() : undefined,
                override_assigned_note: assignedLockActive ? overrideAssignedNote.trim() : undefined,
                override_note: planEditingId ? planOverrideNote.trim() || undefined : undefined,
                confirm_float_conflicts: confirmFloatConflicts,
            };
            const res = await fetch(
                planEditingId
                    ? `/api/bookings/${reservationId}/planned-room-moves/${planEditingId}`
                    : `/api/bookings/${reservationId}/planned-room-moves`,
                {
                    method: planEditingId ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                }
            );
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (payload?.requires_confirmation && Array.isArray(payload?.conflicts) && !confirmFloatConflicts) {
                    const shouldContinue = window.confirm(buildConflictPrompt(payload.conflicts));
                    if (shouldContinue) {
                        await handleSavePlan(true);
                    }
                    return;
                }

                const rawError = typeof payload?.error === "string" ? payload.error : "";
                if (!planEditingId && rawError.toLowerCase().includes("planned move overlaps existing segment")) {
                    const parsedRange = parseOverlapSegmentRange(rawError);
                    const overlapLabel = parsedRange
                        ? `${parsedRange.start} -> ${parsedRange.end}`
                        : "an existing planned segment";
                    setError(
                        `This date range overlaps ${overlapLabel}. Please choose non-overlapping dates or edit that segment from the list above.`
                    );
                    return;
                }

                setError(payload.error ?? "Failed to save planned move.");
                return;
            }
            await loadPlannedMoves();
            setSaveNotice(
                `${planEditingId ? "Updated" : "Saved"} planned move: ${clampedPlanStartDate} → ${clampedPlanEndDate} (${nightLabel})${payload?.floated_conflicts ? ` · floated ${payload.floated_conflicts} dependent reservation(s)` : ""}.`
            );
            if (planEditingId) {
                resetPlanForm();
            } else {
                const nextStartCandidate = clampedPlanEndDate <= latestPlanStart ? clampedPlanEndDate : latestPlanStart;
                resetPlanForm(nextStartCandidate);
            }
        } catch {
            setError("Network error.");
        } finally {
            setSaving(false);
        }
    }

    async function handleCancelPlan(moveId: string, locked: boolean, confirmFloatConflicts = false, existingOverrideNote?: string) {
        const override_note = existingOverrideNote ?? (
            locked
                ? window.prompt("This move is locked (Do Not Move). Enter override note to cancel.", "")?.trim() ?? ""
                : ""
        );
        if (locked && !override_note) return;
        if (!confirmFloatConflicts && !window.confirm("Cancel this planned move?")) return;
        setSaving(true);
        setError("");
        setSaveNotice("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/planned-room-moves/${moveId}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    override_note: override_note || undefined,
                    confirm_float_conflicts: confirmFloatConflicts,
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (payload?.requires_confirmation && Array.isArray(payload?.conflicts) && !confirmFloatConflicts) {
                    const shouldContinue = window.confirm(buildConflictPrompt(payload.conflicts));
                    if (shouldContinue) {
                        await handleCancelPlan(moveId, locked, true, override_note);
                    }
                    return;
                }
                setError(payload.error ?? "Failed to cancel planned move.");
                return;
            }
            await loadPlannedMoves();
            if (planEditingId === moveId) resetPlanForm();
            if (payload?.floated_conflicts) {
                setSaveNotice(`Cancelled planned move and floated ${payload.floated_conflicts} dependent reservation(s).`);
            }
        } catch {
            setError("Network error.");
        } finally {
            setSaving(false);
        }
    }

    async function handleExecutePlan(moveId: string) {
        setSaving(true);
        setError("");
        setSaveNotice("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/planned-room-moves/${moveId}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(payload.error ?? "Failed to execute planned move.");
                return;
            }
            onSuccess();
        } catch {
            setError("Network error.");
        } finally {
            setSaving(false);
        }
    }

    function openCalendarFocus() {
        const url = `/pms/calendar?focus_reservation_id=${reservationId}`;
        window.location.assign(url);
    }

    const planPossible = earliestPlanStart < checkoutDate;
    const moveNowRoomInvalid = activeTab === "move_now" && showValidation && !effectiveTodayMove && !nowRoomId;
    const moveNowReasonInvalid = activeTab === "move_now" && showValidation && !effectiveTodayMove && !nowReason.trim();
    const moveNowDiscountValueInvalid =
        activeTab === "move_now" &&
        showValidation &&
        !effectiveTodayMove &&
        nowPricingPolicy === "reprice_grid_discount" &&
        !(Math.max(0, toNumber(nowDiscountValue)) > 0);
    const moveNowDiscountReasonInvalid =
        activeTab === "move_now" &&
        showValidation &&
        !effectiveTodayMove &&
        nowPricingPolicy === "reprice_grid_discount" &&
        !nowDiscountReason.trim();
    const moveNowOverrideInvalid =
        activeTab === "move_now" &&
        showValidation &&
        !effectiveTodayMove &&
        futurePlannedMoves.length > 0 &&
        !overridePlannedNote.trim();
    const moveNowAssignedOverrideInvalid =
        activeTab === "move_now" &&
        showValidation &&
        !effectiveTodayMove &&
        assignedLockActive &&
        !overrideAssignedNote.trim();

    const planRoomInvalid = activeTab === "plan_move" && showValidation && !planRoomId;
    const planReasonInvalid = activeTab === "plan_move" && showValidation && !planReason.trim();
    const planDiscountValueInvalid =
        activeTab === "plan_move" &&
        showValidation &&
        planPricingPolicy === "reprice_grid_discount" &&
        !(Math.max(0, toNumber(planDiscountValue)) > 0);
    const planDiscountReasonInvalid =
        activeTab === "plan_move" &&
        showValidation &&
        planPricingPolicy === "reprice_grid_discount" &&
        !planDiscountReason.trim();
    const planDoNotMoveNoteInvalid =
        activeTab === "plan_move" && showValidation && planDoNotMove && !planDoNotMoveNote.trim();
    const lockedMoveNeedsOverride = Boolean(planEditingId && plannedMoves.find((row) => row.id === planEditingId)?.do_not_move);
    const planOverrideInvalid = activeTab === "plan_move" && showValidation && lockedMoveNeedsOverride && !planOverrideNote.trim();
    const planAssignedOverrideInvalid =
        activeTab === "plan_move" &&
        showValidation &&
        assignedLockActive &&
        !overrideAssignedNote.trim();

    return (
        <PmsModal
            title="Move Room"
            size="lg"
            onClose={onClose}
            footer={
                <div className="flex w-full gap-2">
                    <button className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
                        Close
                    </button>
                    {activeTab === "move_now" ? (
                        <button
                            className="btn btn-primary flex-1"
                            onClick={handleMoveNow}
                            disabled={saving || loadingNowRooms || (!effectiveTodayMove && !nowSelectedRoom)}
                        >
                            {saving ? (effectiveTodayMove ? "Executing…" : "Moving…") : effectiveTodayMove ? "Execute Planned Move" : "Confirm Move"}
                        </button>
                    ) : (
                        <button
                            className="btn btn-primary flex-1"
                            onClick={() => void handleSavePlan()}
                            disabled={saving || loadingPlanRooms || !planPossible || !planSelectedRoom}
                        >
                            {saving ? "Saving…" : planEditingId ? "Update Planned Move" : "Save Planned Move"}
                        </button>
                    )}
                </div>
            }
        >
            <div className="space-y-4">
                {error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                        {error}
                    </div>
                )}
                {saveNotice && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30">
                        {saveNotice}
                    </div>
                )}

                <div className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-1">
                    <button
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${activeTab === "move_now" ? "bg-[var(--bg-surface)] text-brand-700 dark:text-indigo-400 shadow-sm" : "text-[var(--text-secondary)]"}`}
                        onClick={() => {
                            setShowValidation(false);
                            setActiveTab("move_now");
                        }}
                        type="button"
                    >
                        Move Now
                    </button>
                    <button
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${activeTab === "plan_move" ? "bg-[var(--bg-surface)] text-brand-700 dark:text-indigo-400 shadow-sm" : "text-[var(--text-secondary)]"}`}
                        onClick={() => {
                            setShowValidation(false);
                            if (!planEditingId) {
                                const nextStart = planStartDate && planStartDate >= earliestPlanStart && planStartDate <= latestPlanStart
                                    ? planStartDate
                                    : earliestPlanStart;
                                const nextEndBase = planEndDate && planEndDate > nextStart ? planEndDate : addDays(nextStart, 1);
                                const nextEnd = nextEndBase > checkoutDate ? checkoutDate : nextEndBase;
                                setPlanStartDate(nextStart);
                                setPlanEndDate(nextEnd);
                            }
                            setActiveTab("plan_move");
                        }}
                        type="button"
                    >
                        Plan Move
                    </button>
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] font-semibold">Current Room</p>
                        <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">Room {currentRoomNumber}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Stay until {checkoutDate}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="badge bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                            Planned: {futurePlannedMoves.length}
                        </span>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={openCalendarFocus}>
                            View Path in Calendar
                        </button>
                    </div>
                </div>

                {activeTab === "move_now" ? (
                    <div className="space-y-4">
                        {effectiveTodayMove && (
                            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-semibold">Planned move is effective today</p>
                                        <p className="mt-1">
                                            {effectiveTodayMove.start_date} → {effectiveTodayMove.end_date} · {formatNightCount(countNightsBetween(effectiveTodayMove.start_date, effectiveTodayMove.end_date))} · Room {effectiveTodayMove.from_room_number ?? currentRoomNumber} → Room {effectiveTodayMove.to_room_number ?? "?"}
                                        </p>
                                        <p className="text-xs text-indigo-700 mt-1">
                                            {effectiveTodayMove.move_reason} · {policyLabel(effectiveTodayMove.pricing_policy)}
                                        </p>
                                        {effectiveTodayMove.do_not_move && (
                                            <p className="text-xs font-semibold text-rose-700 mt-2">
                                                Do Not Move locked: {effectiveTodayMove.do_not_move_note || "Note required"}
                                            </p>
                                        )}
                                    </div>
                                    <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => handleExecutePlan(effectiveTodayMove.id)}>
                                        {saving ? "Executing…" : "Execute Today"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {!effectiveTodayMove && futurePlannedMoves.length > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                                This reservation already has future planned moves. If you move room immediately, those future planned segments will be cancelled. Override note is required.
                            </div>
                        )}

                        {assignedLockActive && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                                <p className="font-semibold">⚠️ Room Lock Active</p>
                                <p className="mt-1">
                                    This reservation is locked to Room {assignedLockRoomNumber ?? currentRoomNumber}
                                </p>
                                <p className="mt-1 text-xs text-rose-700">
                                    Reason: {assignedLockReason || "No reason provided"}
                                </p>
                                <div className="mt-3">
                                    <label className="form-label">Override Note</label>
                                    <textarea
                                        className="form-input min-h-[84px] dark:aria-invalid:bg-rose-500/10"
                                        value={overrideAssignedNote}
                                        onChange={(e) => setOverrideAssignedNote(e.target.value)}
                                        placeholder="Reason for overriding Do Not Move lock"
                                        disabled={saving}
                                        aria-invalid={moveNowAssignedOverrideInvalid ? "true" : "false"}
                                    />
                                    {moveNowAssignedOverrideInvalid && <p className="mt-1 text-xs text-rose-600">Override note is required.</p>}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="form-label">New Room Type</label>
                            <select className="form-select" value={nowRoomTypeId} onChange={(e) => setNowRoomTypeId(e.target.value)} disabled={loadingMeta || saving || Boolean(effectiveTodayMove)}>
                                {roomTypes.map((roomType) => (
                                    <option key={roomType.id} value={roomType.id}>
                                        {roomType.name_en}{roomType.id === currentRoomTypeId ? " (Current)" : ""}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="form-label">New Room</label>
                            {loadingNowRooms ? (
                                <div className="h-10 rounded-lg bg-[var(--bg-muted)] animate-pulse" />
                            ) : nowRooms.length === 0 ? (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                                    No available rooms for selected type in the remaining stay.
                                </div>
                            ) : (
                                <select
                                    className="form-input dark:aria-invalid:bg-rose-500/10 px-3 py-2"
                                    value={nowRoomId}
                                    onChange={(e) => setNowRoomId(e.target.value)}
                                    disabled={saving || Boolean(effectiveTodayMove)}
                                    aria-invalid={moveNowRoomInvalid ? "true" : "false"}
                                >
                                    {nowRooms.map((room) => (
                                        <option key={room.id} value={room.id}>
                                            Room {room.room_number}
                                            {room.room_type_name ? ` · ${room.room_type_name}` : ""}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {moveNowRoomInvalid && <p className="mt-1 text-xs text-rose-600">Please select a new room.</p>}
                        </div>

                        <div>
                            <label className="form-label">Reason</label>
                            <input
                                className="form-input dark:aria-invalid:bg-rose-500/10"
                                value={nowReason}
                                onChange={(e) => setNowReason(e.target.value)}
                                disabled={saving || Boolean(effectiveTodayMove)}
                                placeholder="e.g. upgrade, maintenance, guest request"
                                aria-invalid={moveNowReasonInvalid ? "true" : "false"}
                            />
                            {moveNowReasonInvalid && <p className="mt-1 text-xs text-rose-600">Please provide a reason.</p>}
                        </div>

                        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                            <p className="font-semibold text-[var(--text-table-cell)] mb-2 text-sm">Pricing Policy</p>
                            <div className="grid gap-2">
                                {([
                                    ["keep_rtc", "Keep RTC (Free Upgrade / Keep old price)"],
                                    ["reprice_grid", "Update RTC to Rate Grid"],
                                    ["reprice_grid_discount", "Update RTC + Discount"],
                                ] as Array<[PricingPolicy, string]>).map(([value, label]) => (
                                    <label key={value} className={`rounded-lg border px-3 py-2 text-sm cursor-pointer ${nowPricingPolicy === value ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/50" : "border-[var(--border-default)] bg-[var(--bg-surface)]"}`}>
                                        <input type="radio" className="mr-2" checked={nowPricingPolicy === value} onChange={() => setNowPricingPolicy(value)} disabled={saving || Boolean(effectiveTodayMove)} />
                                        {label}
                                    </label>
                                ))}
                            </div>

                            {nowPricingPolicy === "reprice_grid_discount" && (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    <div>
                                        <label className="form-label">Discount Type</label>
                                        <select className="form-select" value={nowDiscountType} onChange={(e) => setNowDiscountType(e.target.value === "fixed" ? "fixed" : "percent")} disabled={saving || Boolean(effectiveTodayMove)}>
                                            <option value="percent">Percent (%)</option>
                                            <option value="fixed">Fixed per night (THB)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Discount Value</label>
                                        <input
                                            className="form-input dark:aria-invalid:bg-rose-500/10"
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={nowDiscountValue}
                                            onChange={(e) => setNowDiscountValue(e.target.value)}
                                            disabled={saving || Boolean(effectiveTodayMove)}
                                            aria-invalid={moveNowDiscountValueInvalid ? "true" : "false"}
                                        />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="form-label">Discount Reason</label>
                                        <input
                                            className="form-input dark:aria-invalid:bg-rose-500/10"
                                            value={nowDiscountReason}
                                            onChange={(e) => setNowDiscountReason(e.target.value)}
                                            disabled={saving || Boolean(effectiveTodayMove)}
                                            aria-invalid={moveNowDiscountReasonInvalid ? "true" : "false"}
                                        />
                                    </div>
                                </div>
                            )}
                            {(moveNowDiscountValueInvalid || moveNowDiscountReasonInvalid) && (
                                <p className="mt-2 text-xs text-rose-600">Discount value and reason are required for discounted move.</p>
                            )}
                        </div>

                        {!effectiveTodayMove && futurePlannedMoves.length > 0 && (
                            <div>
                                <label className="form-label">Override Planned Move Note</label>
                                <textarea
                                    className="form-input min-h-[84px] dark:aria-invalid:bg-rose-500/10"
                                    value={overridePlannedNote}
                                    onChange={(e) => setOverridePlannedNote(e.target.value)}
                                    placeholder="Why are you overriding planned future room moves?"
                                    disabled={saving}
                                    aria-invalid={moveNowOverrideInvalid ? "true" : "false"}
                                />
                                {moveNowOverrideInvalid && <p className="mt-1 text-xs text-rose-600">Override note is required.</p>}
                            </div>
                        )}

                        {moveNowDiff && moveNowPreview && (
                            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-sm">
                                <p className="font-semibold text-[var(--text-table-cell)] mb-1">Rate preview (remaining {nowRemainingNights} night{nowRemainingNights !== 1 ? "s" : ""})</p>
                                <div className="grid grid-cols-2 gap-y-1 text-[var(--text-secondary)]">
                                    <span>Current room rate/night</span>
                                    <span className="text-right">฿{fmtMoney(moveNowDiff.current_per_night)}</span>
                                    <span>New room rate/night</span>
                                    <span className="text-right">฿{fmtMoney(moveNowDiff.next_per_night)}</span>
                                    <span>Current total</span>
                                    <span className="text-right">฿{fmtMoney(moveNowDiff.current_total)}</span>
                                    <span>Final total after policy</span>
                                    <span className="text-right font-semibold">฿{fmtMoney(moveNowPreview.finalTotal)}</span>
                                    <span>Delta vs current</span>
                                    <span className={`text-right font-semibold ${moveNowPreview.delta > 0 ? "text-rose-600" : moveNowPreview.delta < 0 ? "text-emerald-600" : "text-[var(--text-table-cell)]"}`}>
                                        {moveNowPreview.delta > 0 ? "+" : moveNowPreview.delta < 0 ? "-" : ""}฿{fmtMoney(Math.abs(moveNowPreview.delta))}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
                            <div className="border-b border-[var(--border-default)] px-4 py-3 flex items-center justify-between gap-3">
                                <div>
                                    <p className="font-semibold text-[var(--text-primary)]">Existing Planned Moves</p>
                                    <p className="text-xs text-[var(--text-secondary)]">Future room segments for this reservation</p>
                                </div>
                                {!planPossible && (
                                    <span className="badge bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30">Last-night stay</span>
                                )}
                            </div>
                            <div className="divide-y divide-[var(--border-subtle)]">
                                {loadingMoves ? (
                                    <div className="px-4 py-4 text-sm text-[var(--text-secondary)]">Loading planned moves…</div>
                                ) : futurePlannedMoves.length === 0 ? (
                                    <div className="px-4 py-4 text-sm text-[var(--text-secondary)]">No planned moves yet.</div>
                                ) : (
                                    futurePlannedMoves.map((move) => {
                                        const startsToday = isDateWithinRange(today, move.start_date, move.end_date);
                                        return (
                                            <div key={move.id} className="px-4 py-3 flex items-start justify-between gap-3">
                                                <div className="space-y-1 text-sm">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold text-[var(--text-primary)]">{move.start_date} → {move.end_date}</span>
                                                        <span className="text-xs font-semibold text-[var(--text-secondary)]">{formatNightCount(countNightsBetween(move.start_date, move.end_date))}</span>
                                                        <span className="text-[var(--text-muted)]">•</span>
                                                        <span className="text-[var(--text-table-cell)]">Room {move.from_room_number ?? currentRoomNumber} → Room {move.to_room_number ?? "?"}</span>
                                                        {move.do_not_move && (
                                                            <span className="badge bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30">Do Not Move</span>
                                                        )}
                                                        {startsToday && (
                                                            <span className="badge bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30">Effective Today</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[var(--text-secondary)]">{move.move_reason}</p>
                                                    <p className="text-xs text-[var(--text-secondary)]">
                                                        {policyLabel(move.pricing_policy)}{move.discount_reason ? ` · ${move.discount_reason}` : ""}
                                                    </p>
                                                    <p className="text-xs text-indigo-600">
                                                        Releases Room {move.from_room_number ?? currentRoomNumber} for reassignment during this segment.
                                                    </p>
                                                    {move.do_not_move_note && (
                                                        <p className="text-xs text-rose-700 dark:text-rose-400">Note: {move.do_not_move_note}</p>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap gap-2 justify-end">
                                                    {startsToday && (
                                                        <button className="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => handleExecutePlan(move.id)}>
                                                            Execute Today
                                                        </button>
                                                    )}
                                                    <button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={() => populatePlanForm(move)}>
                                                        Edit
                                                    </button>
                                                    <button className="btn btn-secondary btn-sm" type="button" disabled={saving} onClick={() => handleCancelPlan(move.id, move.do_not_move)}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="font-semibold text-[var(--text-primary)]">{planEditingId ? "Edit Planned Segment" : "Add Planned Segment"}</p>
                                    <p className="text-xs text-[var(--text-secondary)]">Use stay-style dates: 2026-03-09 → 2026-03-10 = 1 night. First stay night is excluded, so planning starts from the next night onward.</p>
                                </div>
                                {planEditingId && (
                                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => resetPlanForm()} disabled={saving}>
                                        Clear Form
                                    </button>
                                )}
                            </div>

                            {!planPossible ? (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                                    Planned move is not available for same-day / last-night stay.
                                </div>
                            ) : (
                                <>
                                    {assignedLockActive && (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                                            <p className="font-semibold">⚠️ Room Lock Active</p>
                                            <p className="mt-1">
                                                This reservation is locked to Room {assignedLockRoomNumber ?? currentRoomNumber}
                                            </p>
                                            <p className="mt-1 text-xs text-rose-700">
                                                Reason: {assignedLockReason || "No reason provided"}
                                            </p>
                                            <div className="mt-3">
                                                <label className="form-label">Override Note</label>
                                                <textarea
                                                    className="form-input min-h-[84px] dark:aria-invalid:bg-rose-500/10"
                                                    value={overrideAssignedNote}
                                                    onChange={(e) => setOverrideAssignedNote(e.target.value)}
                                                    placeholder="Reason for overriding Do Not Move lock"
                                                    disabled={saving}
                                                    aria-invalid={planAssignedOverrideInvalid ? "true" : "false"}
                                                />
                                                {planAssignedOverrideInvalid && <p className="mt-1 text-xs text-rose-600">Override note is required.</p>}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                                        <div>
                                            <label className="form-label">Start Date</label>
                                            <input className="form-input" type="date" min={earliestPlanStart} max={latestPlanStart} value={clampedPlanStartDate} onChange={(e) => {
                                                const next = e.target.value;
                                                setPlanStartDate(next);
                                                if (!planEndDate || planEndDate <= next) {
                                                    setPlanEndDate(addDays(next, 1) > checkoutDate ? checkoutDate : addDays(next, 1));
                                                }
                                            }} disabled={saving} />
                                        </div>
                                        <div className="hidden sm:flex items-center justify-center pb-2 text-sm font-semibold text-indigo-700 dark:text-indigo-400 whitespace-nowrap">
                                            + {formatNightCount(planRemainingNights)}
                                        </div>
                                        <div>
                                            <label className="form-label">End Date</label>
                                            <input className="form-input" type="date" min={addDays(clampedPlanStartDate, 1)} max={checkoutDate} value={clampedPlanEndDate} onChange={(e) => setPlanEndDate(e.target.value)} disabled={saving} />
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30">
                                        {clampedPlanStartDate && clampedPlanEndDate
                                            ? `${clampedPlanStartDate} → ${clampedPlanEndDate} = ${formatNightCount(planRemainingNights)}`
                                            : "Select start and end date"}
                                    </div>

                                    <div>
                                        <label className="form-label">Target Room Type</label>
                                        <select className="form-select" value={planRoomTypeId} onChange={(e) => setPlanRoomTypeId(e.target.value)} disabled={loadingMeta || saving}>
                                            {roomTypes.map((roomType) => (
                                                <option key={roomType.id} value={roomType.id}>
                                                    {roomType.name_en}{roomType.id === currentRoomTypeId ? " (Same Type)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="form-label">Target Room Number</label>
                                        {loadingPlanRooms ? (
                                            <div className="h-10 rounded-lg bg-[var(--bg-muted)] animate-pulse" />
                                        ) : planRooms.length === 0 ? (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                                                No available rooms for this plan range.
                                            </div>
                                        ) : (
                                            <select
                                                className="form-input dark:aria-invalid:bg-rose-500/10 px-3 py-2"
                                                value={planRoomId}
                                                onChange={(e) => setPlanRoomId(e.target.value)}
                                                disabled={saving}
                                                aria-invalid={planRoomInvalid ? "true" : "false"}
                                            >
                                                {planRooms.map((room) => (
                                                    <option key={room.id} value={room.id}>
                                                        Room {room.room_number}{room.room_type_name ? ` · ${room.room_type_name}` : ""}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                        {planRoomInvalid && <p className="mt-1 text-xs text-rose-600">Please select target room.</p>}
                                    </div>

                                    <div>
                                        <label className="form-label">Move Reason</label>
                                        <input
                                            className="form-input dark:aria-invalid:bg-rose-500/10"
                                            value={planReason}
                                            onChange={(e) => setPlanReason(e.target.value)}
                                            disabled={saving}
                                            placeholder="e.g. guest request, maintenance, balancing inventory"
                                            aria-invalid={planReasonInvalid ? "true" : "false"}
                                        />
                                        {planReasonInvalid && <p className="mt-1 text-xs text-rose-600">Please provide move reason.</p>}
                                    </div>

                                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                                        <p className="font-semibold text-[var(--text-table-cell)] mb-2 text-sm">Pricing Policy</p>
                                        <div className="grid gap-2">
                                            {([
                                                ["keep_rtc", "Keep RTC (Free Upgrade / Keep old price)"],
                                                ["reprice_grid", "Update RTC to Rate Grid"],
                                                ["reprice_grid_discount", "Update RTC + Discount"],
                                            ] as Array<[PricingPolicy, string]>).map(([value, label]) => (
                                                <label key={value} className={`rounded-lg border px-3 py-2 text-sm cursor-pointer ${planPricingPolicy === value ? "border-sky-400 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/50" : "border-[var(--border-default)] bg-[var(--bg-surface)]"}`}>
                                                    <input type="radio" className="mr-2" checked={planPricingPolicy === value} onChange={() => setPlanPricingPolicy(value)} disabled={saving} />
                                                    {label}
                                                </label>
                                            ))}
                                        </div>

                                        {planPricingPolicy === "reprice_grid_discount" && (
                                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                                <div>
                                                    <label className="form-label">Discount Type</label>
                                                    <select className="form-select" value={planDiscountType} onChange={(e) => setPlanDiscountType(e.target.value === "fixed" ? "fixed" : "percent")} disabled={saving}>
                                                        <option value="percent">Percent (%)</option>
                                                        <option value="fixed">Fixed per night (THB)</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="form-label">Discount Value</label>
                                                    <input
                                                        className="form-input dark:aria-invalid:bg-rose-500/10"
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        value={planDiscountValue}
                                                        onChange={(e) => setPlanDiscountValue(e.target.value)}
                                                        disabled={saving}
                                                        aria-invalid={planDiscountValueInvalid ? "true" : "false"}
                                                    />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <label className="form-label">Discount Reason</label>
                                                    <input
                                                        className="form-input dark:aria-invalid:bg-rose-500/10"
                                                        value={planDiscountReason}
                                                        onChange={(e) => setPlanDiscountReason(e.target.value)}
                                                        disabled={saving}
                                                        aria-invalid={planDiscountReasonInvalid ? "true" : "false"}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {(planDiscountValueInvalid || planDiscountReasonInvalid) && (
                                            <p className="mt-2 text-xs text-rose-600">Discount value and reason are required for discounted move.</p>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 space-y-3 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                                        <label className="flex items-center gap-2 text-sm font-semibold text-rose-800">
                                            <input type="checkbox" checked={planDoNotMove} onChange={(e) => setPlanDoNotMove(e.target.checked)} disabled={saving} />
                                            Do Not Move
                                        </label>
                                        {planDoNotMove && (
                                            <div>
                                                <label className="form-label">Do Not Move Note</label>
                                                <textarea
                                                    className="form-input min-h-[72px] dark:aria-invalid:bg-rose-500/10"
                                                    value={planDoNotMoveNote}
                                                    onChange={(e) => setPlanDoNotMoveNote(e.target.value)}
                                                    disabled={saving}
                                                    placeholder="Required. This note will also be mirrored into Reservation Notes."
                                                    aria-invalid={planDoNotMoveNoteInvalid ? "true" : "false"}
                                                />
                                                {planDoNotMoveNoteInvalid && <p className="mt-1 text-xs text-rose-600">Do Not Move note is required.</p>}
                                            </div>
                                        )}
                                        {planEditingId && plannedMoves.find((row) => row.id === planEditingId)?.do_not_move && (
                                            <div>
                                                <label className="form-label">Override Note</label>
                                                <textarea
                                                    className="form-input min-h-[72px] dark:aria-invalid:bg-rose-500/10"
                                                    value={planOverrideNote}
                                                    onChange={(e) => setPlanOverrideNote(e.target.value)}
                                                    disabled={saving}
                                                    placeholder="Required to edit locked planned move."
                                                    aria-invalid={planOverrideInvalid ? "true" : "false"}
                                                />
                                                {planOverrideInvalid && <p className="mt-1 text-xs text-rose-600">Override note is required.</p>}
                                            </div>
                                        )}
                                    </div>

                                    {planDiff && planPreview && (
                                        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-sm">
                                            <p className="font-semibold text-[var(--text-table-cell)] mb-1">Planned pricing preview ({formatNightCount(planRemainingNights)})</p>
                                            <div className="grid grid-cols-2 gap-y-1 text-[var(--text-secondary)]">
                                                <span>Current room rate/night</span>
                                                <span className="text-right">฿{fmtMoney(planDiff.current_per_night)}</span>
                                                <span>Target room rate/night</span>
                                                <span className="text-right">฿{fmtMoney(planDiff.next_per_night)}</span>
                                                <span>Current total</span>
                                                <span className="text-right">฿{fmtMoney(planDiff.current_total)}</span>
                                                <span>Planned total after policy</span>
                                                <span className="text-right font-semibold">฿{fmtMoney(planPreview.finalTotal)}</span>
                                                <span>Delta vs current</span>
                                                <span className={`text-right font-semibold ${planPreview.delta > 0 ? "text-rose-600" : planPreview.delta < 0 ? "text-emerald-600" : "text-[var(--text-table-cell)]"}`}>
                                                    {planPreview.delta > 0 ? "+" : planPreview.delta < 0 ? "-" : ""}฿{fmtMoney(Math.abs(planPreview.delta))}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </PmsModal>
    );
}
