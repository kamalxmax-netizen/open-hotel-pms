export default function AmenityAnalyticsPlaceholder() {
    return (
        <div className="max-w-[1400px] mx-auto p-6 space-y-5 pb-24">
            <header>
                <div className="a-muted text-[11px] uppercase tracking-[0.2em]">Phase 68.2 · upcoming</div>
                <h1 className="text-2xl font-semibold tracking-tight mt-1">Amenity Analytics</h1>
                <p className="a-secondary text-sm mt-1">
                    Variance view for coffee, water, soap, and shampoo. Requires the FO Prepare/Return reconciliation
                    migration landing in Phase 68.2a.
                </p>
            </header>
            <div className="a-card p-6">
                <span className="a-badge a-badge-na">Not built yet</span>
                <p className="a-secondary text-sm mt-3">
                    This page reserves the route. Phase 68.2 will split coffee/water (FO reconciled) from soap/shampoo
                    (maid-tap + audit adjust) with separate accuracy badges.
                </p>
            </div>
        </div>
    );
}
