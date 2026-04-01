"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Banknote, ArrowRightLeft, AlertTriangle } from "lucide-react";

export default function PaymentStep() {
  const params = useParams();
  const router = useRouter();
  const resId = params.resId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [roomData, setRoomData] = useState<any>(null);
  const [method, setMethod] = useState<string>("cash");
  const [paymentAmount, setPaymentAmount] = useState<string>("");

  useEffect(() => {
    // 1. Fetch Room Summary
    const loadData = async () => {
      try {
        const res = await fetch("/api/checkin/due-today");
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to load room details.");
        }
        const data = json.data.rooms;
        
        const room = data.find((r: any) => r.reservation_id === resId);
        if (room) setRoomData(room);
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to load room details.");
      } finally {
        setLoading(false);
      }
      
      // 2. Load Existing Session Guard
      const saved = sessionStorage.getItem(`mobile-checkin-${resId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.payment_method) setMethod(parsed.payment_method);
        if (parsed.payment_amount != null) setPaymentAmount(String(parsed.payment_amount));
      } else {
        router.replace("/pms/mobile-checkin");
      }
    };
    
    loadData();
  }, [resId, router]);

  useEffect(() => {
    if (!roomData || paymentAmount) return;
    const total = Number(roomData?.total_price ?? 0);
    if (Number.isFinite(total) && total > 0) {
      setPaymentAmount(String(total));
    }
  }, [roomData, paymentAmount]);

  const onNext = () => {
    const payVal = parseFloat(paymentAmount);
    if (paymentAmount && (isNaN(payVal) || payVal < 0 || payVal > 999999)) {
      alert("Please enter a valid room payment amount.");
      return;
    }

    // Update existing session
    const savedLine = sessionStorage.getItem(`mobile-checkin-${resId}`);
    const session = savedLine ? JSON.parse(savedLine) : {};
    
    session.payment_method = method;
    session.payment_amount = paymentAmount ? payVal : 0;
    
    sessionStorage.setItem(`mobile-checkin-${resId}`, JSON.stringify(session));
    router.push(`/pms/mobile-checkin/deposit/${resId}`);
  };

  const paymentOptions = [
    { id: "cash", label: "Cash", icon: Banknote },
    { id: "credit_card", label: "Credit Card", icon: CreditCard },
    { id: "transfer", label: "Transfer", icon: ArrowRightLeft },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)] pb-24">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-brand-600 tracking-wider">STEP 2/4</span>
            <h1 className="text-xl font-bold tracking-tight">Room Payment</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Summary Card */}
        <section className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-default)] p-6">
          <p className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Room Charges</p>
          
          {loading ? (
             <div className="h-16 flex items-center justify-center">
                 <span className="w-6 h-6 border-4 border-[var(--border-default)] border-t-brand-500 rounded-full animate-spin"></span>
             </div>
          ) : (
            <>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[var(--text-primary)] font-semibold text-lg">Room {roomData?.room_number ?? "???"}</span>
                <span className="text-2xl font-black text-[var(--text-primary)]">฿{roomData?.total_price?.toLocaleString() ?? "0"}</span>
              </div>
              <p className="text-[var(--text-secondary)] font-medium text-sm text-right">
                for {roomData?.nights ?? 1} {roomData?.nights === 1 ? "night" : "nights"}
              </p>
            </>
          )}
        </section>

        {/* Payment Methods */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">Select Method</h3>
          
          <div className="grid grid-cols-2 gap-4">
            {paymentOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setMethod(opt.id)}
                className={`relative overflow-hidden rounded-2xl p-5 border-2 transition-all active:scale-[0.98] ${
                  method === opt.id 
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400 shadow-md" 
                    : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-3">
                  <opt.icon className={`w-8 h-8 ${method === opt.id ? "text-brand-500 opacity-100" : "opacity-50"}`} />
                  <span className="font-bold text-sm tracking-wide">{opt.label}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* SCB Transfer Info Box */}
        {method === "transfer" && (
          <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-2xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <div className="text-xl shrink-0">ℹ️</div>
            <p className="text-sm font-medium text-sky-800 dark:text-sky-300 leading-relaxed">
              เมื่อกด "ถัดไป" ระบบจะสร้าง QR <br/>
              สำหรับรับชำระยอดนี้อัตโนมัติ
            </p>
          </div>
        )}

        {/* Room Payment Amount */}
        <section className="space-y-3 pt-4 border-t border-[var(--border-default)]">
          <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">Room Payment Amount</h3>
          
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-black text-lg">
              ฿
            </span>
            <input 
              type="number" 
              min="0"
              max="999999"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-14 pl-10 pr-4 rounded-xl border border-[var(--border-input)] bg-[var(--bg-surface)] text-xl font-bold text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </section>
      </main>

      {/* Floating Action */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button
            onClick={onNext}
            className="w-full h-14 bg-brand-600 text-white rounded-2xl font-black tracking-widest uppercase shadow-xl shadow-brand-500/30 active:scale-[0.98] transition-all flex items-center justify-center"
          >
            Next: Deposit <ArrowLeft className="w-6 h-6 ml-2 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
