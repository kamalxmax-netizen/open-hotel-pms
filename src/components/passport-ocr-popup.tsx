"use client";

import { useEffect, useMemo, useState } from "react";

type PassportOcrFieldStatus = "ok" | "manual_check";

type PassportOcrResult = {
  firstName: string | null;
  familyName: string | null;
  nationality: string | null;
  passportNumber: string | null;
  gender: "M" | "F" | "X" | null;
  dateOfBirth: string | null;
  mrzLine1: string;
  mrzLine2: string;
  fieldStatus: {
    passportNumber: PassportOcrFieldStatus;
    nationality: PassportOcrFieldStatus;
    firstName: PassportOcrFieldStatus;
    familyName: PassportOcrFieldStatus;
    gender: PassportOcrFieldStatus;
    dateOfBirth: PassportOcrFieldStatus;
  };
  warnings: string[];
};

type PassportOcrMeta = {
  selected_source: string;
  confidence_score: number;
  confidence_label: string;
};

type PassportOcrDebug = {
  selected_text: string;
  candidates: Array<{
    source: string;
    confidence_score: number;
    confidence_label: string;
    parsed: boolean;
  }>;
};

const IMAGE_OPT = {
  FULL_MAX_SIDE: 1800,
  MRZ_MAX_SIDE: 1800,
  JPEG_QUALITY: 0.85,
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Cannot read image file."));
    reader.readAsDataURL(file);
  });
}

function optimizeImageDataUrl(dataUrl: string, maxSide: number, quality: number) {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const limit = Math.max(600, Number(maxSide) || 1800);
      const longest = Math.max(srcW, srcH);
      const scale = longest > limit ? limit / longest : 1;
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, outW, outH);
      resolve(canvas.toDataURL("image/jpeg", quality || 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function cropBottomMrzDataUrl(dataUrl: string, preset: "tight" | "legacy" = "tight") {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const crop =
        preset === "legacy"
          ? { left: 0.02, top: 0.46, width: 0.96, bottom: 0.98 }
          : { left: 0.03, top: 0.60, width: 0.94, bottom: 0.985 };

      const left = Math.max(0, Math.floor(srcW * crop.left));
      const top = Math.max(0, Math.floor(srcH * crop.top));
      const width = Math.max(1, Math.min(srcW - left, Math.floor(srcW * crop.width)));
      const bottomPx = Math.max(top + 1, Math.min(srcH, Math.floor(srcH * crop.bottom)));
      const height = Math.max(1, bottomPx - top);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function enhanceMrzDataUrl(dataUrl: string) {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = srcW;
      canvas.height = srcH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      // OCR-friendly enhancement pass for MRZ:
      // keep the original crop path, but add grayscale + contrast + brightness
      // as a fallback candidate rather than replacing the raw MRZ image.
      ctx.filter = "grayscale(1) contrast(1.6) brightness(1.15)";
      ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, srcW, srcH);
      resolve(canvas.toDataURL("image/jpeg", 0.96));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, b64] = String(dataUrl || "").split(",");
  const mime = /data:([^;]+)/.exec(meta || "")?.[1] || "image/jpeg";
  const binary = atob(b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function displayValue(value: string | null) {
  return String(value || "").trim() || "Needs manual check";
}

function fieldTone(status: PassportOcrFieldStatus) {
  return status === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-800";
}

export default function PassportOcrPopup() {
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const importTarget = searchParams.get("target") === "accompany" ? "accompany" : "main";
  const scanId = searchParams.get("scan_id");
  const reservationId = searchParams.get("reservation_id");
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [mrzPreviewUrl, setMrzPreviewUrl] = useState("");
  const [mrzEnhancedPreviewUrl, setMrzEnhancedPreviewUrl] = useState("");
  const [statusText, setStatusText] = useState("Capture the passport MRZ area or upload a photo.");
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PassportOcrResult | null>(null);
  const [meta, setMeta] = useState<PassportOcrMeta | null>(null);
  const [debug, setDebug] = useState<PassportOcrDebug | null>(null);

  const canConfirm = Boolean(result);

  const resultRows = useMemo(
    () =>
      result
        ? [
            { label: "First Name", value: displayValue(result.firstName), status: result.fieldStatus.firstName },
            { label: "Family Name", value: displayValue(result.familyName), status: result.fieldStatus.familyName },
            { label: "Nationality", value: displayValue(result.nationality), status: result.fieldStatus.nationality },
            { label: "Passport Number", value: displayValue(result.passportNumber), status: result.fieldStatus.passportNumber },
            { label: "Gender", value: displayValue(result.gender), status: result.fieldStatus.gender },
            { label: "DOB", value: displayValue(result.dateOfBirth), status: result.fieldStatus.dateOfBirth },
          ]
        : [],
    [result]
  );

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      if (mrzPreviewUrl) URL.revokeObjectURL(mrzPreviewUrl);
      if (mrzEnhancedPreviewUrl) URL.revokeObjectURL(mrzEnhancedPreviewUrl);
    };
  }, [mrzEnhancedPreviewUrl, mrzPreviewUrl, previewUrl]);

  // Handle loading saved scan (Bonus: PDPA access)
  useEffect(() => {
    if (!scanId && !reservationId) return;

    const loadSavedScan = async () => {
      setBusy(true);
      setErrorText("");
      setStatusText("Loading saved passport data...");
      try {
        const targetScanId = scanId || "latest";
        const qs = reservationId ? `?reservation_id=${encodeURIComponent(reservationId)}` : "";
        const res = await fetch(`/api/checkin/passport-photo/${targetScanId}${qs}`);
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error || "Cannot load photo");
        }

        setPreviewUrl(payload.data.url);
        const p = payload.data.ocr_parsed;
        
        setResult({
          firstName: p.firstName,
          familyName: p.familyName,
          nationality: p.nationality,
          passportNumber: p.passportNumber,
          gender: p.gender,
          dateOfBirth: p.dateOfBirth,
          mrzLine1: p.mrzLine1 || "",
          mrzLine2: p.mrzLine2 || "",
          fieldStatus: {
            passportNumber: "ok",
            nationality: "ok",
            firstName: "ok",
            familyName: "ok",
            gender: "ok",
            dateOfBirth: "ok"
          },
          warnings: []
        });
        
        setStatusText(`Loaded saved scan from ${new Date(payload.data.created_at).toLocaleString()}`);
      } catch (err: any) {
        setErrorText(err.message);
        setStatusText("Failed to load saved scan.");
      } finally {
        setBusy(false);
      }
    };
    
    loadSavedScan();
  }, [reservationId, scanId]);

  const updateSelectedFile = (file: File | null) => {
    setSelectedFile(file);
    setResult(null);
    setMeta(null);
    setDebug(null);
    setErrorText("");
    if (!file) {
      setPreviewUrl("");
      setMrzPreviewUrl("");
      setMrzEnhancedPreviewUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
    setMrzPreviewUrl("");
    setMrzEnhancedPreviewUrl("");
    setStatusText("Image selected. Review preview, then run Passport OCR.");
  };

  const handleScan = async () => {
    if (!selectedFile) {
      setErrorText("Please choose an image first.");
      return;
    }

    setBusy(true);
    setErrorText("");
    setStatusText("Running Passport OCR...");
    setResult(null);
    setMeta(null);
    setDebug(null);

    try {
      setStatusText("Preparing MRZ image...");
      const rawDataUrl = await readFileAsDataUrl(selectedFile);
      const fullDataUrl = await optimizeImageDataUrl(rawDataUrl, IMAGE_OPT.FULL_MAX_SIDE, IMAGE_OPT.JPEG_QUALITY);
      const mrzRawDataUrl = await cropBottomMrzDataUrl(fullDataUrl, "tight");
      const finalMrzDataUrl = await optimizeImageDataUrl(mrzRawDataUrl, IMAGE_OPT.MRZ_MAX_SIDE, IMAGE_OPT.JPEG_QUALITY);
      const enhancedMrzDataUrl = await enhanceMrzDataUrl(finalMrzDataUrl);
      setMrzPreviewUrl(finalMrzDataUrl);
      setMrzEnhancedPreviewUrl(enhancedMrzDataUrl);

      const formData = new FormData();
      formData.append("image", dataUrlToBlob(finalMrzDataUrl), "passport-mrz.jpg");
      formData.append("source", "tight_mrz");

      const response = await fetch("/api/passport-ocr/scan", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Passport OCR failed.");
      }

      setResult(payload.data as PassportOcrResult);
      setMeta((payload.meta || null) as PassportOcrMeta | null);
      setDebug((payload.debug || null) as PassportOcrDebug | null);
      setStatusText("Passport OCR complete. Review fields before import.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Passport OCR failed.");
      setStatusText("Passport OCR failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = () => {
    if (!result || !window.opener) return;
    window.opener.postMessage(
      {
        type: "PMS_PASSPORT_OCR_CONFIRMED",
        target: importTarget,
        payload: result,
      },
      window.location.origin
    );
    window.close();
  };

  return (
    <main className="min-h-screen bg-[var(--bg-surface-hover)] p-4 sm:p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Passport OCR</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Capture the MRZ area at the bottom of the passport. Photo is not stored.
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm self-start" onClick={() => window.close()}>
            Close
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4">
            <div className="rounded-xl border border-dashed border-[var(--border-input)] bg-[var(--bg-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Choose image</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Use camera or upload an existing passport photo.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <label className="btn btn-primary btn-sm cursor-pointer">
                  Take Photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(event) => updateSelectedFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  Upload Image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => updateSelectedFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button type="button" className="btn btn-sm" onClick={handleScan} disabled={busy || !selectedFile}>
                  {busy ? "Scanning..." : "Run Passport OCR"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Original preview</p>
                <div className="mt-3 flex min-h-[240px] items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)]">
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="Passport preview" className="max-h-[360px] w-full rounded-lg object-contain" />
                  ) : (
                    <p className="px-6 text-center text-sm text-[var(--text-muted)]">No image selected yet.</p>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">MRZ auto-crop</p>
                <div className="mt-3 flex min-h-[240px] items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)]">
                  {mrzPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mrzPreviewUrl} alt="Passport MRZ preview" className="max-h-[360px] w-full rounded-lg object-contain" />
                  ) : (
                    <p className="px-6 text-center text-sm text-[var(--text-muted)]">Run Passport OCR to generate MRZ crop preview.</p>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">MRZ enhanced (preview only)</p>
                <div className="mt-3 flex min-h-[240px] items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)]">
                  {mrzEnhancedPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mrzEnhancedPreviewUrl} alt="Passport MRZ enhanced preview" className="max-h-[360px] w-full rounded-lg object-contain" />
                  ) : (
                    <p className="px-6 text-center text-sm text-[var(--text-muted)]">Enhanced OCR fallback preview appears after scanning.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Status</p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{statusText}</p>
              {errorText ? <p className="mt-2 text-sm font-medium text-rose-600">{errorText}</p> : null}
            </div>

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Extracted fields</p>
                {result ? (
                  <span className="badge bg-indigo-100 text-indigo-700">
                    {meta ? `${meta.confidence_label} · ${meta.confidence_score}%` : result.warnings.length > 0 ? `${result.warnings.length} manual check` : "Ready"}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-2">
                {resultRows.length > 0 ? (
                  resultRows.map((row) => (
                    <div
                      key={row.label}
                      className={`rounded-xl border px-3 py-2 ${fieldTone(row.status)}`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{row.label}</p>
                      <p className="mt-1 text-sm font-semibold">{row.value}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-4 text-sm text-[var(--text-muted)]">
                    OCR results will appear here after scanning.
                  </div>
                )}
              </div>
            </div>

            {result?.warnings.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">Needs manual check</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">MRZ</p>
              <div className="mt-3 space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3 font-mono text-[11px] text-[var(--text-secondary)]">
                <p className="break-all">{result?.mrzLine1 || "-"}</p>
                <p className="break-all">{result?.mrzLine2 || "-"}</p>
              </div>
              {debug ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Debug source</p>
                    <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{meta?.selected_source || "-"}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">OCR text</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-secondary)]">
                      {debug.selected_text || "-"}
                    </pre>
                  </div>
                </div>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.close()}>
                  Cancel
                </button>
                <button type="button" className="btn btn-sm" onClick={handleConfirm} disabled={!canConfirm}>
                  Confirm Import
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
