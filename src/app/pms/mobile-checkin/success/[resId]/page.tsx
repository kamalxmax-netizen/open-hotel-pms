"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Home, UserPlus, AlertTriangle } from "lucide-react";

export default function SuccessStep() {
  const params = useParams();
  const resId = params.resId as string;

  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(`mobile-checkin-result-${resId}`);
    if (saved) {
      setResult(JSON.parse(saved));
    }
  }, [resId]);

  if (!result) return null;

  const isDraft = result?.status === "draft_checkin" || result?.is_draft;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-surface)]">
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-500">
        
        {isDraft ? (
          <>
            <div className="w-24 h-24 bg-amber-100 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] mb-2">
              DRAFT SAVED
            </h1>
            <p className="text-[var(--text-secondary)] font-medium mb-8">
              Room {result?.room_number ?? "Updated"}
            </p>
            
            <div className="w-full max-w-sm bg-amber-50 border border-amber-200 dark:bg-amber-900/30 dark:border-amber-500/30 p-4 rounded-xl text-left mb-8">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500" />
                <span className="font-bold text-amber-800 dark:text-amber-300">ACTION REQUIRED</span>
              </div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                กรุณากรอกข้อมูลเพิ่มเติมจาก Desktop ในเมนู Booking {">"} Passport OCR 
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="w-24 h-24 bg-emerald-100 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/20">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)] mb-2 uppercase">
              Data Saved
            </h1>
            <p className="text-[var(--text-secondary)] font-medium text-lg mb-2">
              Room {result?.room_number ?? "Updated"}
            </p>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mb-6">
              FO ต้องกด Check-in จาก Desktop อีกครั้ง
            </p>
          </>
        )}

        <div className="w-full max-w-xs space-y-4">
          <Link 
            href="/pms/mobile-checkin/method"
            className="w-full h-14 bg-brand-600 text-white rounded-2xl font-black uppercase tracking-wider shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <UserPlus className="w-5 h-5" /> Next Check-in
          </Link>

          <Link 
            href="/pms/mobile-checkin"
            className="w-full h-14 bg-[var(--bg-muted)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-2xl font-bold uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-2 hover:bg-[var(--bg-surface-hover)]"
          >
            <Home className="w-5 h-5" /> Back to Home
          </Link>
        </div>

      </main>
    </div>
  );
}
