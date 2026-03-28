"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TaxInvoiceStatus, TaxInvoiceLanguage } from "@/lib/tax-invoice/types";
import { fmtDate, fmtMoney } from "@/lib/tax-invoice/utils";

/* ─── Types ─────────────────────────────────────────── */

interface PendingRequest {
  reservation_id: string;
  booking_code: string;
  guest_name: string;
  room_numbers: string[];
  checkin_date: string;
  checkout_date: string;
  total_amount: number;
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
}

/* ─── Mock Data (Until API is ready) ─────────────────── */

const MOCK_PENDING: PendingRequest[] = [
  {
    reservation_id: "res-1",
    booking_code: "BK12345",
    guest_name: "John Doe",
    room_numbers: ["201"],
    checkin_date: "2026-03-25",
    checkout_date: "2026-03-28",
    total_amount: 4500,
  },
  {
    reservation_id: "res-2",
    booking_code: "BK67890",
    guest_name: "Jane Smith",
    room_numbers: ["304", "305"],
    checkin_date: "2026-03-26",
    checkout_date: "2026-03-29",
    total_amount: 9000,
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

/* ─── Components ────────────────────────────────────── */

export default function TaxInvoiceListPage() {
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [history, setHistory] = useState<InvoiceHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState<{ id: string; invoiceNo: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch("/api/tax-invoice?include_pending=true", { cache: "no-store" });
        const result = await res.json();
        if (!result?.success) {
          throw new Error(String(result?.error || "Failed to load tax invoice list"));
        }

        const nextPending: PendingRequest[] = Array.isArray(result.pending_reservations)
          ? result.pending_reservations.map((row: any) => ({
              reservation_id: String(row.reservation_id || row.id || ""),
              booking_code: String(row.booking_code || "-"),
              guest_name: String(row.guest_name || "-"),
              room_numbers: Array.isArray(row.room_numbers) ? row.room_numbers.map((x: any) => String(x)) : [],
              checkin_date: String(row.checkin_date || ""),
              checkout_date: String(row.checkout_date || ""),
              total_amount: Number(row.total_amount || 0),
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
            }))
          : [];

        setPending(nextPending);
        setHistory(nextHistory);
      } catch (error) {
        console.error("Failed to fetch tax invoice list:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/tax-invoice?include_pending=true", { cache: "no-store" });
      const result = await res.json();
      if (!result?.success) throw new Error(String(result?.error || "Failed"));

      const nextPending: PendingRequest[] = Array.isArray(result.pending_reservations)
        ? result.pending_reservations.map((row: any) => ({
            reservation_id: String(row.reservation_id || row.id || ""),
            booking_code: String(row.booking_code || "-"),
            guest_name: String(row.guest_name || "-"),
            room_numbers: Array.isArray(row.room_numbers) ? row.room_numbers.map((x: any) => String(x)) : [],
            checkin_date: String(row.checkin_date || ""),
            checkout_date: String(row.checkout_date || ""),
            total_amount: Number(row.total_amount || 0),
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
          }))
        : [];

      setPending(nextPending);
      setHistory(nextHistory);
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
        body: JSON.stringify({ cancel_reason: cancelReason.trim() }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Cancel failed");
      }
      setCancelTarget(null);
      setCancelReason("");
      fetchData(); // reload list
    } catch (err: any) {
      setCancelError(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setCancelLoading(false);
    }
  };

  const filteredPending = pending.filter(p =>
    p.guest_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.booking_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.room_numbers.some(r => r.includes(searchQuery))
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
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">🔍</span>
            <input 
              type="text" 
              placeholder="Search guest, room, or invoice..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input pl-9 w-64 md:w-80"
            />
          </div>
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
                      <Link 
                        href={`/pms/tax-invoice/issue/${p.reservation_id}`}
                        className="inline-flex items-center justify-center px-4 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition shadow-sm"
                      >
                        Issue Invoice
                      </Link>
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
                filteredHistory.map((h) => (
                  <tr key={h.id} className="hover:bg-[var(--bg-body)]/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-brand-600 dark:text-brand-400">{h.invoice_no}</p>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase">{fmtDate(h.issue_date, "en")}</p>
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
                    <td className="px-6 py-4 text-right font-mono font-semibold text-[var(--text-primary)]">
                      {fmtMoney(h.grand_total)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link 
                          href={`/pms/tax-invoice/edit/${h.id}`}
                          className="p-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-muted)] hover:text-brand-600 transition"
                          title="Edit"
                        >
                          ✏️
                        </Link>
                        <Link 
                          href={`/pms/tax-invoice/preview/${h.id}`}
                          className="p-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-muted)] hover:text-sky-600 transition"
                          title="Preview & Print"
                        >
                          🖨️
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
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
