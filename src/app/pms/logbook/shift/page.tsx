"use client";

import { LogbookShiftLog } from "../_components/LogbookShiftLog";

export default function LogbookShiftPage() {
  return (
    <div className="logbook-shell min-h-screen bg-[var(--logbook-canvas)] pb-24">
      {/* Simple header — this page is debug/direct access only, not in primary nav */}
      <div className="sticky top-0 z-50 border-b border-black/5 bg-[var(--logbook-card)]/90 px-6 py-4 backdrop-blur-md dark:border-white/5">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--logbook-brand-heading)] tracking-[-0.02em]">Shift Log</h1>
        </div>
      </div>

      <div className="mx-auto mt-6 w-full max-w-5xl px-6">
        <div className="h-[800px]">
          <LogbookShiftLog initialDate={new Date()} />
        </div>
      </div>
    </div>
  );
}
