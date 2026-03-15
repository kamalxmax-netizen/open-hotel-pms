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
    const [roomTypeId, setRoomTypeId] = useState(currentRoomTypeId);
    const [roomId, setRoomId] = useState("");
    const [rooms, setRooms] = useState<RoomOption[]>([]);
    const [checkoutDate, setCheckoutDate] = useState(addDays(currentCheckoutDate, 1));
    const [extensionNights, setExtensionNights] = useState(1);
    const [copyAccompanying, setCopyAccompanying] = useState(true);
    const [copyPreferences, setCopyPreferences] = useState(true);
    const [note, setNote] = useState("");
    const [loadingMeta, setLoadingMeta] = useState(true);
    const [loadingRooms, setLoadingRooms] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    useEffect(() => {
        setExtensionNights(1);
        setCheckoutDate(addDays(currentCheckoutDate, 1));
    }, [currentCheckoutDate]);

    const extensionNightsLabel = useMemo(
        () => `${extensionNights} night${extensionNights !== 1 ? "s" : ""}`,
        [extensionNights]
    );

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
        async function loadRooms() {
            setLoadingRooms(true);
            setError("");
            try {
                const query = new URLSearchParams({
                    checkin: currentCheckoutDate,
                    checkout: checkoutDate,
                    room_type_id: roomTypeId,
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
                        room_type_id: String(row.room_type_id ?? roomTypeId),
                        room_type_name: row.room_type_name ?? row.room_type ?? row.room_types?.name_en ?? null,
                    }))
                    .filter((row: RoomOption) => Boolean(row.id && row.room_number));
                if (active) {
                    setRooms(parsed);
                    const sameRoom = parsed.find((row: RoomOption) => row.room_number === currentRoomNumber);
                    setRoomId((current) => (parsed.some((row: RoomOption) => row.id === current) ? current : sameRoom?.id ?? parsed[0]?.id ?? ""));
                }
            } catch {
                if (active) setError("Network error while loading available rooms.");
            } finally {
                if (active) setLoadingRooms(false);
            }
        }

        void loadRooms();
        return () => {
            active = false;
        };
    }, [currentCheckoutDate, checkoutDate, roomTypeId, currentRoomNumber]);

    async function handleSubmit() {
        setShowValidation(true);
        if (!roomId) {
            setError("Please select room for the extension reservation.");
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
                    room_type_id: Number(roomTypeId),
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
                    <button className="btn btn-primary flex-1" onClick={handleSubmit} disabled={saving || loadingRooms || !roomId}>
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

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Original OTA Reservation</p>
                    <p className="text-lg font-bold text-slate-900 mt-0.5">{guestName}</p>
                    <p className="text-xs text-slate-500 mt-1">Extension source will be Walk-in. Original OTA reservation remains unchanged.</p>
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
                        <label className="form-label">Room Type</label>
                            <select className="form-select" value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} disabled={loadingMeta || saving}>
                                {roomTypes.map((roomType) => (
                                    <option key={roomType.id} value={roomType.id}>
                                        {roomType.name_en}{roomType.id === currentRoomTypeId ? " (Current)" : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Room</label>
                        {loadingRooms ? (
                            <div className="h-10 rounded-lg bg-slate-100 animate-pulse" />
                        ) : rooms.length === 0 ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                                No available rooms for selected extension stay.
                            </div>
                        ) : (
                            <select
                                className="form-select"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                disabled={saving}
                                required
                                aria-invalid={showValidation && !roomId}
                            >
                                {rooms.map((room) => (
                                    <option key={room.id} value={room.id}>
                                        Room {room.room_number}{room.room_type_name ? ` · ${room.room_type_name}` : ""}
                                    </option>
                                ))}
                            </select>
                        )}
                        {showValidation && !roomId && (
                            <p className="mt-1 text-xs text-rose-600">Please select a room.</p>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-center justify-between gap-3">
                        <span>Extension nights</span>
                        <span className="font-semibold">{extensionNightsLabel}</span>
                    </div>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <input type="checkbox" checked={copyAccompanying} onChange={(e) => setCopyAccompanying(e.target.checked)} disabled={saving} />
                        Copy accompanying guests to the new reservation
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
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
