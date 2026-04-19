import { Suspense } from "react";
import AmenityAnalyticsClient from "./_components/AmenityAnalyticsClient";

export default function AmenityAnalyticsPage() {
    return (
        <Suspense fallback={<div className="p-6 a-muted text-sm">Loading amenity analytics...</div>}>
            <AmenityAnalyticsClient />
        </Suspense>
    );
}
