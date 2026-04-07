"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardSignature, AlertTriangle, RefreshCw, Upload, Users, MessageSquareText, Camera } from "lucide-react";

interface Room {
  reservation_id: string;
  room_number: string;
  guest_name: string;
  status: string;
  has_passport_scan: boolean;
  profile_complete: boolean;
}

export default function MobileCheckinLanding() {
  const [data, setData] = useState<{ business_date: string; rooms: Room[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDueIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkin/due-today");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Fetch failed");
      }
      setData(json.data);
    } catch (err: any) {
      setError(err?.message || "Failed to load due-in data.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Session cleanup on returning to home
    if (typeof window !== "undefined") {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith("mobile-checkin-")) {
          sessionStorage.removeItem(key);
        }
      });
    }
    fetchDueIn();
  }, []);

  const totalDueIn = data?.rooms.length || 0;
  const draftRooms = data?.rooms.filter(r => r.has_passport_scan && !r.profile_complete) || [];

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="px-6 py-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)] flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Mobile Check-in
          </h1>
          <p className="text-sm font-medium text-[var(--text-secondary)] mt-1">
            {data?.business_date ? `Business Date: ${data.business_date}` : "Loading date..."}
          </p>
        </div>
        <button 
          onClick={fetchDueIn} 
          disabled={loading}
          className="p-3 -mr-3 rounded-full hover:bg-[var(--bg-surface-hover)] transition text-[var(--text-muted)] hover:text-brand-500 disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 p-6 space-y-8 flex flex-col">
        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        
        {/* Main CTA */}
        <div className="mt-4">
          <Link href="/pms/mobile-checkin/method" className="block">
            <div className="relative overflow-hidden rounded-2xl bg-brand-600 p-8 shadow-lg shadow-brand-500/20 active:scale-[0.98] transition-all flex flex-col items-center text-center">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <ClipboardSignature className="w-48 h-48 rotate-12 translate-x-12 -translate-y-8" />
              </div>
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mb-4 text-white">
                <ClipboardSignature className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-white tracking-widest uppercase">
                Check-in
              </h2>
              <p className="mt-2 text-brand-100 font-medium">
                Scan passport or select manually
              </p>
              
              {!loading && (
                <div className="mt-6 inline-flex items-center gap-2 bg-white/20 backdrop-blur px-4 py-2 rounded-full text-sm font-bold text-white">
                  <span>Due on business date</span>
                  <span className="bg-white text-brand-700 px-2 py-0.5 rounded-full min-w-[24px] text-center">
                    {totalDueIn}
                  </span>
                </div>
              )}
            </div>
          </Link>
        </div>

        {/* Fill OCR */}
        <div>
          <Link href="/pms/mobile-checkin/fill-ocr" className="block">
            <div className="relative overflow-hidden rounded-2xl bg-indigo-600 p-6 shadow-lg shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center gap-5">
              <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white shrink-0">
                <Upload className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-widest uppercase">
                  Fill OCR
                </h2>
                <p className="mt-1 text-indigo-200 font-medium text-sm">
                  Upload passport photo &rarr; auto-fill guest info
                </p>
                <p className="text-indigo-300 text-xs font-semibold mt-0.5">
                  ไม่บันทึกรูป — เก็บแค่ข้อมูลตัวอักษร
                </p>
              </div>
            </div>
          </Link>
        </div>

        <div>
          <Link href="/pms/mobile-checkin/passport-practice" className="block">
            <div className="relative overflow-hidden rounded-2xl bg-emerald-600 p-6 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center gap-5">
              <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white shrink-0">
                <Camera className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white tracking-widest uppercase">
                  OCR Practice
                </h2>
                <p className="mt-1 text-emerald-100 font-medium text-sm">
                  Practice taking passport photos with live OCR feedback
                </p>
                <p className="text-emerald-200 text-xs font-semibold mt-0.5">
                  Camera only · no booking link · no data saved
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Group OCR */}
        <div>
          <Link href="/pms/mobile-checkin/group-ocr" className="block">
            <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] p-6 border border-[var(--border-default)] shadow-sm active:scale-[0.98] transition-all flex items-center gap-5">
              <div className="w-14 h-14 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
                <Users className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[var(--text-primary)] tracking-widest uppercase">
                  Group OCR
                </h2>
                <p className="mt-1 text-[var(--text-secondary)] font-medium text-sm">
                  Scan passports for group check-in
                </p>
              </div>
            </div>
          </Link>
        </div>

        <div>
          <Link href="/pms/mobile-checkin/text-tools" className="block">
            <div className="relative overflow-hidden rounded-2xl bg-[var(--bg-surface)] p-6 border border-[var(--border-default)] shadow-sm active:scale-[0.98] transition-all flex items-center gap-5">
              <div className="w-14 h-14 bg-cyan-100 dark:bg-cyan-900/30 rounded-full flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
                <MessageSquareText className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[var(--text-primary)] tracking-widest uppercase">
                  Guest Text Tools
                </h2>
                <p className="mt-1 text-[var(--text-secondary)] font-medium text-sm">
                  Copy booking summary and room availability text for chat.
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* Drafts Section */}
        {loading ? (
          <div className="py-12 flex justify-center">
             <span className="w-8 h-8 border-4 border-[var(--border-default)] border-t-brand-500 rounded-full animate-spin"></span>
          </div>
        ) : draftRooms.length > 0 ? (
          <div className="space-y-3 flex-1">
            <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> 
              Draft Check-ins ({draftRooms.length})
            </h3>
            
            <div className="space-y-3">
              {draftRooms.map((room) => (
                <div key={room.reservation_id} className="border-2 border-amber-400/50 bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 flex gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-lg text-[var(--text-primary)]">Room {room.room_number}</span>
                      <span className="text-sm font-medium text-[var(--text-secondary)] truncate">· {room.guest_name}</span>
                    </div>
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wide">
                      DRAFT — ข้อมูลยังไม่ครบ
                    </p>
                  </div>
                  
                  <div className="flex items-center">
                    <Link 
                      href={`/pms/mobile-checkin/guest-info/${room.reservation_id}?draft=true`}
                      className="inline-flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-2 px-3 rounded-lg transition"
                    >
                      Complete <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <p className="text-sm font-medium">No pending drafts to complete.</p>
          </div>
        )}
      </main>
    </div>
  );
}
