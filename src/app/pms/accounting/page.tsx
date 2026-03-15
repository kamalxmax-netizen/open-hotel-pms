"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TabKey = "transfer" | "transfer_tx" | "commission" | "tip";

type TransferRow = {
  transfer_id: string;
  guest_name: string;
  booking_code: string | null;
  room_number: string | null;
  route: string;
  selling_price: number;
  cost_price: number;
  margin: number;
  commission: number;
  net: number;
  status: string;
  payment_status: string;
  date: string;
  driver_name: string | null;
};

type TransferReport = {
  kpis: {
    gross_sell: number;
    total_cost: number;
    gross_margin: number;
    commission_payable: number;
    net_margin: number;
  };
  transfers: TransferRow[];
};

type CommissionRow = {
  id: string;
  transfer_id: string;
  staff_name: string;
  base_amount: number;
  commission_amount: number;
  status: "pending" | "approved" | "paid" | "reversed";
  payout_cycle: "monthly" | "bimonthly";
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  reversal_reason: string | null;
  created_at: string;
};

type TipRow = {
  id: string;
  tip_type: "unassigned" | "manual_staff";
  reservation_id: string | null;
  guest_profile_id: string | null;
  transfer_id: string | null;
  amount: number;
  payment_method: "cash" | "transfer" | "credit_card";
  assigned_to: string | null;
  status: "pending" | "approved" | "paid" | "reversed";
  note: string | null;
  created_at: string;
  reversal_reason: string | null;
};

type TipEligibleStatus = "due_in" | "due_out" | "in_house";

type TipEligibleReservation = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string;
  room_number: string | null;
  status: TipEligibleStatus;
};

type TransferTransactionRow = {
  id: string;
  transfer_id: string;
  reservation_id: string | null;
  tx_type: "charge" | "refund" | "adjustment";
  amount: number;
  payment_method: "cash" | "transfer" | "credit_card" | null;
  cashier_name: string | null;
  note: string | null;
  transaction_date: string;
  created_at: string;
};

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtMoney(value: number): string {
  return `฿${Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value: string | null | undefined): string {
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

const TIP_STATUS_LABEL: Record<TipEligibleStatus, string> = {
  due_in: "Due In",
  due_out: "Due Out",
  in_house: "In House",
};

export default function AccountingPage() {
  const today = useMemo(() => toDateInput(new Date()), []);
  const [tab, setTab] = useState<TabKey>("transfer");
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [report, setReport] = useState<TransferReport | null>(null);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [commissionStatus, setCommissionStatus] = useState<string>("all");
  const [tips, setTips] = useState<TipRow[]>([]);
  const [tipStatus, setTipStatus] = useState<string>("all");
  const [transferTxRows, setTransferTxRows] = useState<TransferTransactionRow[]>([]);
  const [transferTxType, setTransferTxType] = useState<"all" | "charge" | "refund" | "adjustment">("all");

  const [tipType, setTipType] = useState<"unassigned" | "manual_staff">("unassigned");
  const [tipAmount, setTipAmount] = useState<string>("");
  const [tipMethod, setTipMethod] = useState<"cash" | "transfer" | "credit_card">("cash");
  const [tipAssignedTo, setTipAssignedTo] = useState<string>("");
  const [tipReservationId, setTipReservationId] = useState<string>("");
  const [tipNote, setTipNote] = useState<string>("");
  const [tipCandidates, setTipCandidates] = useState<TipEligibleReservation[]>([]);
  const [tipCandidateLoading, setTipCandidateLoading] = useState<boolean>(false);
  const [tipCandidateStatus, setTipCandidateStatus] = useState<"all" | TipEligibleStatus>("all");
  const [tipCandidateSearch, setTipCandidateSearch] = useState<string>("");
  const [showTipValidation, setShowTipValidation] = useState<boolean>(false);

  const loadTransferReport = useCallback(async () => {
    const params = new URLSearchParams({
      date_from: startDate,
      date_to: endDate,
    });
    const res = await fetch(`/api/accounting/transfer-report?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to load transfer report.");
    }
    setReport({
      kpis: data.kpis,
      transfers: data.transfers ?? [],
    });
  }, [startDate, endDate]);

  const loadCommissions = useCallback(async () => {
    const params = new URLSearchParams({
      date_from: startDate,
      date_to: endDate,
    });
    if (commissionStatus !== "all") params.set("status", commissionStatus);
    const res = await fetch(`/api/accounting/commissions?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to load commissions.");
    }
    setCommissions(data.items ?? []);
  }, [commissionStatus, startDate, endDate]);

  const loadTransferTransactions = useCallback(async () => {
    const params = new URLSearchParams({
      date_from: startDate,
      date_to: endDate,
      limit: "500",
    });
    if (transferTxType !== "all") params.set("tx_type", transferTxType);
    const res = await fetch(`/api/accounting/transfer-transactions?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to load transfer transactions.");
    }
    setTransferTxRows((data.items ?? []) as TransferTransactionRow[]);
  }, [startDate, endDate, transferTxType]);

  const loadTips = useCallback(async () => {
    const params = new URLSearchParams({
      date_from: startDate,
      date_to: endDate,
    });
    if (tipStatus !== "all") params.set("status", tipStatus);
    const res = await fetch(`/api/accounting/tips?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to load tips.");
    }
    setTips(data.items ?? []);
  }, [tipStatus, startDate, endDate]);

  const loadTipCandidates = useCallback(async () => {
    setTipCandidateLoading(true);
    try {
      const [arrivalsRes, departuresRes, inhouseRes] = await Promise.all([
        fetch("/api/arrivals"),
        fetch("/api/departures"),
        fetch("/api/inhouse"),
      ]);
      const [arrivalsJson, departuresJson, inhouseJson] = await Promise.all([
        arrivalsRes.json(),
        departuresRes.json(),
        inhouseRes.json(),
      ]);

      const byReservation = new Map<string, TipEligibleReservation>();

      for (const row of (arrivalsJson?.arrivals ?? []) as Array<Record<string, unknown>>) {
        const reservationId = String(row.id ?? "");
        if (!reservationId) continue;
        byReservation.set(reservationId, {
          reservation_id: reservationId,
          booking_code: row.booking_code ? String(row.booking_code) : null,
          guest_name: row.guest_name ? String(row.guest_name) : "Unknown Guest",
          room_number: row.room_number ? String(row.room_number) : null,
          status: "due_in",
        });
      }

      for (const row of (inhouseJson?.reservations ?? []) as Array<Record<string, unknown>>) {
        const reservationId = String(row.id ?? "");
        if (!reservationId) continue;
        const existing = byReservation.get(reservationId);
        byReservation.set(reservationId, {
          reservation_id: reservationId,
          booking_code: row.booking_code ? String(row.booking_code) : existing?.booking_code ?? null,
          guest_name: row.guest_name ? String(row.guest_name) : existing?.guest_name ?? "Unknown Guest",
          room_number: row.room_number ? String(row.room_number) : existing?.room_number ?? null,
          status: existing?.status === "due_out" ? "due_out" : "in_house",
        });
      }

      for (const row of (departuresJson?.departures ?? []) as Array<Record<string, unknown>>) {
        const reservationId = String(row.id ?? "");
        if (!reservationId) continue;
        byReservation.set(reservationId, {
          reservation_id: reservationId,
          booking_code: row.booking_code ? String(row.booking_code) : null,
          guest_name: row.guest_name ? String(row.guest_name) : "Unknown Guest",
          room_number: row.room_number ? String(row.room_number) : null,
          status: "due_out",
        });
      }

      const merged = Array.from(byReservation.values()).sort((a, b) => {
        const roomA = a.room_number ?? "";
        const roomB = b.room_number ?? "";
        if (roomA !== roomB) {
          return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: "base" });
        }
        return a.guest_name.localeCompare(b.guest_name, undefined, { sensitivity: "base" });
      });
      setTipCandidates(merged);
    } catch (err) {
      console.error("loadTipCandidates failed", err);
      setTipCandidates([]);
    } finally {
      setTipCandidateLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      if (tab === "transfer") await loadTransferReport();
      if (tab === "transfer_tx") await loadTransferTransactions();
      if (tab === "commission") await loadCommissions();
      if (tab === "tip") await loadTips();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [tab, loadTransferReport, loadTransferTransactions, loadCommissions, loadTips]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (tab !== "tip") return;
    loadTipCandidates();
  }, [tab, loadTipCandidates]);

  const filteredTipCandidates = useMemo(() => {
    const q = tipCandidateSearch.trim().toLowerCase();
    return tipCandidates.filter((row) => {
      if (tipCandidateStatus !== "all" && row.status !== tipCandidateStatus) return false;
      if (!q) return true;
      return (
        row.guest_name.toLowerCase().includes(q) ||
        String(row.room_number ?? "").toLowerCase().includes(q) ||
        String(row.booking_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [tipCandidates, tipCandidateSearch, tipCandidateStatus]);

  async function runCommissionAction(id: string, action: "approve" | "mark_paid" | "reverse") {
    const payload: Record<string, unknown> = { action };
    if (action === "approve") payload.approved_by = "FO";
    if (action === "reverse") {
      const reason = window.prompt("Reversal reason (required):", "");
      if (!reason || !reason.trim()) return;
      payload.reversal_reason = reason.trim();
    }

    const res = await fetch(`/api/accounting/commissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Commission action failed.");
    }
  }

  async function runTipAction(id: string, action: "approve" | "mark_paid" | "reverse") {
    const payload: Record<string, unknown> = { action };
    if (action === "reverse") {
      const reason = window.prompt("Reversal reason (required):", "");
      if (!reason || !reason.trim()) return;
      payload.reversal_reason = reason.trim();
    }

    const res = await fetch(`/api/accounting/tips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Tip action failed.");
    }
  }

  async function submitTip() {
    setShowTipValidation(true);
    const amount = Number(tipAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Tip amount must be greater than 0.");
      return;
    }

    const payload: Record<string, unknown> = {
      tip_type: tipType,
      amount,
      payment_method: tipMethod,
      assigned_to: tipAssignedTo || undefined,
      note: tipNote || undefined,
      recorded_by: "FO",
    };
    if (tipType === "manual_staff") {
      if (!tipReservationId) {
        setError("Please select reservation for Manual Staff tip.");
        return;
      }
      payload.reservation_id = tipReservationId;
    }

    const res = await fetch("/api/accounting/tips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Failed to create tip.");
    }

    setTipAmount("");
    setTipAssignedTo("");
    setTipReservationId("");
    setTipNote("");
    setShowTipValidation(false);
    await loadTips();
  }

  const tipAmountInvalid = showTipValidation && (!Number.isFinite(Number(tipAmount)) || Number(tipAmount) <= 0);
  const tipReservationInvalid = showTipValidation && tipType === "manual_staff" && !tipReservationId;

  return (
    <div className="flex flex-col gap-5 max-w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Commission and Tips</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Commission and Tips</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Commission workflow and tip ledger in one place.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData} disabled={loading}>
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === "transfer" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
              }`}
            onClick={() => setTab("transfer")}
          >
            Transfer Revenue
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === "transfer_tx" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
              }`}
            onClick={() => setTab("transfer_tx")}
          >
            Transfer Transactions
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === "commission" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
              }`}
            onClick={() => setTab("commission")}
          >
            Commission
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === "tip" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
              }`}
            onClick={() => setTab("tip")}
          >
            Tips
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">From</span>
          <input className="form-input py-1 text-sm w-36" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">To</span>
          <input className="form-input py-1 text-sm w-36" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        {tab === "commission" && (
          <select
            className="form-input py-1 text-sm w-44"
            value={commissionStatus}
            onChange={(e) => setCommissionStatus(e.target.value)}
          >
            <option value="all">All Commission Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
          </select>
        )}

        {tab === "transfer_tx" && (
          <select
            className="form-input py-1 text-sm w-52"
            value={transferTxType}
            onChange={(e) => setTransferTxType(e.target.value as "all" | "charge" | "refund" | "adjustment")}
          >
            <option value="all">All Transaction Types</option>
            <option value="charge">Charge</option>
            <option value="refund">Refund</option>
            <option value="adjustment">Adjustment</option>
          </select>
        )}

        {tab === "tip" && (
          <select className="form-input py-1 text-sm w-36" value={tipStatus} onChange={(e) => setTipStatus(e.target.value)}>
            <option value="all">All Tip Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
          </select>
        )}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {tab === "transfer" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="card p-4">
              <p className="text-xs text-slate-500">Gross Sell</p>
              <p className="text-xl font-bold text-slate-900">{fmtMoney(report?.kpis.gross_sell ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500">Total Cost</p>
              <p className="text-xl font-bold text-slate-900">{fmtMoney(report?.kpis.total_cost ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500">Gross Margin</p>
              <p className="text-xl font-bold text-slate-900">{fmtMoney(report?.kpis.gross_margin ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500">Commission Payable</p>
              <p className="text-xl font-bold text-amber-700">{fmtMoney(report?.kpis.commission_payable ?? 0)}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-slate-500">Net Margin</p>
              <p className="text-xl font-bold text-emerald-700">{fmtMoney(report?.kpis.net_margin ?? 0)}</p>
            </div>
          </div>

          <div className="card p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Guest</th>
                  <th className="text-left py-2">Room</th>
                  <th className="text-left py-2">Route</th>
                  <th className="text-right py-2">Sell</th>
                  <th className="text-right py-2">Cost</th>
                  <th className="text-right py-2">Margin</th>
                  <th className="text-right py-2">Commission</th>
                  <th className="text-right py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {(report?.transfers ?? []).map((row) => (
                  <tr key={row.transfer_id} className="border-b border-slate-50">
                    <td className="py-2">{row.date}</td>
                    <td className="py-2">
                      <p className="font-medium text-slate-800">{row.guest_name}</p>
                      <p className="text-xs text-slate-400">{row.booking_code ?? "-"}</p>
                    </td>
                    <td className="py-2">{row.room_number ?? "-"}</td>
                    <td className="py-2">{row.route}</td>
                    <td className="py-2 text-right">{fmtMoney(row.selling_price)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.cost_price)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.margin)}</td>
                    <td className="py-2 text-right">{fmtMoney(row.commission)}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoney(row.net)}</td>
                  </tr>
                ))}
                {(report?.transfers ?? []).length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No transfer records in selected date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "commission" && (
        <div className="card p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2">Created</th>
                <th className="text-left py-2">Transfer</th>
                <th className="text-left py-2">Staff</th>
                <th className="text-right py-2">Base</th>
                <th className="text-right py-2">Commission</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="py-2">{formatDateTime(row.created_at)}</td>
                  <td className="py-2 text-xs">{row.transfer_id}</td>
                  <td className="py-2">{row.staff_name}</td>
                  <td className="py-2 text-right">{fmtMoney(row.base_amount)}</td>
                  <td className="py-2 text-right">{fmtMoney(row.commission_amount)}</td>
                  <td className="py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize">
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === "pending" && (
                        <button className="btn btn-secondary btn-sm" onClick={() => runCommissionAction(row.id, "approve").then(loadCommissions).catch((err) => setError(err.message))}>
                          Approve
                        </button>
                      )}
                      {row.status === "approved" && (
                        <button className="btn btn-secondary btn-sm" onClick={() => runCommissionAction(row.id, "mark_paid").then(loadCommissions).catch((err) => setError(err.message))}>
                          Mark Paid
                        </button>
                      )}
                      {row.status !== "reversed" && (
                        <button className="btn btn-secondary btn-sm" onClick={() => runCommissionAction(row.id, "reverse").then(loadCommissions).catch((err) => setError(err.message))}>
                          Reverse
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {commissions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No commission entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "transfer_tx" && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-500">Rows</p>
                <p className="text-xl font-bold text-slate-900">{transferTxRows.length}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Charge Total</p>
                <p className="text-xl font-bold text-emerald-700">
                  {fmtMoney(
                    transferTxRows
                      .filter((row) => row.tx_type === "charge")
                      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Refund Total</p>
                <p className="text-xl font-bold text-rose-700">
                  {fmtMoney(
                    transferTxRows
                      .filter((row) => row.tx_type === "refund")
                      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="card p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2">Date/Time</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Transfer ID</th>
                  <th className="text-left py-2">Reservation</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-left py-2">Method</th>
                  <th className="text-left py-2">Cashier</th>
                  <th className="text-left py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {transferTxRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50">
                    <td className="py-2">
                      <p>{row.transaction_date}</p>
                      <p className="text-xs text-slate-400">{formatDateTime(row.created_at)}</p>
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${row.tx_type === "charge"
                            ? "bg-emerald-100 text-emerald-700"
                            : row.tx_type === "refund"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                      >
                        {row.tx_type}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-600">{row.transfer_id}</td>
                    <td className="py-2 font-mono text-xs text-slate-600">{row.reservation_id ?? "-"}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoney(Number(row.amount ?? 0))}</td>
                    <td className="py-2 capitalize">{row.payment_method ?? "-"}</td>
                    <td className="py-2">{row.cashier_name ?? "-"}</td>
                    <td className="py-2 text-slate-600">{row.note ?? "-"}</td>
                  </tr>
                ))}
                {transferTxRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No transfer transactions in selected date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "tip" && (
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-bold text-slate-700 mb-3">Add Tip</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="form-input" value={tipType} onChange={(e) => setTipType(e.target.value as "unassigned" | "manual_staff")}>
                <option value="unassigned">Unassigned</option>
                <option value="manual_staff">Manual Staff</option>
              </select>
              <input
                className="form-input"
                type="number"
                min={0}
                step="0.01"
                placeholder="Amount"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
                required
                aria-invalid={tipAmountInvalid ? "true" : "false"}
              />
              {tipAmountInvalid && <p className="-mt-1 text-xs text-rose-600">Tip amount must be greater than 0.</p>}
              <select className="form-input" value={tipMethod} onChange={(e) => setTipMethod(e.target.value as "cash" | "transfer" | "credit_card")}>
                <option value="cash">Cash</option>
                <option value="transfer">Transfer</option>
                <option value="credit_card">Credit Card</option>
              </select>
              <input className="form-input" placeholder="Assigned To (optional)" value={tipAssignedTo} onChange={(e) => setTipAssignedTo(e.target.value)} />
              <input className="form-input" placeholder="Note (optional)" value={tipNote} onChange={(e) => setTipNote(e.target.value)} />
            </div>
            {tipType === "manual_staff" && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <select
                  className="form-input"
                  value={tipCandidateStatus}
                  onChange={(e) => setTipCandidateStatus(e.target.value as "all" | TipEligibleStatus)}
                  disabled={tipCandidateLoading}
                >
                  <option value="all">Today: All (Due In / Due Out / In House)</option>
                  <option value="due_in">Today: Due In</option>
                  <option value="due_out">Today: Due Out</option>
                  <option value="in_house">Today: In House</option>
                </select>
                <input
                  className="form-input"
                  placeholder="Search room or guest name"
                  value={tipCandidateSearch}
                  onChange={(e) => setTipCandidateSearch(e.target.value)}
                  disabled={tipCandidateLoading}
                />
                <select
                  className="form-input"
                  value={tipReservationId}
                  onChange={(e) => setTipReservationId(e.target.value)}
                  disabled={tipCandidateLoading}
                  aria-invalid={tipReservationInvalid ? "true" : "false"}
                >
                  <option value="">{tipCandidateLoading ? "Loading reservations..." : "Select reservation"}</option>
                  {filteredTipCandidates.map((row) => (
                    <option key={row.reservation_id} value={row.reservation_id}>
                      Room {row.room_number ?? "-"} · {row.guest_name} · {TIP_STATUS_LABEL[row.status]}
                    </option>
                  ))}
                </select>
                {tipReservationInvalid && (
                  <p className="mt-1 text-xs text-rose-600 md:col-span-3">Please select reservation for Manual Staff tip.</p>
                )}
                <p className="text-xs text-slate-500 md:col-span-3">
                  Eligible guests are limited to today&apos;s Due In, Due Out, and In House. If guest is not found, use
                  Unassigned and add note.
                </p>
              </div>
            )}
            <div className="flex justify-end mt-3">
              <button className="btn btn-primary btn-sm" onClick={() => submitTip().catch((err) => setError(err.message))}>
                Save Tip
              </button>
            </div>
          </div>

          <div className="card p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2">Created</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Assigned</th>
                  <th className="text-right py-2">Amount</th>
                  <th className="text-left py-2">Method</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-left py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {tips.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50">
                    <td className="py-2">{formatDateTime(row.created_at)}</td>
                    <td className="py-2 capitalize">{row.tip_type.replace("_", " ")}</td>
                    <td className="py-2">{row.assigned_to ?? "-"}</td>
                    <td className="py-2 text-right">{fmtMoney(row.amount)}</td>
                    <td className="py-2">{row.payment_method}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.status === "pending" && (
                          <button className="btn btn-secondary btn-sm" onClick={() => runTipAction(row.id, "approve").then(loadTips).catch((err) => setError(err.message))}>
                            Approve
                          </button>
                        )}
                        {row.status === "approved" && (
                          <button className="btn btn-secondary btn-sm" onClick={() => runTipAction(row.id, "mark_paid").then(loadTips).catch((err) => setError(err.message))}>
                            Mark Paid
                          </button>
                        )}
                        {row.status !== "reversed" && (
                          <button className="btn btn-secondary btn-sm" onClick={() => runTipAction(row.id, "reverse").then(loadTips).catch((err) => setError(err.message))}>
                            Reverse
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {tips.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No tip entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
