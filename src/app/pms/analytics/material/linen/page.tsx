import { Suspense } from "react";
import LinenAnalyticsClient from "./_components/LinenAnalyticsClient";

export default function LinenAnalyticsPage() {
    return (
        <Suspense fallback={<div className="p-6 a-muted text-sm">Loading linen analytics…</div>}>
            <LinenAnalyticsClient />
        </Suspense>
    );
}
