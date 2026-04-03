"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import TaxInvoiceForm from "../../tax-invoice-form";
import { BuildLineItemsResult } from "@/lib/tax-invoice/types";
import { formatDateRangeDisplay } from "@/lib/date-display";

type DocType = "invoice" | "receipt";

export default function TaxInvoiceIssuePage() {
  const { resId } = useParams<{ resId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<BuildLineItemsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [docType, setDocType] = useState<DocType>("invoice");

  // Receipt form state
  const [rcLanguage, setRcLanguage] = useState<"th" | "en">("th");
  const [rcNote, setRcNote] = useState("");
  const [rcLoading, setRcLoading] = useState(false);
  const reservationIds = useMemo(
    () =>
      Array.from(
        new Set([
          resId,
          ...String(searchParams.get("reservation_ids") ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ])
      ),
    [resId, searchParams]
  );
  const reservationIdsQuery = useMemo(() => reservationIds.join(","), [reservationIds]);
  const isCombinedInvoice = reservationIds.length > 1;

  useEffect(() => {
    async function fetchData() {
      try {
        const query = isCombinedInvoice ? `?reservation_ids=${encodeURIComponent(reservationIdsQuery)}` : "";
        const res = await fetch(`/api/tax-invoice/build-line-items/${resId}${query}`);
        const result = await res.json();
        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error || "Failed to load folio data");
        }
      } catch {
        setError("Failed to load folio data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isCombinedInvoice, reservationIdsQuery, resId]);

  const handleIssueReceipt = async () => {
    if (!data) return;
    setRcLoading(true);
    try {
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: data.reservation.id,
          guest_name: data.reservation.guest_name || "Guest",
          room_numbers: data.booking_snapshot.room_numbers,
          grand_total: data.totals.grand_total,
          language: rcLanguage,
          note: rcNote.trim() || null,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to issue receipt");
      }
      router.push(`/pms/receipt/preview/${result.data.id}`);
    } catch (err: any) {
      alert(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setRcLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse">
        <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-4" />
        <p className="text-sm text-[var(--text-muted)] font-medium">Preparing Folio Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Data Error</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-xl font-bold text-sm shadow-md">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto w-full pb-20">
      {/* Page header + doc type toggle */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {docType === "invoice" ? "Issue Tax Invoice" : "Issue Receipt"}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {docType === "invoice"
              ? isCombinedInvoice
                ? "ใบเสร็จรับเงิน / ใบกำกับภาษีแบบรวมกลุ่ม — พร้อมรายละเอียด VAT"
                : "ใบเสร็จรับเงิน / ใบกำกับภาษี — พร้อมรายละเอียด VAT"
              : "ใบเสร็จรับเงินธรรมดา — ไม่แยก VAT"}
          </p>
        </div>
        {/* Document type toggle */}
        <div className="flex bg-[var(--bg-muted)] p-1 rounded-xl border border-[var(--border-default)]">
          <button
            onClick={() => setDocType("invoice")}
            className={`px-5 py-2 text-xs font-bold rounded-lg transition ${docType === "invoice" ? "bg-white dark:bg-white/10 shadow text-brand-600" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          >
            📄 Tax Invoice
          </button>
          <button
            onClick={() => !isCombinedInvoice && setDocType("receipt")}
            disabled={isCombinedInvoice}
            className={`px-5 py-2 text-xs font-bold rounded-lg transition ${docType === "receipt" ? "bg-white dark:bg-white/10 shadow text-emerald-600" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"} ${isCombinedInvoice ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            🧾 Receipt
          </button>
        </div>
      </div>

      {isCombinedInvoice && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
          Group booking นี้จะออกเป็นใบกำกับภาษีรวมตามห้องที่เลือกไว้: {data?.booking_snapshot?.room_numbers?.join(", ") || "-"}
        </div>
      )}

      {docType === "invoice" && data && (
        <TaxInvoiceForm initialData={data} mode="issue" />
      )}

      {docType === "receipt" && data && (
        <div className="space-y-6">
          {/* Receipt summary card */}
          <div className="bg-[var(--bg-surface)] p-5 rounded-xl border border-[var(--border-default)] shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>🧾</span> Receipt Details
            </h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Guest</p>
                <p className="font-semibold text-[var(--text-primary)]">{data.reservation.guest_name || "-"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Rooms</p>
                <p className="font-semibold text-[var(--text-primary)]">{data.booking_snapshot.room_numbers.join(", ") || "-"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Stay Period</p>
                <p className="text-[var(--text-secondary)]">{formatDateRangeDisplay(data.booking_snapshot.checkin_date, data.booking_snapshot.checkout_date)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Grand Total</p>
                <p className="text-2xl font-extrabold text-emerald-600">฿{data.totals.grand_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          {/* Receipt options */}
          <div className="bg-[var(--bg-surface)] p-5 rounded-xl border border-[var(--border-default)] shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span>⚙️</span> Options
            </h2>
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-2">Language</p>
              <div className="flex bg-[var(--bg-muted)] p-1 rounded-lg w-fit">
                <button
                  onClick={() => setRcLanguage("th")}
                  className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${rcLanguage === "th" ? "bg-white dark:bg-white/10 shadow text-brand-600" : "text-[var(--text-muted)]"}`}
                >
                  ภาษาไทย
                </button>
                <button
                  onClick={() => setRcLanguage("en")}
                  className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${rcLanguage === "en" ? "bg-white dark:bg-white/10 shadow text-brand-600" : "text-[var(--text-muted)]"}`}
                >
                  English
                </button>
              </div>
            </div>
            <div>
              <label className="form-label">Remark (optional)</label>
              <input
                type="text"
                value={rcNote}
                onChange={(e) => setRcNote(e.target.value)}
                placeholder="หมายเหตุเพิ่มเติม..."
                className="form-input"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => router.back()} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Cancel
            </button>
            <button
              onClick={handleIssueReceipt}
              disabled={rcLoading}
              className="px-8 py-2.5 rounded-xl bg-emerald-600 text-white font-extrabold text-sm shadow-lg hover:bg-emerald-700 transition flex items-center gap-2"
            >
              {rcLoading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              🧾 Print Receipt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
