"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw, WalletCards, ReceiptText, Landmark, FileClock } from "lucide-react";
import PmsModal from "./pms-modal";
import { PostChargeModal } from "./post-charge-modal";
import { SettlementDrawer } from "./settlement-drawer";
import { PAYMENT_METHODS } from "@/lib/constants";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import type { PaymentMethod, ReservationFolioLedgerRow, ReservationFolioResponse } from "@/lib/types";

type BookingMode = "create" | "edit" | "checkin" | "inhouse" | "checkout";

type BillingData = {
  roomTotalSatang: number;
  extraChargesSatang: number;
  totalChargesSatang: number;
  totalCreditsSatang: number;
  outstandingSatang: number;
};

interface ReservationFolioModalProps {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  mode: BookingMode;
  isReadonly?: boolean;
  totalPrice: number;
  depositAmount: number;
  billingData: BillingData | null;
  policyFeePayload?: {
    fee_template_code: string;
    amount: number;
    payment_method: string;
    note: string;
  } | null;
  onInlineRefresh?: () => void;
  onCheckoutComplete: () => void;
}

type FolioFilter = "all" | "charges" | "payments" | "deposits";

const FILTERS: Array<{ key: FolioFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "charges", label: "Charges" },
  { key: "payments", label: "Payments" },
  { key: "deposits", label: "Deposits" },
];

function formatLedgerDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatStayRange(checkinDate: string | null, checkoutDate: string | null): string {
  if (!checkinDate || !checkoutDate) return "—";
  return `${checkinDate} → ${checkoutDate}`;
}

function getMethodLabel(method: PaymentMethod | null): string {
  if (!method) return "—";
  return PAYMENT_METHODS.find((item) => item.value === method)?.label ?? method;
}

function getRowTypeLabel(row: ReservationFolioLedgerRow): string {
  if (row.type === "room_charge") return "Room Charge";
  if (row.type === "discount") return "Discount";
  if (row.type === "extra_charge") return "Extra Charge";
  if (row.type === "deposit") return "Deposit";
  if (row.type === "refund") return "Refund";
  return "Payment";
}

function getAmountTone(row: ReservationFolioLedgerRow): string {
  if (row.type === "discount") return "text-rose-700";
  if (row.type === "room_charge" || row.type === "extra_charge") return "text-amber-700";
  if (row.type === "refund") return "text-rose-700";
  if (row.type === "deposit") return "text-indigo-700";
  return "text-emerald-700";
}

function getAmountPrefix(row: ReservationFolioLedgerRow): string {
  if (row.type === "room_charge" || row.type === "extra_charge") return "+";
  if (row.type === "discount") return "-";
  if (row.type === "refund") return "-";
  if (row.type === "deposit") {
    const note = String(row.note ?? "").toLowerCase();
    if (note.includes("paid by deposit")) return "-";
    return "";
  }
  return "";
}

export function ReservationFolioModal({
  open,
  onClose,
  reservationId,
  mode,
  isReadonly = false,
  totalPrice,
  depositAmount,
  billingData,
  policyFeePayload = null,
  onInlineRefresh,
  onCheckoutComplete,
}: ReservationFolioModalProps) {
  const [loading, setLoading] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [error, setError] = useState("");
  const [folio, setFolio] = useState<ReservationFolioResponse | null>(null);
  const [filter, setFilter] = useState<FolioFilter>("all");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showPostCharge, setShowPostCharge] = useState(false);
  const [showSettlement, setShowSettlement] = useState(false);

  const loadFolio = useCallback(async () => {
    if (!reservationId) return;
    try {
      setLoading(true);
      setError("");
      const response = await fetch(`/api/bookings/${reservationId}/folio`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load folio.");
      }
      setFolio(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load folio.");
      setFolio(null);
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    if (!open) return;
    void loadFolio();
  }, [open, loadFolio]);

  const visibleLedger = useMemo(() => {
    const rows = folio?.ledger ?? [];
    if (filter === "all") return rows;
    if (filter === "charges") return rows.filter((row) => row.type === "room_charge" || row.type === "discount" || row.type === "extra_charge");
    if (filter === "payments") return rows.filter((row) => row.type === "payment" || row.type === "refund");
    return rows.filter((row) => row.type === "deposit");
  }, [folio?.ledger, filter]);

  const canAddPayment = open && !!reservationId && !isReadonly && mode !== "create";
  const canPostCharge = open && !!reservationId && !isReadonly && mode === "inhouse";
  const canOpenSettlement = open && !!reservationId && !isReadonly && mode === "checkout";

  const handlePaymentSubmit = async () => {
    const amount = Number(paymentAmount);
    if (!reservationId || !Number.isFinite(amount) || amount <= 0) {
      setError("Payment amount must be greater than 0.");
      return;
    }

    try {
      setSubmittingPayment(true);
      setError("");
      const response = await fetch(`/api/bookings/${reservationId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_type: "payment",
          method: paymentMethod,
          amount,
          note: paymentNote.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to add payment.");
      }

      setPaymentAmount("");
      setPaymentNote("");
      setShowPaymentForm(false);
      window.dispatchEvent(new CustomEvent("billing-panel-refresh"));
      onInlineRefresh?.();
      await loadFolio();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to add payment.");
    } finally {
      setSubmittingPayment(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <PmsModal
        title="Reservation Folio"
        size="wide"
        onClose={onClose}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div className="text-xs text-[var(--text-secondary)]">
              Full folio ledger for this reservation
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        }
      >
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Reservation</div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">
                  {folio?.reservation.guest_name || "Guest"}
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-[var(--text-secondary)]">
                  <span>{folio?.reservation.booking_code || "—"}</span>
                  <span>Room {folio?.reservation.room_number || "—"}</span>
                  <span className="capitalize">{folio?.reservation.status || "—"}</span>
                  <span>{formatStayRange(folio?.reservation.checkin_date ?? null, folio?.reservation.checkout_date ?? null)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      filter === item.key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                    }`}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Room Charges</div>
              <div className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">฿{formatMoney(folio?.summary.room_charges_total ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700">Discount</div>
              <div className="mt-4 text-2xl font-semibold text-rose-800">฿{formatMoney(folio?.summary.discount_total ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Extra Charges</div>
              <div className="mt-4 text-2xl font-semibold text-amber-800">฿{formatMoney(folio?.summary.extra_charges_total ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Payments</div>
              <div className="mt-4 text-2xl font-semibold text-emerald-800">฿{formatMoney(folio?.summary.payments_total ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700">Refunds</div>
              <div className="mt-4 text-2xl font-semibold text-rose-800">฿{formatMoney(folio?.summary.refunds_total ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">Deposit Held</div>
              <div className="mt-4 text-2xl font-semibold text-indigo-800">฿{formatMoney(folio?.summary.deposit_held ?? 0)}</div>
            </div>
            <div className="flex min-h-[120px] flex-col justify-between rounded-2xl border border-slate-900 bg-slate-900 p-4 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Outstanding</div>
              <div className="mt-4 text-2xl font-semibold">฿{formatMoney(folio?.summary.outstanding_balance ?? 0)}</div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">Unified Ledger</div>
                  <div className="text-xs text-[var(--text-secondary)]">Charges, payments, refunds, and deposits in one view</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadFolio()}
                  disabled={loading}
                >
                  <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <colgroup>
                    <col className="w-[15%]" />
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[19%]" />
                    <col className="w-[15%]" />
                    <col className="w-[16%]" />
                    <col className="w-[7%]" />
                  </colgroup>
                  <thead className="bg-[var(--bg-body)] text-left text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                    <tr>
                      <th className="px-4 py-3">Date/Time</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Note</th>
                      <th className="px-4 py-3">Cashier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedger.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-secondary)]">
                          No folio rows for this filter.
                        </td>
                      </tr>
                    ) : (
                      visibleLedger.map((row) => (
                        <tr
                          key={row.id}
                          className={`border-t border-[var(--border-subtle)] align-top ${row.is_record_only ? "opacity-60 italic" : ""}`}
                        >
                          <td className="px-4 py-3 font-medium text-[var(--text-table-cell)]">{formatLedgerDateTime(row.occurred_at)}</td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-[var(--text-primary)]">{getRowTypeLabel(row)}</div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                              <span>{row.label}</span>
                              {row.is_record_only ? (
                                <span
                                  className="rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"
                                  title="This transaction was settled in POS. Shown for reference only."
                                >
                                  Record Only
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-table-cell)]">{getMethodLabel(row.method)}</td>
                          <td className={`whitespace-nowrap px-4 py-3 font-mono font-semibold ${getAmountTone(row)}`}>
                            {getAmountPrefix(row)}฿{formatMoney(row.amount)}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {row.template_name || row.revenue_category || "—"}
                          </td>
                          <td className="max-w-[260px] px-4 py-3 text-[var(--text-secondary)]">
                            <div className="truncate" title={row.note || ""}>
                              {row.note || "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{row.cashier_name || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <WalletCards className="h-4 w-4 text-indigo-600" />
                  Action Rail
                </div>

                <div className="space-y-2">
                  {canAddPayment && (
                    <button
                      type="button"
                      className="btn btn-primary w-full justify-center"
                      onClick={() => setShowPaymentForm((current) => !current)}
                    >
                      Add Payment
                    </button>
                  )}
                  {canPostCharge && (
                    <button
                      type="button"
                      className="btn btn-secondary w-full justify-center"
                      onClick={() => setShowPostCharge(true)}
                    >
                      Post Charge
                    </button>
                  )}
                  {canOpenSettlement && (
                    <button
                      type="button"
                      className="btn btn-secondary w-full justify-center"
                      onClick={() => setShowSettlement(true)}
                    >
                      Open Settlement
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost w-full justify-center"
                    onClick={() => void loadFolio()}
                    disabled={loading}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              {canAddPayment && showPaymentForm && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <ReceiptText className="h-4 w-4" />
                    Add Payment
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="form-label">Method</label>
                      <select
                        className="form-select"
                        value={paymentMethod}
                        onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                        disabled={submittingPayment}
                      >
                        {PAYMENT_METHODS.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Amount</label>
                      <input
                        className="form-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={paymentAmount}
                        onChange={(event) => setPaymentAmount(event.target.value)}
                        disabled={submittingPayment}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="form-label">Note</label>
                      <input
                        className="form-input"
                        type="text"
                        value={paymentNote}
                        onChange={(event) => setPaymentNote(event.target.value)}
                        disabled={submittingPayment}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary flex-1"
                        onClick={() => setShowPaymentForm(false)}
                        disabled={submittingPayment}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary flex-1"
                        onClick={() => void handlePaymentSubmit()}
                        disabled={submittingPayment || !paymentAmount}
                      >
                        {submittingPayment ? "Saving..." : "Save Payment"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Landmark className="h-4 w-4 text-[var(--text-secondary)]" />
                  Quick Snapshot
                </div>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between gap-3">
                    <span>Grand Total</span>
                    <span className="font-semibold text-[var(--text-primary)]">฿{formatMoney(folio?.summary.grand_total ?? totalPrice)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Deposit Held</span>
                    <span className="font-semibold text-[var(--text-primary)]">฿{formatMoney(folio?.summary.deposit_held ?? depositAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Outstanding</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      ฿{formatMoney(fromSatang(billingData?.outstandingSatang ?? toSatang(folio?.summary.outstanding_balance ?? 0)))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <FileClock className="h-4 w-4 text-[var(--text-secondary)]" />
                  Notes
                </div>
                <p className="text-sm leading-6 text-[var(--text-secondary)]">
                  This full folio view is the detailed financial workspace for the reservation. Inline booking folio can be reduced later after this view is validated.
                </p>
              </div>
            </div>
          </div>
        </div>
      </PmsModal>

      {showPostCharge && (
        <PostChargeModal
          open={showPostCharge}
          onClose={() => setShowPostCharge(false)}
          reservationId={reservationId}
          onChargePosted={() => {
            window.dispatchEvent(new CustomEvent("billing-panel-refresh"));
            onInlineRefresh?.();
            void loadFolio();
          }}
        />
      )}

      {showSettlement && (
        <SettlementDrawer
          open={showSettlement}
          onClose={() => setShowSettlement(false)}
          reservationId={reservationId}
          totalPrice={totalPrice}
          depositAmount={depositAmount}
          policyFeePayload={policyFeePayload}
          billingData={billingData}
          onCheckoutComplete={() => {
            setShowSettlement(false);
            onCheckoutComplete();
          }}
        />
      )}
    </>
  );
}
