"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, AlertTriangle, User, Bed, Wallet, MapPin, Loader2 } from "lucide-react";
import { mockConfirmCheckin, mockDueToday } from "@/lib/mock/mobile-checkin";

export default function ConfirmStep() {
  const params = useParams();
  const router = useRouter();
  const resId = params.resId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [roomData, setRoomData] = useState<any>(null);
  const [sessionData, setSessionData] = useState<any>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch("/api/checkin/due-today");
        let data;
        if (!res.ok) {
          const mock = await mockDueToday();
          data = mock.data.rooms;
        } else {
          const json = await res.json();
          data = json.data.rooms;
        }
        
        const room = data.find((r: any) => r.reservation_id === resId);
        if (room) setRoomData(room);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
      
      const saved = sessionStorage.getItem(`mobile-checkin-${resId}`);
      if (saved) {
        setSessionData(JSON.parse(saved));
      } else {
        // If they bypass directly here without session
        router.replace("/pms/mobile-checkin/method");
      }
    };
    
    loadData();
  }, [resId, router]);

  const onConfirm = async () => {
    setSubmitting(true);
    
    const payload = {
      reservation_id: resId,
      ...sessionData
    };

    let result;
    try {
      try {
        const res = await fetch("/api/checkin/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to confirm check-in");
        result = json.data;
      } catch (err) {
        console.warn("API failed, attempting mock:", err);
        const mockResult = await mockConfirmCheckin(payload);
        result = mockResult.data;
      }

      setSubmitting(false);
      
      // Store result to pass state quickly without URL pollution
      sessionStorage.setItem(`mobile-checkin-result-${resId}`, JSON.stringify(result));
      
      // Clean up working session
      sessionStorage.removeItem(`mobile-checkin-${resId}`);
      sessionStorage.removeItem("mobile-checkin-temp-ocr");

      router.push(`/pms/mobile-checkin/success/${resId}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred.");
      setSubmitting(false);
    }
  };

  if (!sessionData) return null; // Avoid flicker

  const isDraft = sessionData.force_draft || !sessionData.guest_info?.passport_no || !sessionData.guest_info?.nationality;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)] pb-24">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            disabled={submitting}
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition disabled:opacity-50"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-brand-600 tracking-wider">STEP 3/3</span>
            <h1 className="text-xl font-bold tracking-tight">Confirm</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl flex items-start gap-3 text-sm font-medium animate-in slide-in-from-top-2">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {isDraft && (
          <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-500/30 rounded-xl p-4 shadow-sm animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500" />
              <h2 className="font-black text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                ⚠️ CHECK-IN เป็น DRAFT
              </h2>
            </div>
            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
              ข้อมูลประวัติยังไม่ครบถ้วน กรุณากรอกเพิ่มเติมภายหลัง จากหน้า Booking Desktop
            </p>
          </div>
        )}

        {/* Summary Card */}
        <section className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-default)] overflow-hidden">
          <div className="bg-[var(--bg-surface-hover)] px-5 py-3 border-b border-[var(--border-default)] line-clamp-1 truncate font-bold text-[var(--text-secondary)] text-sm tracking-wide uppercase">
            Review Details
          </div>
          
          <div className="p-5 divide-y divide-[var(--border-default)]">
            
            {/* Room & Dates */}
            <div className="py-4 first:pt-0 last:pb-0 flex items-start gap-4">
              <div className="p-2 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 rounded-lg">
                <Bed className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[var(--text-muted)] uppercase mb-1">Stay Details</p>
                <p className="text-lg font-black text-[var(--text-primary)]">
                  Room {roomData?.room_number ?? "..."}
                </p>
                <p className="text-sm font-medium text-[var(--text-secondary)] mt-0.5">
                  {loading ? "Loading..." : `${roomData?.checkin_date} ➔ ${roomData?.checkout_date} (${roomData?.nights ?? 0} nights)`}
                </p>
              </div>
            </div>

            {/* Guest */}
            <div className="py-4 first:pt-0 last:pb-0 flex items-start gap-4">
              <div className="p-2 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded-lg">
                <User className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[var(--text-muted)] uppercase mb-1">Primary Guest</p>
                <p className="text-lg font-bold text-[var(--text-primary)] truncate">
                  {sessionData.guest_info.full_name || "Unknown"}
                </p>
                <p className="text-sm font-medium text-[var(--text-secondary)] mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
                  {sessionData.guest_info.passport_no ? (
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {sessionData.guest_info.passport_no}</span>
                  ) : <span className="text-rose-500 font-bold">No Passport</span>}
                  
                  {sessionData.guest_info.nationality ? (
                    <span className="uppercase badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      {sessionData.guest_info.nationality}
                    </span>
                  ) : <span className="text-rose-500 font-bold">No Nation</span>}
                </p>

                {sessionData.accompanying?.length > 0 && (
                  <p className="text-xs font-semibold text-[var(--text-muted)] mt-2">
                    + {sessionData.accompanying.length} accompanying passenger(s)
                  </p>
                )}
              </div>
            </div>

            {/* Payment */}
            <div className="py-4 first:pt-0 last:pb-0 flex items-start gap-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-lg">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[var(--text-muted)] uppercase mb-1">Payment Method</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="inline-block px-3 py-1 bg-[var(--bg-muted)] border border-[var(--border-input)] rounded-full text-sm font-bold capitalize text-[var(--text-primary)]">
                    {sessionData.payment_method || "Card"}
                  </span>
                  {sessionData.deposit_amount && (
                    <span className="inline-block px-3 py-1 bg-brand-50 border border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30 rounded-full text-sm font-bold text-brand-700 dark:text-brand-400">
                      Dep: ฿{sessionData.deposit_amount.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>

      {/* Floating Action */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none z-20">
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button
            onClick={onConfirm}
            disabled={submitting}
            className={`w-full h-14 ${
              isDraft ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/30" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30"
            } text-white rounded-2xl font-black tracking-widest uppercase shadow-xl transition-all flex items-center justify-center gap-2`}
          >
            {submitting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Check className="w-6 h-6" /> {isDraft ? "Save Draft" : "Confirm Check-in"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
