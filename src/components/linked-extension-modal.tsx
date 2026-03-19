"use client";

import { useEffect, useMemo, useState } from "react";
import PmsModal from "./pms-modal";
import NightCounter from "./night-counter";
import { addDays } from "@/lib/dates";

type LinkedExtensionModalProps = {
    reservationId: string;
    guestName: string;
    currentCheckoutDate: string;
    currentRoomTypeId: string;
    currentRoomNumber: string;
    onClose: () => void;
    onSuccess: (payload: { reservation_id: string }) => void;
};

type RoomTypeOption = {
    id: string;
    name_en: string;
};

type RoomOption = {
    id: string;
    room_number: string;
    room_type_id: string;
    room_type_name?: string | null;
};

export default function LinkedExtensionModal({
    reservationId,
    guestName,
    currentCheckoutDate,
    currentRoomTypeId,
    currentRoomNumber,
    onClose,
    onSuccess,
}: LinkedExtensionModalProps) {
    const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
    const [roomId, setRoomId] = useState("");
    const [checkoutDate, setCheckoutDate] = useState(addDays(currentCheckoutDate, 1));
    const [extensionNights, setExtensionNights] = useState(1);
    const [copyAccompanying, setCopyAccompanying] = useState(true);
    const [copyPreferences, setCopyPreferences] = useState(true);
    const [note, setNote] = useState("");
    const [loadingMeta, setLoadingMeta] = useState(true);
    const [loadingRoomLock, setLoadingRoomLock] = useState(true);
    const [sameRoomAvailable, setSameRoomAvailable] = useState<boolean>(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setExtensionNights(1);
        setCheckoutDate(addDays(currentCheckoutDate, 1));
    }, [currentCheckoutDate]);

    const extensionNightsLabel = useMemo(
        () => `${extensionNights} night${extensionNights !== 1 ? "s" : ""}`,
        [extensionNights]
    );
    const currentRoomTypeName = useMemo(() => {
        const found = roomTypes.find((row) => row.id === currentRoomTypeId);
        return found?.name_en ?? `Room Type #${currentRoomTypeId}`;
    }, [roomTypes, currentRoomTypeId]);

    useEffect(() => {
        let active = true;
        async function loadMeta() {
            setLoadingMeta(true);
            try {
                const res = await fetch("/api/booking-meta");
                const payload = await res.json().catch(() => ({}));
                if (active && res.ok && payload.success && Array.isArray(payload.roomTypes)) {
                    setRoomTypes(
                        payload.roomTypes.map((row: any) => ({
                            id: String(row.id),
                            name_en: String(row.name_en ?? row.code ?? `Type ${row.id}`),
                        }))
                    );
                }
            } finally {
                if (active) setLoadingMeta(false);
            }
        }
        void loadMeta();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        async function validateLockedRoom() {
            setLoadingRoomLock(true);
            setError("");
            try {
                const query = new URLSearchParams({
                    checkin: currentCheckoutDate,
                    checkout: checkoutDate,
                    room_type_id: currentRoomTypeId,
                });
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
                    .map((row: any): RoomOption => ({
                        id: String(row.id ?? row.room_id ?? ""),
                        room_number: String(row.room_number ?? ""),
                        room_type_id: String(row.room_type_id ?? currentRoomTypeId),
                        room_type_name: row.room_type_name ?? row.room_type ?? row.room_types?.name_en ?? null,
                    }))
                    .filter((row: RoomOption) => Boolean(row.id && row.room_number));
                if (active) {
                    const normalizedCurrentRoom = String(currentRoomNumber ?? "").trim().toLowerCase();
                    const sameRoom = parsed.find(
                        (row: RoomOption) => String(row.room_number ?? "").trim().toLowerCase() === normalizedCurrentRoom
                    );
                    setRoomId(sameRoom?.id ?? "");
                    setSameRoomAvailable(Boolean(sameRoom?.id));
                }
            } catch {
                if (active) {
                    setSameRoomAvailable(false);
                    setRoomId("");
                    setError("Network error while validating current room availability.");
                }
            } finally {
                if (active) setLoadingRoomLock(false);
            }
        }

        void validateLockedRoom();
        return () => {
            active = false;
        };
    }, [currentCheckoutDate, checkoutDate, currentRoomTypeId, currentRoomNumber]);

    async function handleSubmit() {
        if (!roomId || !sameRoomAvailable) {
            setError(
                `Room ${currentRoomNumber} is not available for the selected extension date range. ` +
                "Linked extension is locked to current room/type. Use Plan Move or Move Room after extension."
            );
            return;
        }
        if (checkoutDate <= currentCheckoutDate) {
            setError("New checkout date must be after extension check-in date.");
            return;
        }

        setSaving(true);
        setError("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/linked-extension`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    checkin_date: currentCheckoutDate,
                    checkout_date: checkoutDate,
                    source: "walkin",
                    room_type_id: Number(currentRoomTypeId),
                    room_id: roomId,
                    note: note.trim() || undefined,
                    copy_accompanying: copyAccompanying,
                    copy_preferences: copyPreferences,
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok || !payload.success) {
                setError(payload.error ?? "Failed to create linked extension reservation.");
                return;
            }
            onSuccess({ reservation_id: String(payload.reservation_id) });
        } catch {
            setError("Network error.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <PmsModal
            title="Extend Stay as Walk-in"
            size="lg"
            onClose={onClose}
            footer={
                <div className="flex w-full gap-2">
                    <button className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button className="btn btn-primary flex-1" onClick={handleSubmit} disabled={saving || loadingRoomLock || !sameRoomAvailable || !roomId}>
                        {saving ? "Creating…" : "Create Linked Extension"}
                    </button>
                </div>
            }
        >
            <div className="space-y-4">
                {error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {error}
                    </div>
                )}

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] font-semibold">Original OTA Reservation</p>
                    <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{guestName}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Extension source will be Walk-in. Original OTA reservation remains unchanged.</p>
                </div>

                <div>
                    <label className="form-label">Extension Date / Nights</label>
                    <NightCounter
                        checkinDate={currentCheckoutDate}
                        checkoutDate={checkoutDate}
                        nights={extensionNights}
                        lockCheckin
                        disabled={saving}
                        onChange={(_checkin, nextCheckout, nextNights) => {
                            setCheckoutDate(nextCheckout);
                            setExtensionNights(Math.max(1, nextNights || 1));
                        }}
                    />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label className="form-label">Locked Room Type</label>
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)]">
                            {loadingMeta ? "Loading..." : currentRoomTypeName}
                        </div>
                    </div>
                    <div>
                        <label className="form-label">Locked Room</label>
                        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)]">
                            Room {currentRoomNumber}
                        </div>
                    </div>
                </div>

                <div className={`rounded-lg px-3 py-2 text-sm ${
                    loadingRoomLock
                        ? "border border-[var(--border-default)] bg-[var(--bg-body)] text-[var(--text-muted)]"
                        : sameRoomAvailable
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}>
                    {loadingRoomLock
                        ? "Validating current room availability..."
                        : sameRoomAvailable
                            ? `Room ${currentRoomNumber} is available for the selected extension stay.`
                            : `Room ${currentRoomNumber} is not available for selected extension range. Linked extension stays locked to this room/type; use Plan Move or Move Room after extension.`}
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-table-cell)]">
                    <div className="flex items-center justify-between gap-3">
                        <span>Extension nights</span>
                        <span className="font-semibold">{extensionNightsLabel}</span>
                    </div>
                </div>

                <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-table-cell)]">
                        <input type="checkbox" checked={copyAccompanying} onChange={(e) => setCopyAccompanying(e.target.checked)} disabled={saving} />
                        Copy accompanying guests to the new reservation
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-table-cell)]">
                        <input type="checkbox" checked={copyPreferences} onChange={(e) => setCopyPreferences(e.target.checked)} disabled={saving} />
                        Copy preferences / reservation notes context
                    </label>
                </div>

                <div>
                    <label className="form-label">Extension Note</label>
                    <textarea className="form-input min-h-[96px]" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="Optional note for the walk-in extension reservation" />
                </div>
            </div>
        </PmsModal>
    );
}
