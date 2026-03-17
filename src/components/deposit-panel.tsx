"use client";

import { PAYMENT_METHODS } from "@/lib/constants";
import { formatMoney } from "@/lib/money";

interface DepositPanelProps {
  reservationId: string;
  mode: "create" | "edit" | "checkin" | "inhouse" | "checkout";
  depositAmount: number;
  depositNote: string;
  depositMethod: string;
  depositInputAmount: string;
  depositInputNote: string;
  depositSaving: boolean;
  depositInlineError: string | null;
  depositLines: { method: string; amount: number; note?: string }[];
  onDepositMethodChange: (val: string) => void;
  onDepositInputAmountChange: (val: string) => void;
  onDepositInputNoteChange: (val: string) => void;
  onDepositNoteChange: (val: string) => void;
  onAddDeposit: () => void;
  onSaveDepositNote: () => void;
  onClearDeposit: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
  canEditDeposit: boolean;
}

export function DepositPanel({
  mode,
  depositAmount,
  depositNote,
  depositMethod,
  depositInputAmount,
  depositInputNote,
  depositSaving,
  depositInlineError,
  depositLines,
  onDepositMethodChange,
  onDepositInputAmountChange,
  onDepositInputNoteChange,
  onDepositNoteChange,
  onAddDeposit,
  onSaveDepositNote,
  onClearDeposit,
  onKeyDown,
  canEditDeposit
}: DepositPanelProps) {
  
  // Extra layer of safety: we only show the main interactive deposit block in create/edit/checkin.
  // Inhouse/Checkout will use BillingPanel & SettlementDrawer instead, but just in case it renders:
  if (mode === "inhouse" || mode === "checkout") {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-widest text-amber-800 dark:text-amber-300">
          💰 Deposit Collection
        </h3>
        {depositAmount > 0 && (
          <span className="rounded bg-amber-200 dark:bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-900 dark:text-amber-300">
            Total Collected: ฿ {formatMoney(depositAmount)}
          </span>
        )}
      </div>

      {depositLines.length > 0 ? (
        <div className="space-y-1.5">
          {depositLines.map((line, idx) => {
            const methodLabel =
              PAYMENT_METHODS.find((m) => m.value === line.method)?.label ??
              line.method;
            return (
              <div
                key={`${line.method}-${idx}-${line.amount}`}
                className="flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-500/20 bg-[var(--bg-surface)] px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-amber-900 dark:text-amber-300">{methodLabel}</span>
                  {line.note && (
                    <span className="ml-1 text-amber-700 dark:text-amber-400 truncate">({line.note})</span>
                  )}
                </div>
                <span className="font-mono font-semibold text-amber-900 dark:text-amber-300">
                  ฿ {formatMoney(line.amount)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-400">No deposit collected yet.</p>
      )}

      {depositNote && (
        <div className="rounded-md border border-amber-300 dark:border-amber-500/20 bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-amber-900 dark:text-amber-300">
          <span className="font-semibold">Deposit Note:</span> {depositNote}
        </div>
      )}

      {depositInlineError && (
        <p className="text-xs text-rose-700">{depositInlineError}</p>
      )}

      {canEditDeposit && (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-4">
              <select
                className="form-select text-sm h-9 px-2"
                value={depositMethod}
                onChange={(e) => onDepositMethodChange(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={depositSaving}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-4 border relative rounded-md bg-[var(--bg-surface)]">
              <span className="absolute left-2 top-1.5 text-[var(--text-muted)] font-bold text-sm">฿</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount (0 allowed)"
                className="w-full h-full pl-6 pr-2 bg-transparent text-sm outline-none font-mono"
                value={depositInputAmount}
                onChange={(e) => onDepositInputAmountChange(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={depositSaving}
              />
            </div>
            <div className="col-span-4">
              <button
                type="button"
                onClick={() => onAddDeposit()}
                disabled={depositSaving || !depositInputAmount}
                className="btn btn-primary h-9 w-full px-0 text-xs"
              >
                {depositSaving ? "..." : "Add Deposit"}
              </button>
            </div>
          </div>
          <input
            type="text"
            placeholder="Deposit note / reason if no deposit"
            className="form-input text-sm h-9 px-2 w-full"
            value={depositNote}
            onChange={(e) => onDepositNoteChange(e.target.value)}
            disabled={depositSaving}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm text-xs"
            onClick={() => onSaveDepositNote()}
            disabled={depositSaving}
          >
            Save Deposit Note
          </button>
          
          <input
            type="text"
            placeholder="Line note / Ref ID (optional)"
            className="form-input text-sm h-9 px-2 w-full"
            value={depositInputNote}
            onChange={(e) => onDepositInputNoteChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={depositSaving}
          />

          {(depositAmount > 0 || depositNote.trim().length > 0) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm text-xs"
              onClick={() => onClearDeposit()}
              disabled={depositSaving}
            >
              Clear Deposit
            </button>
          )}
        </div>
      )}

      {!canEditDeposit && (
        <div className="rounded-md border border-amber-300 dark:border-amber-500/20 bg-[var(--bg-surface)] px-2.5 py-2 text-xs text-amber-900 dark:text-amber-300">
          Deposit is locked before check-in. Use pre-payment only until guest is checked in.
        </div>
      )}
    </div>
  );
}
