import Link from "next/link";
import { Camera, Search, ArrowLeft, ScanText } from "lucide-react";

export default function MethodSelection() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="px-6 py-4 flex items-center gap-4 border-b border-[var(--border-default)]">
        <Link 
          href="/pms/mobile-checkin"
          className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
        >
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Select Method</h1>
      </header>

      <main className="flex-1 p-6 flex flex-col justify-center space-y-4">
        <Link 
          href="/pms/mobile-checkin/scan"
          className="group block border-2 border-brand-500 rounded-2xl p-6 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 flex items-center justify-center shrink-0">
              <Camera className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Scan Passport</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Auto-fill details via OCR and match booking smart search.
              </p>
            </div>
          </div>
        </Link>

        <Link 
          href="/pms/mobile-checkin/passport-practice"
          className="group block border-2 border-emerald-500 rounded-2xl p-6 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <ScanText className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Passport Practice</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Camera-only OCR practice with preview feedback. No booking or guest data is saved.
              </p>
            </div>
          </div>
        </Link>

        <div className="flex items-center justify-center gap-4 py-4 opacity-60">
          <div className="h-px bg-[var(--border-input)] flex-1"></div>
          <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">OR</span>
          <div className="h-px bg-[var(--border-input)] flex-1"></div>
        </div>

        <Link 
          href="/pms/mobile-checkin/select-room"
          className="group block border-2 border-[var(--border-default)] rounded-2xl p-6 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-muted)] transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 flex items-center justify-center shrink-0">
              <Search className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Manual Select</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Choose a room from the due-in list directly.
              </p>
            </div>
          </div>
        </Link>
      </main>
    </div>
  );
}
