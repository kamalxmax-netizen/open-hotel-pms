"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type PrintResponse =
  | { success: true; label: string; entry_count: number; manual_count: number; html: string }
  | { success?: false; error?: string };

export default function RR3PrintPreviewPage() {
  const params = useParams<{ year: string; month: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState("");
  const [label, setLabel] = useState("RR3");
  const [meta, setMeta] = useState({ entryCount: 0, manualCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const year = Number(params.year);
  const month = Number(params.month);
  const queryString = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");
        const query = new URLSearchParams(queryString);
        query.set("year", String(year));
        query.set("month", String(month));
        const response = await fetch(`/api/reports/rr3/print?${query.toString()}`, { cache: "no-store" });
        const result = (await response.json().catch(() => null)) as PrintResponse | null;
        if (!response.ok || !result || result.success !== true) {
          const message = result && "error" in result ? result.error : null;
          throw new Error(message || "Failed to load RR3 print data.");
        }
        setHtml(result.html);
        setLabel(result.label);
        setMeta({ entryCount: result.entry_count, manualCount: result.manual_count });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load RR3 print data.");
        setHtml("");
      } finally {
        setLoading(false);
      }
    }

    if (Number.isFinite(year) && Number.isFinite(month)) void load();
  }, [year, month, queryString]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
        Generating RR3 print preview...
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
            <h1 className="text-sm font-bold text-[var(--text-primary)]">{label}</h1>
            <p className="text-[10px] font-bold uppercase tracking-tight text-[var(--text-muted)]">
              {String(month).padStart(2, "0")}/{year} · {meta.entryCount} rows · {meta.manualCount} corrected rows
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden text-right md:block">
            <p className="text-[10px] font-bold text-amber-600">Print Settings</p>
            <p className="text-[10px] italic text-[var(--text-muted)]">A4 Landscape, Margins: None, Scale: 100%</p>
          </div>
          <button
            onClick={() => iframeRef.current?.contentWindow?.print()}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-2.5 text-sm font-extrabold text-white shadow-lg transition hover:bg-brand-700"
          >
            <Printer className="h-4 w-4" />
            Print Now
          </button>
        </div>
      </div>

      <div className="flex justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-muted)] p-8 shadow-inner">
        <div className="bg-white shadow-2xl" style={{ width: "297mm", minHeight: "210mm" }}>
          <iframe
            ref={iframeRef}
            srcDoc={html}
            className="h-[210mm] w-full border-none"
            title="RR3 A4 Landscape Print Template"
          />
        </div>
      </div>
    </div>
  );
}
