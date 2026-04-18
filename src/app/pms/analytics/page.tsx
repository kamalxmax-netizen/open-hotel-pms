import { Suspense } from "react";
import AnalyticsLandingClient from "./_components/AnalyticsLandingClient";

export default function AnalyticsLandingPage() {
    return (
        <Suspense fallback={<div className="p-6 a-muted text-sm">Loading analytics…</div>}>
            <AnalyticsLandingClient />
        </Suspense>
    );
}
