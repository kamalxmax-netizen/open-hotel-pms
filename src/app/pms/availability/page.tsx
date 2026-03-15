"use client";

import AvailabilityWidget from "@/components/availability-widget";
import { useRouter } from "next/navigation";

export default function AvailabilityPage() {
    const router = useRouter();

    function handleSelect(roomTypeId: number, roomTypeName: string, checkin: string, checkout: string) {
        const params = new URLSearchParams({
            new: "1",
            room_type_id: String(roomTypeId),
            checkin_date: checkin,
            checkout_date: checkout,
            room_type_name: roomTypeName,
        });
        router.push(`/pms/reservations?${params.toString()}`);
    }

    return (
        <div className="p-6 max-w-3xl mx-auto space-y-6 pb-16">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Room Availability</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-0.5">
                    Check availability, nightly rate, and stay total before creating a reservation.
                </p>
            </div>

            <div className="card p-6">
                <AvailabilityWidget onSelect={handleSelect} />
            </div>
        </div>
    );
}
