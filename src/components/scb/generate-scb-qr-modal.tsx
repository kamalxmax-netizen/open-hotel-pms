"use client";

import React, { useState, useEffect, useRef } from "react";
import QRCode from "react-qr-code";
import { 
  X, ArrowRight, ArrowLeft, Save, Copy, CheckCircle2, 
  Clock, AlertTriangle, Loader2 
} from "lucide-react";
import { format } from "date-fns";

interface GenerateScbQrModalProps {
  reservationId: string;
  outstandingAmount: number;
  depositHeld?: number;
  targetType?: "reservation" | "pos_order";
  channel?: "booking_folio" | "pos";
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = "mode" | "amount" | "qr";
type Mode = "outstanding" | "custom";

export function GenerateScbQrModal({
  reservationId,
  outstandingAmount,
  depositHeld = 0,
  targetType = "reservation",
  channel = "booking_folio",
  onClose,
  onSuccess
}: GenerateScbQrModalProps) {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode>("outstanding");
  const [includeDeposit, setIncludeDeposit] = useState(false);
  
  // Amounts
  const [roomAmount, setRoomAmount] = useState<number>(outstandingAmount);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  
  // QR State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<any>(null);
  const [status, setStatus] = useState<string>("pending");
  const [timeLeft, setTimeLeft] = useState(0);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastInquiryAtRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrRenderRef = useRef<HTMLDivElement | null>(null);

  const isPOS = targetType === "pos_order";
  const qrValue = String(request?.qr_payload || request?.partner_reference_no || "").trim();
  const hasQrImage = Boolean(request?.qr_image_url);

  // 1. Initial State
  useEffect(() => {
    if (isPOS) {
       setMode("outstanding");
       setIncludeDeposit(false);
       setStep("qr"); // Direct to QR for POS if outstanding is fixed
    }
  }, [isPOS]);

  // 2. Poll & Timer Logic (Similar to Mobile)
  useEffect(() => {
    if (!request?.id || status !== "pending") return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/integrations/scb/requests/${request.id}/status`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          const nextStatus = String(json.data?.status ?? "pending");
          if (nextStatus !== "pending") {
            setStatus(nextStatus);
            if (nextStatus === "paid" && onSuccess) onSuccess();
            return;
          }

          const createdAtMs = request?.created_at ? new Date(request.created_at).getTime() : Number.NaN;
          const inquiryDue = !Number.isNaN(createdAtMs) && Date.now() - createdAtMs >= 2 * 60_000;
          const canRequery = Date.now() - lastInquiryAtRef.current >= 60_000;

          if (inquiryDue && canRequery) {
            lastInquiryAtRef.current = Date.now();
            await fetch("/api/integrations/scb/inquiry", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: JSON.stringify({
                request_id: request.id,
                source: "manual",
              }),
            }).catch(() => null);
          }
        }
      } catch (err) { console.error(err); }
    };

    void pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 5000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [request, status, onSuccess]);

  useEffect(() => {
    if (!request?.expires_at || status !== "pending") return;
    const expiryTime = new Date(request.expires_at).getTime();
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiryTime - now) / 1000));
      setTimeLeft(diff);
      if (diff === 0) setStatus("expired");
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [request, status]);

  // 3. Handlers
  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      // Step A: Check existing
      const checkRes = await fetch(`/api/integrations/scb/requests?target_id=${reservationId}&status=pending`);
      const checkJson = await checkRes.json().catch(() => null);
      
      if (checkRes.ok && checkJson?.success && checkJson.data) {
        // Option to reuse or warning would go here, lead said show QRเดิม if exists
        setRequest(checkJson.data);
        setStatus(checkJson.data.status);
        setStep("qr");
        setLoading(false);
        return;
      }

      // Step B: POST
      const finalRoom = mode === "outstanding" ? outstandingAmount : roomAmount;
      const finalDep = includeDeposit ? depositAmount : 0;

      const createRes = await fetch("/api/integrations/scb/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: reservationId,
          channel: channel,
          room_amount: finalRoom,
          deposit_amount: finalDep,
        })
      });
      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok || !createJson?.success) throw new Error(createJson?.error || "Failed to generate QR.");

      setRequest(createJson.data);
      setStatus(createJson.data.status);
      setStep("qr");
    } catch (err: any) {
      setError(err.message || "Failed to generate QR.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveImage = async () => {
    if (!request || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 600; canvas.height = 800;
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,600,800);
    ctx.fillStyle = "#1e293b"; ctx.font = "bold 24px Inter"; ctx.textAlign = "center";
    ctx.fillText("OFFICIAL PAYMENT QR", 300, 50);

    if (request.qr_image_url) {
      const qrImg = new Image();
      qrImg.crossOrigin = "anonymous";
      qrImg.src = request.qr_image_url;
      await new Promise((resolve) => {
        qrImg.onload = resolve;
      });
      ctx.drawImage(qrImg, 150, 100, 300, 300);
    } else if (qrValue) {
      const svgNode = qrRenderRef.current?.querySelector("svg");
      if (svgNode) {
        const svgMarkup = new XMLSerializer().serializeToString(svgNode);
        const fallbackImg = new Image();
        fallbackImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
        await new Promise((resolve) => {
          fallbackImg.onload = resolve;
        });
        ctx.drawImage(fallbackImg, 150, 100, 300, 300);
      }
    }
    ctx.fillStyle = "#000"; ctx.font = "bold 50px Inter";
    ctx.fillText(`฿ ${request.request_amount_total.toLocaleString()}`, 300, 500);
    ctx.fillStyle = "#64748b"; ctx.font = "18px Inter";
    ctx.fillText(`REF: ${request.partner_reference_no}`, 300, 560);
    
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `QR-${reservationId}.png`; a.click();
    });
  };

  const handleCheckPaymentNow = async () => {
    if (!request?.id || loading) return;
    setLoading(true);
    setError("");
    try {
      const inquiryRes = await fetch("/api/integrations/scb/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          request_id: request.id,
          source: "manual",
        }),
      });
      const inquiryJson = await inquiryRes.json().catch(() => null);
      if (!inquiryRes.ok || !inquiryJson?.success) {
        throw new Error(inquiryJson?.error || "Failed to check payment.");
      }

      const statusRes = await fetch(`/api/integrations/scb/requests/${request.id}/status?_ts=${Date.now()}`, {
        cache: "no-store",
      });
      const statusJson = await statusRes.json().catch(() => null);
      if (!statusRes.ok || !statusJson?.success) {
        throw new Error(statusJson?.error || "Failed to refresh payment status.");
      }

      const nextStatus = String(statusJson.data?.status ?? status);
      setRequest(statusJson.data);
      setStatus(nextStatus);
      if (nextStatus === "paid" && onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to check payment.");
    } finally {
      setLoading(false);
    }
  };

  // 4. Render Step 1 & 2
  const renderConfig = () => {
     if (step === "mode") {
        return (
          <div className="space-y-6 py-4">
             <p className="text-sm font-semibold text-[var(--text-secondary)]">เลือกยอดที่ต้องการเรียกเก็บ:</p>
             <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setMode("outstanding")}
                  className={`p-6 rounded-2xl border-2 text-left transition-all ${mode === "outstanding" ? "border-brand-500 bg-brand-50" : "border-[var(--border-default)] hover:bg-[var(--bg-surface-hover)]"}`}
                >
                   <p className="text-xs font-black uppercase text-brand-600 mb-1">Outstanding</p>
                   <p className="text-2xl font-black">฿{outstandingAmount.toLocaleString()}</p>
                </button>
                <button
                  type="button"
                   onClick={() => setMode("custom")}
                   className={`p-6 rounded-2xl border-2 text-left transition-all ${mode === "custom" ? "border-brand-500 bg-brand-50" : "border-[var(--border-default)] hover:bg-[var(--bg-surface-hover)]"}`}
                >
                   <p className="text-xs font-black uppercase text-slate-500 mb-1">Custom</p>
                   <p className="text-2xl font-black">กำหนดเอง</p>
                </button>
             </div>
             
             {depositHeld > 0 && (
               <label className="flex items-center gap-3 p-4 bg-[var(--bg-muted)] rounded-xl cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={includeDeposit} 
                    onChange={e => setIncludeDeposit(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm font-bold">รวมค่ามัดจำในการโอนด้วย (฿{depositHeld.toLocaleString()})</span>
               </label>
             )}
          </div>
        );
     }

     if (step === "amount") {
        return (
          <div className="space-y-6 py-4">
             <div className="space-y-4">
                <div>
                   <label className="text-xs font-black uppercase text-[var(--text-muted)] tracking-widest mb-1 block">ค่าห้อง</label>
                   <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-[var(--text-muted)]">฿</span>
                      <input 
                        type="number" 
                        value={roomAmount} 
                        onChange={e => setRoomAmount(Number(e.target.value))}
                        className={`form-input pl-10 h-12 w-full font-bold text-lg ${roomAmount > outstandingAmount ? "border-rose-500" : ""}`}
                      />
                   </div>
                   <p className="text-[10px] text-[var(--text-muted)] mt-1 ml-1">ค้างชำระ: ฿{outstandingAmount.toLocaleString()}</p>
                </div>

                {includeDeposit && (
                  <div>
                    <label className="text-xs font-black uppercase text-[var(--text-muted)] tracking-widest mb-1 block">มัดจำ</label>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-[var(--text-muted)]">฿</span>
                        <input 
                          type="number" 
                          value={depositAmount} 
                          onChange={e => setDepositAmount(Number(e.target.value))}
                          className="form-input pl-10 h-12 w-full font-bold text-lg"
                        />
                    </div>
                  </div>
                )}
             </div>

             <div className="pt-4 border-t border-[var(--border-default)] flex justify-between items-center">
                <span className="font-black text-sm uppercase tracking-widest text-[var(--text-muted)]">รวมยอด QR</span>
                <span className="text-3xl font-black text-brand-600 italic">฿{(roomAmount + (includeDeposit ? depositAmount : 0)).toLocaleString()}</span>
             </div>

             {roomAmount > outstandingAmount && (
               <p className="text-xs text-rose-500 font-bold flex items-center gap-1 bg-rose-50 p-2 rounded-lg">
                  <AlertTriangle className="w-3 h-3" /> ยอดชำระค่าห้องห้ามเกินยอดค้างชำระ (฿{outstandingAmount.toLocaleString()})
               </p>
             )}
          </div>
        );
     }

     return null;
  };

  // 5. Render Step 3 (QR)
  const renderQR = () => {
    if (!request) return null;
    const isPaid = status === "paid";
    const isExpired = status === "expired";
    const isPending = status === "pending";

    return (
      <div className="flex flex-col items-center gap-6 py-6 scroll-smooth animate-in zoom-in-95">
         <div className="relative group">
            <div ref={qrRenderRef} className={`bg-white p-4 rounded-3xl shadow-xl transition-all ${isPaid ? "scale-90 opacity-40" : isPending ? "scale-100" : "opacity-20 blur-[1px]"}`}>
              {hasQrImage ? (
                <img src={request.qr_image_url} alt="QR" className="w-64 h-64 rounded-xl" />
              ) : qrValue ? (
                <div className="w-64 h-64 rounded-xl bg-white p-3 flex items-center justify-center">
                  <QRCode value={qrValue} size={232} />
                </div>
              ) : (
                <div className="w-64 h-64 rounded-xl bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                  No QR Data
                </div>
              )}
            </div>
            {isPaid && (
              <div className="absolute inset-0 flex items-center justify-center animate-bounce">
                <div className="bg-emerald-500 text-white rounded-full p-4 shadow-xl">
                    <CheckCircle2 className="w-16 h-16" />
                </div>
              </div>
            )}
         </div>

         <div className="text-center space-y-1">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">SCB Mae Manee PromptPay</p>
            <p className={`text-4xl font-black ${isPaid ? "text-emerald-500" : "text-brand-600 italic"}`}>
              ฿{request.request_amount_total.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--text-muted)] font-medium">
               ค่าห้อง: ฿{request.room_amount.toLocaleString()} · มัดจำ: ฿{request.deposit_amount.toLocaleString()}
            </p>
         </div>

         <div className="w-full max-w-xs space-y-4">
            {isPending && (
              <div className="flex justify-between items-center px-4 py-2 bg-brand-50 rounded-full border border-brand-100 animate-pulse">
                 <span className="text-[10px] uppercase font-black text-brand-600">รอการชำระเงิน</span>
                 <span className="text-sm font-mono font-bold text-brand-700">
                    {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, "0")}
                 </span>
              </div>
            )}

            {isPaid && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl flex items-center gap-3 text-sm font-bold">
                 <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                 ชำระเงินสำเร็จแล้ว
              </div>
            )}

            {(isExpired || status === "cancelled" || status === "failed") && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-sm font-bold text-center space-y-2">
                 <p>{isExpired ? "QR หมดอายุแล้ว" : "รายการถูกยกเลิก"}</p>
                       <button type="button" onClick={() => setStep("mode")} className="text-xs underline text-rose-600 hover:text-rose-700 font-black uppercase tracking-widest">สร้างใหม่</button>
              </div>
            )}
         </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-[var(--bg-surface)] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-default)] flex justify-between items-center bg-[var(--bg-body)]">
           <div className="flex flex-col">
              <h3 className="font-black text-[var(--text-primary)] text-lg leading-tight">
                 {step === "qr" ? "QR ชำระเงิน" : "สร้าง SCB QR รับเงิน"}
              </h3>
              <p className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-widest mt-0.5">
                 Reservation ID: {reservationId}
              </p>
           </div>
           <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-[var(--text-muted)] transition-colors">
              <X className="w-5 h-5" />
           </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6">
           {loading ? (
             <div className="py-20 flex flex-col items-center gap-4 text-[var(--text-muted)]">
                <Loader2 className="w-10 h-10 animate-spin" />
                <p className="font-bold text-sm tracking-widest uppercase">กำลังส่งข้อมูลไป SCB...</p>
             </div>
           ) : error ? (
             <div className="py-12 flex flex-col items-center gap-4 text-center">
                <AlertTriangle className="w-12 h-12 text-rose-500" />
                <p className="font-bold text-rose-700">{error}</p>
                <button type="button" onClick={() => setStep("mode")} className="btn btn-secondary px-6 btn-sm">ลองใหม่</button>
             </div>
           ) : (
             step === "qr" ? renderQR() : renderConfig()
           )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-default)] flex justify-between items-center bg-[var(--bg-body)] min-h-[72px]">
           {step === "mode" && !loading && !error && (
             <>
               <button type="button" onClick={onClose} className="btn btn-ghost px-6 shadow-none">ยกเลิก</button>
               <button 
                 type="button"
                 onClick={() => setStep("amount")} 
                 className="btn btn-primary px-8 flex items-center gap-2"
               >
                 ถัดไป <ArrowRight className="w-4 h-4" />
               </button>
             </>
           )}

           {step === "amount" && !loading && !error && (
             <>
               <button type="button" onClick={() => setStep("mode")} className="btn btn-ghost px-6 flex items-center gap-2">
                 <ArrowLeft className="w-4 h-4" /> กลับ
               </button>
               <button 
                 type="button"
                 onClick={handleGenerate}
                 disabled={roomAmount > outstandingAmount || (roomAmount + (includeDeposit ? depositAmount : 0)) <= 0}
                 className="btn btn-primary px-10 shadow-lg shadow-brand-500/20"
               >
                 สร้าง QR
               </button>
             </>
           )}

           {step === "qr" && !loading && !error && (
              <>
                <div className="flex gap-2">
                   {status === "pending" && (
                     <>
                       <button type="button" onClick={handleSaveImage} className="btn btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 h-10">
                          <Save className="w-4 h-4" /> บันทึกรูป
                       </button>
                       <button type="button" onClick={handleCheckPaymentNow} className="btn btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 h-10">
                          <CheckCircle2 className="w-4 h-4" /> ตรวจสอบการชำระ
                       </button>
                       <button type="button" onClick={() => navigator.clipboard.writeText(request?.partner_reference_no)} className="btn btn-secondary px-4 py-2 text-xs flex items-center gap-1.5 h-10">
                          <Copy className="w-4 h-4" /> คัดลอก Ref
                       </button>
                     </>
                   )}
                </div>
                <button
                  type="button"
                  onClick={onClose} 
                  className={`btn h-11 px-8 font-black uppercase tracking-widest ${status === "paid" ? "btn-primary" : "btn-ghost"}`}
                >
                  {status === "paid" ? "ปิด (ชำระแล้ว)" : "ปิด"}
                </button>
              </>
           )}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
