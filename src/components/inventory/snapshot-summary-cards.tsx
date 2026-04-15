import { StockSnapshotSummary } from "@/lib/types";

export function SnapshotSummaryCards({ summary }: { summary: StockSnapshotSummary | null }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg bg-[var(--bg-muted)] h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="card border-l-4 border-l-slate-400 p-4 dark:bg-[var(--bg-surface)]">
        <p className="text-xs text-[var(--text-secondary)] font-medium">Total Products</p>
        <p className="text-2xl font-extrabold text-[var(--text-primary)]">{summary.total_products}</p>
      </div>
      <div className="card border-l-4 border-l-emerald-500 p-4 dark:bg-[var(--bg-surface)]">
        <p className="text-xs text-[var(--text-secondary)] font-medium">Clean</p>
        <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{summary.clean_count}</p>
      </div>
      <div className="card border-l-4 border-l-red-500 p-4 dark:bg-[var(--bg-surface)]">
        <p className="text-xs text-[var(--text-secondary)] font-medium">Variance (All)</p>
        <p className="text-2xl font-extrabold text-red-600 dark:text-red-400">{summary.variance_count}</p>
      </div>
      <div className="card border-l-4 border-l-amber-500 p-4 dark:bg-[var(--bg-surface)]">
        <p className="text-xs text-[var(--text-secondary)] font-medium">Amenity Direct Variance</p>
        <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{summary.amenity_direct_variance_count}</p>
      </div>
    </div>
  );
}
