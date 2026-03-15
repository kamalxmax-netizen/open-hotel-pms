"use client";

import { useState, useEffect } from "react";
import { X, AlertTriangle, AlertCircle, Info, Navigation, CheckCircle2 } from "lucide-react";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import { PAYMENT_METHODS } from "@/lib/constants";

interface CheckoutWarning {
  message: string;
  severity: "error" | "warning" | "info";
}

interface PreCheckoutData {
  warnings: CheckoutWarning[];
  has_blocking_errors: boolean;
  open_loans: any[];
  co_alerts: any[];
  policy_fee_payload?: {
    fee_template_code: string;
    amount: number;
    method: string;
    note: string;
  } | null;
}

interface BillingData {
  roomTotalSatang: number;
  extraChargesSatang: number;
  totalChargesSatang: number;
  totalCreditsSatang: number;
  outstandingSatang: number;
}

interface SettlementDrawerProps {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  totalPrice: number;
  depositAmount: number;
  billingData: BillingData | null;
  onCheckoutComplete: () => void;
  policyFeePayload?: {
    fee_template_code: string;
    amount: number;
    payment_method: string;
    note: string;
  } | null;
  // Temporary: passed until full Phase 25/26 is integrated
  preCheckoutDataCache?: PreCheckoutData | null; 
}

export function SettlementDrawer({
  open,
  onClose,
  reservationId,
  totalPrice,
  depositAmount,
  billingData,
  onCheckoutComplete,
  policyFeePayload,
}: SettlementDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [preData, setPreData] = useState<PreCheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deposit Actions: 'refund' vs 'apply'
  const [depositAction, setDepositAction] = useState<"refund" | "apply">("refund");
  const [depositRefundMethod, setDepositRefundMethod] = useState("cash");

  // Payment Form
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentNote, setPaymentNote] = useState("");
  const [forceCheckout, setForceCheckout] = useState(false);

  // Derived calculations
  const outstandingSatang = billingData?.outstandingSatang ?? 0;
  
  // If we apply deposit, how much of outstanding is covered?
  const depositSatang = toSatang(depositAmount);
  const appliedDepositSatang = depositAction === "apply" ? depositSatang : 0;
  
  // What does the guest ACTUALLY need to pay right now?
  const finalBalanceSatang = Math.max(0, outstandingSatang - appliedDepositSatang);
  // Optional: what if deposit is bigger than outstanding? (Refund the rest)
  const leftoverDepositSatang = depositAction === "apply" && depositSatang > outstandingSatang 
    ? depositSatang - outstandingSatang 
    : 0;

  useEffect(() => {
    if (open) {
      loadPreCheckout();
      setDepositAction("refund");
      setForceCheckout(false);
      setError(null);
    }
  }, [open, reservationId]);

  // Auto-fill payment amount when balance or deposit action changes
  useEffect(() => {
    if (finalBalanceSatang > 0) {
      // Just auto-fill if they need to pay
      setPaymentAmount(fromSatang(finalBalanceSatang).toString());
    } else {
      setPaymentAmount("");
    }
  }, [finalBalanceSatang]);

  const loadPreCheckout = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/bookings/${reservationId}/pre-checkout`);
      if (!res.ok) throw new Error("Failed to load pre-checkout data");
      const data = await res.json();
      setPreData(data);
    } catch (err: any) {
      setError(err.message || "Failed to load pre-checkout validation");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    // Basic validation
    if (finalBalanceSatang > 0) {
      const inputSatang = toSatang(paymentAmount);
      if (inputSatang !== finalBalanceSatang) {
        setError(`Must settle exact remaining balance of ฿${formatMoney(fromSatang(finalBalanceSatang))}`);
        return;
      }
    }

    if (preData?.has_blocking_errors && !forceCheckout) {
      setError("Please resolve blocking errors or use Force Checkout override.");
      return;
    }

    try {
      setCheckingOut(true);
      setError(null);

      const payload = {
        force: forceCheckout,
        payment_amount: paymentAmount ? parseFloat(paymentAmount) : undefined,
        payment_method: paymentMethod,
        payment_note: paymentNote,
        // The deposit refund action logic
        refund_deposit: depositAction === "refund" && depositAmount > 0,
        apply_deposit: depositAction === "apply" && depositAmount > 0,
        deposit_refund_method: depositRefundMethod,
        policy_fee: policyFeePayload ?? undefined,
      };

      const res = await fetch(`/api/bookings/${reservationId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Checkout failed");
      }

      onCheckoutComplete();
    } catch (err: any) {
      setError(err.message || "Checkout failed");
    } finally {
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  const hasBlockingLoans = preData?.open_loans?.some((l: any) => !l.requires_hk_collection) || false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm sm:p-0">
      <div className="w-full sm:w-[480px] bg-[var(--bg-body)] shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-[var(--bg-surface)]">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Navigation className="w-5 h-5 text-emerald-600" />
              Settlement & Checkout
            </h2>
            <p className="text-xs text-[var(--text-secondary)] font-medium">Reservation #{reservationId.substring(0, 8)}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-slate-600 p-2 rounded-full hover:bg-[var(--bg-surface-hover)] transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {loading ? (
            <div className="flex items-center justify-center p-8 space-x-2 text-[var(--text-secondary)]">
              <div className="w-4 h-4 rounded-full border-2 border-[var(--border-input)] border-t-slate-600 animate-spin" />
              <span className="text-sm font-medium">Validating checkout status...</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5" />
                  <p className="text-sm font-medium text-rose-800">{error}</p>
                </div>
              )}

              {/* Warnings / Pre-Checkout Data */}
              {preData?.warnings && preData.warnings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2">Validation</h3>
                  {preData.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border p-3 flex items-start gap-3 text-sm ${
                        w.severity === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : w.severity === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-sky-200 bg-sky-50 text-sky-800"
                      }`}
                    >
                      {w.severity === "error" ? <AlertCircle className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
                      <span className="font-medium leading-relaxed">{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Financial Summary */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2">Summary</h3>
                <div className="bg-[var(--bg-surface)] border rounded-xl overflow-hidden shadow-sm">
                  <div className="p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)] font-medium">Total Charges</span>
                      <span className="font-mono text-slate-800 font-semibold">฿ {formatMoney(fromSatang(billingData?.totalChargesSatang ?? 0))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)] font-medium">Total Credits</span>
                      <span className="font-mono text-slate-800 font-semibold">฿ {formatMoney(fromSatang(billingData?.totalCreditsSatang ?? 0))}</span>
                    </div>
                    <div className="border-t pt-3 flex justify-between items-center">
                      <span className="text-base font-bold text-slate-800">Outstanding</span>
                      <span className={`text-lg font-mono font-bold ${outstandingSatang > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        ฿ {formatMoney(fromSatang(outstandingSatang))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deposit Action */}
              {depositAmount > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Deposit Action</h3>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-indigo-900">Deposit Held</span>
                      <span className="font-mono text-base font-bold text-indigo-700">฿ {formatMoney(depositAmount)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDepositAction("refund")}
                        className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition flex flex-col items-center justify-center gap-1 ${
                          depositAction === "refund"
                            ? "border-amber-400 bg-amber-100/50 text-amber-900 shadow-sm"
                            : "border-indigo-200 bg-[var(--bg-surface)] text-indigo-600 hover:bg-white/60"
                        }`}
                      >
                         Refund to Guest
                         <span className="text-[10px] font-normal opacity-70">(Keep balance separate)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDepositAction("apply")}
                        className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition flex flex-col items-center justify-center gap-1 ${
                          depositAction === "apply"
                            ? "border-indigo-500 bg-indigo-100/50 text-indigo-900 shadow-sm"
                            : "border-indigo-200 bg-[var(--bg-surface)] text-indigo-600 hover:bg-white/60"
                        }`}
                      >
                         Apply to Balance
                         <span className="text-[10px] font-normal opacity-70">(Reduce outstanding)</span>
                      </button>
                    </div>

                    {/* Method selection for Refund Phase 26B prep */}
                    {depositAction === "refund" && (
                       <div className="flex items-center gap-3 mt-2 bg-white/60 p-2 rounded-lg border border-indigo-100">
                          <label className="text-xs font-semibold text-indigo-900 whitespace-nowrap">Refund Method:</label>
                          <select 
                            className="form-select text-sm h-8 py-0 bg-transparent border-indigo-200 text-indigo-900 w-full focus:ring-indigo-500 focus:border-indigo-500"
                            value={depositRefundMethod}
                            onChange={e => setDepositRefundMethod(e.target.value)}
                          >
                             {PAYMENT_METHODS.map(m => (
                               <option key={m.value} value={m.value}>{m.label}</option>
                             ))}
                          </select>
                       </div>
                    )}
                  </div>
                </div>
              )}

              {/* Settlement Payment Form */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">Final Settlement</h3>
                
                {finalBalanceSatang <= 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-2">
                     <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                     <h4 className="text-emerald-900 font-bold">Fully Settled</h4>
                     <p className="text-sm text-emerald-700">No additional payment required from guest.</p>
                     
                     {leftoverDepositSatang > 0 && depositAction === "apply" && (
                       <div className="mt-4 inline-block bg-[var(--bg-surface)] border border-amber-200 px-3 py-2 rounded-lg text-xs font-semibold text-amber-800">
                         * Remaining deposit (฿{formatMoney(fromSatang(leftoverDepositSatang))}) will be refunded.
                       </div>
                     )}
                  </div>
                ) : (
                  <div className="rounded-xl border bg-[var(--bg-surface)] p-5 shadow-sm space-y-5">
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-semibold text-slate-800">Amount Due</label>
                        <span className="text-sm font-bold text-amber-600">฿ {formatMoney(fromSatang(finalBalanceSatang))}</span>
                      </div>
                      
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 font-bold text-[var(--text-muted)]">฿</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="form-input pl-8 font-mono text-lg font-semibold placeholder:font-sans placeholder:font-normal placeholder:text-sm"
                          placeholder="Amount received"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-800">Payment Method</label>
                      <div className="grid grid-cols-4 gap-2">
                        {PAYMENT_METHODS.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setPaymentMethod(m.value)}
                            className={`rounded-lg border py-2 text-xs font-semibold transition ${
                              paymentMethod === m.value
                                ? "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm"
                                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <input
                        type="text"
                        className="form-input text-sm"
                        placeholder="Reference or Note (Optional)"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {hasBlockingLoans && (
                 <label className="flex items-center gap-2 p-3 rounded-lg border border-amber-300 bg-amber-100/50 cursor-pointer hover:bg-amber-100 transition">
                   <input 
                     type="checkbox" 
                     className="form-checkbox text-amber-600 border-amber-400 rounded w-4 h-4"
                     checked={forceCheckout}
                     onChange={(e) => setForceCheckout(e.target.checked)}
                   />
                   <span className="text-sm font-semibold text-amber-900">
                     Force checkout (Ignore unreturned FO items)
                   </span>
                 </label>
              )}
            </>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t bg-[var(--bg-body)] flex gap-3">
          <button
            type="button"
            className="btn btn-secondary flex-1 py-3 text-sm font-semibold"
            onClick={onClose}
            disabled={checkingOut}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-[2] py-3 text-sm font-bold shadow-md hover:shadow-lg transition-transform active:scale-[0.98]"
            onClick={handleCheckout}
            disabled={loading || checkingOut || (!forceCheckout && preData?.has_blocking_errors)}
          >
            {checkingOut ? "Processing..." : "Confirm Checkout"}
          </button>
        </div>

      </div>
    </div>
  );
}
