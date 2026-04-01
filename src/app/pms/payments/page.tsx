"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

const ReservationDetailPage = dynamic(() => import("@/components/reservation-detail-page"), {
  loading: () => null,
});

type MethodRow = {
  method: "cash" | "transfer" | "credit_card" | "other";
  total: number;
  deposits: number;
  refunds: number;
  net: number;
  count: number;
  share_pct: number;
};

type CategoryRow = {
  category: "room_revenue" | "pos_revenue" | "extra_charge" | "deposit" | "no_show_fee" | "dayuse_revenue";
  inflow: number;
  refunds: number;
  net: number;
};

type DayRow = {
  date: string;
  cash: number;
  transfer: number;
  credit_card: number;
  other: number;
  total_inflow: number;
  refunds: number;
  net: number;
  tx_count: number;
};

type DepositMismatch = {
  reservation_id: string;
  deposit_method: string;
  refund_method: string;
  deposit_amount: number;
  refund_amount: number;
  deposit_date: string;
  refund_date: string;
  note: string;
};

type SummaryResponse = {
  success: boolean;
  business_date?: string;
  start_date?: string;
  end_date?: string;
  error?: string;
  summary: {
    grand_total: number;
    grand_refunds: number;
    net_total: number;
    tx_count: number;
  };
  by_method: MethodRow[];
  by_category: CategoryRow[];
  by_day: DayRow[];
  deposit_method_mismatches: DepositMismatch[];
};

type DetailEntry = {
  id: string;
  paid_date: string;
  paid_at: string;
  tx_type: "payment" | "refund" | "deposit";
  method: "cash" | "transfer" | "credit_card" | "other";
  revenue_category: "room_revenue" | "pos_revenue" | "extra_charge" | "deposit" | "no_show_fee" | "dayuse_revenue";
  amount: number;
  signed_amount: number;
  cashier_name: string | null;
  note: string | null;
  room_number: string | null;
};

type DetailReservation = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  guest_profile_id: string | null;
  room_number: string | null;
  totals: { inflow: number; refunds: number; net: number };
  entries: DetailEntry[];
};

type DetailResponse = {
  success: boolean;
  business_date?: string;
  start_date?: string;
  end_date?: string;
  error?: string;
  reservations: DetailReservation[];
};

type ViewKey = "summary" | "detail";

const METHOD_LABEL: Record<MethodRow["method"], string> = {
  cash: "Cash",
  transfer: "Bank Transfer",
  credit_card: "Credit Card",
  other: "Other",
};

const CATEGORY_LABEL: Record<CategoryRow["category"], string> = {
  room_revenue: "Room Revenue",
  pos_revenue: "POS Revenue",
  extra_charge: "Extra Charge",
  deposit: "Deposit",
  no_show_fee: "No-show Fee",
  dayuse_revenue: "Day Use Revenue",
};

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function fmtMoney(value: number): string {
  return `฿${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

const PRESETS = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: -1 },
  { label: "Last 7D", days: -6 },
  { label: "Last 30D", days: -29 },
];

export default function PaymentsPage() {
  const localToday = toDateInput(new Date());
  const [businessDate, setBusinessDate] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [presetIndex, setPresetIndex] = useState<number>(0);
  const [view, setView] = useState<ViewKey>("summary");

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [detailData, setDetailData] = useState<DetailResponse | null>(null);
  const [detailResId, setDetailResId] = useState<string | null>(null);

  function openReservation(reservationId?: string | null) {
    if (!reservationId) return;
    setDetailResId(reservationId);
  }

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const query = new URLSearchParams();
      if (startDate) query.set("start", startDate);
      if (endDate) query.set("end", endDate);
      const queryString = query.toString();
      const suffix = queryString ? `?${queryString}` : "";

      const [summaryRes, detailRes] = await Promise.all([
        fetch(`/api/payments/report${suffix}`),
        fetch(`/api/payments/detail${suffix}`),
      ]);

      const summaryJson = (await summaryRes.json()) as SummaryResponse;
      const detailJson = (await detailRes.json()) as DetailResponse;

      if (!summaryRes.ok || summaryJson.success === false) {
        throw new Error(summaryJson.error || "Failed to load payment summary.");
      }
      if (!detailRes.ok || detailJson.success === false) {
        throw new Error(detailJson.error || "Failed to load payment detail.");
      }

      setSummaryData(summaryJson);
      setDetailData(detailJson);
      const resolvedBusinessDate =
        (summaryJson.business_date && String(summaryJson.business_date)) ||
        (detailJson.business_date && String(detailJson.business_date)) ||
        localToday;
      setBusinessDate(resolvedBusinessDate);
      if (!startDate) {
        setStartDate(summaryJson.start_date ?? detailJson.start_date ?? resolvedBusinessDate);
      }
      if (!endDate) {
        setEndDate(summaryJson.end_date ?? detailJson.end_date ?? resolvedBusinessDate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [endDate, localToday, startDate]);

  useEffect(() => {
    load();
  }, [load]);

  function applyPreset(index: number) {
    setPresetIndex(index);
    const preset = PRESETS[index];
    const anchorDate = businessDate || localToday;
    const nextStart = addDays(anchorDate, preset.days);
    const nextEnd = preset.days === -1 ? addDays(anchorDate, -1) : anchorDate;
    setStartDate(nextStart);
    setEndDate(nextEnd);
  }

  return (
    <div className="flex flex-col gap-5 max-w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Revenue</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Payment Report</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Summary and detail folio by reservation room mapping.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PRESETS.map((preset, idx) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(idx)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                presetIndex === idx
                  ? "border-brand-400 bg-brand-600 text-white"
                  : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">From</span>
          <input
            className="form-input py-1 text-sm w-36"
            type="date"
            value={startDate}
            onChange={(e) => {
              setPresetIndex(-1);
              setStartDate(e.target.value);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)]">To</span>
          <input
            className="form-input py-1 text-sm w-36"
            type="date"
            value={endDate}
            onChange={(e) => {
              setPresetIndex(-1);
              setEndDate(e.target.value);
            }}
          />
        </div>

        <div className="flex gap-1 rounded-lg bg-[var(--bg-muted)] p-1 ml-auto">
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
              view === "summary" ? "bg-[var(--bg-surface)] text-brand-700 shadow-sm" : "text-[var(--text-secondary)]"
            }`}
            onClick={() => setView("summary")}
          >
            Summary
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
              view === "detail" ? "bg-[var(--bg-surface)] text-brand-700 shadow-sm" : "text-[var(--text-secondary)]"
            }`}
            onClick={() => setView("detail")}
          >
            Detail Folio
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {view === "summary" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-4">
              <p className="text-xs text-[var(--text-secondary)]">Total Inflow</p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{fmtMoney(summaryData?.summary.grand_total ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-[var(--text-secondary)]">Refunds</p>
              <p className="text-2xl font-bold text-rose-600">{fmtMoney(summaryData?.summary.grand_refunds ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-[var(--text-secondary)]">Net</p>
              <p className="text-2xl font-bold text-emerald-700">{fmtMoney(summaryData?.summary.net_total ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-[var(--text-secondary)]">Transactions</p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{summaryData?.summary.tx_count ?? 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4 overflow-x-auto">
              <h2 className="text-sm font-bold text-[var(--text-table-cell)] mb-3">By Payment Method</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left py-2">Method</th>
                    <th className="text-right py-2">Payment</th>
                    <th className="text-right py-2">Deposit</th>
                    <th className="text-right py-2">Refund</th>
                    <th className="text-right py-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(summaryData?.by_method ?? []).map((row) => (
                    <tr key={row.method} className="border-b border-[var(--border-subtle)]">
                      <td className="py-2">{METHOD_LABEL[row.method]}</td>
                      <td className="py-2 text-right">{fmtMoney(row.total)}</td>
                      <td className="py-2 text-right">{fmtMoney(row.deposits)}</td>
                      <td className="py-2 text-right">{fmtMoney(row.refunds)}</td>
                      <td className="py-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card p-4 overflow-x-auto">
              <h2 className="text-sm font-bold text-[var(--text-table-cell)] mb-3">By Revenue Category</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="text-left py-2">Category</th>
                    <th className="text-right py-2">Inflow</th>
                    <th className="text-right py-2">Refund</th>
                    <th className="text-right py-2">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {(summaryData?.by_category ?? []).map((row) => (
                    <tr key={row.category} className="border-b border-[var(--border-subtle)]">
                      <td className="py-2">{CATEGORY_LABEL[row.category]}</td>
                      <td className="py-2 text-right">{fmtMoney(row.inflow)}</td>
                      <td className="py-2 text-right">{fmtMoney(row.refunds)}</td>
                      <td className="py-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card p-4 overflow-x-auto">
            <h2 className="text-sm font-bold text-[var(--text-table-cell)] mb-3">Daily Summary</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left py-2">Date</th>
                  <th className="text-right py-2">Cash</th>
                  <th className="text-right py-2">Transfer</th>
                  <th className="text-right py-2">Card</th>
                  <th className="text-right py-2">Other</th>
                  <th className="text-right py-2">Inflow</th>
                  <th className="text-right py-2">Refund</th>
                  <th className="text-right py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {(summaryData?.by_day ?? []).map((row) => (
                  <tr key={row.date} className="border-b border-[var(--border-subtle)]">
                    <td className="py-2">{row.date}</td>
                    <td className="py-2 text-right">{fmtMoney(row.cash)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.transfer)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.credit_card)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.other)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.total_inflow)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.refunds)}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                  </tr>
                ))}
                {(summaryData?.by_day ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--text-secondary)]">
                      No payment rows in selected dates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {(summaryData?.deposit_method_mismatches ?? []).length > 0 && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <h2 className="text-sm font-bold text-amber-800 mb-2">Deposit Refund Method Mismatch</h2>
              <div className="space-y-1 text-sm text-amber-900">
                {summaryData?.deposit_method_mismatches.map((row, index) => (
                  <p key={`${row.reservation_id}-${index}`}>
                    {row.reservation_id}: deposit {fmtMoney(row.deposit_amount)} via {row.deposit_method}, refund{" "}
                    {fmtMoney(row.refund_amount)} via {row.refund_method}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {view === "detail" && (
        <div className="space-y-4">
          {(detailData?.reservations ?? []).map((reservation) => (
            <div key={reservation.reservation_id} className="card p-4">
              <div
                className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors ${reservation.reservation_id ? "cursor-pointer hover:bg-[var(--bg-body)]" : ""}`}
                onClick={() => openReservation(reservation.reservation_id)}
              >
                <div>
                  <p className="text-sm font-bold text-[var(--text-primary)]">
                    Room {reservation.room_number ?? "-"} · {reservation.guest_name ?? "Unknown Guest"}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Booking: {reservation.booking_code ?? "-"} · Reservation: {reservation.reservation_id}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="text-[var(--text-secondary)]">Inflow: {fmtMoney(reservation.totals.inflow)}</p>
                  <p className="text-[var(--text-secondary)]">Refund: {fmtMoney(reservation.totals.refunds)}</p>
                  <p className="font-semibold text-[var(--text-primary)]">Net: {fmtMoney(reservation.totals.net)}</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left py-2">Time</th>
                      <th className="text-left py-2">Category</th>
                      <th className="text-left py-2">Method</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-left py-2">Cashier</th>
                      <th className="text-left py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservation.entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={`border-b border-[var(--border-subtle)] ${reservation.reservation_id ? "cursor-pointer hover:bg-[var(--bg-body)]/70" : ""}`}
                        onClick={() => openReservation(reservation.reservation_id)}
                      >
                        <td className="py-2">{fmtDateTime(entry.paid_at)}</td>
                        <td className="py-2">{CATEGORY_LABEL[entry.revenue_category]}</td>
                        <td className="py-2">{METHOD_LABEL[entry.method]}</td>
                        <td className="py-2 capitalize">{entry.tx_type}</td>
                        <td className="py-2 text-right">{fmtMoney(entry.signed_amount)}</td>
                        <td className="py-2">{entry.cashier_name ?? "-"}</td>
                        <td className="py-2">{entry.note ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {(detailData?.reservations ?? []).length === 0 && (
            <div className="card p-8 text-center text-[var(--text-secondary)]">No folio details in selected dates.</div>
          )}
        </div>
      )}

      {detailResId && (
        <ReservationDetailPage
          mode="edit"
          reservationId={detailResId}
          onClose={() => setDetailResId(null)}
          onSuccess={() => {
            setDetailResId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
