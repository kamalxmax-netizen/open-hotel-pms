"use client";

import React, { useEffect, useRef } from "react";
import { LogbookShiftLog } from "./LogbookShiftLog";

interface LogbookShiftDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate: Date;
}

export function LogbookShiftDrawer({ isOpen, onClose, initialDate }: LogbookShiftDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // D12: On open, scroll so NOW line is at ~75% of visible drawer height
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (!scrollRef.current) return;
      const nowHour = new Date().getHours();
      const nowMinute = new Date().getMinutes();
      const container = scrollRef.current;
      const rowHeight = 40; // approximate min row height
      const totalHeight = container.scrollHeight;
      const viewportHeight = container.clientHeight;
      // Position of NOW line within the scrollable area
      const nowPosition = (nowHour / 24) * totalHeight + (nowMinute / 60) * rowHeight;
      // We want nowPosition to appear at 75% of the viewport
      const targetScroll = nowPosition - viewportHeight * 0.75;
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    }, 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-[var(--logbook-canvas)] shadow-2xl transition-transform transform flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--logbook-hairline)] bg-[var(--logbook-card)]">
          <h2 className="text-lg font-bold text-[var(--logbook-brand-heading)]">Shift Log</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--logbook-canvas-alt)] text-[var(--logbook-text-secondary)]">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          <LogbookShiftLog initialDate={initialDate} scrollContainerRef={scrollRef} />
        </div>
      </div>
    </div>
  );
}
