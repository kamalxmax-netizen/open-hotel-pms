"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DAYUSE_WARNING_RED_MIN, DAYUSE_WARNING_YELLOW_MIN } from "@/lib/constants";

type DayUseTimerProps = {
  expiresAt: string;
  onExpired?: () => void;
  className?: string;
};

function formatDuration(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timerClass(remainingMs: number): string {
  const remainingMin = remainingMs / 60000;
  if (remainingMin <= 0) return "text-rose-700 bg-rose-100 animate-pulse";
  if (remainingMin <= DAYUSE_WARNING_RED_MIN) return "text-rose-700 bg-rose-100";
  if (remainingMin <= DAYUSE_WARNING_YELLOW_MIN) return "text-amber-700 bg-amber-100";
  return "text-emerald-700 bg-emerald-100";
}

export function DayUseTimer({ expiresAt, onExpired, className = "" }: DayUseTimerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const expiredNotifiedRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiresMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const remainingMs = Number.isNaN(expiresMs) ? 0 : expiresMs - nowMs;
  const overdue = remainingMs <= 0;

  useEffect(() => {
    if (!overdue || !onExpired || expiredNotifiedRef.current) return;
    expiredNotifiedRef.current = true;
    onExpired();
  }, [overdue, onExpired]);

  useEffect(() => {
    expiredNotifiedRef.current = false;
  }, [expiresAt]);

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${timerClass(
        remainingMs
      )} ${className}`}
      title={expiresAt}
    >
      {overdue ? `+${formatDuration(remainingMs)}` : formatDuration(remainingMs)}
    </span>
  );
}

