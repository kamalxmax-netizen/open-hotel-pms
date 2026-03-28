"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import TaxInvoiceForm from "../../tax-invoice-form";
import { BuildLineItemsResult } from "@/lib/tax-invoice/types";

export default function TaxInvoiceEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 animate-pulse text-[var(--text-muted)]">
      <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-4" />
      Loading Invoice Detail...
    </div>
  );

  if (error || !data) return (
    <div className="max-w-md mx-auto py-20 text-center">
      <h2 className="text-lg font-bold">Edit Failed</h2>
      <p className="text-sm text-[var(--text-secondary)] mt-2">{error}</p>
      <button onClick={() => router.back()} className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-xl">Back</button>
    </div>
  );

  // Map invoice data to the form expected format
  const formInitialData: BuildLineItemsResult = {
    reservation: {
      id: data.reservation_id,
      booking_code: data.booking_snapshot.booking_code,
      guest_name: data.customer_name,
      source: data.booking_snapshot.source,
      checkin_date: data.booking_snapshot.checkin_date,
      checkout_date: data.booking_snapshot.checkout_date,
      tax_invoice_requested: true,
      guest_profile_id: data.guest_tax_profile_id,
    },
    line_items: data.line_items,
    totals: {
      subtotal: data.subtotal,
      vat_rate: data.vat_rate,
      vat_amount: data.vat_amount,
      grand_total: data.grand_total,
      discount: data.discount,
    },
    booking_snapshot: data.booking_snapshot,
  };

  return (
    <div className="max-w-[1280px] mx-auto w-full pb-20">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Edit Tax Invoice</h1>
          <p className="text-sm text-[var(--text-secondary)]">Modifying {data.invoice_no}</p>
        </div>
        
        {data.status === "issued" && (
          <div className="px-3 py-1 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-tight">
            Issued · Admin Edit Required after Night Audit
          </div>
        )}
      </div>
      
      <TaxInvoiceForm
        initialData={formInitialData}
        invoiceId={id}
        mode="edit"
        existingInvoice={{
          language: data.language,
          customer_name: data.customer_name,
          customer_tax_id: data.customer_tax_id,
          customer_address: data.customer_address,
          customer_branch: data.customer_branch,
        }}
      />
    </div>
  );
}
