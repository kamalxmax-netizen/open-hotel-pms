"use client";

import { useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

type CaptureState = "idle" | "capturing" | "previewing" | "submitting" | "done" | "error";

export default function BugReportButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CaptureState>("idle");
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const capture = useCallback(async () => {
    setState("capturing");
    setErrorMsg(null);
    try {
      // Dynamic import to avoid SSR issues
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        scale: 0.6,          // reduce resolution
        useCORS: true,
        logging: false,
        allowTaint: true,
        ignoreElements: (el) => el.id === "bug-report-overlay",
      });

      // Convert to JPEG at 60% quality → ~200–400KB
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      setScreenshotDataUrl(dataUrl);
      setState("previewing");
      setTimeout(() => descriptionRef.current?.focus(), 100);
    } catch {
      // If capture fails, still allow submitting without screenshot
      setScreenshotDataUrl(null);
      setState("previewing");
    }
  }, []);

  function handleOpen() {
    setOpen(true);
    setDescription("");
    setScreenshotDataUrl(null);
    setErrorMsg(null);
    setState("idle");
    // Short delay so modal renders before capture (avoids capturing the modal)
    setTimeout(() => capture(), 300);
  }

  function handleClose() {
    setOpen(false);
    setState("idle");
    setScreenshotDataUrl(null);
    setDescription("");
    setErrorMsg(null);
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setErrorMsg("กรุณาอธิบายปัญหา");
      return;
    }
    setState("submitting");

    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          page_url: window.location.href,
          screenshot_base64: screenshotDataUrl,
          browser_info: {
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            timestamp: new Date().toISOString(),
            path: pathname,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Unknown error");
      }

      setState("done");
      setTimeout(() => handleClose(), 2000);
    } catch (err: any) {
      setErrorMsg(err.message ?? "ส่งไม่สำเร็จ กรุณาลองใหม่");
      setState("previewing");
    }
  }

  if (!open) {
    return (
      <button
        id="bug-report-btn"
        onClick={handleOpen}
        title="Report a bug"
        className="fixed bottom-5 right-5 z-50 w-10 h-10 bg-rose-500 hover:bg-rose-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        aria-label="Report a bug"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      </button>
    );
  }

  return (
    <div id="bug-report-overlay" className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-[var(--bg-surface)] rounded-2xl shadow-2xl border border-[var(--border-default)] overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <span className="text-rose-500 text-lg">🐛</span>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Report Bug</h3>
          </div>
          <button onClick={handleClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none">×</button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Screenshot preview */}
          {state === "capturing" && (
            <div className="h-24 bg-[var(--bg-surface-hover)] rounded-lg flex items-center justify-center">
              <p className="text-xs text-[var(--text-muted)]">กำลัง capture หน้าจอ...</p>
            </div>
          )}

          {(state === "previewing" || state === "submitting" || state === "error") && (
            <div>
              {screenshotDataUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotDataUrl}
                    alt="Screenshot preview"
                    className="w-full h-28 object-cover rounded-lg border border-[var(--border-default)]"
                  />
                  <button
                    onClick={() => setScreenshotDataUrl(null)}
                    className="absolute top-1.5 right-1.5 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded hover:bg-black/70 transition"
                  >
                    ลบ
                  </button>
                </div>
              ) : (
                <button
                  onClick={capture}
                  className="w-full h-16 border-2 border-dashed border-[var(--border-default)] rounded-lg flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] hover:border-[var(--border-input)] hover:text-[var(--text-muted)] transition"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  Capture อีกครั้ง
                </button>
              )}
            </div>
          )}

          {/* Done state */}
          {state === "done" && (
            <div className="h-24 flex flex-col items-center justify-center gap-2">
              <span className="text-3xl">✅</span>
              <p className="text-sm font-medium text-emerald-600">ส่ง report แล้ว — ขอบคุณ!</p>
            </div>
          )}

          {/* Description */}
          {(state === "previewing" || state === "submitting") && (
            <>
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="อธิบายปัญหา เช่น 'กดบันทึกแล้วหน้าขาว' หรือ 'ตัวเลขผิด'"
                rows={3}
                className="w-full text-sm border border-[var(--border-default)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent"
              />

              <p className="text-[10px] text-[var(--text-muted)]">
                หน้า: <span className="font-mono">{pathname}</span>
              </p>

              {errorMsg && (
                <p className="text-xs text-rose-600">{errorMsg}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={state === "submitting"}
                className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {state === "submitting" ? "กำลังส่ง..." : "ส่ง Bug Report"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
