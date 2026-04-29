"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaffScheduleBoard } from "./StaffScheduleBoard";
import type { StaffScheduleView } from "@/lib/staff-schedule";

type ApiResponse =
  | { success: true; data: StaffScheduleView }
  | { success: false; error?: string };

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthKey(key: string): { year: number; month: number } {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

export default function StaffSchedulePage() {
  const [data, setData] = useState<StaffScheduleView | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const loadSchedule = useCallback(async (key?: string) => {
    const requestId = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (key) {
        const parsed = parseMonthKey(key);
        params.set("year", String(parsed.year));
        params.set("month", String(parsed.month));
      }

      const response = await fetch(`/api/staff/schedule-view${params.size > 0 ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiResponse;
      if (requestSeqRef.current !== requestId) return;

      if (!response.ok || !payload.success) {
        setError(payload.success ? "Cannot load staff schedule." : payload.error || "Cannot load staff schedule.");
        return;
      }

      setData(payload.data);
      setSelectedMonthKey(monthKey(payload.data.month.year, payload.data.month.month));
    } catch (err) {
      if (requestSeqRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Cannot load staff schedule.");
    } finally {
      if (requestSeqRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const shellState = useMemo(() => {
    if (loading && !data) return "loading";
    if (error && !data) return "error";
    return "ready";
  }, [data, error, loading]);

  if (shellState === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-6">
        <div className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-900" />
        <div className="h-[560px] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-900" />
      </main>
    );
  }

  if (shellState === "error" || !data) {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-100">Staff Schedule</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error || "Cannot load staff schedule."}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 md:p-6">
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : null}
      <StaffScheduleBoard
        data={data}
        selectedMonthKey={selectedMonthKey}
        loading={loading}
        onMonthChange={(key) => {
          setSelectedMonthKey(key);
          loadSchedule(key);
        }}
      />
    </main>
  );
}
