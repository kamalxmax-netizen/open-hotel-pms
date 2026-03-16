"use client";

import { useState, useEffect } from "react";

interface AvailableRoomSelectProps {
    roomTypeId: string;
    checkinDate: string;   // YYYY-MM-DD
    checkoutDate: string;  // YYYY-MM-DD
    excludeReservationId?: string;  // เวลา edit ต้อง exclude ตัวเอง
    value: string;         // room_id ที่เลือก
    onChange: (roomId: string, roomNumber: string) => void;
    disabled?: boolean;
    selectClassName?: string;
}

export default function AvailableRoomSelect({
    roomTypeId,
    checkinDate,
    checkoutDate,
    excludeReservationId,
    value,
    onChange,
    disabled,
    selectClassName = ""
}: AvailableRoomSelectProps) {
    const [rooms, setRooms] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        // If we don't have enough info, don't fetch yet
        if (!roomTypeId || !checkinDate || !checkoutDate) {
            setRooms([]);
            return;
        }

        let isMounted = true;
        setLoading(true);
        setError("");

        const timeoutId = setTimeout(async () => {
            try {
                let url = `/api/available-rooms?room_type_id=${roomTypeId}&checkin=${checkinDate}&checkout=${checkoutDate}`;
                if (excludeReservationId) {
                    url += `&exclude_reservation_id=${excludeReservationId}`;
                }

                const res = await fetch(url);
                const data = await res.json();

                if (isMounted) {
                    if (data.success && Array.isArray(data.rooms)) {
                        setRooms(data.rooms);

                        // if the current selected value is not in the new room list, we shouldn't necessarily force clear it 
                        // unless requested by UX, but usually the parent handles this.
                    } else {
                        setError("Failed to load rooms");
                        setRooms([]);
                    }
                }
            } catch (err) {
                if (isMounted) {
                    setError("Network error");
                    setRooms([]);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }, 300); // Debounce 300ms

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
        };
    }, [roomTypeId, checkinDate, checkoutDate, excludeReservationId]);

    return (
        <div className="relative">
            <select
                className={`form-select text-sm ${selectClassName} ${loading ? "opacity-50" : ""}`}
                value={value}
                onChange={(e) => {
                    const selectedRoom = rooms.find(r => r.id === e.target.value);
                    onChange(e.target.value, selectedRoom ? selectedRoom.room_number : "");
                }}
                disabled={disabled || loading || !roomTypeId}
            >
                <option value="">Auto-assign later</option>

                {!loading && !error && rooms.length === 0 && roomTypeId && (
                    <option value="" disabled>No rooms available</option>
                )}

                {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                        Room {r.room_number}
                    </option>
                ))}
            </select>

            {loading && (
                <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">
                    ...
                </span>
            )}
            {error && (
                <span className="text-[10px] text-red-500 mt-1 block px-1">
                    {error}
                </span>
            )}
        </div>
    );
}
