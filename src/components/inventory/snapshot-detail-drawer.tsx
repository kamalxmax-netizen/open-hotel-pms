import { XIcon, ActivityIcon } from "lucide-react";
import { StockSnapshotRow, StockSnapshotTxEntry } from "@/lib/types";

interface SnapshotDetailDrawerProps {
  product: StockSnapshotRow | null;
  onClose: () => void;
  timeline: StockSnapshotTxEntry[];
  isLoadingTimeline: boolean;
}

export function SnapshotDetailDrawer({
  product, onClose, timeline, isLoadingTimeline
}: SnapshotDetailDrawerProps) {
  if (!product) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-[var(--bg-body)] shadow-2xl z-50 flex flex-col border-l border-[var(--border-subtle)] translate-x-0 transition-transform duration-300">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{product.product_name}</h2>
            <p className="text-xs text-[var(--text-muted)]">Category: {product.category} | Mode: {product.tracking_mode}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg-muted)] rounded-full text-[var(--text-muted)]">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {product.tracking_mode !== "pos_main_only" && product.floor_breakdown.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">Floor Breakdown</h3>
              <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                     <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] bg-[var(--bg-muted)]/30">
                       <th className="py-2 px-3 text-left font-semibold">Floor</th>
                       <th className="py-2 px-3 text-right font-semibold">Open</th>
                       <th className="py-2 px-3 text-right font-semibold">Use/Refill</th>
                       <th className="py-2 px-3 text-right font-semibold">Expected</th>
                       <th className="py-2 px-3 text-right font-semibold">Actual</th>
                       <th className="py-2 px-3 text-right font-semibold">Var.</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {product.floor_breakdown.map(f => {
                       // Note: The specific typescript type for floor breakdown properties needs to map to actual keys from the API.
                       // Looking at the mock StockSnapshotFloorBreakdown, keys are floor_number, opening, used, refilled, expected, actual, variance.
                       // Mock data uses `refilled`. Note that `adjust` might exist too.
                       const fRecord = f as any; 
                       return (
                      <tr key={fRecord.floor_number} className={fRecord.variance ? "bg-red-50/50 hover:bg-red-50 dark:bg-rose-500/10 dark:hover:bg-rose-500/20" : "hover:bg-[var(--bg-body)]"}>
                        <td className="py-2 px-3 font-semibold text-[var(--text-primary)]">Floor {fRecord.floor_number}</td>
                        <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{fRecord.opening}</td>
                        <td className="py-2 px-3 text-right text-[var(--text-muted)] text-[11px] whitespace-nowrap">
                          {(fRecord.used ? `-${fRecord.used} ` : "")} {(fRecord.refilled ? `+${fRecord.refilled}` : "")}
                        </td>
                        <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{fRecord.expected}</td>
                        <td className="py-2 px-3 text-right font-bold text-[var(--text-primary)]">{fRecord.actual}</td>
                        <td className={`py-2 px-3 text-right font-bold ${fRecord.variance < 0 ? "text-red-600 dark:text-red-400" : fRecord.variance > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]"}`}>
                          {fRecord.variance > 0 ? `+${fRecord.variance}` : fRecord.variance === 0 ? "-" : fRecord.variance}
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
             <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">Transaction Timeline</h3>
             {isLoadingTimeline ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <div key={i} className="animate-pulse flex gap-3"><div className="w-8 h-8 rounded-full bg-[var(--bg-muted)]" /><div className="flex-1 h-8 rounded bg-[var(--bg-muted)]"/></div>)}
                </div>
             ) : timeline.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No transactions found for this period.</p>
             ) : (
                <div className="space-y-4 border-l-2 border-brand-100 dark:border-brand-900 ml-3 pl-4 relative">
                  {timeline.map((tx) => (
                    <div key={tx.tx_id} className="relative">
                      <div className="absolute -left-[26px] top-1 p-1 bg-[var(--bg-body)] rounded-full border border-[var(--border-subtle)]">
                        <ActivityIcon className="w-3 h-3 text-[var(--text-muted)]" />
                      </div>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-3">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-bold uppercase text-[var(--text-primary)]">{tx.action}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                        <div className="text-sm flex gap-2 items-baseline mb-1">
                          <span className={`font-extrabold ${tx.quantity_change > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {tx.quantity_change > 0 ? `+${tx.quantity_change}` : tx.quantity_change}
                          </span>
                          <span className="text-[var(--text-secondary)]">{tx.performed_by}</span>
                        </div>
                        {tx.note && <p className="text-[11px] text-[var(--text-muted)] max-w-full break-words">{tx.note}</p>}
                        <div className="text-[10px] text-[var(--text-muted)] mt-1 opacity-70 flex gap-2">
                           {tx.from_location && <span>From: {tx.from_location}</span>} 
                           {tx.to_location && <span>To: {tx.to_location}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
             )}
          </div>
        </div>
      </div>
    </>
  );
}
