"use client";

import { useRouter } from "next/navigation";
import { VarianceBadge } from "../../_components/VarianceBadge";
import type { MaterialGroupTile } from "@/lib/analytics/types";

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function maxLabel(max: number | null, unit: string): string {
  if (max === null) return "— (no baseline)";
  return `${compact(max)} ${unit}`;
}

export function MaterialTile({ tile }: { tile: MaterialGroupTile }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(tile.detail_href)}
      className={`a-card group text-left p-5 min-h-[250px] flex flex-col transition-colors ${
        tile.errored ? "opacity-70 border-dashed" : "hover:border-[var(--a-accent-cyan)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight">{tile.label}</div>
          <div className="a-muted text-[11px] uppercase tracking-[0.15em] mt-1">{tile.unit}</div>
        </div>
        <VarianceBadge tier={tile.tier} />
      </div>

      {tile.errored ? (
        <div className="mt-5 rounded border border-[var(--a-border)] bg-[var(--a-bg-2)]/50 p-3 text-xs a-secondary">
          This group is temporarily unavailable. Other material groups are still shown.
        </div>
      ) : (
        <>
          <div className="mt-7">
            <div className="flex items-baseline gap-2">
              <span className="a-mono text-4xl font-semibold">{compact(tile.actual)}</span>
              <span className="a-muted text-sm">{tile.unit}</span>
            </div>
            <div className="a-secondary text-xs mt-2">of {maxLabel(tile.max, tile.unit)}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded border border-[var(--a-border)] bg-[var(--a-bg-2)]/50 p-3">
              <div className="a-muted text-[10px] uppercase tracking-[0.14em]">Usage</div>
              <div className="a-mono text-2xl font-semibold mt-1">{percent(tile.usage_pct)}</div>
            </div>
            <div className="rounded border border-[var(--a-border)] bg-[var(--a-bg-2)]/50 p-3">
              <div className="a-muted text-[10px] uppercase tracking-[0.14em]">Alerts</div>
              <div className="a-mono text-2xl font-semibold mt-1">{compact(tile.alert_count)}</div>
            </div>
          </div>
        </>
      )}

      <div className="mt-auto pt-5 flex items-center justify-between gap-3">
        <div className="a-muted text-[11px]">
          R {tile.bucket_counts.red} · Y {tile.bucket_counts.yellow} · G {tile.bucket_counts.green} · N/A {tile.bucket_counts.na}
        </div>
        <span className="a-secondary text-xs group-hover:text-[var(--a-text-0)]">View detail →</span>
      </div>
    </button>
  );
}
