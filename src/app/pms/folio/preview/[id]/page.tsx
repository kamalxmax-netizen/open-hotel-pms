"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { renderFolioA4Html, type FolioPrintData } from "@/lib/folio/printFolioHtml";

type FolioPrintResponse = (FolioPrintData & { success: true }) | { success?: false; error?: string };

export default function FolioPrintPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingCode, setBookingCode] = useState<string | null>(null);

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
        setHtml(renderFolioA4Html(result));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load folio print data.");
        setHtml("");
      } finally {
        setLoading(false);
      }
    }

    if (id) void load();
  }, [id]);

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-pulse text-[var(--text-muted)]">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        Generating Guest Folio...
      </div>
    );
  }

  if (error || !html) {
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
    <div className="mx-auto w-full max-w-[1280px] pb-20">
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

      <div className="flex justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-muted)] p-8 shadow-inner">
        <div className="bg-white shadow-2xl" style={{ width: "210mm", height: "297mm" }}>
          <iframe
            ref={iframeRef}
            srcDoc={html}
            className="h-full w-full border-none pointer-events-none"
            title="Guest Folio A4 Print Template"
          />
        </div>
      </div>
    </div>
  );
}
