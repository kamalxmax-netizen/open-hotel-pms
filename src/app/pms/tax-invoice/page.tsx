"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TaxInvoiceStatus, TaxInvoiceLanguage, TaxInvoiceKind } from "@/lib/tax-invoice/types";
import { fmtDate, fmtMoney } from "@/lib/tax-invoice/utils";

/* ─── Types ─────────────────────────────────────────── */

interface PendingRequest {
  reservation_id: string;
  reservation_ids: string[];
  booking_code: string;
  guest_name: string;
  room_numbers: string[];
  checkin_date: string;
  checkout_date: string;
  total_amount: number;
  combine_eligible?: boolean;
  booking_group_id?: string | null;
  member_reservations: Array<{
    reservation_id: string;
    booking_code: string | null;
    guest_name: string | null;
    room_numbers: string[];
    total_amount: number;
  }>;
}

interface InvoiceHistoryItem {
  id: string;
  invoice_no: string;
  reservation_id: string;
  guest_name: string;
  issue_date: string;
  status: TaxInvoiceStatus;
  grand_total: number;
  language: TaxInvoiceLanguage;
  can_edit?: boolean;
  can_reuse_invoice_no?: boolean;
  has_edit_log?: boolean;
  invoice_kind?: TaxInvoiceKind;
  split_group_id?: string | null;
  coverage_amount?: number | null;
}

type AuditHistoryRow = {
  id: string;
  actor_name: string;
  action: string;
  note: string | null;
  created_at: string;
  before_json: any;
  after_json: any;
};

/* ─── Mock Data (Until API is ready) ─────────────────── */

const MOCK_PENDING: PendingRequest[] = [
  {
    reservation_id: "res-1",
    reservation_ids: ["res-1"],
    booking_code: "BK12345",
    guest_name: "John Doe",
    room_numbers: ["201"],
    checkin_date: "2026-03-25",
    checkout_date: "2026-03-28",
    total_amount: 4500,
    member_reservations: [
      {
        reservation_id: "res-1",
        booking_code: "BK12345",
        guest_name: "John Doe",
        room_numbers: ["201"],
        total_amount: 4500,
      },
    ],
  },
  {
    reservation_id: "res-2",
    reservation_ids: ["res-2", "res-3"],
    booking_code: "BK67890",
    guest_name: "Jane Smith",
    room_numbers: ["304", "305"],
    checkin_date: "2026-03-26",
    checkout_date: "2026-03-29",
    total_amount: 9000,
    combine_eligible: true,
    member_reservations: [
      {
        reservation_id: "res-2",
        booking_code: "BK67890",
        guest_name: "Jane Smith",
        room_numbers: ["304"],
        total_amount: 4500,
      },
      {
        reservation_id: "res-3",
        booking_code: "BK67891",
        guest_name: "Jane Smith",
        room_numbers: ["305"],
        total_amount: 4500,
      },
    ],
  },
];

const MOCK_HISTORY: InvoiceHistoryItem[] = [
  {
    id: "inv-1",
    invoice_no: "IV26001",
    reservation_id: "res-old-1",
    guest_name: "Somchai Saetang",
    issue_date: "2026-03-20",
    status: "issued",
    grand_total: 3500,
    language: "th",
  },
  {
    id: "inv-2",
    invoice_no: "IV26002",
    reservation_id: "res-old-2",
    guest_name: "Alice Cooper",
    issue_date: "2026-03-22",
    status: "cancelled",
    grand_total: 1200,
    language: "en",
  },
];

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(value: unknown) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function summarizeAuditChange(row: AuditHistoryRow) {
  const before = row.before_json || {};
  const after = row.after_json || {};
  const changes: string[] = [];

  if (before.language !== after.language) changes.push(`Language ${before.language || "-"} -> ${after.language || "-"}`);
  if (before.customer_name !== after.customer_name) changes.push("Customer name");
  if (before.customer_tax_id !== after.customer_tax_id) changes.push("Tax ID");
  if (before.customer_address !== after.customer_address) changes.push("Address");
  if (before.customer_branch !== after.customer_branch) changes.push("Branch");
  if (Number(before.grand_total || 0) !== Number(after.grand_total || 0)) {
    changes.push(`Total ${formatAmount(before.grand_total)} -> ${formatAmount(after.grand_total)}`);
  }
  const beforeItems = Array.isArray(before.line_items) ? before.line_items.length : 0;
  const afterItems = Array.isArray(after.line_items) ? after.line_items.length : 0;
  if (beforeItems !== afterItems) changes.push(`Items ${beforeItems} -> ${afterItems}`);

  return changes.length > 0 ? changes.join(" · ") : "Document fields updated";
}

function issueHref(reservationId: string, reservationIds: string[], kind: TaxInvoiceKind = "standard") {
  const params = new URLSearchParams();
  if (reservationIds.length > 1) params.set("reservation_ids", reservationIds.join(","));
  if (kind !== "standard") params.set("invoice_kind", kind);
  const query = params.toString();
  return `/pms/tax-invoice/issue/${reservationId}${query ? `?${query}` : ""}`;
}

/* ─── Components ────────────────────────────────────── */

export default function TaxInvoiceListPage() {
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [history, setHistory] = useState<InvoiceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState<{ id: string; invoiceNo: string; canReuseInvoiceNo: boolean } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReuseMode, setCancelReuseMode] = useState<"continue" | "reuse">("continue");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [editLogTarget, setEditLogTarget] = useState<InvoiceHistoryItem | null>(null);
  const [editLogRows, setEditLogRows] = useState<AuditHistoryRow[]>([]);
  const [editLogLoading, setEditLogLoading] = useState(false);
  const [editLogError, setEditLogError] = useState("");

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCancelled]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tax-invoice?include_pending=true&include_cancelled=${showCancelled ? "true" : "false"}`, { cache: "no-store" });
      const result = await res.json();
      if (!result?.success) throw new Error(String(result?.error || "Failed"));

      const nextPending: PendingRequest[] = Array.isArray(result.pending_reservations)
        ? result.pending_reservations.map((row: any) => ({
            reservation_id: String(row.reservation_id || row.id || ""),
            reservation_ids: Array.isArray(row.reservation_ids)
              ? row.reservation_ids.map((value: any) => String(value))
              : [String(row.reservation_id || row.id || "")],
            booking_code: String(row.booking_code || "-"),
            guest_name: String(row.guest_name || "-"),
            room_numbers: Array.isArray(row.room_numbers) ? row.room_numbers.map((x: any) => String(x)) : [],
            checkin_date: String(row.checkin_date || ""),
            checkout_date: String(row.checkout_date || ""),
            total_amount: Number(row.total_amount || 0),
            combine_eligible: Boolean(row.combine_eligible),
            booking_group_id: row.booking_group_id ? String(row.booking_group_id) : null,
            member_reservations: Array.isArray(row.member_reservations)
              ? row.member_reservations.map((member: any) => ({
                  reservation_id: String(member.reservation_id || ""),
                  booking_code: member.booking_code ? String(member.booking_code) : null,
                  guest_name: member.guest_name ? String(member.guest_name) : null,
                  room_numbers: Array.isArray(member.room_numbers) ? member.room_numbers.map((value: any) => String(value)) : [],
                  total_amount: Number(member.total_amount || 0),
                }))
              : [],
          }))
        : [];

      const nextHistory: InvoiceHistoryItem[] = Array.isArray(result.data)
        ? result.data.map((row: any) => ({
            id: String(row.id || ""),
            invoice_no: String(row.invoice_no || "Draft"),
            reservation_id: String(row.reservation_id || ""),
            guest_name: String(row.reservation?.guest_name || row.customer_name || "-"),
            issue_date: String(row.issue_date || ""),
            status: String(row.status || "draft") as TaxInvoiceStatus,
            grand_total: Number(row.grand_total || 0),
            language: (String(row.language || "th") === "en" ? "en" : "th") as TaxInvoiceLanguage,
            can_edit: Boolean(row.can_edit),
            can_reuse_invoice_no: Boolean(row.can_reuse_invoice_no),
            has_edit_log: Boolean(row.has_edit_log),
            invoice_kind: (["prepayment", "balance"].includes(String(row.invoice_kind))
              ? String(row.invoice_kind)
              : "standard") as TaxInvoiceKind,
            split_group_id: row.split_group_id ? String(row.split_group_id) : null,
            coverage_amount: row.coverage_amount == null ? null : Number(row.coverage_amount),
          }))
        : [];

      setPending(nextPending);
      setHistory(nextHistory);
      setIsAdmin(Boolean(result.viewer_is_admin));
    } catch (error) {
      console.error("Failed to fetch tax invoice list:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleCancelConfirm = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) {
      setCancelError("กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร");
      return;
    }
    setCancelLoading(true);
    setCancelError("");
    try {
      const res = await fetch(`/api/tax-invoice/${cancelTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancel_reason: cancelReason.trim(),
          reuse_invoice_no: cancelTarget.canReuseInvoiceNo && cancelReuseMode === "reuse",
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Cancel failed");
      }
      setCancelTarget(null);
      setCancelReason("");
      setCancelReuseMode("continue");
      fetchData(); // reload list
    } catch (err: any) {
      setCancelError(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setCancelLoading(false);
    }
  };

  const openEditLog = async (invoice: InvoiceHistoryItem) => {
    setEditLogTarget(invoice);
    setEditLogRows([]);
    setEditLogError("");
    setEditLogLoading(true);
    try {
      const res = await fetch(`/api/audit/entity/tax_invoice/${invoice.id}`, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to load edit log");
      }
      setEditLogRows(Array.isArray(result.history) ? result.history : []);
    } catch (err: any) {
      setEditLogError(err.message || "Failed to load edit log");
    } finally {
      setEditLogLoading(false);
    }
  };

  const filteredPending = pending.filter(p =>
    p.guest_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.booking_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.room_numbers.some(r => r.includes(searchQuery)) ||
    p.member_reservations.some(member =>
      (member.booking_code || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.room_numbers.some(r => r.includes(searchQuery))
    )
  );

  const filteredHistory = history.filter(h => 
    h.guest_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    h.invoice_no.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Accounting</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Tax Invoices</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Manage and issue official tax receipts</p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "history" && isAdmin && (
            <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
              />
              แสดงรายการที่ยกเลิกแล้ว
            </label>
          )}
          <input 
            type="text" 
            placeholder="Search guest, room, or invoice..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input w-64 md:w-80"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-default)]">
        <button 
          onClick={() => setActiveTab("pending")}
          className={`px-6 py-3 text-sm font-semibold transition-colors relative ${activeTab === "pending" ? "text-brand-600" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
        >
          Pending Requests
          {activeTab === "pending" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
          {pending.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-brand-100 text-brand-700 rounded-full dark:bg-brand-500/20 dark:text-brand-400">
              {pending.length}
            </span>
          )}
        </button>
        <button 
          onClick={() => setActiveTab("history")}
          className={`px-6 py-3 text-sm font-semibold transition-colors relative ${activeTab === "history" ? "text-brand-600" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
        >
          Invoice History
          {activeTab === "history" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
        </button>
      </div>

      {/* Content */}
      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] overflow-hidden shadow-sm">
        {activeTab === "pending" ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-muted)] border-b border-[var(--border-default)]">
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Guest / Booking</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Rooms</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Stay Period</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] text-right">Amount</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredPending.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-[var(--text-muted)] italic">No pending requests found</td>
                </tr>
              ) : (
                filteredPending.map((p) => (
                  <tr key={p.reservation_id} className="hover:bg-[var(--bg-body)]/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{p.guest_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{p.booking_code}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {p.room_numbers.map(r => (
                          <span key={r} className="px-2 py-0.5 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 rounded text-xs font-bold border border-sky-100 dark:border-sky-500/20">
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-[var(--text-table-cell)]">
                        {fmtDate(p.checkin_date, "en")} – {fmtDate(p.checkout_date, "en")}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-semibold text-[var(--text-primary)]">
                      {fmtMoney(p.total_amount)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {p.member_reservations.map((member) => (
                          <Link
                            key={member.reservation_id}
                            href={issueHref(member.reservation_id, [member.reservation_id])}
                            className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-[var(--border-default)] text-[11px] font-bold text-[var(--text-primary)] hover:border-brand-300 hover:text-brand-600 transition"
                          >
                            {member.room_numbers.join(", ") || member.booking_code || "Separate"}
                          </Link>
                        ))}
                        {p.combine_eligible && p.reservation_ids.length > 1 && (
                          <Link
                            href={issueHref(p.reservation_id, p.reservation_ids)}
                            className="inline-flex items-center justify-center px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition shadow-sm"
                          >
                            Combine
                          </Link>
                        )}
                        {isAdmin && (
                          <>
                            <Link
                              href={issueHref(p.reservation_id, p.reservation_ids, "prepayment")}
                              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] font-bold text-amber-700 hover:bg-amber-100 transition dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              Prepayment
                            </Link>
                            <Link
                              href={issueHref(p.reservation_id, p.reservation_ids, "balance")}
                              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                            >
                              Balance
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-muted)] border-b border-[var(--border-default)]">
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Invoice No / Date</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Guest Name</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Status</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] text-right">Total</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-[var(--text-muted)] italic">No invoice history found</td>
                </tr>
              ) : (
                filteredHistory.map((h) => {
                  const isCancelled = h.status === "cancelled";
                  return (
                    <tr key={h.id} className={`transition-colors ${isCancelled ? "opacity-50 bg-rose-50/30 dark:bg-rose-500/5" : "hover:bg-[var(--bg-body)]/50"}`}>
                      <td className="px-6 py-4">
                        <p className={`text-sm font-bold ${isCancelled ? "text-rose-400 line-through" : "text-brand-600 dark:text-brand-400"}`}>
                          {h.invoice_no}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <KindBadge kind={h.invoice_kind ?? "standard"} />
                          {h.split_group_id && (
                            <span className="text-[9px] px-1 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-muted)]">
                              Split {h.split_group_id.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] text-[var(--text-muted)] uppercase">{fmtDate(h.issue_date, "en")}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-primary)] font-medium">
                        {h.guest_name}
                        <span className="ml-2 text-[10px] px-1 bg-[var(--bg-muted)] rounded text-[var(--text-muted)] border border-[var(--border-subtle)]">
                          {h.language.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={h.status} />
                      </td>
                      <td className={`px-6 py-4 text-right font-mono font-semibold ${isCancelled ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]"}`}>
                        {fmtMoney(h.grand_total)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isCancelled && (isAdmin || (h.can_edit && (h.invoice_kind ?? "standard") === "standard")) && (
                            <Link
                              href={`/pms/tax-invoice/edit/${h.id}`}
                              className="p-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-muted)] hover:text-brand-600 transition"
                              title="Edit"
                            >
                              ✏️
                            </Link>
                          )}
                          {isAdmin && h.has_edit_log && (
                            <button
                              onClick={() => openEditLog(h)}
                              className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-500/20 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
                              title="Edit invoice log"
                            >
                              ⚠️
                            </button>
                          )}
                          <Link
                            href={`/pms/tax-invoice/preview/${h.id}`}
                            className="p-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-muted)] hover:text-sky-600 transition"
                            title="Preview & Print"
                          >
                            🖨️
                          </Link>
                          {!isCancelled && isAdmin && (
                            <button
                              onClick={() => {
                                setCancelTarget({ id: h.id, invoiceNo: h.invoice_no, canReuseInvoiceNo: Boolean(h.can_reuse_invoice_no) });
                                setCancelReason("");
                                setCancelReuseMode("continue");
                                setCancelError("");
                              }}
                              className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/20 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition"
                              title="Cancel Invoice (Admin)"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--bg-surface)] w-full max-w-md rounded-2xl shadow-2xl border border-[var(--border-default)] overflow-hidden">
            <div className="bg-rose-50 dark:bg-rose-500/10 p-6 flex items-center gap-4 border-b border-rose-100 dark:border-rose-500/20">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center text-2xl">🗑️</div>
              <div>
                <h3 className="text-lg font-bold text-rose-900 dark:text-rose-400">ยกเลิก Invoice</h3>
                <p className="text-xs text-rose-700/70 dark:text-rose-400/60 mt-0.5 font-mono">{cancelTarget.invoiceNo}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-400 leading-relaxed">
                {cancelTarget.canReuseInvoiceNo
                  ? <>⚠️ ใบนี้เป็นเลขล่าสุด คุณเลือกได้ว่าจะให้เลข <strong>{cancelTarget.invoiceNo}</strong> ถูกรันต่อไป หรือเก็บเลขนี้ไว้ใช้กับใบใหม่ใบถัดไปเพื่อคง Audit Trail</>
                  : <>⚠️ เลข Invoice <strong>{cancelTarget.invoiceNo}</strong> จะถูกขีดฆ่าและเลขถัดไปจะรันต่อเนื่อง เพื่อคง Audit Trail</>}
              </div>
              {cancelTarget.canReuseInvoiceNo && (
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-[var(--text-primary)]">การจัดการเลข Invoice</label>
                  <label className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] p-3 cursor-pointer">
                    <input
                      type="radio"
                      name="cancelReuseMode"
                      checked={cancelReuseMode === "continue"}
                      onChange={() => setCancelReuseMode("continue")}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">
                      รันเลขต่อไป
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] p-3 cursor-pointer">
                    <input
                      type="radio"
                      name="cancelReuseMode"
                      checked={cancelReuseMode === "reuse"}
                      onChange={() => setCancelReuseMode("reuse")}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">
                      เก็บเลขนี้ไว้ให้ใบใหม่ใบถัดไปใช้ต่อ
                    </span>
                  </label>
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-[var(--text-primary)] mb-2">
                  เหตุผลการยกเลิก <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => { setCancelReason(e.target.value); setCancelError(""); }}
                  placeholder="ระบุเหตุผล เช่น ออกเลขผิด, ลูกค้าเปลี่ยนใจ..."
                  rows={3}
                  className="form-input w-full resize-none"
                />
                {cancelError && <p className="mt-1 text-xs text-rose-600">{cancelError}</p>}
              </div>
            </div>
            <div className="bg-[var(--bg-muted)] p-4 flex gap-3 justify-end border-t border-[var(--border-default)]">
              <button
                onClick={() => { setCancelTarget(null); setCancelReason(""); setCancelReuseMode("continue"); setCancelError(""); }}
                disabled={cancelLoading}
                className="px-6 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-body)] transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleCancelConfirm}
                disabled={cancelLoading || cancelReason.trim().length < 3}
                className="px-8 py-2 rounded-xl bg-rose-600 text-white text-sm font-extrabold shadow-lg hover:bg-rose-700 transition flex items-center gap-2 disabled:opacity-50"
              >
                {cancelLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                ยืนยันยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {editLogTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--bg-surface)] w-full max-w-2xl rounded-2xl shadow-2xl border border-[var(--border-default)] overflow-hidden">
            <div className="bg-amber-50 dark:bg-amber-500/10 p-5 flex items-center justify-between gap-4 border-b border-amber-100 dark:border-amber-500/20">
              <div>
                <h3 className="text-lg font-bold text-amber-900 dark:text-amber-400">Edit Invoice Log</h3>
                <p className="text-xs text-amber-700/70 dark:text-amber-400/60 mt-0.5 font-mono">{editLogTarget.invoice_no}</p>
              </div>
              <button
                onClick={() => setEditLogTarget(null)}
                className="w-9 h-9 rounded-xl border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/10"
              >
                ×
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {editLogLoading ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)]">Loading edit log...</div>
              ) : editLogError ? (
                <div className="px-6 py-10 text-sm text-rose-600">{editLogError}</div>
              ) : editLogRows.length === 0 ? (
                <div className="px-6 py-10 text-sm text-[var(--text-muted)] italic">
                  This invoice has an older edit marker, but no detailed audit rows were recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {editLogRows.map((row) => (
                    <div key={row.id} className="px-6 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-[var(--text-primary)]">{summarizeAuditChange(row)}</p>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">{row.note || "No reason provided"}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-[var(--text-primary)]">{row.actor_name || "System"}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{formatDateTime(row.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: TaxInvoiceStatus }) {
  const styles = {
    issued: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
    draft: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    cancelled: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${styles[status]}`}>
      {status}
    </span>
  );
}

function KindBadge({ kind }: { kind: TaxInvoiceKind }) {
  const styles: Record<TaxInvoiceKind, string> = {
    standard: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-slate-300 dark:border-white/10",
    prepayment: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
    balance: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${styles[kind]}`}>
      {kind}
    </span>
  );
}
