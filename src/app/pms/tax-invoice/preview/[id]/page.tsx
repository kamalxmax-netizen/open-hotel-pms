"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getInvoiceRenderPageCount, renderInvoiceA4Html } from "@/lib/tax-invoice/printInvoiceHtml";
import { getLabels } from "@/lib/tax-invoice/utils";

export default function TaxInvoicePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/tax-invoice/${id}`);
        const result = await res.json();
        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error || "Invoice not found");
        }
      } catch (e) {
        setError("Error fetching invoice data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  const handlePrint = () => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.print();
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 animate-pulse text-[var(--text-muted)]">
      <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-4" />
      Generating A4 Layout...
    </div>
  );

  if (error || !data) return (
    <div className="max-w-md mx-auto py-20 text-center">
      <h2 className="text-lg font-bold">Preview Failed</h2>
      <p className="text-sm text-[var(--text-secondary)] mt-2">{error}</p>
      <button onClick={() => router.back()} className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-xl">Back</button>
    </div>
  );

  const html = renderInvoiceA4Html({
    invoiceNo: data.invoice_no,
    issueDate: data.issue_date,
    language: data.language,
    customerName: data.customer_name,
    customerTaxId: data.customer_tax_id,
    customerAddress: data.customer_address,
    customerBranch: data.customer_branch,
    booking: data.booking_snapshot,
    lineItems: data.line_items,
    totals: {
      subtotal: data.subtotal,
      vat_rate: data.vat_rate,
      vat_amount: data.vat_amount,
      grand_total: data.grand_total,
      discount: data.discount,
    },
    seller: data.seller_snapshot,
  });
  const pageCount = getInvoiceRenderPageCount(data.line_items || []);
  const previewHeight = `${pageCount * 297}mm`;

  return (
    <div className="max-w-[1280px] mx-auto w-full pb-20">
      {/* Header (Hidden during print natively, but framed in UI here) */}
      <div className="flex items-center justify-between bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-default)] shadow-sm mb-6 sticky top-4 z-10 no-print">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--bg-muted)] text-[var(--text-primary)] hover:bg-[var(--border-subtle)] transition"
          >
            ←
          </button>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-primary)]">Print Preview</h1>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-tight">{data.invoice_no || "Draft"}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right hidden md:block">
            <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 justify-end">
              <span>⚠️</span> Print Settings:
            </p>
            <p className="text-[10px] text-[var(--text-muted)] italic">Margins: None, Scale: 100%</p>
          </div>
          <button 
            onClick={handlePrint}
            className="px-8 py-2.5 rounded-xl bg-brand-600 text-white font-extrabold text-sm shadow-lg hover:bg-brand-700 transition flex items-center gap-2"
          >
            <span>🖨️</span> Print Now
          </button>
        </div>
      </div>

      {/* A4 Frame */}
      <div className="flex justify-center bg-[var(--bg-muted)] p-8 rounded-2xl border border-[var(--border-default)] shadow-inner">
         <div className="bg-white shadow-2xl relative" style={{ width: "210mm", minHeight: previewHeight }}>
            <iframe 
              ref={iframeRef}
              srcDoc={html}
              className="w-full border-none pointer-events-none"
              style={{ height: previewHeight }}
              title="A4 Print Template"
            />
         </div>
      </div>
    </div>
  );
}
