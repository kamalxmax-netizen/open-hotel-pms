"use client";

import { useEffect, useRef, useState } from "react";
import ReservationDetailPage from "./reservation-detail-page";
import DepositModal from "./deposit-modal";
import ReservationOptionsPanel from "./reservation-options-panel";
import RoomMoveModal from "./room-move-modal";
import LinkedExtensionModal from "./linked-extension-modal";
import CancelFeeModal, { CancelFeePayload } from "./cancel-fee-modal";
import { DayUseTimer } from "./dayuse-timer";
import type { LinkedStay } from "@/lib/types";
import { LinkedStayBadge } from "./linked-stay-badge";
import { Link as LinkIcon } from "lucide-react";

export type BookingSource = "walkin" | "ota" | "direct" | "agent";
type DiaryState = "available" | "due_in" | "inhouse" | "back_to_back" | "due_out";
type HousekeepingDrawerStatus = "dirty" | "in_progress" | "paused" | "cleaned" | "approved" | null;

export type RoomDrawerRoom = {
    room_id: string;
    room_number: string;
    room_type: string;
    sellable: boolean;
    closure_reason?: string | null;
    status: string;
    diary_state?: DiaryState | null;
    reservation?: {
        id: string;
        booking_code: string;
        guest_name: string;
        phone?: string | null;
        room_type_id?: string | null;
        source: BookingSource;
        checkin_date: string;
        checkout_date: string;
        checked_in_at?: string | null;
        total_price: number;
        note?: string | null;
        deposit_amount?: number | null;
        deposit_note?: string | null;
        deposit_paid_at?: string | null;
        dayuse_expires_at?: string | null;
        do_not_move_assigned_room?: boolean;
        do_not_move_reason?: string | null;
        do_not_move_room_id_snapshot?: string | null;
        do_not_move_room_number_snapshot?: string | null;
        do_not_move_set_at?: string | null;
        do_not_move_set_by?: string | null;
        linked_stay?: LinkedStay | null;
    } | null;
    is_dayuse?: boolean;
    hk_status?: string | null;
    hk_assigned_maid?: string | null;
    hk_started_at?: string | null;
    hk_finished_at?: string | null;
    hk_approved_at?: string | null;
    hk_is_no_service?: boolean;
    hk_no_service_note?: string | null;
    transfer_pickup_at?: string | null;
    transfer_type_icon?: string | null;
    transfer_status?: string | null;
    transfer_id?: string | null;
    transfer_guest_note?: string | null;
    transfer_alert_enabled?: boolean | null;
};

type DrawerHousekeepingState = {
    hk_status: HousekeepingDrawerStatus;
    hk_assigned_maid: string | null;
    hk_started_at: string | null;
    hk_finished_at: string | null;
    hk_approved_at: string | null;
    hk_is_no_service: boolean;
    hk_no_service_note: string | null;
};

function buildDrawerHousekeepingState(room: RoomDrawerRoom): DrawerHousekeepingState {
    const status = room.hk_status;
    const normalizedStatus: HousekeepingDrawerStatus =
        status === "dirty" ||
        status === "in_progress" ||
        status === "paused" ||
        status === "cleaned" ||
        status === "approved"
            ? status
            : null;

    return {
        hk_status: normalizedStatus,
        hk_assigned_maid: room.hk_assigned_maid ?? null,
        hk_started_at: room.hk_started_at ?? null,
        hk_finished_at: room.hk_finished_at ?? null,
        hk_approved_at: room.hk_approved_at ?? null,
        hk_is_no_service: room.hk_is_no_service ?? false,
        hk_no_service_note: room.hk_no_service_note ?? null,
    };
}

const STATUS_LABEL: Record<string, string> = {
    available: "Available",
    reserved: "Reserved / In-house",
    dirty: "Dirty",
    cleaning: "Cleaning",
    approved: "Clean ✓",
    closed: "Renovation"
};

const STATUS_BADGE: Record<string, string> = {
    available: "status-available",
    reserved: "status-reserved",
    dirty: "status-dirty",
    cleaning: "status-cleaning",
    approved: "status-approved",
    closed: "status-closed"
};

const HOUSEKEEPING_LABEL: Record<string, string> = {
    dirty: "Dirty",
    in_progress: "In Progress",
    paused: "Paused",
    cleaned: "Ready (Cleaned)",
    approved: "Approved",
};

const HOUSEKEEPING_BADGE: Record<string, string> = {
    dirty: "status-dirty",
    in_progress: "status-cleaning",
    paused: "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    cleaned: "bg-lime-100 text-lime-700 border border-lime-200 dark:bg-lime-500/10 dark:text-lime-400 dark:border-lime-500/20",
    approved: "status-approved",
};

const TRANSFER_STATUS_LABEL: Record<string, string> = {
    pending: "Pending",
    confirmed: "Confirmed",
    driver_assigned: "Driver Assigned",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "No Show",
};

const TRANSFER_STATUS_BADGE: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    confirmed: "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20",
    driver_assigned: "bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20",
    in_progress: "bg-green-100 text-green-700 border border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20",
    completed: "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
    cancelled: "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
    no_show: "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] border border-[var(--border-default)]",
};

const SOURCE_LABEL: Record<string, string> = {
    walkin: "Walk-in",
    ota: "OTA",
    direct: "Direct",
    agent: "Agent"
};

function fmt(n: number) {
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toLocaleString("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function fmtBangkokDateTime(value: string | null | undefined) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
    }).format(d);
}

function canToggleTransferAlertNow(pickupAt: string | null | undefined) {
    if (!pickupAt) return false;
    const pickupMs = new Date(pickupAt).getTime();
    if (Number.isNaN(pickupMs)) return false;
    return Date.now() >= pickupMs - 30 * 60 * 1000;
}

function earliestToggleTransferAlertAt(pickupAt: string | null | undefined) {
    if (!pickupAt) return "—";
    const pickupMs = new Date(pickupAt).getTime();
    if (Number.isNaN(pickupMs)) return "—";
    return fmtBangkokDateTime(new Date(pickupMs - 30 * 60 * 1000).toISOString());
}

function getThailandDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
    return `${year}-${month}-${day}`;
}

interface RoomDrawerProps {
    room: RoomDrawerRoom;
    onClose: () => void;
    onRefresh: () => void;
    onDayUseCheckin?: (payload: { room_id: string; room_number: string }) => void;
}

type InlineReservationAlert = {
    id: string;
    message: string;
    severity: "info" | "warning" | "critical";
    created_at: string | null;
    icon?: string | null;
};

export default function RoomDrawer({ room, onClose, onRefresh, onDayUseCheckin }: RoomDrawerProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [detailMode, setDetailMode] = useState<"create" | "edit" | "checkin" | "inhouse" | "checkout" | null>(null);
    const [activeDetailResId, setActiveDetailResId] = useState<string | null>(null);
    const [showDepositModal, setShowDepositModal] = useState(false);
    const [showOptionsPanel, setShowOptionsPanel] = useState(false);
    const [showMoveRoomModal, setShowMoveRoomModal] = useState(false);
    const [showLinkedExtensionModal, setShowLinkedExtensionModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [transferAlertToggleLoading, setTransferAlertToggleLoading] = useState(false);
    const [transferAlertEnabledLocal, setTransferAlertEnabledLocal] = useState(room.transfer_alert_enabled !== false);
    const [hkView, setHkView] = useState<DrawerHousekeepingState>(() => buildDrawerHousekeepingState(room));
    const [hkActionLoading, setHkActionLoading] = useState<"dirty" | "no_service" | null>(null);
    const [showNoServiceBox, setShowNoServiceBox] = useState(false);
    const [noServiceNoteInput, setNoServiceNoteInput] = useState("");
    const [showLockEditor, setShowLockEditor] = useState(false);
    const [lockReasonInput, setLockReasonInput] = useState("");
    const [lockLoading, setLockLoading] = useState(false);
    const [folioSummary, setFolioSummary] = useState<{
        deposit_amount: number;
        total_paid: number;
        total_refunded: number;
        balance_due: number;
    } | null>(null);
    const [folioLoading, setFolioLoading] = useState(false);
    const [folioRefreshToken, setFolioRefreshToken] = useState(0);
    const [plannedMoveCount, setPlannedMoveCount] = useState(0);
    const [plannedMoveLockedCount, setPlannedMoveLockedCount] = useState(0);
    const [showCancelFeeModal, setShowCancelFeeModal] = useState(false);
    const [inlineAlerts, setInlineAlerts] = useState<InlineReservationAlert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [traceCount, setTraceCount] = useState(0);

    function resolveRoomDiaryLockMessage(payload: {
        error?: string;
        reason_code?: string;
        current_status?: string;
        assigned_maid_name?: string | null;
    }) {
        const maidName = payload.assigned_maid_name?.trim();
        const maidSuffix = maidName ? ` by ${maidName}` : "";
        if (payload.reason_code === "hk_task_locked_started") {
            return `Housekeeping already started${maidSuffix}. Dirty / No Service is locked.`;
        }
        if (payload.reason_code === "hk_task_locked_completed") {
            return `Housekeeping already finished${maidSuffix}. Dirty / No Service is locked.`;
        }
        if (payload.current_status === "in_progress" || payload.current_status === "paused") {
            return `Housekeeping already started${maidSuffix}. Dirty / No Service is locked.`;
        }
        if (payload.current_status === "cleaned" || payload.current_status === "approved") {
            return `Housekeeping already finished${maidSuffix}. Dirty / No Service is locked.`;
        }
        return payload.error ?? "Room housekeeping state is locked.";
    }

    // ESC to close
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (
                e.key === "Escape" &&
                !detailMode &&
                !showDepositModal &&
                !showOptionsPanel &&
                !showMoveRoomModal &&
                !showLinkedExtensionModal
            ) {
                onClose();
            }
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose, detailMode, showDepositModal, showOptionsPanel, showMoveRoomModal, showLinkedExtensionModal]);

    // Scroll lock
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    async function handleCancelClick() {
        if (!room.reservation) return;
        setShowCancelFeeModal(true);
    }

    async function executeCancel(payload: CancelFeePayload) {
        if (!room.reservation) return;
        setCancelLoading(true);
        setShowCancelFeeModal(false);
        try {
            const bodyPayload: any = { cancel_reason: payload.cancel_reason };
            if (payload.fee_amount && payload.fee_amount > 0) {
                bodyPayload.fee_amount = payload.fee_amount;
                if (payload.fee_collect_method) {
                    bodyPayload.fee_collect_method = payload.fee_collect_method;
                }
                bodyPayload.fee_note = payload.fee_note?.trim() || undefined;
            }
            if (payload.refund_method) bodyPayload.refund_method = payload.refund_method;
            if (payload.refund_note?.trim()) bodyPayload.refund_note = payload.refund_note.trim();
            const res = await fetch(`/api/bookings/${room.reservation.id}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload)
            });
            if (res.ok) {
                setMsg("Booking cancelled.");
                onRefresh();
                setTimeout(onClose, 1200);
            } else {
                const d = await res.json();
                setMsg(d.error ?? "Error cancelling.");
            }
        } finally {
            setCancelLoading(false);
        }
    }

    async function handleMarkDirtyFromDiary() {
        if (!room.room_id) return;
        if (housekeepingLocked) {
            setMsg(housekeepingLockMessage ?? "Room housekeeping state is locked.");
            return;
        }
        setHkActionLoading("dirty");
        try {
            const date = getThailandDateString();
            const res = await fetch("/api/housekeeping/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "room_diary_mark_dirty",
                    room_id: room.room_id,
                    date,
                }),
            });
            const payload = await res.json().catch(
                () =>
                    ({} as {
                        error?: string;
                        reason_code?: string;
                        current_status?: string;
                        assigned_maid_name?: string | null;
                        housekeeping?: {
                            assigned_maid_name?: string | null;
                        };
                    })
            );
            if (!res.ok) {
                setMsg(resolveRoomDiaryLockMessage(payload));
                return;
            }
            setHkView((prev) => ({
                ...prev,
                hk_status: "dirty",
                hk_assigned_maid: payload.housekeeping?.assigned_maid_name ?? prev.hk_assigned_maid,
                hk_is_no_service: false,
                hk_no_service_note: null,
                hk_started_at: null,
                hk_finished_at: null,
                hk_approved_at: null,
            }));
            setMsg("Room sent to housekeeping as Dirty.");
            onRefresh();
        } finally {
            setHkActionLoading(null);
        }
    }

    async function handleMarkNoServiceFromDiary() {
        if (!room.room_id) return;
        if (housekeepingLocked) {
            setMsg(housekeepingLockMessage ?? "Room housekeeping state is locked.");
            return;
        }
        setHkActionLoading("no_service");
        try {
            const date = getThailandDateString();
            const note = noServiceNoteInput.trim() || null;
            const res = await fetch("/api/housekeeping/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "room_diary_mark_no_service",
                    room_id: room.room_id,
                    date,
                    note,
                }),
            });
            const payload = await res.json().catch(
                () =>
                    ({} as {
                        error?: string;
                        reason_code?: string;
                        current_status?: string;
                        assigned_maid_name?: string | null;
                        housekeeping?: {
                            assigned_maid_name?: string | null;
                        };
                    })
            );
            if (!res.ok) {
                setMsg(resolveRoomDiaryLockMessage(payload));
                return;
            }
            setHkView((prev) => ({
                ...prev,
                hk_status: "dirty",
                hk_assigned_maid: payload.housekeeping?.assigned_maid_name ?? prev.hk_assigned_maid,
                hk_is_no_service: true,
                hk_no_service_note: note,
                hk_started_at: null,
                hk_finished_at: null,
                hk_approved_at: null,
            }));
            setMsg("Room marked as No Service and sent to housekeeping.");
            setShowNoServiceBox(false);
            setNoServiceNoteInput("");
            onRefresh();
        } finally {
            setHkActionLoading(null);
        }
    }

    async function handleToggleTransferAlert() {
        if (!room.transfer_id) return;
        if (!transferAlertToggleReady) {
            setMsg(`Alert switch is blocked until ${earliestToggleTransferAlertAt(room.transfer_pickup_at)}.`);
            return;
        }
        const nextValue = !transferAlertEnabledLocal;
        setTransferAlertToggleLoading(true);
        try {
            const res = await fetch(`/api/transportation/transfers/${room.transfer_id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alert_enabled: nextValue }),
            });
            const payload = await res.json().catch(() => ({} as { error?: string }));
            if (!res.ok || !payload.success) {
                setMsg(payload.error ?? "Failed to update transfer alert switch.");
                return;
            }
            const returnedValue = payload?.transfer?.alert_enabled;
            setTransferAlertEnabledLocal(
                typeof returnedValue === "boolean" ? returnedValue : nextValue
            );
            setMsg(nextValue ? "Transfer alert switched ON." : "Transfer alert switched OFF.");
            onRefresh();
        } finally {
            setTransferAlertToggleLoading(false);
        }
    }

    const res = room.reservation;
    const diaryState: DiaryState = room.diary_state ?? (res ? "inhouse" : "available");
    const canCheckIn = Boolean(res && diaryState === "due_in");
    const canCheckOut = Boolean(res && (diaryState === "due_out" || diaryState === "back_to_back"));
    const canCancel = Boolean(res && diaryState === "due_in");
    const canInHouseActions = Boolean(res && (diaryState === "inhouse" || diaryState === "due_out" || diaryState === "back_to_back"));
    const canOptions = Boolean(res);
    const canMoveRoom = Boolean(canInHouseActions && res?.room_type_id);
    const canManageDeposit = Boolean(res?.checked_in_at);
    const canControlTransferAlert =
        Boolean(room.transfer_id) &&
        (room.transfer_status === "pending" ||
            room.transfer_status === "confirmed" ||
            room.transfer_status === "driver_assigned");
    const housekeepingLocked =
        hkView.hk_status === "in_progress" ||
        hkView.hk_status === "paused" ||
        hkView.hk_status === "cleaned" ||
        hkView.hk_status === "approved" ||
        Boolean(hkView.hk_finished_at) ||
        Boolean(hkView.hk_approved_at);
    const housekeepingStartedLocked =
        hkView.hk_status === "in_progress" || hkView.hk_status === "paused";
    const housekeepingLockMessage = housekeepingLocked
        ? housekeepingStartedLocked
            ? `Housekeeping already started${hkView.hk_assigned_maid ? ` by ${hkView.hk_assigned_maid}` : ""}. Dirty / No Service is locked.`
            : `Housekeeping already finished${hkView.hk_assigned_maid ? ` by ${hkView.hk_assigned_maid}` : ""}. Dirty / No Service is locked.`
        : null;
    const disableInHouseControls = hkActionLoading !== null || housekeepingLocked;
    const transferAlertEnabled = transferAlertEnabledLocal;
    const transferAlertToggleReady = canToggleTransferAlertNow(room.transfer_pickup_at);
    const editMode: "edit" | "inhouse" = diaryState === "due_in" ? "edit" : "inhouse";
    const linkedStay = res?.linked_stay ?? null;
    const displayCheckinDate = linkedStay?.full_checkin ?? res?.checkin_date ?? "";
    const displayCheckoutDate = linkedStay?.full_checkout ?? res?.checkout_date ?? "";
    const nights = linkedStay?.full_nights ?? (
        res
            ? Math.round(
                (new Date(res.checkout_date).getTime() - new Date(res.checkin_date).getTime()) /
                86400000
            )
            : 0
    );
    const stayTotalPrice = linkedStay?.combined_total ?? res?.total_price ?? 0;
    const depositHeld = Number(folioSummary?.deposit_amount ?? res?.deposit_amount ?? 0);
    const balanceDue = Number(folioSummary?.balance_due ?? res?.total_price ?? 0);

    useEffect(() => {
        setHkView(buildDrawerHousekeepingState(room));
    }, [
        room.room_id,
        room.hk_status,
        room.hk_assigned_maid,
        room.hk_started_at,
        room.hk_finished_at,
        room.hk_approved_at,
        room.hk_is_no_service,
        room.hk_no_service_note,
    ]);

    useEffect(() => {
        if (!res?.id) {
            setFolioSummary(null);
            return;
        }
        let cancelled = false;
        setFolioLoading(true);
        fetch(`/api/bookings/${res.id}/pre-checkout`, { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => {
                if (cancelled || !d?.success) return;
                setFolioSummary({
                    deposit_amount: Number(d.deposit_amount ?? 0),
                    total_paid: Number(d.total_paid ?? 0),
                    total_refunded: Number(d.total_refunded ?? 0),
                    balance_due: Number(d.balance_due ?? 0)
                });
            })
            .catch(() => {
                if (!cancelled) setFolioSummary(null);
            })
            .finally(() => {
                if (!cancelled) setFolioLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [res?.id, folioRefreshToken]);

    useEffect(() => {
        if (!res?.id) {
            setPlannedMoveCount(0);
            setPlannedMoveLockedCount(0);
            return;
        }
        let cancelled = false;
        fetch(`/api/bookings/${res.id}/planned-room-moves`, { cache: "no-store" })
            .then((response) => response.json())
            .then((payload) => {
                if (cancelled || !payload?.success) return;
                const count = Array.isArray(payload.moves)
                    ? payload.moves.filter((row: any) => row.status === "planned").length
                    : 0;
                const lockedCount = Array.isArray(payload.moves)
                    ? payload.moves.filter((row: any) => row.status === "planned" && row.do_not_move).length
                    : 0;
                setPlannedMoveCount(count);
                setPlannedMoveLockedCount(lockedCount);
            })
            .catch(() => {
                if (!cancelled) {
                    setPlannedMoveCount(0);
                    setPlannedMoveLockedCount(0);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [res?.id]);

    useEffect(() => {
        setShowNoServiceBox(false);
        setNoServiceNoteInput("");
        setHkActionLoading(null);
        setTransferAlertToggleLoading(false);
        setShowLockEditor(false);
        setLockReasonInput("");
        setLockLoading(false);
    }, [room.room_id]);

    const assignedLockActive = Boolean(res?.do_not_move_assigned_room);
    const assignedLockReason = res?.do_not_move_reason ?? null;
    const assignedLockRoomNumber = res?.do_not_move_room_number_snapshot ?? room.room_number;
    const canLockRoom = Boolean(res && res.id && room.room_id && !res.checked_in_at);

    async function handleSaveAssignedLock() {
        if (!res?.id) return;
        if (!lockReasonInput.trim()) {
            setMsg("Please enter a reason before locking this room.");
            return;
        }
        setLockLoading(true);
        try {
            const response = await fetch(`/api/bookings/${res.id}/room-lock`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: true,
                    reason: lockReasonInput.trim(),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                setMsg(payload?.error ?? "Failed to lock room.");
                return;
            }
            if (room.reservation) {
                room.reservation.do_not_move_assigned_room = true;
                room.reservation.do_not_move_reason = payload.reason ?? lockReasonInput.trim();
                room.reservation.do_not_move_room_number_snapshot = payload.room_number_snapshot ?? room.room_number;
            }
            setShowLockEditor(false);
            setLockReasonInput("");
            setMsg("Do Not Move enabled.");
            onRefresh();
        } finally {
            setLockLoading(false);
        }
    }

    async function handleUnlockAssignedLock() {
        if (!res?.id) return;
        if (!confirm("Unlock this Do Not Move room lock?")) return;
        setLockLoading(true);
        try {
            const response = await fetch(`/api/bookings/${res.id}/room-lock`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: false,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                setMsg(payload?.error ?? "Failed to unlock room.");
                return;
            }
            if (room.reservation) {
                room.reservation.do_not_move_assigned_room = false;
                room.reservation.do_not_move_reason = null;
                room.reservation.do_not_move_room_number_snapshot = null;
            }
            setMsg("Do Not Move cleared.");
            onRefresh();
        } finally {
            setLockLoading(false);
        }
    }

    useEffect(() => {
        setTransferAlertEnabledLocal(room.transfer_alert_enabled !== false);
    }, [room.room_id, room.transfer_id, room.transfer_alert_enabled]);

    useEffect(() => {
        let alive = true;
        async function loadAlerts() {
            if (!room.reservation?.id) {
                if (alive) setInlineAlerts([]);
                return;
            }
            setAlertsLoading(true);
            try {
                const res = await fetch(
                    `/api/bookings/${room.reservation.id}/alerts?surface=room_drawer`,
                    { cache: "no-store" }
                );
                const data = await res.json();
                if (!alive) return;
                if (res.ok && data.success) {
                    setInlineAlerts((data.alerts ?? []).map((alert: any) => ({
                        id: String(alert.id),
                        message: String(alert.message ?? alert.note ?? alert.alert_code ?? "Alert"),
                        severity: (alert.severity === "warning" || alert.severity === "critical") ? alert.severity : "info",
                        created_at: alert.created_at ? String(alert.created_at) : null,
                        icon: alert.icon ? String(alert.icon) : null,
                    })));
                } else {
                    setInlineAlerts([]);
                }
            } catch {
                if (alive) setInlineAlerts([]);
            } finally {
                if (alive) setAlertsLoading(false);
            }
        }
        loadAlerts();
        const timer = window.setInterval(() => {
            void loadAlerts();
        }, 15000);
        return () => {
            alive = false;
            window.clearInterval(timer);
        };
    }, [room.reservation?.id]);

    useEffect(() => {
        let alive = true;
        async function loadTraceCount() {
            if (!room.reservation?.id) {
                if (alive) setTraceCount(0);
                return;
            }
            try {
                const res = await fetch(`/api/bookings/${room.reservation.id}/traces?kind=trace`);
                const data = await res.json().catch(() => ({}));
                if (!alive) return;
                if (res.ok && data?.success) {
                    const openCount = Array.isArray(data.traces)
                        ? data.traces.filter((trace: any) => trace?.status === "open").length
                        : 0;
                    setTraceCount(openCount);
                } else {
                    setTraceCount(0);
                }
            } catch {
                if (alive) setTraceCount(0);
            }
        }
        loadTraceCount();
        return () => { alive = false; };
    }, [room.reservation?.id]);

    return (
        <>
            {/* Overlay */}
            <div
                className="drawer-overlay"
                onClick={() =>
                    !detailMode &&
                    !showDepositModal &&
                    !showOptionsPanel &&
                    !showMoveRoomModal &&
                    !showLinkedExtensionModal &&
                    onClose()
                }
            />

            {/* Panel */}
            <div ref={panelRef} className="drawer-panel">
                {/* Header */}
                <div className="drawer-header">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-[var(--text-primary)]">Room {room.room_number}</span>
                            <span className={`badge ${STATUS_BADGE[room.status] ?? "status-closed"}`}>
                                {STATUS_LABEL[room.status] ?? room.status}
                            </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{room.room_type}</p>
                    </div>
                    <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="drawer-body space-y-5">
                    {msg && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            {msg}
                        </div>
                    )}

                    {/* Renovation / Closed */}
                    {!room.sellable && (
                        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4 text-center">
                            <p className="text-sm font-semibold text-[var(--text-muted)]">🚧 Room under Renovation</p>
                            {room.closure_reason && (
                                <p className="text-xs text-[var(--text-muted)] mt-1">{room.closure_reason}</p>
                            )}
                        </div>
                    )}

                    {/* Current Reservation */}
                    {room.sellable && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                                Current Reservation
                            </h3>
                            {res?.linked_stay && (
                                <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 pt-2 text-sm dark:border-indigo-500/20 dark:bg-indigo-500/10">
                                    <div className="mb-2 flex items-center gap-2 font-semibold text-indigo-900 dark:text-indigo-300">
                                        <LinkIcon className="h-4 w-4" />
                                        Linked Stay
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                        <LinkedStayBadge segments={res.linked_stay.segments} activeSegmentId={res.linked_stay.active_segment_id || res.id} />
                                    </div>
                                    <div className="flex items-center justify-between text-xs mt-1 border-t border-indigo-200/50 pt-2 dark:border-indigo-500/20">
                                        <span className="text-indigo-700 dark:text-indigo-300">
                                            Active: {SOURCE_LABEL[res.source] ?? res.source} booking
                                        </span>
                                        {res.linked_stay.segments.find((s) => s.reservation_id !== res.id) && (
                                            <button 
                                                type="button"
                                                className="text-indigo-600 font-semibold hover:underline dark:text-indigo-400"
                                                onClick={() => {
                                                    const other = res.linked_stay!.segments.find(s => s.reservation_id !== res.id);
                                                    if (other) {
                                                        setActiveDetailResId(other.reservation_id);
                                                        setDetailMode("inhouse");
                                                    }
                                                }}
                                            >
                                                View Other →
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            {res ? (
                                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-base font-bold text-[var(--text-primary)]">{res.guest_name}</p>
                                            {res.phone && <p className="text-xs text-[var(--text-muted)]">{res.phone}</p>}
                                        </div>
                                        <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 shrink-0">
                                            {SOURCE_LABEL[res.source] ?? res.source}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2">
                                            <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase">Check-in</p>
                                            <p className="font-semibold text-[var(--text-primary)]">{displayCheckinDate}</p>
                                        </div>
                                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2">
                                            <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase">Check-out</p>
                                            <p className="font-semibold text-[var(--text-primary)]">{displayCheckoutDate}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-3">
                                        <div className="text-sm text-[var(--text-secondary)]">
                                            <span className="font-semibold text-[var(--text-primary)]">฿{fmt(stayTotalPrice)}</span>
                                            <span className="text-[var(--text-muted)]"> · {nights} night{nights !== 1 ? "s" : ""}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-[var(--text-muted)]">{res.booking_code}</span>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-[var(--text-muted)]">Deposit Held</span>
                                            <span className="font-semibold text-amber-700 dark:text-amber-500">฿{fmt(depositHeld)}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-[var(--text-muted)]">Room Balance Due</span>
                                            <span className={`font-semibold ${balanceDue > 0 ? "text-rose-700 dark:text-rose-500" : "text-emerald-700 dark:text-emerald-500"}`}>
                                                {balanceDue > 0
                                                    ? `฿${fmt(balanceDue)}`
                                                    : balanceDue < 0
                                                        ? `Credit ฿${fmt(Math.abs(balanceDue))}`
                                                        : "฿0.00"}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                                            <span>Paid / Refunded</span>
                                            <span>
                                                {folioLoading
                                                    ? "Loading..."
                                                    : `฿${fmt(Number(folioSummary?.total_paid ?? 0))} / ฿${fmt(Number(folioSummary?.total_refunded ?? 0))}`}
                                            </span>
                                        </div>
                                    </div>

                                    {room.is_dayuse && res.dayuse_expires_at && (
                                        <div className="rounded-lg border border-[var(--dayuse-border)] bg-[var(--dayuse-bg)] px-3 py-2 flex items-center justify-between">
                                            <span className="text-xs font-semibold text-[var(--dayuse-text)] uppercase tracking-widest pl-1">Remaining Time</span>
                                            <DayUseTimer expiresAt={res.dayuse_expires_at} className="bg-[var(--bg-surface)] shadow-sm" />
                                        </div>
                                    )}

                                    {res.note && (
                                        <p className="text-xs text-[var(--text-muted)] bg-amber-50 border border-amber-100 dark:bg-amber-500/5 dark:border-amber-500/20 rounded-lg px-3 py-2">
                                            📝 {res.note}
                                        </p>
                                    )}

                                    {(alertsLoading || inlineAlerts.length > 0) && (
                                        <div className="space-y-2">
                                            {alertsLoading && inlineAlerts.length === 0 ? (
                                                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
                                                    Loading alerts...
                                                </div>
                                            ) : (
                                                inlineAlerts.map((alert) => (
                                                    <div
                                                        key={alert.id}
                                                        className={`rounded-lg border px-3 py-2 text-xs ${
                                                            alert.severity === "critical"
                                                                ? "border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
                                                                : alert.severity === "warning"
                                                                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
                                                                    : "border-sky-200 bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-300"
                                                        }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <p className="font-medium">
                                                                {(alert.icon ?? "🔔")} {alert.message}
                                                            </p>
                                                            <span className="whitespace-nowrap text-[10px] opacity-70">
                                                                {alert.created_at ? fmtBangkokDateTime(alert.created_at) : "alert"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                        {assignedLockActive && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"
                                                title={assignedLockReason ?? "Assigned room is locked"}
                                            >
                                                🔒 Do Not Move
                                            </span>
                                        )}
                                        {plannedMoveLockedCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20"
                                                title="There is at least one locked planned room move"
                                            >
                                                🚫 Plan Locked
                                            </span>
                                        )}
                                    </div>

                                    {assignedLockActive && (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/20 px-3 py-3 text-sm text-rose-800 dark:text-rose-400">
                                            <p className="font-semibold">Do Not Move: Room {assignedLockRoomNumber}</p>
                                            <p className="mt-1">{assignedLockReason || "No reason provided."}</p>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--border-subtle)] mt-2">
                                        <>
                                            {canCheckIn && (
                                                <button
                                                    className="btn btn-primary btn-sm flex items-center gap-1"
                                                    onClick={() => setDetailMode("checkin")}
                                                >
                                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                                                        <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0v3.75a2.25 2.25 0 01-2.25 2.25H9.75A2.25 2.25 0 017.5 9.75V6zM3.105 11.124a.75.75 0 001.05 1.05l1.125-1.125a9.75 9.75 0 000 5.656l-1.125-1.125a.75.75 0 00-1.05 1.05l2.25 2.25a.75.75 0 001.05 0l2.25-2.25a.75.75 0 00-1.05-1.05L9 15.207V9.75a.75.75 0 00-1.5 0v5.457l-1.125-1.125a.75.75 0 00-1.05 0zM12 18.75a.75.75 0 01.75-.75h.008v.008H12.75a.75.75 0 01-.75-.75zm2.25 0a.75.75 0 01.75-.75h.008v.008h-.008a.75.75 0 01-.75-.75zm2.25 0a.75.75 0 01.75-.75h.008v.008h-.008a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                                                    </svg>
                                                    Check-in
                                                </button>
                                            )}
                                            {canCheckOut && (
                                                <button
                                                    className="btn btn-success btn-sm flex items-center gap-1"
                                                    onClick={() => setDetailMode("checkout")}
                                                >
                                                    Check-out
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-secondary btn-sm flex items-center gap-1 bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                                onClick={() => {
                                                    if (!canManageDeposit) return;
                                                    setShowDepositModal(true);
                                                }}
                                                disabled={!canManageDeposit}
                                                title={canManageDeposit ? "Manage deposit" : "Deposit locked before check-in"}
                                            >
                                                <svg className="h-3.5 w-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                                                    <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                                                    <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
                                                </svg>
                                                Deposit
                                            </button>
                                            <button
                                                className="btn btn-secondary btn-sm flex items-center gap-1"
                                                onClick={() => setDetailMode(editMode)}
                                            >
                                                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                </svg>
                                                Edit
                                            </button>
                                            {canMoveRoom && (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => setShowMoveRoomModal(true)}
                                                >
                                                    Move Room
                                                </button>
                                            )}
                                            {canLockRoom && !assignedLockActive && (
                                                <button
                                                    className="btn btn-secondary btn-sm text-rose-700 hover:bg-rose-50"
                                                    onClick={() => setShowLockEditor((value) => !value)}
                                                    disabled={lockLoading}
                                                >
                                                    🔒 Lock Room
                                                </button>
                                            )}
                                            {canLockRoom && assignedLockActive && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={handleUnlockAssignedLock}
                                                    disabled={lockLoading}
                                                >
                                                    🔓 Unlock
                                                </button>
                                            )}
                                            {res && plannedMoveCount > 0 && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => window.location.assign(`/pms/calendar?focus_reservation_id=${res.id}`)}
                                                >
                                                    View Path
                                                </button>
                                            )}
                                            {canInHouseActions && res?.source === "ota" && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setShowLinkedExtensionModal(true)}
                                                >
                                                    Extend Stay
                                                </button>
                                            )}
                                            {canOptions && (
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => setShowOptionsPanel(true)}
                                                >
                                                    ⋯ Options
                                                    {inlineAlerts.length > 0 && (
                                                        <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                                                            🔴 {inlineAlerts.length}
                                                        </span>
                                                    )}
                                                    {traceCount > 0 && (
                                                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                                                            🟠 {traceCount}
                                                        </span>
                                                    )}
                                                </button>
                                            )}
                                            {canCancel && (
                                                <button
                                                    className="btn btn-danger btn-sm"
                                                    onClick={handleCancelClick}
                                                    disabled={cancelLoading}
                                                >
                                                    {cancelLoading ? "Cancelling…" : "Cancel"}
                                                </button>
                                            )}
                                        </>
                                    </div>
                                    {showLockEditor && !assignedLockActive && (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/20 px-3 py-3 space-y-2">
                                            <p className="text-sm font-semibold text-rose-800 dark:text-rose-400">Lock Room</p>
                                            <textarea
                                                className="form-input min-h-[72px]"
                                                value={lockReasonInput}
                                                onChange={(e) => setLockReasonInput(e.target.value)}
                                                placeholder="Why must this reservation stay in this room?"
                                                disabled={lockLoading}
                                            />
                                            <div className="flex items-center justify-end gap-2">
                                                <button className="btn btn-secondary btn-sm" onClick={() => setShowLockEditor(false)} disabled={lockLoading}>
                                                    Cancel
                                                </button>
                                                <button className="btn btn-secondary btn-sm text-rose-700 hover:bg-rose-100" onClick={handleSaveAssignedLock} disabled={lockLoading || !lockReasonInput.trim()}>
                                                    {lockLoading ? "Saving..." : "Save Lock"}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {!canCheckOut && !room.is_dayuse && (
                                        <div className="space-y-1">
                                            <p className="text-[11px] text-[var(--text-muted)]">
                                                Check-out is available when this room becomes Due Out / Back-to-Back.
                                            </p>
                                            {plannedMoveCount > 0 && (
                                                <p className="text-[11px] font-medium text-indigo-600">
                                                    Planned move{plannedMoveCount !== 1 ? "s" : ""}: {plannedMoveCount}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="rounded-xl border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-6 text-center">
                                    <p className="text-sm text-[var(--text-muted)] mb-3">Room is available</p>
                                    {room.is_dayuse ? (
                                        <button
                                            className="btn btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 hover:border-emerald-700"
                                            onClick={() => {
                                                if (!onDayUseCheckin) {
                                                    setMsg("Day Use check-in is unavailable right now.");
                                                    return;
                                                }
                                                onDayUseCheckin({
                                                    room_id: room.room_id,
                                                    room_number: room.room_number,
                                                });
                                            }}
                                        >
                                            + Check-in
                                        </button>
                                    ) : (
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => setDetailMode("create")}
                                        >
                                            + New Booking
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Transfer Alert */}
                    {room.sellable && room.transfer_pickup_at && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                                Transfer Alert
                            </h3>
                            <div className="rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/20 px-4 py-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg leading-none">{room.transfer_type_icon ?? "🚗"}</span>
                                        <div>
                                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                                Pickup {fmtBangkokDateTime(room.transfer_pickup_at)}
                                            </p>
                                            {room.transfer_status && (
                                                <span className={`badge ${TRANSFER_STATUS_BADGE[room.transfer_status] ?? "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] border border-[var(--border-default)]"}`}>
                                                    {TRANSFER_STATUS_LABEL[room.transfer_status] ?? room.transfer_status}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {canControlTransferAlert && (
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`text-xs font-semibold ${transferAlertEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-[var(--text-secondary)]"}`}
                                            >
                                                Alert {transferAlertEnabled ? "ON" : "OFF"}
                                            </span>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={transferAlertEnabled}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${transferAlertEnabled ? "bg-emerald-500" : "bg-[var(--bg-muted)]"} ${transferAlertToggleLoading || !transferAlertToggleReady ? "opacity-60" : ""}`}
                                                onClick={handleToggleTransferAlert}
                                                disabled={transferAlertToggleLoading}
                                                title={
                                                    transferAlertToggleReady
                                                        ? "Toggle transfer alert ON/OFF"
                                                        : `Switch is available at ${earliestToggleTransferAlertAt(room.transfer_pickup_at)}`
                                                }
                                            >
                                                <span
                                                    className={`inline-block h-5 w-5 transform rounded-full bg-[var(--bg-surface)] transition ${transferAlertEnabled ? "translate-x-5" : "translate-x-1"}`}
                                                />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {room.transfer_guest_note && (
                                    <div className="rounded-md border border-sky-200 bg-[var(--bg-surface)] px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
                                        <p className="font-semibold">Guest Note</p>
                                        <p className="mt-1 whitespace-pre-wrap">{room.transfer_guest_note}</p>
                                    </div>
                                )}
                                {canControlTransferAlert && !transferAlertToggleReady && (
                                    <p className="text-[11px] text-sky-700 dark:text-sky-400">
                                        Alert switch is allowed 30 minutes before pickup.
                                        Earliest: {earliestToggleTransferAlertAt(room.transfer_pickup_at)}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Housekeeping Status */}
                    {room.sellable && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                                Housekeeping
                            </h3>
                            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`badge ${hkView.hk_status ? (HOUSEKEEPING_BADGE[hkView.hk_status] ?? "status-closed") : "bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-default)]"}`}>
                                            {hkView.hk_status ? (HOUSEKEEPING_LABEL[hkView.hk_status] ?? hkView.hk_status) : "No HK Task"}
                                        </span>
                                        {hkView.hk_is_no_service ? (
                                            <span className="badge bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20">No Service</span>
                                        ) : null}
                                    </div>
                                    <span className="text-xs text-[var(--text-muted)]">
                                        {hkView.hk_assigned_maid ? `Maid: ${hkView.hk_assigned_maid}` : "Unassigned"}
                                    </span>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">Started</p>
                                        <p className="font-medium text-[var(--text-secondary)]">{fmtBangkokDateTime(hkView.hk_started_at)}</p>
                                    </div>
                                    <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">Cleaned</p>
                                        <p className="font-medium text-[var(--text-secondary)]">{fmtBangkokDateTime(hkView.hk_finished_at)}</p>
                                    </div>
                                    <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-[var(--text-muted)] font-semibold">Approved</p>
                                        <p className="font-medium text-[var(--text-secondary)]">{fmtBangkokDateTime(hkView.hk_approved_at)}</p>
                                    </div>
                                </div>

                                {hkView.hk_is_no_service && hkView.hk_no_service_note && (
                                    <div className="rounded-md border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/20 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
                                        <p className="font-semibold">No Service Note</p>
                                        <p className="mt-1 whitespace-pre-wrap">{hkView.hk_no_service_note}</p>
                                    </div>
                                )}

                                {canInHouseActions && (
                                    <div className="space-y-2 border-t border-[var(--border-default)] pt-2">
                                        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">
                                            In-house Controls
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={handleMarkDirtyFromDiary}
                                                disabled={disableInHouseControls}
                                            >
                                                {hkActionLoading === "dirty" ? "Sending..." : "Mark Dirty"}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setShowNoServiceBox((prev) => !prev)}
                                                disabled={disableInHouseControls}
                                            >
                                                {showNoServiceBox ? "Close No Service" : "No Service"}
                                            </button>
                                        </div>
                                        {housekeepingLockMessage ? (
                                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                                {housekeepingLockMessage}
                                            </div>
                                        ) : null}
                                        {showNoServiceBox && (
                                            <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 space-y-2">
                                                <label className="text-[11px] font-semibold text-[var(--text-secondary)] block">
                                                    Note for maid (optional)
                                                </label>
                                                <textarea
                                                    value={noServiceNoteInput}
                                                    onChange={(e) => setNoServiceNoteInput(e.target.value)}
                                                    className="w-full rounded-md border border-[var(--border-default)] px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500"
                                                    rows={3}
                                                    placeholder="e.g. Water only, no full cleaning"
                                                    disabled={disableInHouseControls}
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => {
                                                            setShowNoServiceBox(false);
                                                            setNoServiceNoteInput("");
                                                        }}
                                                        disabled={disableInHouseControls}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary btn-sm"
                                                        onClick={handleMarkNoServiceFromDiary}
                                                        disabled={disableInHouseControls}
                                                    >
                                                        {hkActionLoading === "no_service" ? "Sending..." : "Send No Service"}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="drawer-footer">
                    <button onClick={onClose} className="btn btn-secondary w-full">
                        Close
                    </button>
                </div>
            </div>

            {/* Reservation Detail Page (stacked on top of drawer) */}
            {detailMode && (
                <ReservationDetailPage
                    mode={detailMode}
                    reservationId={activeDetailResId ?? (detailMode === "create" ? undefined : res?.id)}
                    roomNumber={room.room_number}
                    isDayUse={Boolean(room.is_dayuse)}
                    onClose={() => {
                        setDetailMode(null);
                        setActiveDetailResId(null);
                        onClose();
                    }}
                    onSuccess={() => {
                        setDetailMode(null);
                        setActiveDetailResId(null);
                        setMsg("Booking saved successfully!");
                        onRefresh();
                    }}
                />
            )}

            {showOptionsPanel && res && (
                <ReservationOptionsPanel
                    reservationId={res.id}
                    guestName={res.guest_name}
                    checkinDate={res.checkin_date}
                    checkoutDate={res.checkout_date}
                    onClose={() => {
                        setShowOptionsPanel(false);
                        onRefresh();
                    }}
                />
            )}

            {showMoveRoomModal && res && res.room_type_id && (
                <RoomMoveModal
                    reservationId={res.id}
                    currentRoomNumber={room.room_number}
                    currentRoomTypeId={String(res.room_type_id)}
                    checkinDate={res.checkin_date}
                    checkoutDate={res.checkout_date}
                    assignedLockActive={assignedLockActive}
                    assignedLockReason={assignedLockReason}
                    assignedLockRoomNumber={assignedLockRoomNumber}
                    onClose={() => setShowMoveRoomModal(false)}
                    onSuccess={() => {
                        setShowMoveRoomModal(false);
                        setMsg("Room moved successfully.");
                        onRefresh();
                    }}
                />
            )}

            {showLinkedExtensionModal && res && res.room_type_id && (
                <LinkedExtensionModal
                    reservationId={res.id}
                    guestName={res.guest_name}
                    currentCheckoutDate={res.checkout_date}
                    currentRoomTypeId={String(res.room_type_id)}
                    currentRoomNumber={room.room_number}
                    onClose={() => setShowLinkedExtensionModal(false)}
                    onSuccess={() => {
                        setShowLinkedExtensionModal(false);
                        setMsg("Linked walk-in extension created.");
                        onRefresh();
                    }}
                />
            )}

            {showDepositModal && res && (
                <DepositModal
                    reservationId={res.id}
                    bookingCode={res.booking_code}
                    guestName={res.guest_name}
                    totalPrice={res.total_price}
                    existingDeposit={res.deposit_amount}
                    existingDepositNote={res.deposit_note}
                    existingDepositPaidAt={res.deposit_paid_at}
                    onClose={() => setShowDepositModal(false)}
                    onSuccess={() => {
                        setShowDepositModal(false);
                        setMsg("Deposit updated successfully!");
                        setFolioRefreshToken((value) => value + 1);
                        onRefresh();
                    }}
                />
            )}

            <CancelFeeModal
                isOpen={showCancelFeeModal}
                reservationId={res?.id ?? ""}
                guestName={res?.guest_name || ""}
                onClose={() => setShowCancelFeeModal(false)}
                onConfirm={executeCancel}
            />
        </>
    );
}
