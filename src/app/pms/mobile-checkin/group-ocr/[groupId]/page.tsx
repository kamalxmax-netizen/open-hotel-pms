"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, Image as ImageIcon, Check, AlertTriangle, Loader2 } from "lucide-react";
import { mockGroupOcrPool, mockGroupOcrScanSuccess } from "@/lib/mock/group-ocr";
import { buildPassportMrzBlob, PASSPORT_OCR_MAX_FILE_BYTES } from "@/lib/passport-ocr/client-preprocess";

type ScanState = "idle" | "uploading" | "result" | "done";

interface PoolEntry {
  scan_id: string;
  pool_status: "ready" | "ocr_failed";
  display_name?: string | null;
  nationality_code?: string | null;
  passport_no?: string | null;
  gender?: string | null;
  source?: string;
  image_path?: string | null;
}

export default function GroupOcrCameraLoop() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [state, setState] = useState<ScanState>("idle");
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // result state variables
  const [lastResult, setLastResult] = useState<any>(null);
  const [lastPreview, setLastPreview] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const poolContainerRef = useRef<HTMLDivElement>(null);

  // Fetch initial pool data
  useEffect(() => {
    const fetchPool = async () => {
      try {
        const res = await fetch(`/api/checkin/group-ocr-pool/${groupId}`);
        if (!res.ok) throw new Error("Endpoint not ready");
        const json = await res.json();
        setPool(json.pool || []);
      } catch (err) {
        console.warn("API failed, using mock:", err);
        const mock = mockGroupOcrPool(groupId);
        setPool(mock.pool);
      } finally {
        setLoading(false);
      }
    };
    fetchPool();
  }, [groupId]);

  // Auto-scroll pool to bottom
  useEffect(() => {
    if (poolContainerRef.current) {
      poolContainerRef.current.scrollTop = poolContainerRef.current.scrollHeight;
    }
  }, [pool]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (lastPreview) URL.revokeObjectURL(lastPreview);
    };
  }, [lastPreview]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload a valid image file (JPEG, PNG).");
      return;
    }

    if (file.size > PASSPORT_OCR_MAX_FILE_BYTES) {
      setError("File size exceeds 10MB limit. Please capture a smaller photo.");
      return;
    }

    // Set preview from original file
    const url = URL.createObjectURL(file);
    setLastPreview(url);
    setState("uploading");

    try {
      // Phase 48 preprocessing: resize → crop MRZ zone → optimize
      const mrzBlob = await buildPassportMrzBlob(file);

      const formData = new FormData();
      formData.append("image", mrzBlob, "passport-mrz.jpg");
      formData.append("booking_group_id", groupId);

      const res = await fetch("/api/checkin/group-ocr-scan", {
        method: "POST",
        body: formData,
      });

      let json;
      if (!res.ok) {
        throw new Error("API not ready");
      } else {
        json = await res.json();
      }

      setLastResult(json);
      
      // Add to local pool immediately for snappy UX
      if (json.entry || json.pool_status === "ocr_failed") {
        setPool(prev => [...prev, {
          scan_id: json.scan_id,
          pool_status: json.pool_status,
          display_name: json.entry?.display_name || null,
          nationality_code: json.entry?.nationality_code || null,
          passport_no: json.entry?.passport_no || null,
          gender: json.entry?.gender || null,
          source: "passport_ocr"
        }]);
      }
    } catch (err) {
      console.warn("API failed, using mock:", err);
      // Let's sometimes simulate a failure randomly for dev
      const forceFail = Math.random() > 0.8;
      const mockResult = await mockGroupOcrScanSuccess(forceFail);
      setLastResult(mockResult);

      if (mockResult.entry || mockResult.pool_status === "ocr_failed") {
        setPool(prev => [...prev, {
          scan_id: mockResult.scan_id,
          pool_status: mockResult.pool_status as any,
          display_name: mockResult.entry?.display_name || null,
          nationality_code: mockResult.entry?.nationality_code || null,
          passport_no: mockResult.entry?.passport_no || null,
          gender: mockResult.entry?.gender || null,
          source: "passport_ocr"
        }]);
      }
    }

    setState("result");
    
    // reset inputs
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  const handleNextScan = () => {
    setLastResult(null);
    if (lastPreview) URL.revokeObjectURL(lastPreview);
    setLastPreview(null);
    setState("idle");
  };

  const handleDone = () => {
    setState("done");
  };

  const poolSuccessCount = pool.filter(p => p.pool_status === "ready").length;
  const poolFailedCount = pool.filter(p => p.pool_status === "ocr_failed").length;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-body)] pb-24">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link 
            href="/pms/mobile-checkin/group-ocr"
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight">Group OCR</h1>
            <p className="text-xs font-bold text-violet-600 tracking-wider">#{groupId.slice(-6).toUpperCase()}</p>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-900 p-4 m-6 mb-0 rounded-r-lg shadow-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-4">
           <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
           <div>
              <h3 className="font-bold text-sm">Upload Failed</h3>
              <p className="text-xs mt-1">{error}</p>
           </div>
           <button onClick={() => setError(null)} className="ml-auto text-amber-700 hover:text-amber-900 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center">✕</button>
        </div>
      )}

      <main className="flex-1 flex flex-col p-6 space-y-6">
        
        {/* State: Uploading */}
        {state === "uploading" && (
          <div className="flex-1 flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-24 h-24 bg-violet-100 dark:bg-violet-900/30 rounded-3xl flex items-center justify-center text-violet-600 mb-6 shadow-[0_0_0_12px_rgba(139,92,246,0.1)]">
              <Loader2 className="w-12 h-12 animate-spin" />
            </div>
            <h2 className="text-xl font-black text-[var(--text-primary)]">อ่านข้อมูลพาสปอร์ต</h2>
            <p className="text-[var(--text-secondary)] mt-2 font-medium">กำลังประมวลผล OCR...</p>
          </div>
        )}

        {/* State: Result */}
        {state === "result" && lastResult && (
          <div className="flex-1 flex flex-col items-center animate-in slide-in-from-bottom-8">
            {lastPreview && (
              <div className="w-full max-w-sm aspect-[4/3] rounded-2xl overflow-hidden shadow-lg border-4 border-white dark:border-[var(--border-default)] mb-6">
                <img src={lastPreview} alt="Scan preview" className="w-full h-full object-cover" />
              </div>
            )}

            <div className="w-full max-w-sm space-y-4">
              {lastResult.ocr_success ? (
                <>
                  {lastResult.warnings?.length > 0 ? (
                    <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-500/30 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="w-6 h-6 text-amber-500" />
                        <h2 className="font-black text-lg text-amber-800 dark:text-amber-300 uppercase">
                          บางข้อมูลไม่ครบ
                        </h2>
                      </div>
                      <div className="space-y-1 mb-3">
                        <p className="font-bold text-amber-900 dark:text-amber-100 text-xl">{lastResult.entry?.display_name}</p>
                        <p className="text-sm font-semibold text-amber-700 flex gap-3">
                          <span>{lastResult.entry?.passport_no}</span>
                          <span>{lastResult.entry?.nationality_code || "No Nation"}</span>
                        </p>
                      </div>
                      <div className="text-xs font-bold bg-amber-200/50 text-amber-800 p-2 rounded-lg">
                        {lastResult.warnings.join(", ")}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-500/30 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <Check className="w-6 h-6 text-emerald-500" />
                        <h2 className="font-black text-lg text-emerald-800 dark:text-emerald-300 uppercase">
                          Added to pool
                        </h2>
                      </div>
                      <div className="space-y-1">
                        <p className="font-bold text-emerald-900 dark:text-emerald-100 text-xl">{lastResult.entry?.display_name}</p>
                        <p className="text-sm font-semibold text-emerald-700 flex gap-3">
                          <span>{lastResult.entry?.passport_no}</span>
                          <span className="bg-emerald-200 px-1.5 rounded">{lastResult.entry?.nationality_code}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-rose-100 dark:bg-rose-900/30 border border-rose-300 dark:border-rose-500/30 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-6 h-6 text-rose-500" />
                    <h2 className="font-black text-lg text-rose-800 dark:text-rose-300 uppercase">
                      อ่านไม่ได้
                    </h2>
                  </div>
                  <p className="text-sm font-bold text-rose-700 mb-2">
                    ไม่พบ MRZ หรือแสงสะท้อนบัง กรุณาถ่ายใหม่หรือข้ามเพื่อกรอกข้อมูลบน Desktop ภายหลัง
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-4">
                <button
                  onClick={handleNextScan}
                  className="w-full h-14 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-input)] text-[var(--text-primary)] rounded-2xl font-black uppercase text-sm tracking-widest shadow-sm transition-all"
                >
                  ถ่ายใหม่
                </button>
                <button
                  onClick={handleNextScan}
                  className="w-full h-14 bg-violet-600 hover:bg-violet-700 shadow-violet-500/30 shadow-lg text-white rounded-2xl font-black uppercase text-sm tracking-widest transition-all"
                >
                  Scan Next
                </button>
              </div>
            </div>
          </div>
        )}

        {/* State: Idle / Active Loop */}
        {state === "idle" && (
          <>
            <div className="flex-1 flex flex-col space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">Ready to Scan</h2>
                <div className="text-xs font-bold text-[var(--text-secondary)] bg-[var(--bg-surface-hover)] px-2 py-1 rounded border border-[var(--border-subtle)]">
                  {pool.length} scanned
                </div>
              </div>

              {/* Pool Logs */}
              <div 
                ref={poolContainerRef}
                className="flex-1 border border-[var(--border-default)] rounded-2xl bg-[var(--bg-surface)] overflow-y-auto max-h-[40vh] p-2 space-y-2 relative"
              >
                {loading ? (
                   <div className="h-full flex items-center justify-center">
                     <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
                   </div>
                ) : pool.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] text-sm font-medium">
                    <ImageIcon className="w-8 h-8 opacity-20 mb-2" />
                    <p>No scans in pool yet.</p>
                  </div>
                ) : (
                  pool.map((p, i) => (
                    <div key={p.scan_id + i} className="flex items-center justify-between bg-[var(--bg-body)] p-3 rounded-xl border border-[var(--border-subtle)] animate-in fade-in slide-in-from-right-4">
                      <div>
                        {p.pool_status === "ocr_failed" ? (
                          <div className="font-bold text-rose-600 dark:text-rose-400 text-sm">Failed Scan</div>
                        ) : (
                          <div className="font-bold text-[var(--text-primary)] text-sm">{p.display_name}</div>
                        )}
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
                          {p.pool_status === "ocr_failed" ? "Saved photo for manual entry" : `${p.passport_no || "—"} · ${p.nationality_code || "—"}`}
                        </div>
                      </div>
                      <div>
                        {p.pool_status === "ready" ? (
                           <Check className="w-5 h-5 text-emerald-500" />
                        ) : (
                           <AlertTriangle className="w-5 h-5 text-rose-500" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Scan Actions */}
              <div className="grid grid-cols-12 gap-3 mt-auto pt-4">
                <div className="col-span-8">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleCapture}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-16 bg-violet-600 hover:bg-violet-700 shadow-[0_4px_20px_rgba(139,92,246,0.3)] text-white rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Camera className="w-6 h-6" /> Scan
                  </button>
                </div>
                <div className="col-span-4">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={galleryInputRef}
                    onChange={handleCapture}
                  />
                  <button
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-full h-16 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-input)] text-[var(--text-secondary)] rounded-2xl font-bold uppercase text-xs tracking-wider transition-all flex items-center justify-center gap-1.5"
                  >
                    <ImageIcon className="w-5 h-5" /> File
                  </button>
                </div>
              </div>

            </div>
          </>
        )}

        {/* State: Done Summary */}
        {state === "done" && (
          <div className="flex-1 flex flex-col items-center justify-center animate-in slide-in-from-bottom-8">
             <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-600 mb-6 border-[8px] border-emerald-50 dark:border-emerald-900/10">
              <Check className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-black text-[var(--text-primary)] uppercase tracking-wider mb-2">
              All Set
            </h2>
            <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl p-6 w-full max-w-sm mt-4 text-center shadow-sm">
              <div className="grid grid-cols-2 gap-4 divide-x divide-[var(--border-subtle)]">
                <div>
                  <div className="text-3xl font-black text-emerald-600">{poolSuccessCount}</div>
                  <div className="text-xs font-bold text-[var(--text-secondary)] uppercase mt-1">Ready</div>
                </div>
                <div>
                  <div className="text-3xl font-black text-rose-600">{poolFailedCount}</div>
                  <div className="text-xs font-bold text-[var(--text-secondary)] uppercase mt-1">Failed</div>
                </div>
              </div>
              <p className="mt-5 text-sm font-semibold text-[var(--text-muted)]">
                You can now assign these passports securely from the Desktop Check-in Wizard.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Floating Done Button */}
      {(state === "idle" || state === "done") && (
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none z-20">
          <div className="max-w-lg mx-auto pointer-events-auto">
            {state === "idle" ? (
               <button
                  onClick={handleDone}
                  disabled={loading}
                  className="w-full h-14 bg-slate-800 hover:bg-slate-900 shadow-lg shadow-slate-900/20 text-white rounded-2xl font-black tracking-widest uppercase transition-all"
                >
                  Finish Scanning
                </button>
            ) : (
                <Link
                  href="/pms/mobile-checkin/group-ocr"
                  className="w-full h-14 flex items-center justify-center bg-slate-800 hover:bg-slate-900 shadow-lg shadow-slate-900/20 text-white rounded-2xl font-black tracking-widest uppercase transition-all"
                >
                  Back to Groups
                </Link>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
