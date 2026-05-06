"use client";

import Link from "next/link";
import { ArrowLeft, BadgeDollarSign, CalendarRange, MessageSquareText } from "lucide-react";

export default function MobileTextToolsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-6 py-4 flex items-center gap-4 border-b border-[var(--border-default)]">
        <Link
          href="/pms/mobile-checkin"
          className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
        >
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Guest Text Tools</h1>
          <p className="text-sm text-[var(--text-secondary)]">Copy Thai guest text with the same format as the old GAS flow.</p>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col justify-center space-y-4">
        <Link
          href="/pms/mobile-checkin/text-tools/booking-summary"
          className="group block border-2 border-brand-500 rounded-2xl p-6 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 flex items-center justify-center shrink-0">
              <MessageSquareText className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Booking Summary</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Pick a due-in guest and copy the Thai booking summary text.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/pms/mobile-checkin/text-tools/room-availability"
          className="group block border-2 border-[var(--border-default)] rounded-2xl p-6 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-muted)] transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 flex items-center justify-center shrink-0">
              <CalendarRange className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Room Availability</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Use C/I - NightX+ - C/O, then copy Thai availability text for the guest.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/pms/mobile-checkin/text-tools/price-quote"
          className="group block border-2 border-[var(--border-default)] rounded-2xl p-6 bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-muted)] transition-colors shadow-sm active:scale-[0.98]"
        >
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <BadgeDollarSign className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Price Quote</h2>
              <p className="text-sm font-medium text-[var(--text-secondary)] mt-1 line-clamp-2">
                Build a Thai room price quote and recheck available room quantity before copy.
              </p>
            </div>
          </div>
        </Link>
      </main>
    </div>
  );
}
