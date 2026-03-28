"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import TaxInvoiceForm from "../../tax-invoice-form";
import { BuildLineItemsResult } from "@/lib/tax-invoice/types";

export default function TaxInvoiceIssuePage() {
  const { resId } = useParams<{ resId: string }>();
  const [data, setData] = useState<BuildLineItemsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/tax-invoice/build-line-items/${resId}`);
        const result = await res.json();
        if (result.success) {
          setData(result.data);
        } else {
          setError(result.error || "Failed to load folio data");
        }
      } catch (e) {
        // Mock data for initial development if API doesn't exist yet
        setData({
          reservation: {
            id: resId,
            booking_code: "BK9999",
            guest_name: "Mock Guest",
            source: "Direct",
            checkin_date: "2026-03-28",
            checkout_date: "2026-03-31",
            tax_invoice_requested: true,
            guest_profile_id: null,
          },
          line_items: [
            {
              kind: "room_charge",
              description: "Room Charge - 201",
              quantity: 3,
              unit: "night",
              unit_price: 1500,
              amount: 4500,
              room_number: "201",
              note: "28/03 - 31/03",
            }
          ],
          totals: {
            subtotal: 4500,
            vat_rate: 0.07,
            vat_amount: 315,
            grand_total: 4815,
            discount: 0,
          },
          booking_snapshot: {
            booking_code: "BK9999",
            source: "Direct",
            checkin_date: "2026-03-28",
            checkout_date: "2026-03-31",
            nights: 3,
            room_numbers: ["201"],
          }
        });
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [resId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse">
        <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-4"></div>
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
        <button 
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-2 bg-brand-600 text-white rounded-xl font-bold text-sm shadow-md"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto w-full pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Issue Tax Invoice</h1>
        <p className="text-sm text-[var(--text-secondary)]">Create a new official tax invoice from reservation folio.</p>
      </div>
      
      {data && <TaxInvoiceForm initialData={data} mode="issue" />}
    </div>
  );
}
