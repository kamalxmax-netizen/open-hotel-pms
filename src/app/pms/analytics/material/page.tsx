import Link from "next/link";

export default function MaterialOverviewPage() {
    return (
        <div className="max-w-[1400px] mx-auto p-6 space-y-5 pb-24">
            <header>
                <div className="a-muted text-[11px] uppercase tracking-[0.2em]">Phase 68</div>
                <h1 className="text-2xl font-semibold tracking-tight mt-1">Material Analytics</h1>
                <p className="a-secondary text-sm mt-1">
                    Choose a material type to drill into its variance view.
                </p>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Link href="/pms/analytics/material/linen" className="a-card p-5 block">
                    <div className="text-lg font-semibold">Linen</div>
                    <p className="a-secondary text-sm mt-1">Towel, bath mat, pillowcase, bed sheet, duvet cover.</p>
                    <div className="a-muted text-xs mt-3">Phase 68.1 · live</div>
                </Link>
                <Link href="/pms/analytics/material/amenity" className="a-card p-5 block">
                    <div className="text-lg font-semibold">Amenity</div>
                    <p className="a-secondary text-sm mt-1">Coffee, water, soap, shampoo.</p>
                    <div className="a-muted text-xs mt-3">Phase 68.2 · placeholder</div>
                </Link>
            </div>
        </div>
    );
}
