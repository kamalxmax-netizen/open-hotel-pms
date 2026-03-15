"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/constants";
import { resolveCheckoutRevenueCategory } from "@/lib/checkout-balance";

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

export function BillingPanel({
  reservationId,
  totalPrice,
  discountAmount = 0,
  discountReason,
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
          const total = validCharges.reduce(
            (sum: number, c: any) => sum + Number(c.amount || 0),
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
    const note = String(p.note ?? "").toLowerCase();
    const category = String(p.revenue_category ?? "").toLowerCase();
    return p.tx_type === "deposit"
      || (p.tx_type === "refund" && (category === "deposit" || note.includes("deposit refund")));
  });
  const depositNetSatang = payments.reduce((sum, p) => {
      const note = String(p.note ?? "").toLowerCase();
      const category = String(p.revenue_category ?? "").toLowerCase();
      const amount = toSatang(p.amount);
      if (p.tx_type === "deposit") return sum + amount;
      if (p.tx_type === "refund" && (category === "deposit" || note.includes("deposit refund"))) {
          return sum - amount;
      }
      return sum;
  }, 0);
  const depositLines = Array.from(
    payments.reduce((map, p) => {
      const note = String(p.note ?? "").toLowerCase();
      const category = String(p.revenue_category ?? "").toLowerCase();
      const isDepositRefund =
        p.tx_type === "refund" && (category === "deposit" || note.includes("deposit refund"));
      if (p.tx_type !== "deposit" && !isDepositRefund) return map;
      const methodKey = String(p.method || "cash");
      const current = map.get(methodKey) ?? { method: methodKey, amountSatang: 0, note: p.note ?? "" };
      current.amountSatang += p.tx_type === "deposit" ? toSatang(p.amount) : -toSatang(p.amount);
      if (!current.note && p.note) current.note = p.note;
      map.set(methodKey, current);
      return map;
    }, new Map<string, { method: string; amountSatang: number; note: string }>())
  )
    .map(([, line]) => ({
      method: line.method,
      note: line.note,
      amount: fromSatang(line.amountSatang),
    }))
    .filter((line) => line.amount > 0);

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
    <div className="bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
      {/* HEADER */}
      <div className="bg-slate-50 px-5 py-4 border-b flex justify-between items-center">
        <h3 className="font-bold text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
           <span className="text-lg">💳</span> Guest Folio
        </h3>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Outstanding Balance</div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b">
        {/* CHARGES PANEL */}
        <div className="p-5 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 border-b pb-2">
            Charges Summary
          </h4>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm text-slate-700">
              <span className="font-medium">Room Charges</span>
              <span className="font-mono">฿ {formatMoney(totalPrice)}</span>
            </div>

            {discountAmount > 0 && (
              <div className="flex justify-between items-center text-sm text-rose-700">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">Discount</span>
                  {discountReason ? (
                    <span className="truncate text-[11px] text-rose-500" title={discountReason}>
                      {discountReason}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono">- ฿ {formatMoney(discountAmount)}</span>
              </div>
            )}
            
            {(extraCharges.length > 0 || policyPreviewSatang > 0) && (
              <div className="pt-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Extra Charges</span>
                <div className="space-y-1">
                  {extraCharges.map((c, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm text-slate-600 pl-2 border-l-2 border-slate-200">
                      <span>{c.fee_template_name || "Extra Charge"}</span>
                      <span className="font-mono">฿ {formatMoney(Number(c.amount))}</span>
                    </div>
                  ))}
                  {policyPreviewSatang > 0 && (
                    <div className="flex justify-between items-center text-sm text-amber-700 pl-2 border-l-2 border-amber-200 bg-amber-50/70 rounded px-2 py-1">
                      <span>Late checkout fee (pending)</span>
                      <span className="font-mono">฿ {formatMoney(fromSatang(policyPreviewSatang))}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="pt-2 border-t flex justify-between items-center text-sm font-bold text-slate-900">
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
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 border-b pb-2 flex justify-between">
            <span>Payment</span>
            <span className="text-slate-700">฿ {formatMoney(fromSatang(totalCreditsSatang))}</span>
          </h4>

          {loading ? (
             <div className="text-xs text-slate-400 py-2">Loading timeline...</div>
          ) : (
            <div className="space-y-2">
              {creditRows.length === 0 && (
                  <p className="text-xs text-slate-400 italic">No payments recorded</p>
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
                        isPending ? "bg-amber-100 text-amber-800" : 
                        isRefund ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                      }`}>
                        {methodLabel}
                      </span>
                      {isPending && deferPersist && typeof p.pending_index === "number" && (
                         <button
                           type="button"
                           onClick={() => handleRemovePendingPayment(p.pending_index as number)}
                           className="text-[10px] text-slate-400 hover:text-rose-500"
                         >
                           (remove)
                         </button>
                      )}
                    </div>
                    <span className="font-mono font-medium text-slate-700">
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

      {/* DEPOSIT SUMMARY (Separate Section per B3) */}
      {depositTransactions.length > 0 && (
        <div className="bg-indigo-50/50 px-5 py-3 border-b flex flex-col sm:flex-row justify-between sm:items-center gap-2">
           <div className="flex items-center gap-2 text-indigo-800">
             <span className="text-lg">🔒</span>
             <span className="text-xs font-bold uppercase tracking-widest">Deposit Held</span>
           </div>
           
           <div className="flex flex-col gap-1 items-end">
             {depositLines.map((p, idx) => (
                <div key={`dep-${p.method}-${idx}`} className="flex items-center gap-2 text-xs text-indigo-700">
                   <span className="uppercase opacity-70 bg-indigo-100 px-1 py-0.5 rounded">{p.method}</span>
                   {p.note && <span className="opacity-70">({p.note})</span>}
                   <span className="font-mono font-bold ml-2 text-sm">฿ {formatMoney(p.amount)}</span>
                </div>
             ))}
           </div>
        </div>
      )}

      {/* FOOTER ACTIONS */}
      {canShowAddForm && (
        <div className="bg-slate-50 p-4 border-t flex flex-wrap gap-2 items-end">
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
              <span className="absolute left-2 top-2 text-slate-400 font-bold text-sm">฿</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount"
                className="form-input text-sm h-9 pl-6 w-full font-mono"
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
    </div>
  );
}
