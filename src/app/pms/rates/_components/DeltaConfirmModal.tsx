"use client";

export function DeltaConfirmModal({
  oldPrice,
  newPrice,
  pctChange,
  onCancel,
  onConfirm
}: {
  oldPrice: number;
  newPrice: number;
  pctChange: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isIncrease = pctChange > 0;
  
  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-sm">
        <div className="modal-header bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900">
          <h2 className="text-lg font-bold text-amber-800 dark:text-amber-500">Unusual Price Change</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            You are about to change the rate by a large margin:
          </p>
          <div className="flex items-center justify-center gap-4 text-lg font-bold py-2 bg-[var(--bg-muted)] rounded-lg border border-[var(--border-subtle)]">
            <span className="text-[var(--text-muted)] line-through">฿{oldPrice.toLocaleString("th-TH")}</span>
            <span className="text-[var(--text-muted)]">→</span>
            <span className="text-[var(--text-primary)]">฿{newPrice.toLocaleString("th-TH")}</span>
          </div>
          <div className={`text-center font-bold text-lg ${isIncrease ? "text-emerald-600" : "text-rose-600"}`}>
            {isIncrease ? "+" : ""}{Math.round(pctChange)}%
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn btn-primary flex-1" onClick={onConfirm}>
              Yes, Apply Rate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
