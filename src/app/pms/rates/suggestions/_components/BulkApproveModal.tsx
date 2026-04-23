"use client";

import { useState } from "react";

type BulkApproveModalProps = {
  selectedCount: number;
  hasPriceDowns: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function BulkApproveModal({ selectedCount, hasPriceDowns, onClose, onConfirm }: BulkApproveModalProps) {
  const [confirmText, setConfirmText] = useState("");

  const canConfirm = confirmText === "CONFIRM";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-lg p-6 space-y-6 bg-[var(--bg-primary)]">
        <h2 className="text-xl font-bold flex items-center gap-2">
          {hasPriceDowns ? <span className="text-rose-500">⚠ High Risk Operation</span> : "Bulk Approve"}
        </h2>
        
        <div className="text-sm text-[var(--text-secondary)] space-y-2">
          <p>You are about to approve <strong>{selectedCount}</strong> rate suggestions.</p>
          {hasPriceDowns && (
            <p className="text-rose-600 dark:text-rose-400 font-medium">
              This batch includes price REDUCTIONS which may impact revenue.
            </p>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 p-4 rounded-xl space-y-2">
          <label className="text-sm font-semibold text-amber-900 dark:text-amber-200 block">
            Type CONFIRM to proceed
          </label>
          <input 
            type="text" 
            autoFocus
            className="form-input w-full border-amber-300 focus:border-amber-500 uppercase" 
            placeholder="CONFIRM"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="btn btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-50" 
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            Confirm Apply
          </button>
        </div>
      </div>
    </div>
  );
}
