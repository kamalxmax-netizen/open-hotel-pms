"use client";

import { useEffect, useRef, useState } from "react";
import ReservationDetailPage from "./reservation-detail-page";
import DepositModal from "./deposit-modal";
import ReservationOptionsPanel from "./reservation-options-panel";
import RoomMoveModal from "./room-move-modal";
import LinkedExtensionModal from "./linked-extension-modal";
import CancelFeeModal, { CancelFeePayload } from "./cancel-fee-modal";
import { DayUseTimer } from "./dayuse-timer";

export type BookingSource = "walkin" | "ota" | "direct" | "agent";
type DiaryState = "available" | "due_in" | "inhouse" | "back_to_back" | "due_out";

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
    paused: "bg-amber-100 text-amber-700 border border-amber-200",
    cleaned: "bg-lime-100 text-lime-700 border border-lime-200",
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
    pending: "bg-amber-100 text-amber-700 border border-amber-200",
    confirmed: "bg-sky-100 text-sky-700 border border-sky-200",
    driver_assigned: "bg-indigo-100 text-indigo-700 border border-indigo-200",
    in_progress: "bg-green-100 text-green-700 border border-green-200",
    completed: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    cancelled: "bg-rose-100 text-rose-700 border border-rose-200",
    no_show: "bg-slate-100 text-slate-600 border border-slate-200",
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
    const [showDepositModal, setShowDepositModal] = useState(false);
    const [showOptionsPanel, setShowOptionsPanel] = useState(false);
    const [showMoveRoomModal, setShowMoveRoomModal] = useState(false);
    const [showLinkedExtensionModal, setShowLinkedExtensionModal] = useState(false);
    const [cancelLoading, setCancelLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [transferAlertToggleLoading, setTransferAlertToggleLoading] = useState(false);
    const [transferAlertEnabledLocal, setTransferAlertEnabledLocal] = useState(room.transfer_alert_enabled !== false);
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
    const [plannedMoveCount, setPlannedMoveCount] = useState(0);
    const [plannedMoveLockedCount, setPlannedMoveLockedCount] = useState(0);
    const [showCancelFeeModal, setShowCancelFeeModal] = useState(false);
    const [inlineAlerts, setInlineAlerts] = useState<InlineReservationAlert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [traceCount, setTraceCount] = useState(0);

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
            const payload = await res.json().catch(() => ({} as { error?: string }));
            if (!res.ok) {
                setMsg(payload.error ?? "Failed to mark room dirty.");
                return;
            }
            setMsg("Room sent to housekeeping as Dirty.");
            onRefresh();
        } finally {
            setHkActionLoading(null);
        }
    }

    async function handleMarkNoServiceFromDiary() {
        if (!room.room_id) return;
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
            const payload = await res.json().catch(() => ({} as { error?: string }));
            if (!res.ok) {
                setMsg(payload.error ?? "Failed to mark room No Service.");
                return;
            }
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
    const transferAlertEnabled = transferAlertEnabledLocal;
    const transferAlertToggleReady = canToggleTransferAlertNow(room.transfer_pickup_at);
    const editMode: "edit" | "inhouse" = diaryState === "due_in" ? "edit" : "inhouse";
    const nights = res
        ? Math.round(
            (new Date(res.checkout_date).getTime() - new Date(res.checkin_date).getTime()) /
            86400000
        )
        : 0;
    const depositHeld = Number(folioSummary?.deposit_amount ?? res?.deposit_amount ?? 0);
    const balanceDue = Number(folioSummary?.balance_due ?? res?.total_price ?? 0);

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
    }, [res?.id]);

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
                            <span className="text-lg font-bold text-slate-900">Room {room.room_number}</span>
                            <span className={`badge ${STATUS_BADGE[room.status] ?? "status-closed"}`}>
                                {STATUS_LABEL[room.status] ?? room.status}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{room.room_type}</p>
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
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                            <p className="text-sm font-semibold text-slate-500">🚧 Room under Renovation</p>
                            {room.closure_reason && (
                                <p className="text-xs text-slate-400 mt-1">{room.closure_reason}</p>
                            )}
                        </div>
                    )}

                    {/* Current Reservation */}
                    {room.sellable && (
                        <div>
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Current Reservation
                            </h3>
                            {res ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-base font-bold text-slate-900">{res.guest_name}</p>
                                            {res.phone && <p className="text-xs text-slate-500">{res.phone}</p>}
                                        </div>
                                        <span className="badge bg-amber-100 text-amber-700 shrink-0">
                                            {SOURCE_LABEL[res.source] ?? res.source}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                                            <p className="text-[10px] text-slate-400 font-semibold uppercase">Check-in</p>
                                            <p className="font-semibold text-slate-800">{res.checkin_date}</p>
                                        </div>
                                        <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                                            <p className="text-[10px] text-slate-400 font-semibold uppercase">Check-out</p>
                                            <p className="font-semibold text-slate-800">{res.checkout_date}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                                        <div className="text-sm text-slate-600">
                                            <span className="font-semibold text-slate-900">฿{fmt(res.total_price)}</span>
                                            <span className="text-slate-400"> · {nights} night{nights !== 1 ? "s" : ""}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-slate-400">{res.booking_code}</span>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500">Deposit Held</span>
                                            <span className="font-semibold text-amber-700">฿{fmt(depositHeld)}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500">Room Balance Due</span>
                                            <span className={`font-semibold ${balanceDue > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                                                {balanceDue > 0
                                                    ? `฿${fmt(balanceDue)}`
                                                    : balanceDue < 0
                                                        ? `Credit ฿${fmt(Math.abs(balanceDue))}`
                                                        : "฿0.00"}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                                            <span>Paid / Refunded</span>
                                            <span>
                                                {folioLoading
                                                    ? "Loading..."
                                                    : `฿${fmt(Number(folioSummary?.total_paid ?? 0))} / ฿${fmt(Number(folioSummary?.total_refunded ?? 0))}`}
                                            </span>
                                        </div>
                                    </div>

                                    {room.is_dayuse && res.dayuse_expires_at && (
                                        <div className="rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 flex items-center justify-between">
                                            <span className="text-xs font-semibold text-[#e11d48] uppercase tracking-widest pl-1">Remaining Time</span>
                                            <DayUseTimer expiresAt={res.dayuse_expires_at} className="bg-white shadow-sm" />
                                        </div>
                                    )}

                                    {res.note && (
                                        <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                            📝 {res.note}
                                        </p>
                                    )}

                                    {(alertsLoading || inlineAlerts.length > 0) && (
                                        <div className="space-y-2">
                                            {alertsLoading && inlineAlerts.length === 0 ? (
                                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">
                                                    Loading alerts...
                                                </div>
                                            ) : (
                                                inlineAlerts.map((alert) => (
                                                    <div
                                                        key={alert.id}
                                                        className={`rounded-lg border px-3 py-2 text-xs ${
                                                            alert.severity === "critical"
                                                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                                                : alert.severity === "warning"
                                                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                                                    : "border-sky-200 bg-sky-50 text-sky-800"
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
                                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700"
                                                title={assignedLockReason ?? "Assigned room is locked"}
                                            >
                                                🔒 Do Not Move
                                            </span>
                                        )}
                                        {plannedMoveLockedCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700"
                                                title="There is at least one locked planned room move"
                                            >
                                                🚫 Plan Locked
                                            </span>
                                        )}
                                    </div>

                                    {assignedLockActive && (
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                                            <p className="font-semibold">Do Not Move: Room {assignedLockRoomNumber}</p>
                                            <p className="mt-1">{assignedLockReason || "No reason provided."}</p>
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100 mt-2">
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
                                                className="btn btn-secondary btn-sm flex items-center gap-1 bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
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
                                                        <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                                            🔴 {inlineAlerts.length}
                                                        </span>
                                                    )}
                                                    {traceCount > 0 && (
                                                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
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
                                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 space-y-2">
                                            <p className="text-sm font-semibold text-rose-800">Lock Room</p>
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
                                            <p className="text-[11px] text-slate-400">
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
                                <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-6 text-center">
                                    <p className="text-sm text-slate-400 mb-3">Room is available</p>
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
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Transfer Alert
                            </h3>
                            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg leading-none">{room.transfer_type_icon ?? "🚗"}</span>
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">
                                                Pickup {fmtBangkokDateTime(room.transfer_pickup_at)}
                                            </p>
                                            {room.transfer_status && (
                                                <span className={`badge ${TRANSFER_STATUS_BADGE[room.transfer_status] ?? "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                                                    {TRANSFER_STATUS_LABEL[room.transfer_status] ?? room.transfer_status}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {canControlTransferAlert && (
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`text-xs font-semibold ${transferAlertEnabled ? "text-emerald-700" : "text-slate-600"}`}
                                            >
                                                Alert {transferAlertEnabled ? "ON" : "OFF"}
                                            </span>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={transferAlertEnabled}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${transferAlertEnabled ? "bg-emerald-500" : "bg-slate-300"} ${transferAlertToggleLoading || !transferAlertToggleReady ? "opacity-60" : ""}`}
                                                onClick={handleToggleTransferAlert}
                                                disabled={transferAlertToggleLoading}
                                                title={
                                                    transferAlertToggleReady
                                                        ? "Toggle transfer alert ON/OFF"
                                                        : `Switch is available at ${earliestToggleTransferAlertAt(room.transfer_pickup_at)}`
                                                }
                                            >
                                                <span
                                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${transferAlertEnabled ? "translate-x-5" : "translate-x-1"}`}
                                                />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {room.transfer_guest_note && (
                                    <div className="rounded-md border border-sky-200 bg-white px-3 py-2 text-xs text-sky-800">
                                        <p className="font-semibold">Guest Note</p>
                                        <p className="mt-1 whitespace-pre-wrap">{room.transfer_guest_note}</p>
                                    </div>
                                )}
                                {canControlTransferAlert && !transferAlertToggleReady && (
                                    <p className="text-[11px] text-sky-700">
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
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                Housekeeping
                            </h3>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`badge ${room.hk_status ? (HOUSEKEEPING_BADGE[room.hk_status] ?? "status-closed") : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                                            {room.hk_status ? (HOUSEKEEPING_LABEL[room.hk_status] ?? room.hk_status) : "No HK Task"}
                                        </span>
                                        {room.hk_is_no_service ? (
                                            <span className="badge bg-sky-100 text-sky-700 border border-sky-300">No Service</span>
                                        ) : null}
                                    </div>
                                    <span className="text-xs text-slate-400">
                                        {room.hk_assigned_maid ? `Maid: ${room.hk_assigned_maid}` : "Unassigned"}
                                    </span>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Started</p>
                                        <p className="font-medium text-slate-700">{fmtBangkokDateTime(room.hk_started_at)}</p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Cleaned</p>
                                        <p className="font-medium text-slate-700">{fmtBangkokDateTime(room.hk_finished_at)}</p>
                                    </div>
                                    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Approved</p>
                                        <p className="font-medium text-slate-700">{fmtBangkokDateTime(room.hk_approved_at)}</p>
                                    </div>
                                </div>

                                {room.hk_is_no_service && room.hk_no_service_note && (
                                    <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                                        <p className="font-semibold">No Service Note</p>
                                        <p className="mt-1 whitespace-pre-wrap">{room.hk_no_service_note}</p>
                                    </div>
                                )}

                                {canInHouseActions && (
                                    <div className="space-y-2 border-t border-slate-200 pt-2">
                                        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                                            In-house Controls
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={handleMarkDirtyFromDiary}
                                                disabled={hkActionLoading !== null}
                                            >
                                                {hkActionLoading === "dirty" ? "Sending..." : "Mark Dirty"}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setShowNoServiceBox((prev) => !prev)}
                                                disabled={hkActionLoading !== null}
                                            >
                                                {showNoServiceBox ? "Close No Service" : "No Service"}
                                            </button>
                                        </div>
                                        {showNoServiceBox && (
                                            <div className="rounded-md border border-slate-200 bg-white p-2 space-y-2">
                                                <label className="text-[11px] font-semibold text-slate-700 block">
                                                    Note for maid (optional)
                                                </label>
                                                <textarea
                                                    value={noServiceNoteInput}
                                                    onChange={(e) => setNoServiceNoteInput(e.target.value)}
                                                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500"
                                                    rows={3}
                                                    placeholder="e.g. Water only, no full cleaning"
                                                    disabled={hkActionLoading !== null}
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => {
                                                            setShowNoServiceBox(false);
                                                            setNoServiceNoteInput("");
                                                        }}
                                                        disabled={hkActionLoading !== null}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary btn-sm"
                                                        onClick={handleMarkNoServiceFromDiary}
                                                        disabled={hkActionLoading !== null}
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
                    reservationId={detailMode === "create" ? undefined : res?.id}
                    roomNumber={room.room_number}
                    isDayUse={Boolean(room.is_dayuse)}
                    onClose={() => {
                        setDetailMode(null);
                        onClose();
                    }}
                    onSuccess={() => {
                        setDetailMode(null);
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
