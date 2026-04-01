"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/constants";
import { resolveCheckoutRevenueCategory } from "@/lib/checkout-balance";
import { computeHeldDepositFromRows } from "@/lib/deposit-ledger";
import { GenerateScbQrModal } from "./scb/generate-scb-qr-modal";
import { useAdminRole } from "@/hooks/use-admin-role";

interface Payment {
  id: string;
  tx_type: string;
  method: string;
  amount: number;
  note: string;
  created_at: string;
  revenue_category?: string | null;
  is_record_only?: boolean | null;
}

export type PendingPayment = {
    method: "cash" | "transfer" | "credit_card";
    amount: number;
    note?: string;
};

interface RoomPaymentRow extends Payment {
  is_pending?: boolean;
  pending_index?: number;
}

interface BillingPanelProps {
  reservationId?: string;
  totalPrice: number; // Room charges total
  discountAmount?: number;
  discountReason?: string;
  depositNote?: string;
  mode: "create" | "edit" | "checkin" | "inhouse" | "checkout";
  deferPersist?: boolean;
  pendingPayments?: PendingPayment[];
  onPendingPaymentsChange?: (payments: PendingPayment[]) => void;
  onPaymentAdded?: () => void;
  onPostChargeClick?: () => void;
  onCheckoutClick?: () => void;
  policyFeePreview?: {
    amount: number;
    payment_method: "cash" | "transfer" | "credit_card";
    note?: string;
  } | null;
}

function getSignedExtraChargeAmount(charge: { amount?: number | string | null; tx_type?: string | null }): number {
  const amount = Number(charge?.amount || 0);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  return charge?.tx_type === "refund" ? -Math.abs(amount) : Math.abs(amount);
}

function getPaymentMethodBadgeClass(method: string): string {
  const normalizedMethod = String(method || "").toLowerCase();
  if (normalizedMethod === "cash") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400";
  }
  if (normalizedMethod === "transfer") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-400";
  }
  if (normalizedMethod === "credit_card") {
    return "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-400";
  }
  return "bg-slate-100 text-slate-800 dark:bg-slate-700/40 dark:text-slate-300";
}

export function BillingPanel({
  reservationId,
  totalPrice,
  discountAmount = 0,
  discountReason,
  depositNote = "",
  mode,
  deferPersist = false,
  pendingPayments = [],
  onPendingPaymentsChange,
  onPaymentAdded,
  onPostChargeClick,
  onCheckoutClick,
  policyFeePreview = null,
}: BillingPanelProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [extraCharges, setExtraCharges] = useState<any[]>([]);
  const [extraChargesTotal, setExtraChargesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  // New inline payment state
  const [newMethod, setNewMethod] = useState("cash");
  const [newAmount, setNewAmount] = useState("");
  const [newNote, setNewNote] = useState("");
  const [showScbModal, setShowScbModal] = useState(false);
  const { isAdmin } = useAdminRole();

  const fetchData = useCallback(async () => {
    if (!reservationId || mode === "create") return;
    setLoading(true);
    try {
      const [payRes, extraRes] = await Promise.all([
        fetch(`/api/bookings/${reservationId}/payments`).catch(() => null),
        fetch(`/api/bookings/${reservationId}/extra-charges`).catch(() => null),
      ]);

      if (payRes && payRes.ok) {
        const pData = await payRes.json();
        if (pData.success && pData.payments) {
          setPayments(pData.payments);
        }
      }

      if (extraRes && extraRes.ok) {
        const eData = await extraRes.json();
        if (eData.success && eData.charges) {
          const validCharges = eData.charges.filter((c: any) => !c.is_voided);
          setExtraCharges(validCharges);
          const summaryTotal = Number(eData.summary?.extra_charges_total);
          const total = Number.isFinite(summaryTotal)
            ? summaryTotal
            : validCharges.reduce(
                (sum: number, c: any) => sum + getSignedExtraChargeAmount(c),
                0
              );
          setExtraChargesTotal(total);
        }
      }
    } catch {
      // ignore gracefully
    } finally {
      setLoading(false);
    }
  }, [reservationId, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Exposed method to trigger refresh from parent (e.g. after PostChargeModal closes)
  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener("billing-panel-refresh", handleRefresh);
    return () => window.removeEventListener("billing-panel-refresh", handleRefresh);
  }, [fetchData]);

  const handleAddPayment = async () => {
    if (!reservationId || mode === "create") return;
    const amountSatang = toSatang(newAmount);
    if (amountSatang <= 0) return;
    const amountVal = fromSatang(amountSatang);

    if (deferPersist) {
      if (!onPendingPaymentsChange) return;
      onPendingPaymentsChange([
        ...pendingPayments,
        {
          method: newMethod as "cash" | "transfer" | "credit_card",
          amount: amountVal,
          note: newNote.trim() || undefined,
        },
      ]);
      setNewAmount("");
      setNewNote("");
      if (onPaymentAdded) onPaymentAdded();
      return;
    }

    setAdding(true);
    try {
      const res = await fetch(`/api/bookings/${reservationId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_type: "payment",
          method: newMethod,
          amount: amountVal,
          note: newNote,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewAmount("");
        setNewNote("");
        fetchData();
        if (onPaymentAdded) onPaymentAdded();
      } else {
        alert(data.error || "Failed to add payment.");
      }
    } catch {
      alert("Network error.");
    } finally {
      setAdding(false);
    }
  };

  const handleRemovePendingPayment = (pendingIndex: number) => {
    if (!deferPersist || !onPendingPaymentsChange) return;
    const next = pendingPayments.filter((_, idx) => idx !== pendingIndex);
    onPendingPaymentsChange(next);
  };

  const handleAddPaymentEnter = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!adding && newAmount) {
      void handleAddPayment();
    }
  };

  // --- Calculations ---

  // Net Credits (Room Settlement) = Actual room payments + refunds
  // Note: we exclude 'deposit' rows here, as they are tracked separately in Phase 26A rules
  const persistedPaidSatang = payments.reduce((sum, p) => {
    const amount = toSatang(p.amount);
    const category = resolveCheckoutRevenueCategory(p.revenue_category, p.tx_type, p.note);
    if (p.is_record_only) return sum;
    if (category === "deposit") return sum;
    if (p.tx_type === "payment") return sum + amount;
    if (p.tx_type === "refund") return sum - amount;
    return sum;
  }, 0);

  const pendingPaidSatang = pendingPayments.reduce((sum, p) => sum + toSatang(p.amount), 0);
  const policyPreviewSatang =
    mode === "checkout" && policyFeePreview && Number(policyFeePreview.amount) > 0
      ? toSatang(policyFeePreview.amount)
      : 0;
  const totalCreditsSatang = persistedPaidSatang + pendingPaidSatang + policyPreviewSatang;

  // Deposits Held (Phase 26A: keep it separate for now)
  const depositTransactions = payments.filter((p) => {
    if (p.is_record_only) return false;
    const note = String(p.note ?? "").toLowerCase();
    const category = String(p.revenue_category ?? "").toLowerCase();
    return p.tx_type === "deposit"
      || (
        p.tx_type === "refund"
        && (category === "deposit" || note.includes("deposit refund") || note.includes("paid by deposit"))
      );
  });
  const depositNetSatang = toSatang(
    computeHeldDepositFromRows(
      payments.filter((p) => !p.is_record_only).map((p) => ({
        tx_type: p.tx_type,
        revenue_category: p.revenue_category,
        amount: p.amount,
        note: p.note,
      }))
    )
  );
  const depositSourceRows = payments.filter((p) => !p.is_record_only && p.tx_type === "deposit");
  const depositSourceMethods = Array.from(
    new Set(
      depositSourceRows
        .map((p) => String(p.method || "").toLowerCase())
        .filter((m) => m.length > 0)
    )
  );
  const depositSourceNote =
    depositSourceRows.find((p) => typeof p.note === "string" && p.note.trim().length > 0)?.note ?? "";
  const depositHeldAmount = fromSatang(Math.max(0, depositNetSatang));
  const trimmedDepositNote = depositNote.trim();
  const depositLines = depositTransactions.length > 0
    ? [{
        method: depositSourceMethods.length === 1 ? depositSourceMethods[0] : "mixed",
        note: depositSourceNote,
        amount: depositHeldAmount,
      }]
    : [];
  const shouldShowDepositSummary =
    depositTransactions.length > 0 || (depositHeldAmount <= 0 && trimmedDepositNote.length > 0);

  // Total Charges = Room - Discount + Extra
  const totalChargesSatang =
    toSatang(totalPrice)
    - toSatang(discountAmount)
    + toSatang(extraChargesTotal)
    + policyPreviewSatang;

  // Outstanding Balance = Charges - Credits
  const balanceDueSatang = totalChargesSatang - totalCreditsSatang;

  // Render arrays
  const creditRows: RoomPaymentRow[] = [
    ...(policyPreviewSatang > 0
      ? [{
          id: "pending-policy-fee",
          tx_type: "payment",
          method: policyFeePreview?.payment_method ?? "cash",
          amount: fromSatang(policyPreviewSatang),
          note: policyFeePreview?.note?.trim()
            ? `${policyFeePreview.note.trim()} (pending)`
            : "Late checkout fee (pending)",
          created_at: "",
          is_pending: true,
          pending_index: -1,
        } as RoomPaymentRow]
      : []),
    ...pendingPayments.map((p, idx) => ({
      id: `pending-${idx}`,
      tx_type: "payment",
      method: p.method,
      amount: fromSatang(toSatang(p.amount)),
      note: p.note ?? "",
      created_at: "",
      is_pending: true,
      pending_index: idx,
    })),
    ...payments.filter((p) => {
      if (p.tx_type !== "payment" && p.tx_type !== "refund") return false;
      if (p.is_record_only) return false;
      const category = resolveCheckoutRevenueCategory(p.revenue_category, p.tx_type, p.note);
      return category !== "deposit";
    }),
  ];

  const canShowAddForm =
    (mode === "checkin" || mode === "inhouse" || mode === "checkout" || mode === "edit") &&
    reservationId &&
    (balanceDueSatang > 0 || (deferPersist && pendingPayments.length > 0));

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl overflow-hidden shadow-sm flex flex-col">
      {/* HEADER */}
      <div className="bg-[var(--bg-body)] px-5 py-4 border-b border-[var(--border-default)] flex justify-between items-center">
        <h3 className="font-bold text-[var(--text-primary)] uppercase tracking-widest text-sm flex items-center gap-2">
           <span className="text-lg">💳</span> Guest Folio
        </h3>
        <div className="text-right">
          <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest font-bold mb-1">Outstanding Balance</div>
          <span
            className={`font-mono text-xl font-black ${
              balanceDueSatang > 0
                ? "text-rose-600"
                : balanceDueSatang < 0
                ? "text-amber-500"
                : "text-emerald-600"
            }`}
          >
            {balanceDueSatang > 0 ? "฿ " : balanceDueSatang < 0 ? "Refund ฿ " : "฿ "}
            {formatMoney(Math.abs(fromSatang(balanceDueSatang)))}
          </span>
        </div>
      </div>

      {/* ADD PAYMENT ACTIONS (Moved to top) */}
      {canShowAddForm && (
        <div className="bg-[var(--bg-body)] p-4 border-b border-[var(--border-default)] flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[300px] flex gap-2">
            <select
              className="form-select flex-[0.8] text-sm h-9 px-2"
              value={newMethod}
              onChange={(e) => setNewMethod(e.target.value)}
              disabled={adding}
            >
              {PAYMENT_METHODS.map(m => (
                 <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <div className="relative flex-1">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                className="form-input text-sm h-9 w-full font-mono"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                onKeyDown={handleAddPaymentEnter}
                disabled={adding}
              />
            </div>
            <input
              type="text"
              placeholder="Ref Note"
              className="form-input flex-1 text-sm h-9 px-2"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={handleAddPaymentEnter}
              disabled={adding}
            />
            <button
               type="button"
               onClick={() => void handleAddPayment()}
               disabled={adding || !newAmount}
               className="btn btn-primary h-9 px-4 text-xs shrink-0"
            >
               {adding ? "..." : deferPersist ? "+ Queue" : "+ Add Payment"}
            </button>
            {isAdmin === true && (
              <button
                 type="button"
                 onClick={() => setShowScbModal(true)}
                 className="btn btn-secondary h-9 px-4 text-xs shrink-0 flex items-center gap-2 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-400 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20"
              >
                 QR SCB
              </button>
            )}
          </div>
          
          {mode === "checkout" && onCheckoutClick && (
            <div className="shrink-0 w-full md:w-auto md:ml-auto mt-4 md:mt-0">
               <button
                 type="button"
                 onClick={onCheckoutClick}
                 className="btn btn-primary w-full shadow-md py-2.5 text-sm font-bold bg-slate-900 border-slate-900 hover:bg-slate-800"
               >
                 Proceed to Checkout →
               </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b border-[var(--border-default)] divide-[var(--border-default)]">
        {/* CHARGES PANEL */}
        <div className="p-5 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-default)] pb-2">
            Charges Summary
          </h4>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm text-[var(--text-table-cell)]">
              <span className="font-medium">Room Charges</span>
              <span className="font-mono">฿ {formatMoney(totalPrice)}</span>
            </div>

            {discountAmount > 0 && (
              <div className="flex justify-between items-center text-sm text-rose-700 dark:text-rose-400">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">Discount</span>
                  {discountReason ? (
                    <span className="truncate text-[11px] text-rose-500 dark:text-rose-500/80" title={discountReason}>
                      {discountReason}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono">- ฿ {formatMoney(discountAmount)}</span>
              </div>
            )}
            
            {(extraCharges.length > 0 || policyPreviewSatang > 0) && (
              <div className="pt-2">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-1 block">Extra Charges</span>
                <div className="space-y-1">
                  {extraCharges.map((c, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm text-[var(--text-secondary)] pl-2 border-l-2 border-[var(--border-default)]">
                      <span>{c.fee_template_name || "Extra Charge"}</span>
                      <span className={`font-mono ${c.tx_type === "refund" ? "text-rose-700 dark:text-rose-400" : ""}`}>
                        {c.tx_type === "refund" ? "- ฿ " : "฿ "}
                        {formatMoney(Math.abs(getSignedExtraChargeAmount(c)))}
                      </span>
                    </div>
                  ))}
                  {policyPreviewSatang > 0 && (
                    <div className="flex justify-between items-center text-sm text-amber-700 dark:text-amber-400 pl-2 border-l-2 border-amber-200 dark:border-amber-800/50 bg-amber-50/70 dark:bg-amber-900/10 rounded px-2 py-1">
                      <span>Late checkout fee (pending)</span>
                      <span className="font-mono">฿ {formatMoney(fromSatang(policyPreviewSatang))}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="pt-2 border-t border-[var(--border-default)] flex justify-between items-center text-sm font-bold text-[var(--text-primary)]">
              <span>Total Charges</span>
              <span className="font-mono">฿ {formatMoney(fromSatang(totalChargesSatang))}</span>
            </div>
          </div>

          {mode === "inhouse" && onPostChargeClick && (
             <div className="pt-2">
               <button
                 type="button"
                 onClick={onPostChargeClick}
                 className="btn btn-secondary btn-sm w-full border-dashed"
               >
                 + Post Extra Charge
               </button>
             </div>
          )}
        </div>

        {/* CREDITS PANEL */}
        <div className="p-5 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-default)] pb-2 flex justify-between">
            <span>Payment</span>
            <span className="text-[var(--text-table-cell)]">฿ {formatMoney(fromSatang(totalCreditsSatang))}</span>
          </h4>

          {loading ? (
             <div className="text-xs text-[var(--text-muted)] py-2">Loading timeline...</div>
          ) : (
            <div className="space-y-2">
              {creditRows.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)] italic">No payments recorded</p>
              )}
              {creditRows.map((p, idx) => {
                const amount = Number(p.amount) || 0;
                const isPending = p.is_pending === true;
                const isRefund = !isPending && p.tx_type === "refund";
                const methodLabel = PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method;
                
                return (
                  <div key={p.id || idx} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold shrink-0 ${
                        isPending ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400" : 
                        isRefund ? "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400" : getPaymentMethodBadgeClass(p.method)
                      }`}>
                        {methodLabel}
                      </span>
                      {isPending && deferPersist && typeof p.pending_index === "number" && (
                         <button
                           type="button"
                           onClick={() => handleRemovePendingPayment(p.pending_index as number)}
                           className="text-[10px] text-[var(--text-muted)] hover:text-rose-500"
                         >
                           (remove)
                         </button>
                      )}
                    </div>
                    <span className="font-mono font-medium text-[var(--text-table-cell)]">
                      {isRefund ? "- ฿ " : "฿ "}
                      {formatMoney(amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* DEPOSIT SUMMARY (Moved to bottom) */}
      {shouldShowDepositSummary && (
        <div className="bg-indigo-50/50 dark:bg-indigo-500/10 px-5 py-3 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
           <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300">
             <span className="text-lg">🔒</span>
             <span className="text-xs font-bold uppercase tracking-widest">Deposit Held</span>
           </div>
           
            <div className="flex flex-col gap-1 items-end">
              {depositLines.length === 0 && trimmedDepositNote.length > 0 && (
                 <div className="text-xs text-indigo-700 dark:text-indigo-300">
                    Note: {trimmedDepositNote}
                 </div>
              )}
              {depositLines.map((p, idx) => (
                 <div key={`dep-${p.method}-${idx}`} className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300">
                    <span className="uppercase opacity-70 bg-indigo-100 dark:bg-indigo-500/20 px-1 py-0.5 rounded">{p.method}</span>
                    {p.note && <span className="opacity-70">({p.note})</span>}
                    <span className="font-mono font-bold ml-2 text-sm">฿ {formatMoney(p.amount)}</span>
                 </div>
              ))}
            </div>
        </div>
      )}
      {showScbModal && reservationId && (
        <GenerateScbQrModal
          reservationId={reservationId}
          outstandingAmount={fromSatang(balanceDueSatang)}
          depositHeld={depositHeldAmount}
          onClose={() => setShowScbModal(false)}
          onSuccess={() => {
            fetchData();
            if (onPaymentAdded) onPaymentAdded();
          }}
        />
      )}
    </div>
  );
}
