"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Share2, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { APP_NAME } from "@/lib/constants";

export default function TransferQRPage() {
  const params = useParams();
  const router = useRouter();
  const resId = params.resId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [status, setStatus] = useState<string>("pending"); // pending, paid, expired, cancelled, failed
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Load/Create Request
  useEffect(() => {
    const initRequest = async () => {
      try {
        // Step A: Check existing
        const checkRes = await fetch(`/api/integrations/scb/requests?target_id=${resId}&status=pending`);
        const checkJson = await checkRes.json().catch(() => null);
        
        if (checkRes.ok && checkJson?.success && checkJson.data) {
          setRequest(checkJson.data);
          setStatus(checkJson.data.status);
          setLoading(false);
          return;
        }

        // Step B: Create New if none found
        const savedResult = sessionStorage.getItem(`mobile-checkin-result-${resId}`);
        if (!savedResult) {
           router.replace("/pms/mobile-checkin");
           return;
        }
        const result = JSON.parse(savedResult);
        const roomIsTransfer = result.payment_method === "transfer";
        const depositIsTransfer = result.deposit_method === "transfer";

        const createRes = await fetch("/api/integrations/scb/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: "reservation",
            target_id: resId,
            channel: "mobile_checkin",
            room_amount: roomIsTransfer ? (result.payment_amount || 0) : 0,
            deposit_amount: depositIsTransfer ? (result.deposit_amount || 0) : 0,
          })
        });
        const createJson = await createRes.json().catch(() => null);
        
        if (!createRes.ok || !createJson?.success) {
          throw new Error(createJson?.error || "Failed to generate QR code.");
        }
        
        setRequest(createJson.data);
        setStatus(createJson.data.status);
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred.");
      } finally {
        setLoading(false);
      }
    };

    initRequest();
  }, [resId, router]);

  // 2. Timer Logic
  useEffect(() => {
    if (!request?.expires_at || status !== "pending") return;

    const expiryTime = new Date(request.expires_at).getTime();
    
    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiryTime - now) / 1000));
      setTimeLeft(diff);
      
      if (diff === 0) {
        setStatus("expired");
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [request, status]);

  // 3. Polling Logic
  useEffect(() => {
    if (!request?.id || status !== "pending") return;

    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/integrations/scb/requests/${request.id}/status`);
        const json = await res.json().catch(() => null);
        
        if (res.ok && json?.success && json.data.status !== "pending") {
          setStatus(json.data.status);
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    pollIntervalRef.current = setInterval(pollStatus, 5000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [request, status]);

  // 4. Formatting helpers
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // 5. Canvas Save logic
  const handleSaveImage = async () => {
    if (!request || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Load QR Image
    const qrImg = new Image();
    qrImg.crossOrigin = "anonymous";
    qrImg.src = request.qr_image_url;

    await new Promise((resolve) => {
      qrImg.onload = resolve;
    });

    // Canvas Settings (Official/Bank Style)
    canvas.width = 600;
    canvas.height = 900;
    
    // Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Branding
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 24px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(APP_NAME.toUpperCase(), 300, 50);
    
    ctx.fillStyle = "#64748b";
    ctx.font = "18px Inter, sans-serif";
    ctx.fillText("SCB Mae Manee PromptPay QR", 300, 80);

    // QR Image
    const qrSize = 400;
    ctx.drawImage(qrImg, (canvas.width - qrSize) / 2, 140, qrSize, qrSize);

    // Amount
    ctx.fillStyle = "#000000";
    ctx.font = "bold 64px Inter, sans-serif";
    ctx.fillText(`฿ ${request.request_amount_total.toLocaleString()}`, canvas.width / 2, 650);

    // Breakdown
    ctx.fillStyle = "#475569";
    ctx.font = "20px Inter, sans-serif";
    const breakdown = `ค่าห้อง: ฿${request.room_amount.toLocaleString()} · มัดจำ: ฿${request.deposit_amount.toLocaleString()}`;
    ctx.fillText(breakdown, canvas.width / 2, 700);

    // Reference
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 16px monospace";
    ctx.fillText(`REF: ${request.partner_reference_no}`, canvas.width / 2, 800);
    
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText(`CREATED: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, canvas.width / 2, 830);

    // Download
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `QR-${request.partner_reference_no}.png`;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleShare = async () => {
    // Basic share link or use Web Share API
    if (navigator.share) {
      try {
        await navigator.share({
          title: "SCB Mae Manee QR",
          text: `ชำระเงินค่าห้องพัก จำนวน ฿${request.request_amount_total.toLocaleString()}`,
          url: window.location.href,
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Link copied to clipboard");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--bg-surface)] p-6">
        <Loader2 className="w-10 h-10 animate-spin text-brand-500 mb-4" />
        <p className="text-[var(--text-secondary)] font-bold">กำลังสร้าง QR รับเงิน...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--bg-surface)] p-6 text-center">
        <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
        <h2 className="text-xl font-black mb-2 text-[var(--text-primary)]">เกิดข้อผิดพลาด</h2>
        <p className="text-[var(--text-secondary)] mb-8">{error}</p>
        <button onClick={() => router.back()} className="btn btn-primary px-8">กลับ</button>
      </div>
    );
  }

  const isPaid = status === "paid";
  const isExpired = status === "expired";
  const isCancelled = status === "cancelled";
  const isFailed = status === "failed";

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)] pb-24">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.replace("/pms/mobile-checkin")}
              className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-xl font-bold tracking-tight">ห้อง {request.target_id.slice(0, 3)}...</h1>
          </div>
          <div className="flex items-center gap-2">
             {isPaid ? (
               <span className="flex items-center gap-1 text-emerald-600 font-bold text-xs uppercase tracking-widest">
                 <CheckCircle2 className="w-4 h-4" /> ชำระแล้ว
               </span>
             ) : isExpired ? (
               <span className="flex items-center gap-1 text-slate-500 font-bold text-xs uppercase tracking-widest">
                 <Clock className="w-4 h-4" /> หมดอายุ
               </span>
             ) : (
               <span className="flex items-center gap-1 text-amber-600 font-bold text-xs uppercase tracking-widest">
                 <Clock className="w-4 h-4" /> รอชำระ
               </span>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-8 flex flex-col items-center">
        {/* QR Container */}
        <div className={`relative transition-all duration-500 ${isPaid ? "scale-95 opacity-50" : isExpired || isCancelled ? "opacity-30" : "scale-100"}`}>
          <div className="bg-white rounded-3xl shadow-xl p-6 mx-auto max-w-[300px]">
             {request.qr_image_url ? (
               <img 
                 src={request.qr_image_url} 
                 alt="SCB QR" 
                 className="w-full h-auto aspect-square rounded-xl"
               />
             ) : (
               <div className="w-[250px] h-[250px] bg-slate-100 flex items-center justify-center rounded-xl italic text-slate-400">
                 Generating QR...
               </div>
             )}
          </div>
          
          {isPaid && (
             <div className="absolute inset-0 flex items-center justify-center animate-in zoom-in-50 duration-500">
                <div className="bg-emerald-500 text-white rounded-full p-6 shadow-2xl shadow-emerald-500/50">
                   <CheckCircle2 className="w-20 h-20" />
                </div>
             </div>
          )}
        </div>

        {/* Info */}
        <div className="text-center space-y-2">
          <p className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">ยอดชำระ SCB Mae Manee</p>
          <p className={`${isPaid ? "text-emerald-600" : "text-[#C9903A]"} text-5xl font-black transition-colors duration-500`}>
            ฿{request.request_amount_total.toLocaleString()}
          </p>
        </div>

        {/* Breakdown Card */}
        <div className="w-full max-w-sm bg-[var(--bg-surface)] rounded-2xl p-5 border border-[var(--border-default)] shadow-sm space-y-3">
          <div className="flex justify-between text-sm font-medium">
            <span className="text-[var(--text-secondary)]">ค่าห้อง</span>
            <span className="text-[var(--text-primary)] font-bold underline decoration-brand-500/30 underline-offset-4">฿{request.room_amount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm font-medium">
            <span className="text-[var(--text-secondary)]">เงินมัดจำ</span>
            <span className="text-[var(--text-primary)] font-bold decoration-sky-500/30 underline underline-offset-4">฿{request.deposit_amount.toLocaleString()}</span>
          </div>
          <div className="pt-3 border-t border-[var(--border-default)] flex justify-between items-baseline">
            <span className="text-xs font-black uppercase text-[var(--text-muted)] tracking-widest">Total QR Amount</span>
            <span className="text-xl font-black text-brand-600 italic">฿{request.request_amount_total.toLocaleString()}</span>
          </div>
        </div>

        {/* Timer & Status */}
        {status === "pending" && (
          <div className="w-full max-w-sm space-y-2">
            <div className="flex justify-between items-end mb-1">
               <span className="text-xs font-black uppercase text-[var(--text-muted)] tracking-widest">Expiring in</span>
               <span className={`text-lg font-mono font-black ${timeLeft < 300 ? "text-rose-600 animate-pulse" : "text-[var(--text-primary)]"}`}>
                 {formatTime(timeLeft)}
               </span>
            </div>
            <div className="h-1.5 w-full bg-[var(--bg-muted)] rounded-full overflow-hidden">
               <div 
                 className={`h-full transition-all duration-1000 ${timeLeft < 300 ? "bg-rose-500" : "bg-brand-500"}`}
                 style={{ width: `${(timeLeft / 1800) * 100}%` }}
               />
            </div>
          </div>
        )}

        {(isExpired || isCancelled || isFailed) && (
          <div className="w-full max-w-sm p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900 rounded-2xl text-center">
             <p className="text-rose-700 dark:text-rose-400 font-bold text-sm">
               {isExpired ? "QR หมดอายุการใช้งานแล้ว" : isCancelled ? "QR รายการนี้ถูกยกเลิกแล้ว" : "การชำระเงินขัดข้อง"}
             </p>
             <button 
               onClick={() => window.location.reload()}
               className="mt-3 text-xs font-black text-rose-600 dark:text-rose-400 underline uppercase tracking-widest"
             >
               สร้าง QR ใหม่
             </button>
          </div>
        )}
      </main>

      {/* Floating Actions */}
      <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto flex flex-col gap-3">
          
          {!isPaid && !isExpired && !isCancelled && !isFailed && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleSaveImage}
                className="btn btn-secondary h-12 rounded-xl flex items-center justify-center gap-2 bg-[var(--bg-surface)]"
              >
                <Save className="w-5 h-5" /> บันทึกรูป
              </button>
              <button
                onClick={handleShare}
                className="btn btn-secondary h-12 rounded-xl flex items-center justify-center gap-2 bg-[var(--bg-surface)]"
              >
                <Share2 className="w-5 h-5" /> แชร์
              </button>
            </div>
          )}

          <button
            onClick={() => router.replace("/pms/mobile-checkin")}
            className={`w-full h-14 rounded-2xl font-black tracking-widest uppercase shadow-xl transition-all flex items-center justify-center ${
              isPaid ? "bg-brand-600 text-white shadow-brand-500/20" : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]"
            }`}
          >
            {isPaid ? "✓ ชำระแล้ว — กลับหน้าหลัก" : "เสร็จสิ้น"}
          </button>
        </div>
      </footer>

      {/* Hidden Canvas for Save Logic */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
