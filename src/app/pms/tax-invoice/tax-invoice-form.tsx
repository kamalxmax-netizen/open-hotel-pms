"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  TaxInvoiceLineItem, 
  TaxInvoiceTotals, 
  TaxInvoiceBookingSnapshot, 
  TaxInvoiceLanguage,
  BuildLineItemsResult
} from "@/lib/tax-invoice/types";
import {
  fmtMoney,
  getLabels,
  computeVatInclusiveTotals,
  compareRoomNumber,
} from "@/lib/tax-invoice/utils";

interface TaxProfile {
  id?: string;
  tax_id: string;
  company_name: string;
  address: string;
  branch: string;
}

interface TaxInvoiceFormProps {
  initialData?: BuildLineItemsResult;
  invoiceId?: string; // If editing
  mode: "issue" | "edit";
  /** Pre-filled values from existing invoice (edit mode) */
  existingInvoice?: {
    language?: TaxInvoiceLanguage;
    customer_name?: string;
    customer_tax_id?: string;
    customer_address?: string;
    customer_branch?: string;
  };
}

export default function TaxInvoiceForm({ initialData, invoiceId, mode, existingInvoice }: TaxInvoiceFormProps) {
  const router = useRouter();

  // Form State — pre-fill from existing invoice in edit mode
  const [language, setLanguage] = useState<TaxInvoiceLanguage>(existingInvoice?.language || "th");
  const [customerName, setCustomerName] = useState(existingInvoice?.customer_name || initialData?.reservation.guest_name || "");
  const [customerTaxId, setCustomerTaxId] = useState(existingInvoice?.customer_tax_id || "");
  const [customerAddress, setCustomerAddress] = useState(existingInvoice?.customer_address || "");
  const [customerBranch, setCustomerBranch] = useState(existingInvoice?.customer_branch || "00000"); // สำนักงานใหญ่
  const [isPassport, setIsPassport] = useState(false);
  const [lineItems, setLineItems] = useState<TaxInvoiceLineItem[]>(initialData?.line_items || []);
  const [booking, setBooking] = useState<TaxInvoiceBookingSnapshot | null>(initialData?.booking_snapshot || null);

  // UI State
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [profiles, setProfiles] = useState<TaxProfile[]>([]);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  const l = getLabels(language);

  // Totals Calculation using VAT-inclusive logic from utils.ts
  const totals = useMemo((): TaxInvoiceTotals => {
    const grossTotal = lineItems.reduce((acc, item) => acc + item.amount, 0);
    const discountAmount = 0; // In the future, this can be an input
    return computeVatInclusiveTotals(grossTotal, discountAmount);
  }, [lineItems]);

  // Sorted Line Items (Rooms first, then others)
  const sortedLineItems = useMemo(() => {
    return [...lineItems].sort((a, b) => {
      if (a.room_number && b.room_number) {
        return compareRoomNumber(a.room_number, b.room_number);
      }
      if (a.room_number) return -1;
      if (b.room_number) return 1;
      return 0;
    });
  }, [lineItems]);

  // Handle Lookup
  const handleLookup = async () => {
    if (!customerTaxId || customerTaxId.length < 13) return;
    setLookupLoading(true);
    try {
      const res = await fetch("/api/tax/lookup", {
        method: "POST",
        body: JSON.stringify({ tax_id: customerTaxId }),
      });
      const data = await res.json();
      if (data.success) {
        setCustomerName(data.name);
        setCustomerAddress(data.address);
        setCustomerBranch(data.branch || "00000");
      }
    } catch (e) {
      console.error("Lookup failed", e);
    } finally {
      setLookupLoading(false);
    }
  };

  const handleIssue = async () => {
    if (!initialData?.reservation?.id && !invoiceId) {
      alert("Missing reservation or invoice ID");
      return;
    }
    setLoading(true);
    try {
      if (mode === "issue") {
        // Step 1: Create draft
        const createRes = await fetch("/api/tax-invoice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reservation_id: initialData!.reservation.id,
            language,
            customer_name: customerName,
            customer_tax_id: customerTaxId,
            customer_address: customerAddress,
            customer_branch: customerBranch,
            is_passport: isPassport,
            line_items: lineItems,
            discount: 0,
            save_customer_profile: true,
          }),
        });
        const createResult = await createRes.json();
        if (!createRes.ok || !createResult.success) {
          throw new Error(createResult.error || "Failed to create invoice");
        }

        // Step 2: Issue (finalize) the draft
        const draftId = createResult.data?.id ?? createResult.invoice?.id;
        const issueRes = await fetch(`/api/tax-invoice/${draftId}/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const issueResult = await issueRes.json();
        if (!issueRes.ok || !issueResult.success) {
          throw new Error(issueResult.error || "Failed to issue invoice");
        }

        const issuedId = issueResult.data?.id ?? issueResult.invoice?.id ?? draftId;
        setShowConfirm(false);
        router.push(`/pms/tax-invoice/preview/${issuedId}`);
      } else {
        // Edit mode: PATCH existing
        const patchRes = await fetch(`/api/tax-invoice/${invoiceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language,
            customer_name: customerName,
            customer_tax_id: customerTaxId,
            customer_address: customerAddress,
            customer_branch: customerBranch,
            is_passport: isPassport,
            line_items: lineItems,
            discount: 0,
          }),
        });
        const patchResult = await patchRes.json();
        if (!patchRes.ok || !patchResult.success) {
          throw new Error(patchResult.error || "Failed to update invoice");
        }

        setShowConfirm(false);
        router.push(`/pms/tax-invoice/preview/${invoiceId}`);
      }
    } catch (e: any) {
      alert(e.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar: Language & Metadata */}
      <div className="flex items-center justify-between bg-[var(--bg-surface)] p-4 rounded-xl border border-[var(--border-default)] shadow-sm">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Select Language</p>
            <div className="flex bg-[var(--bg-muted)] p-1 rounded-lg">
              <button 
                onClick={() => setLanguage("th")}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${language === "th" ? "bg-white dark:bg-white/10 shadow-sm text-brand-600" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
              >
                ภาษาไทย (TH)
              </button>
              <button 
                onClick={() => setLanguage("en")}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition ${language === "en" ? "bg-white dark:bg-white/10 shadow-sm text-brand-600" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
              >
                English (EN)
              </button>
            </div>
          </div>
          
          {booking && (
            <div className="h-10 w-px bg-[var(--border-subtle)]" />
          )}

          {booking && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1">Reservation Info</p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {booking.booking_code || "N/A"} · {booking.room_numbers.join(", ")}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="px-4 py-2 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
          <button 
            onClick={() => {
              // Basic Validation
              if (!customerName || !customerTaxId) {
                alert("Please enter Customer Name and Tax ID");
                return;
              }
              if (!isPassport && (customerTaxId.length !== 13 || !/^\d+$/.test(customerTaxId))) {
                alert("Tax ID must be exactly 13 numeric digits (or check Passport)");
                return;
              }
              if (isPassport && !customerTaxId.trim()) {
                alert("Please enter Passport number");
                return;
              }
              setShowConfirm(true);
            }}
            className="px-6 py-2 rounded-xl bg-brand-600 text-white font-bold text-sm shadow-md hover:bg-brand-700 transition active:scale-95"
          >
            {mode === "issue" ? "Issue Official Invoice" : "Update Document"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Customer Details */}
        <div className="lg:col-span-1 space-y-6">
          <div className="section-card bg-[var(--bg-surface)] p-5 rounded-xl border border-[var(--border-default)] shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>👤</span> {l.customer} Details
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">{l.taxId}</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      value={customerTaxId}
                      onChange={(e) => setCustomerTaxId(e.target.value)}
                      placeholder="Enter 13-digit Tax ID"
                      className="form-input"
                    />
                    {showProfileDropdown && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-xl max-h-48 overflow-y-auto">
                        {/* Profiles list would go here */}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleLookup}
                    disabled={lookupLoading || customerTaxId.length < 13}
                    className="px-3 py-2 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 border border-sky-100 dark:border-sky-500/20 rounded-lg text-xs font-bold hover:bg-sky-100 transition whitespace-nowrap disabled:opacity-50"
                  >
                    {lookupLoading ? "..." : "Lookup"}
                  </button>
                </div>
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isPassport}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsPassport(checked);
                      if (checked) {
                        setLanguage("en");
                      }
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    Passport (ไม่ใช่เลข 13 หลัก)
                  </span>
                </label>
              </div>

              <div>
                <label className="form-label">Company Name / Guest Name</label>
                <input 
                  type="text" 
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">{l.branch}</label>
                  <input 
                    type="text" 
                    value={customerBranch}
                    onChange={(e) => setCustomerBranch(e.target.value)}
                    placeholder="00000 (HQ)"
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">{l.address}</label>
                <textarea 
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="form-input min-h-[100px]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Line Items & Totals */}
        <div className="lg:col-span-2 space-y-6">
          <div className="section-card bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-[var(--bg-muted)] border-b border-[var(--border-default)] flex justify-between items-center">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Revenue Items
              </h2>
              <button className="text-[10px] uppercase font-bold text-brand-600 hover:text-brand-700">
                + Add Custom Item
              </button>
            </div>
            
            <table className="w-full text-left">
              <thead className="border-b border-[var(--border-default)]">
                <tr>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase text-[var(--text-muted)]">Description</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase text-[var(--text-muted)] text-center">Qty</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase text-[var(--text-muted)] text-right">Rate</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase text-[var(--text-muted)] text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-sm">
                {sortedLineItems.map((item, idx) => {
                  // Enhanced description logic for room charges
                  // Description already includes date range from service.ts
                  const description = item.description;

                  return (
                    <tr key={idx} className="group">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-[var(--text-primary)]">{description}</p>
                        {item.note && <p className="text-[11px] text-[var(--text-muted)]">{item.note}</p>}
                        {item.room_number && (
                          <span className="text-[10px] bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 px-1.5 py-0.5 rounded border border-sky-100 dark:border-sky-500/20 font-bold uppercase mt-1 inline-block">
                            Room {item.room_number}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center text-[var(--text-secondary)]">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="px-5 py-4 text-right text-[var(--text-secondary)] font-mono">
                        {fmtMoney(item.unit_price)}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-[var(--text-primary)] font-mono">
                        {fmtMoney(item.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="bg-[var(--bg-muted)] p-6 flex justify-end">
              <div className="w-64 space-y-3">
                <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                  <span>{l.subtotal}</span>
                  <span className="font-mono">{fmtMoney(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                  <span>{l.vat}</span>
                  <span className="font-mono">{fmtMoney(totals.vat_amount)}</span>
                </div>
                <div className="pt-3 border-t border-[var(--border-default)] flex justify-between text-lg font-extrabold text-[var(--text-primary)]">
                  <span>{l.total}</span>
                  <span className="font-mono text-brand-600">{fmtMoney(totals.grand_total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Double Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-[var(--bg-surface)] w-full max-w-md rounded-2xl shadow-2xl border border-[var(--border-default)] overflow-hidden scale-in animate-in zoom-in duration-200">
            <div className="bg-amber-50 dark:bg-amber-500/10 p-6 flex items-center gap-4 border-b border-amber-100 dark:border-amber-500/20">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-2xl">
                ⚠️
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-amber-900 dark:text-amber-400">Issue Tax Invoice</h3>
                <p className="text-xs text-amber-700/80 dark:text-amber-500/60 mt-0.5">Please review carefully before proceeding.</p>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-bold text-[var(--text-primary)]">Sequential Compliance Warning</p>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  The system will generate a permanent <strong>Invoice Number</strong> based on the current sequence. 
                  According to Revenue Department regulations, once an invoice number is issued:
                </p>
                <ul className="text-[10px] space-y-1 text-rose-600 dark:text-rose-400 font-bold list-disc pl-4">
                  <li>It CANNOT be deleted or skipped.</li>
                  <li>The sequence must be strictly continuous.</li>
                  <li>Any mistakes must be handled via a Credit Note or Void process.</li>
                </ul>
              </div>

              <div className="bg-[var(--bg-muted)] rounded-2xl p-5 space-y-3 border border-[var(--border-subtle)] shadow-inner">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[var(--text-muted)] font-medium">Recipient:</span>
                  <span className="font-bold text-[var(--text-primary)]">{customerName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[var(--text-muted)] font-medium">Tax ID / Branch:</span>
                  <span className="font-bold text-[var(--text-primary)]">{customerTaxId} ({customerBranch === "00000" ? "HQ" : customerBranch})</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[var(--text-muted)] font-medium">Target Rooms:</span>
                  <span className="font-bold text-brand-600">{booking?.room_numbers.join(", ") || "-"}</span>
                </div>
                <div className="pt-3 border-t border-[var(--border-subtle)] flex justify-between items-baseline">
                  <span className="font-black text-[var(--text-primary)] text-sm">Grand Total (Inc. VAT):</span>
                  <div className="text-right">
                     <span className="block text-xl font-black text-brand-600 font-mono tracking-tighter">฿{fmtMoney(totals.grand_total)}</span>
                     <span className="block text-[9px] text-[var(--text-muted)] uppercase tracking-widest font-bold">Seven Percent VAT Inclusive</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[var(--bg-muted)] p-4 flex gap-3 justify-end border-t border-[var(--border-default)]">
              <button 
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="px-6 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-body)] transition"
              >
                Cancel
              </button>
              <button 
                onClick={handleIssue}
                disabled={loading}
                className="px-8 py-2 rounded-xl bg-brand-600 text-white text-sm font-extrabold shadow-lg hover:bg-brand-700 transition flex items-center gap-2"
              >
                {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>}
                Issue Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
