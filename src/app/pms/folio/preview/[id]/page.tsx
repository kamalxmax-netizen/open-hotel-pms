"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Lock, Printer, RotateCcw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { renderFolioA4Html, type FolioPrintData } from "@/lib/folio/printFolioHtml";
import {
  type EditableReservationField,
  formatLockedLedgerAmount,
  updateFolioPrintLedgerDescription,
  updateFolioPrintReservationField,
} from "@/lib/folio/printDraft";

type FolioPrintResponse = (FolioPrintData & { success: true }) | { success?: false; error?: string };

const editableGuestFields: Array<{
  field: EditableReservationField;
  label: string;
  inputMode?: "text" | "email" | "tel";
  multiline?: boolean;
}> = [
  { field: "guest_name", label: "Guest Name" },
  { field: "guest_address", label: "Address", multiline: true },
  { field: "guest_phone", label: "Phone", inputMode: "tel" },
  { field: "guest_email", label: "Email", inputMode: "email" },
];

function fieldValue(value: string | null | undefined): string {
  return value ?? "";
}

export default function FolioPrintPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [originalData, setOriginalData] = useState<FolioPrintData | null>(null);
  const [draftData, setDraftData] = useState<FolioPrintData | null>(null);
  const [previewData, setPreviewData] = useState<FolioPrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  const html = useMemo(() => (previewData ? renderFolioA4Html(previewData) : ""), [previewData]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch(`/api/bookings/${id}/folio-print`, { cache: "no-store" });
        const result = (await response.json().catch(() => null)) as FolioPrintResponse | null;
        if (!response.ok || !result || result.success !== true) {
          const message = result && "error" in result ? result.error : null;
          throw new Error(message || "Failed to load folio print data.");
        }
        setBookingCode(result.reservation.booking_code);
        setOriginalData(result);
        setDraftData(result);
        setPreviewData(result);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load folio print data.");
        setOriginalData(null);
        setDraftData(null);
        setPreviewData(null);
      } finally {
        setLoading(false);
      }
    }

    if (id) void load();
  }, [id]);

  const handlePrint = () => {
    if (!draftData) return;
    const nextHtml = renderFolioA4Html(draftData);
    setPreviewData(draftData);
    if (iframeRef.current) {
      iframeRef.current.srcdoc = nextHtml;
    }
    window.setTimeout(() => iframeRef.current?.contentWindow?.print(), 50);
  };

  const handlePreviewSync = () => {
    if (draftData) setPreviewData(draftData);
  };

  const handleGuestFieldChange = (field: EditableReservationField, value: string) => {
    setDraftData((current) => (current ? updateFolioPrintReservationField(current, field, value) : current));
  };

  const handleDescriptionChange = (rowIndex: number, description: string) => {
    setDraftData((current) => (current ? updateFolioPrintLedgerDescription(current, rowIndex, description) : current));
  };

  const handleResetDraft = () => {
    if (!originalData) return;
    setDraftData(originalData);
    setPreviewData(originalData);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse text-[var(--text-muted)]">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        Generating Guest Folio...
      </div>
    );
  }

  if (error || !draftData || !html) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Preview Failed</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>
        <button onClick={() => router.back()} className="mt-6 rounded-xl bg-brand-600 px-6 py-2 text-white">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] pb-20">
      <div className="sticky top-4 z-10 mb-6 flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-muted)] text-[var(--text-primary)] transition hover:bg-[var(--border-subtle)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-primary)]">Guest Folio Preview</h1>
            <p className="text-[10px] font-bold uppercase tracking-tight text-[var(--text-muted)]">{bookingCode || "Draft"}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <button
            onClick={handleResetDraft}
            disabled={!originalData}
            className="hidden items-center gap-2 rounded-xl border border-[var(--border-input)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-bold text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50 md:flex"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <div className="hidden text-right md:block">
            <p className="text-[10px] font-bold text-amber-600">Print Settings</p>
            <p className="text-[10px] italic text-[var(--text-muted)]">Margins: None, Scale: 100%</p>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-extrabold text-white shadow-lg transition hover:bg-brand-700"
          >
            <Printer className="h-4 w-4" />
            Print Now
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm xl:sticky xl:top-28 xl:max-h-[calc(100vh-8rem)] xl:overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-brand-600" />
              <h2 className="text-sm font-extrabold text-[var(--text-primary)]">Print Draft</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Lock className="h-3 w-3" />
              Amounts Locked
            </span>
          </div>

          <div className="space-y-5 overflow-y-auto px-5 py-5 xl:max-h-[calc(100vh-13rem)]">
            <section>
              <h3 className="mb-3 text-[10px] font-bold uppercase text-[var(--text-muted)]">Guest Details</h3>
              <div className="space-y-3">
                {editableGuestFields.map((item) => (
                  <label key={item.field} className="block">
                    <span className="mb-1 block text-[11px] font-bold text-[var(--text-secondary)]">{item.label}</span>
                    {item.multiline ? (
                      <textarea
                        value={fieldValue(draftData.reservation[item.field])}
                        onChange={(event) => handleGuestFieldChange(item.field, event.target.value)}
                        onBlur={handlePreviewSync}
                        className="min-h-[88px] w-full resize-y rounded-lg border border-[var(--border-input)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-brand-400 focus:bg-[var(--bg-surface)]"
                      />
                    ) : (
                      <input
                        type={item.inputMode === "email" ? "email" : item.inputMode === "tel" ? "tel" : "text"}
                        value={fieldValue(draftData.reservation[item.field])}
                        onChange={(event) => handleGuestFieldChange(item.field, event.target.value)}
                        onBlur={handlePreviewSync}
                        className="w-full rounded-lg border border-[var(--border-input)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-brand-400 focus:bg-[var(--bg-surface)]"
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-[10px] font-bold uppercase text-[var(--text-muted)]">Description Lines</h3>
              <div className="space-y-3">
                {draftData.ledger_rows.map((row, index) => (
                  <div key={`${index}-${row.kind}-${row.date ?? "no-date"}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase text-[var(--text-muted)]">
                        {index + 1}. {row.kind}
                      </span>
                      <span className="shrink-0 rounded-md bg-[var(--bg-surface)] px-2 py-1 text-right font-mono text-xs font-bold text-[var(--text-primary)]">
                        {formatLockedLedgerAmount(row)}
                      </span>
                    </div>
                    <textarea
                      value={fieldValue(row.description)}
                      onChange={(event) => handleDescriptionChange(index, event.target.value)}
                      onBlur={handlePreviewSync}
                      className="min-h-[64px] w-full resize-y rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-brand-400"
                      aria-label={`Folio description line ${index + 1}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>

        <div className="overflow-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-muted)] p-4 shadow-inner sm:p-8">
          <div className="mx-auto bg-white shadow-2xl" style={{ width: "210mm", height: "297mm" }}>
            <iframe
              ref={iframeRef}
              srcDoc={html}
              tabIndex={-1}
              className="h-full w-full border-none pointer-events-none"
              title="Guest Folio A4 Print Template"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
