import { Badge } from "@/components/ui/badge";
import { StockSnapshotRow } from "@/lib/types";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  amenity: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400",
  pos: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
};

export function SnapshotTable({ 
  rows, 
  onRowClick 
}: { 
  rows: StockSnapshotRow[];
  onRowClick: (row: StockSnapshotRow) => void;
}) {
  return (
    <div className="card overflow-hidden dark:border-white/10">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3 min-w-[200px]">Product</th>
              <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Category/Mode</th>
              <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Opening</th>
              <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3 min-w-[120px]">Activity</th>
              <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Expected</th>
              <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Actual</th>
              <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Variance</th>
              <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)] dark:divide-white/10">
            {rows.map(row => {
              const isVariance = row.status === "variance";
              const tv = row.variance_main + row.variance_floor;
              
              const openStr = row.tracking_mode === "pos_main_only" 
                ? `${row.opening_main}` 
                : `${row.opening_main} M / ${row.opening_floor} F`;
                
              const actStr = [
                 row.sold_qty > 0 && `Sell: ${row.sold_qty}`,
                 row.used_qty > 0 && `Use: ${row.used_qty}`,
                 row.adjust_qty !== 0 && `Adj: ${row.adjust_qty}`,
                 row.refill_qty > 0 && `Refill: ${row.refill_qty}`,
              ].filter(Boolean).join(", ");
              
              const expStr = row.tracking_mode === "pos_main_only" 
                ? `${row.expected_closing_main}` 
                : `${row.expected_closing_main} M / ${row.expected_closing_floor} F`;

              const actualStr = row.tracking_mode === "pos_main_only" 
                ? `${row.actual_closing_main}` 
                : `${row.actual_closing_main} M / ${row.actual_closing_floor} F`;
                
              return (
                <tr 
                  key={row.product_id} 
                  className={`cursor-pointer transition-colors ${isVariance ? "bg-red-50/50 hover:bg-red-50 dark:bg-rose-500/10 dark:hover:bg-rose-500/20" : "hover:bg-[var(--bg-body)]"}`}
                  onClick={() => onRowClick(row)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{row.product_name}</p>
                      <InfoIcon className="w-4 h-4 text-[var(--text-muted)] opacity-50" />
                    </div>
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    <Badge variant="secondary" className={`text-[10px] ${CATEGORY_BADGE_CLASS[row.category] ?? ""}`}>
                      {row.category.toUpperCase()}
                    </Badge>
                    <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[120px]">
                      {row.tracking_mode}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-[var(--text-secondary)] whitespace-nowrap">
                    {openStr}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[var(--text-muted)]">
                    {actStr || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-[var(--text-secondary)] whitespace-nowrap">
                    {expStr}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[var(--text-primary)] whitespace-nowrap">
                    {actualStr}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-extrabold ${tv < 0 ? "text-red-600 dark:text-red-400" : tv > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]"}`}>
                      {tv > 0 ? `+${tv}` : tv === 0 ? "-" : tv}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isVariance ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full text-red-600 bg-red-50 dark:bg-red-500/20 dark:text-red-400">
                        <AlertTriangleIcon className="w-3 h-3" /> VARIANCE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full text-emerald-600 bg-emerald-50 dark:bg-emerald-500/20 dark:text-emerald-400">
                        <CheckCircle2Icon className="w-3 h-3" /> CLEAN
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-[var(--text-muted)]">
                  <p className="text-sm">No data matching filters</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
