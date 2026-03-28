"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Camera, ShieldAlert } from "lucide-react";

export default function GuestInfo() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const resId = params.resId as string;
  const scanId = searchParams.get("scan_id");
  const forceDraft = searchParams.get("force_draft") === "true";
  const isDraftFromUrl = searchParams.get("draft") === "true";

  // State
  const [mainGuest, setMainGuest] = useState({
    full_name: "",
    passport_no: "",
    nationality: "",
    date_of_birth: "",
    gender: ""
  });
  
  const [accompanying, setAccompanying] = useState<any[]>([]);
  const [loadingName, setLoadingName] = useState(true);

  // Hydrate OCR data & Load Session & Fetch Original Name
  useEffect(() => {
    let _originalName = "";

    const loadOriginalName = async () => {
      try {
        const res = await fetch("/api/checkin/due-today");
        let data;
        if (!res.ok) {
          const { mockDueToday } = await import("@/lib/mock/mobile-checkin");
          const mock = await mockDueToday();
          data = mock.data.rooms;
        } else {
          const json = await res.json();
          data = json.data.rooms;
        }
        
        const room = data.find((r: any) => r.reservation_id === resId);
        if (room) {
          _originalName = room.guest_name;
        }
      } catch (e) {
        console.error("Failed fetching original name", e);
      } finally {
        setLoadingName(false);
      }
    };

    const processHydration = async () => {
      await loadOriginalName();

      // 1. Check if we already have session data for this reservation
      const saved = sessionStorage.getItem(`mobile-checkin-${resId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.guest_info) {
          setMainGuest(parsed.guest_info);
        } else if (_originalName) {
          setMainGuest((prev) => ({ ...prev, full_name: _originalName }));
        }
        if (parsed.accompanying) setAccompanying(parsed.accompanying);
        return;
      }

      // 2. Otherwise try loading OCR data from temp storage (or fallback to original name)
      const tempOcrTxt = sessionStorage.getItem("mobile-checkin-temp-ocr");
      if (tempOcrTxt && scanId) {
        const tempOcr = JSON.parse(tempOcrTxt);
        if (tempOcr.scan_id === scanId) {
          setMainGuest(prev => ({
            ...prev,
            full_name: forceDraft ? _originalName : `${tempOcr.parsed.firstName} ${tempOcr.parsed.familyName}`,
            passport_no: tempOcr.parsed.passportNumber || "",
            nationality: tempOcr.parsed.nationality || "",
            date_of_birth: tempOcr.parsed.dateOfBirth || "",
            gender: tempOcr.parsed.gender || ""
          }));
        }
      } else {
        // No OCR, just normal manual fallback
        setMainGuest(prev => ({ ...prev, full_name: _originalName }));
      }
    };

    processHydration();
  }, [resId, scanId, forceDraft]);

  const addAccompanying = () => {
    if (accompanying.length >= 3) return;
    setAccompanying([...accompanying, { full_name: "", passport_no: "", source: "manual" }]);
  };

  const removeAccompanying = (index: number) => {
    if (!confirm("Are you sure you want to delete this accompanying guest?")) return;
    setAccompanying(accompanying.filter((_, i) => i !== index));
  };

  const updateAccompanying = (index: number, key: string, value: string) => {
    const newAcc = [...accompanying];
    newAcc[index][key] = value;
    setAccompanying(newAcc);
  };

  const onNext = () => {
    if (!mainGuest.full_name.trim()) return alert("Main Guest Name is required.");
    
    // Save to session
    sessionStorage.setItem(`mobile-checkin-${resId}`, JSON.stringify({
      scan_id: scanId,
      force_draft: forceDraft || isDraftFromUrl,
      guest_info: mainGuest,
      accompanying
    }));
    
    router.push(`/pms/mobile-checkin/payment/${resId}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)] pb-24">
      {/* Header & Step Indicator */}
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-brand-600 tracking-wider">STEP 1/3</span>
            <h1 className="text-xl font-bold tracking-tight">Guest Info</h1>
          </div>
        </div>
      </header>

      {loadingName ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="w-8 h-8 border-4 border-[var(--border-default)] border-t-brand-500 rounded-full animate-spin"></span>
        </div>
      ) : (
        <>
          <main className="flex-1 p-6 space-y-6">
            {(forceDraft || isDraftFromUrl) && (
          <div className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-500/30 rounded-xl p-4 flex gap-3 shadow-sm">
            <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-500 shrink-0" />
            <div>
               <p className="text-sm font-bold text-amber-800 dark:text-amber-300 uppercase">Draft Mode Active</p>
               <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mt-1">
                 Name fields may be locked to original booking. Missing data will save as DRAFT.
               </p>
            </div>
          </div>
        )}

        {/* Main Guest Form */}
        <section className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-default)] overflow-hidden">
          <div className="bg-brand-50/50 dark:bg-[var(--bg-surface-hover)] px-5 py-3 border-b border-[var(--border-default)] flex justify-between items-center">
            <h2 className="font-bold text-brand-700 dark:text-brand-400">Main Guest</h2>
            {scanId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full uppercase">
                <Camera className="w-3 h-3" /> OCR Verified
              </span>
            )}
          </div>
          
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Full Name</label>
              <input 
                value={mainGuest.full_name} 
                onChange={(e) => setMainGuest({...mainGuest, full_name: e.target.value})}
                disabled={forceDraft} 
                className="w-full h-12 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                placeholder="Required"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Passport No.</label>
                <input 
                  value={mainGuest.passport_no}
                  onChange={(e) => setMainGuest({...mainGuest, passport_no: e.target.value})}
                  className="w-full h-12 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Nationality</label>
                <input 
                  value={mainGuest.nationality}
                  onChange={(e) => setMainGuest({...mainGuest, nationality: e.target.value})}
                  className="w-full h-12 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500 uppercase"
                  placeholder="Ex: FRA"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">DOB</label>
                <input 
                  type="date"
                  value={mainGuest.date_of_birth}
                  onChange={(e) => setMainGuest({...mainGuest, date_of_birth: e.target.value})}
                  className="w-full h-12 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Gender</label>
                <select 
                  value={mainGuest.gender}
                  onChange={(e) => setMainGuest({...mainGuest, gender: e.target.value})}
                  className="w-full h-12 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">-Select-</option>
                  <option value="M">Male (M)</option>
                  <option value="F">Female (F)</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Accompanying Guests */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">Accompanying ({accompanying.length}/3)</h3>
          </div>

          {accompanying.map((acc, idx) => (
            <div key={idx} className="bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-default)] p-5 relative overflow-hidden">
              <button 
                onClick={() => removeAccompanying(idx)}
                className="absolute top-3 right-3 text-rose-500 hover:text-rose-600 bg-rose-50 dark:bg-rose-500/10 p-3 rounded-full transition"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              
              <div className="pr-12 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Name</label>
                  <input 
                    value={acc.full_name}
                    onChange={(e) => updateAccompanying(idx, "full_name", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-sm focus:ring-2 focus:ring-brand-500"
                    placeholder="Guest Name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--text-muted)] uppercase mb-1">Passport No.</label>
                  <input 
                    value={acc.passport_no}
                    onChange={(e) => updateAccompanying(idx, "passport_no", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] text-sm focus:ring-2 focus:ring-brand-500"
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
          ))}

          {accompanying.length < 3 && (
            <button 
              onClick={addAccompanying}
              className="w-full h-14 border-2 border-dashed border-[var(--border-input)] rounded-2xl text-[var(--text-secondary)] font-bold uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] transition active:scale-[0.98]"
            >
              <Plus className="w-5 h-5" /> Add Accompanying Guest
            </button>
          )}
          </section>
        </main>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <button
              onClick={onNext}
              className="w-full h-14 bg-brand-600 text-white rounded-2xl font-black tracking-widest uppercase shadow-xl shadow-brand-500/30 active:scale-[0.98] transition-all flex items-center justify-center"
            >
              Next <ArrowLeft className="w-6 h-6 ml-2 rotate-180" />
            </button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
