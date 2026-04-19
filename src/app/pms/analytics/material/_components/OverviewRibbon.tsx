import { VarianceBadge } from "../../_components/VarianceBadge";
import type { MaterialBucketCounts, MaterialOverviewRibbon } from "@/lib/analytics/types";

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function BucketSplit({ counts }: { counts: MaterialBucketCounts }) {
  const items = [
    { key: "red", label: "Red", value: counts.red, className: "bg-[var(--a-accent-rose)]" },
    { key: "yellow", label: "Yellow", value: counts.yellow, className: "bg-[var(--a-accent-amber)]" },
    { key: "green", label: "Green", value: counts.green, className: "bg-[var(--a-accent-green)]" },
    { key: "na", label: "N/A", value: counts.na, className: "bg-slate-500" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--a-border)] px-2 py-1">
          <span className={`h-2 w-2 rounded-full ${item.className}`} />
          <span className="a-mono text-sm font-semibold">{item.value}</span>
          <span className="a-muted text-[10px] uppercase tracking-[0.12em]">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export function OverviewRibbon({ ribbon }: { ribbon: MaterialOverviewRibbon }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div className="a-card p-4">
        <div className="a-secondary text-xs uppercase tracking-[0.15em]">Total Alerts</div>
        <div className="a-mono text-3xl font-semibold mt-3">{compact(ribbon.total_alerts)}</div>
        <div className="a-muted text-[11px] mt-1">Across successful material groups</div>
      </div>

      <div className="a-card p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="a-secondary text-xs uppercase tracking-[0.15em]">Worst Tier</span>
          <VarianceBadge tier={ribbon.worst_tier} />
        </div>
        <div className="text-2xl font-semibold mt-3 capitalize">{ribbon.worst_tier}</div>
        <div className="a-muted text-[11px] mt-1">Dimensionless health signal</div>
      </div>

      <div className="a-card p-4">
        <div className="a-secondary text-xs uppercase tracking-[0.15em] mb-3">Bucket Split</div>
        <BucketSplit counts={ribbon.bucket_counts} />
      </div>

      <div className="a-card p-4">
        <div className="a-secondary text-xs uppercase tracking-[0.15em]">Coverage</div>
        <div className="flex items-baseline gap-2 mt-3">
          <span className="a-mono text-3xl font-semibold">{compact(ribbon.coverage_days)}</span>
          <span className="a-muted text-sm">days</span>
        </div>
        <div className="a-muted text-[11px] mt-1">Inclusive selected date range</div>
      </div>
    </div>
  );
}
