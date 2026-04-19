"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FilterBar } from "../../_components/FilterBar";
import { MaterialTile } from "./MaterialTile";
import { OverviewRibbon } from "./OverviewRibbon";
import HistoricalBaselineSection from "./HistoricalBaselineSection";
import type { AnalyticsWindow, MaterialOverviewResponse } from "@/lib/analytics/types";

function defaultStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function defaultEnd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  let body: { success?: boolean; data?: T; error?: string } | null = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.success) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return body.data as T;
}

export default function MaterialOverviewClient() {
  const params = useSearchParams();
  const [data, setData] = useState<MaterialOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const window = (params.get("window") as AnalyticsWindow) || "month";
  const start = params.get("start") || defaultStart();
  const end = params.get("end") || defaultEnd();
  const roomType = params.get("room_type") || "";

  const queryString = useMemo(() => {
    const qs = new URLSearchParams({ window, start, end });
    if (roomType) qs.set("room_type", roomType);
    return qs.toString();
  }, [end, roomType, start, window]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchJson<MaterialOverviewResponse>(`/api/analytics/material/overview?${queryString}`)
      .then((nextData) => {
        if (cancelled) return;
        setData(nextData);
      })
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load material overview");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [queryString]);

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-5 pb-24">
      <header>
        <div className="a-muted text-[11px] uppercase tracking-[0.2em]">Phase 68.3 · live</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Material Analytics</h1>
        <p className="a-secondary text-sm mt-1">
          Unified operational health across linen and amenity groups without mixing their native units.
        </p>
      </header>

      <FilterBar showCategory={false} showSource={false} showRoomType />

      {error && (
        <div className="a-card p-4 border-l-2 border-[var(--a-accent-rose)] text-sm">
          <div className="font-semibold">Unable to load Material Analytics</div>
          <p className="a-secondary mt-1">{error}</p>
        </div>
      )}

      {data?.partial && (
        <div className="a-card p-4 border-l-2 border-[var(--a-accent-amber)] text-sm">
          <div className="font-semibold">Partial material overview</div>
          <ul className="a-secondary mt-2 space-y-1">
            {data.errors.map((err) => (
              <li key={err.group}>
                <span className="a-mono">{err.group}</span>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : data ? (
        <>
          <OverviewRibbon ribbon={data.ribbon} />
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.tiles.map((tile) => (
              <MaterialTile key={tile.group} tile={tile} />
            ))}
          </section>
        </>
      ) : null}

      {/* Phase 69/70: Historical Baseline (Jan 2025 — Mar 2026) */}
      <HistoricalBaselineSection />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="a-card h-28 animate-pulse bg-[var(--a-bg-2)]/40" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="a-card h-64 animate-pulse bg-[var(--a-bg-2)]/40" />
        ))}
      </div>
    </div>
  );
}
