"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Camera, RefreshCw, ScanText } from "lucide-react";

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

function cropBottomMrzDataUrl(dataUrl: string) {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const crop = { left: 0.03, top: 0.6, width: 0.94, bottom: 0.985 };
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
    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
}

function evaluatePracticeVerdict(result: PassportOcrResult | null, meta: PassportOcrMeta | null, errorText: string) {
  if (errorText) {
    return {
      tone: "rose" as const,
      title: "Retake Recommended",
      message: "OCR อ่าน MRZ ไม่ผ่าน ลองถ่ายใหม่ให้คมขึ้น ลดแสงสะท้อน และให้ MRZ อยู่เต็มเฟรม",
    };
  }
  if (!result) {
    return {
      tone: "slate" as const,
      title: "Ready to Practice",
      message: "ถ่ายภาพ passport แล้วกด Run Passport OCR เพื่อดูว่ารูปอ่านได้ดีแค่ไหน",
    };
  }

  const confidence = Number(meta?.confidence_score || 0);
  const okCount = Object.values(result.fieldStatus).filter((status) => status === "ok").length;
  const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;

  if (confidence >= 85 && okCount >= 5 && warningCount === 0) {
    return {
      tone: "emerald" as const,
      title: "OK",
      message: "ภาพชุดนี้อ่านได้ดี ใช้เป็นตัวอย่างการถ่ายที่ถูกต้องได้เลย",
    };
  }

  if (confidence >= 65 && okCount >= 3) {
    return {
      tone: "amber" as const,
      title: "Needs Manual Check",
      message: "อ่านได้บางส่วน แต่ยังควรเช็กชื่อ เลข passport หรือวันเกิดอีกครั้ง",
    };
  }

  return {
    tone: "rose" as const,
    title: "Retake Recommended",
    message: "ภาพยังไม่ชัดพอสำหรับ MRZ ลองถ่ายใกล้ขึ้น ตรงขึ้น และให้แสงสม่ำเสมอ",
  };
}

function verdictToneClasses(tone: "slate" | "emerald" | "amber" | "rose") {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200";
  }
  return "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]";
}

export default function MobilePassportPractice() {
  const [inputKey, setInputKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mrzPreviewUrl, setMrzPreviewUrl] = useState("");
  const [statusText, setStatusText] = useState("Open the camera, take a passport photo, then run OCR.");
  const [errorText, setErrorText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PassportOcrResult | null>(null);
  const [meta, setMeta] = useState<PassportOcrMeta | null>(null);

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

  const verdict = evaluatePracticeVerdict(result, meta, errorText);

  const resetPractice = () => {
    setInputKey((value) => value + 1);
    setSelectedFile(null);
    setMrzPreviewUrl("");
    setStatusText("Open the camera, take a passport photo, then run OCR.");
    setErrorText("");
    setBusy(false);
    setResult(null);
    setMeta(null);
  };

  const updateSelectedFile = (file: File | null) => {
    setSelectedFile(file);
    setResult(null);
    setMeta(null);
    setErrorText("");
    if (!file) {
      setMrzPreviewUrl("");
      setStatusText("Open the camera, take a passport photo, then run OCR.");
      return;
    }
    setMrzPreviewUrl("");
    setStatusText("Photo captured. Review the preview, then run Passport OCR.");
  };

  const handleScan = async () => {
    if (!selectedFile) {
      setErrorText("Please take a passport photo first.");
      return;
    }

    setBusy(true);
    setErrorText("");
    setStatusText("Running Passport OCR...");
    setResult(null);
    setMeta(null);

    try {
      const rawDataUrl = await readFileAsDataUrl(selectedFile);
      const fullDataUrl = await optimizeImageDataUrl(rawDataUrl, IMAGE_OPT.FULL_MAX_SIDE, IMAGE_OPT.JPEG_QUALITY);
      const mrzRawDataUrl = await cropBottomMrzDataUrl(fullDataUrl);
      const finalMrzDataUrl = await optimizeImageDataUrl(mrzRawDataUrl, IMAGE_OPT.MRZ_MAX_SIDE, IMAGE_OPT.JPEG_QUALITY);
      setMrzPreviewUrl(finalMrzDataUrl);

      const formData = new FormData();
      formData.append("image", dataUrlToBlob(finalMrzDataUrl), "passport-mrz.jpg");
      formData.append("source", "mobile_practice");

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
      setStatusText("Passport OCR complete. Review the previews and result quality.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Passport OCR failed.");
      setStatusText("Passport OCR failed. Retake the photo and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-muted)]">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-4">
        <Link
          href="/pms/mobile-checkin"
          className="rounded-full p-3 -ml-3 text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Passport OCR Practice</h1>
          <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">
            Camera only. No booking link. No guest data saved.
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-5 p-5 sm:p-6">
        <section className={`rounded-2xl border p-4 ${verdictToneClasses(verdict.tone)}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-widest">{verdict.title}</p>
              <p className="mt-1 text-sm font-medium opacity-90">{verdict.message}</p>
            </div>
            {meta ? (
              <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-bold dark:bg-white/10">
                {meta.confidence_score}%
              </span>
            ) : null}
          </div>
          <p className="mt-3 text-xs font-semibold opacity-70">{statusText}</p>
          {errorText ? <p className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{errorText}</p> : null}
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
          <p className="text-sm font-semibold text-[var(--text-primary)]">โหมดฝึกถ่าย</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            ใช้กล้องถ่ายสดอย่างเดียว แล้วดูภาพ MRZ ที่ระบบส่งเข้า OCR จริงหลังสแกนแต่ละรอบ
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="btn btn-primary cursor-pointer">
              <Camera className="mr-2 h-4 w-4" />
              ถ่าย Passport
              <input
                key={inputKey}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => updateSelectedFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button type="button" className="btn" onClick={handleScan} disabled={busy || !selectedFile}>
              {busy ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  กำลังสแกน...
                </>
              ) : (
                <>
                  <ScanText className="mr-2 h-4 w-4" />
                  เริ่ม Passport OCR
                </>
              )}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetPractice}>
              เริ่มฝึกใหม่
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-sm">
          <p className="text-sm font-semibold text-[var(--text-primary)]">ภาพที่ส่งเข้า OCR (MRZ)</p>
          <div className="mt-3 flex min-h-[220px] items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)]">
            {mrzPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mrzPreviewUrl} alt="Passport MRZ preview" className="max-h-[360px] w-full rounded-xl object-contain" />
            ) : (
              <p className="px-5 text-center text-sm text-[var(--text-muted)]">หลังสแกน ระบบจะแสดงภาพ MRZ ที่ถูกส่งเข้า OCR จริงตรงนี้</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Extracted Fields</p>
            {result ? (
              <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                {meta ? `${meta.confidence_label} · ${meta.confidence_score}%` : "Ready"}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {resultRows.length > 0 ? (
              resultRows.map((row) => (
                <div key={row.label} className={`rounded-xl border px-3 py-2 ${fieldTone(row.status)}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{row.label}</p>
                  <p className="mt-1 text-sm font-semibold">{row.value}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-5 text-sm text-[var(--text-muted)] sm:col-span-2">
                OCR result quality will appear here after a practice scan.
              </div>
            )}
          </div>
        </section>

        {result?.warnings.length ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="text-sm font-semibold">Manual review notes</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
          <p className="text-sm font-semibold text-[var(--text-primary)]">วิธีดูว่ารูปใช้ได้ไหม</p>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
            <li>ให้ passport อยู่เต็มเฟรม โดยเฉพาะแถบ MRZ ด้านล่างต้องติดมาครบ</li>
            <li>หลีกเลี่ยงแสงสะท้อนตรงโซน MRZ ถ้าเส้นหรืออักษรซีด ให้ถ่ายใหม่</li>
            <li>ดูภาพ MRZ ที่ส่งเข้า OCR ว่าระบบ crop โดนเฉพาะส่วนที่ต้องอ่านจริงหรือไม่</li>
            <li>ถ้าผลไม่ขึ้นว่า `OK` ให้กด `เริ่มฝึกใหม่` แล้วลองถ่ายใหม่ได้ทันที</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
