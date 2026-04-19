"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AmenityAnalyticsSource, AnalyticsWindow } from "@/lib/analytics/types";

const WINDOWS: AnalyticsWindow[] = ["day", "week", "month"];

// Phase 68.0: placeholder options. Phase 68.1/68.2 wire these to real setup tables.
const DEFAULT_CATEGORY_OPTIONS = [
    { value: "linen.bath_towel", label: "Bath Towel" },
    { value: "linen.bath_mat", label: "Bath Mat" },
    { value: "linen.pillowcase", label: "Pillowcase" },
    { value: "linen.single_bed_sheet", label: "Single Bed Sheet" },
    { value: "linen.double_bed_sheet", label: "Double Bed Sheet" },
    { value: "linen.king_bed_sheet", label: "King Bed Sheet" },
    { value: "amenity.coffee", label: "Coffee" },
    { value: "amenity.water", label: "Water" },
    { value: "amenity.soap", label: "Soap" },
    { value: "amenity.shampoo", label: "Shampoo" },
];

const FALLBACK_ROOM_TYPE_OPTIONS = [
    { value: "TS", label: "TS" },
    { value: "DS", label: "DS" },
    { value: "DQ", label: "DQ" },
    { value: "DT", label: "DT" },
    { value: "JS", label: "JS" },
    { value: "TB", label: "TB" },
    { value: "FR", label: "FR" },
];

type FilterOption = { value: string; label: string };

function parseList(raw: string | null): string[] {
    if (!raw) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function summarize(selected: string[], options: { value: string; label: string }[]): string {
    if (selected.length === 0) return `All (${options.length})`;
    if (selected.length === 1) return options.find((opt) => opt.value === selected[0])?.label ?? selected[0];
    return `${selected.length} selected`;
}

type FilterBarProps = {
    categoryOptions?: FilterOption[];
    showCategory?: boolean;
    showRoomType?: boolean;
    showSource?: boolean;
};

export function FilterBar({
    categoryOptions = DEFAULT_CATEGORY_OPTIONS,
    showCategory = true,
    showRoomType = true,
    showSource = false,
}: FilterBarProps) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const [roomTypeOptions, setRoomTypeOptions] = useState<FilterOption[]>(FALLBACK_ROOM_TYPE_OPTIONS);

    const window = (params.get("window") as AnalyticsWindow) || "month";
    const start = params.get("start") || defaultStart();
    const end = params.get("end") || defaultEnd();
    const category = parseList(params.get("category"));
    const room_type = parseList(params.get("room_type"));
    const source = (params.get("source") as AmenityAnalyticsSource) || "all";

    const updateParam = useCallback(
        (key: string, value: string | null) => {
            const next = new URLSearchParams(params.toString());
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
            router.replace(`${pathname}?${next.toString()}`);
        },
        [params, pathname, router]
    );

    const toggleInList = useCallback(
        (key: "category" | "room_type", current: string[], value: string) => {
            const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
            updateParam(key, next.length === 0 ? null : next.join(","));
        },
        [updateParam]
    );

    const rangeLabel = useMemo(() => `${start} → ${end}`, [start, end]);

    useEffect(() => {
        if (!showRoomType) return;
        let cancelled = false;

        fetch("/api/analytics/room-types")
            .then((response) => response.json())
            .then((body) => {
                if (cancelled || !body?.success || !Array.isArray(body.data)) return;
                const next = body.data
                    .map((row: any) => ({
                        value: String(row.value ?? "").trim(),
                        label: String(row.label ?? row.value ?? "").trim(),
                    }))
                    .filter((row: FilterOption) => row.value && row.label);
                if (next.length > 0) setRoomTypeOptions(next);
            })
            .catch(() => {
                // Keep fallback room types if the setup lookup is unavailable.
            });

        return () => {
            cancelled = true;
        };
    }, [showRoomType]);

    return (
        <div className="a-card sticky top-0 z-10 px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <span className="a-muted text-[11px] uppercase tracking-[0.15em]">Window</span>
                <div className="flex border border-[var(--a-border)] rounded overflow-hidden">
                    {WINDOWS.map((w) => (
                        <button
                            key={w}
                            onClick={() => updateParam("window", w)}
                            className={`a-mono px-3 py-1 text-xs ${w === window ? "bg-[var(--a-bg-2)] text-[var(--a-text-0)]" : "a-secondary"}`}
                        >
                            {w.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <span className="a-muted text-[11px] uppercase tracking-[0.15em]">Start</span>
                <input
                    type="date"
                    value={start}
                    onChange={(e) => updateParam("start", e.target.value)}
                    className="a-mono bg-[var(--a-bg-2)] border border-[var(--a-border)] rounded px-2 py-1 text-xs"
                />
            </div>
            <div className="flex items-center gap-2">
                <span className="a-muted text-[11px] uppercase tracking-[0.15em]">End</span>
                <input
                    type="date"
                    value={end}
                    onChange={(e) => updateParam("end", e.target.value)}
                    className="a-mono bg-[var(--a-bg-2)] border border-[var(--a-border)] rounded px-2 py-1 text-xs"
                />
            </div>

            {showCategory && (
                <MultiSelect
                    label="Category"
                    options={categoryOptions}
                    selected={category}
                    onToggle={(v) => toggleInList("category", category, v)}
                    onClear={() => updateParam("category", null)}
                    summary={summarize(category, categoryOptions)}
                />
            )}

            {showSource && (
                <div className="flex items-center gap-2">
                    <span className="a-muted text-[11px] uppercase tracking-[0.15em]">Source</span>
                    <div className="flex border border-[var(--a-border)] rounded overflow-hidden">
                        {[
                            { value: "all", label: "All" },
                            { value: "fo_reconciled", label: "FO" },
                            { value: "audit_adjusted", label: "Audit" },
                        ].map((option) => (
                            <button
                                key={option.value}
                                onClick={() => updateParam("source", option.value === "all" ? null : option.value)}
                                className={`a-mono px-3 py-1 text-xs ${source === option.value ? "bg-[var(--a-bg-2)] text-[var(--a-text-0)]" : "a-secondary"}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {showRoomType && (
                <MultiSelect
                    label="Room Type"
                    options={roomTypeOptions}
                    selected={room_type}
                    onToggle={(v) => toggleInList("room_type", room_type, v)}
                    onClear={() => updateParam("room_type", null)}
                    summary={summarize(room_type, roomTypeOptions)}
                />
            )}

            <div className="a-muted a-mono text-[11px] ml-auto">{rangeLabel}</div>
        </div>
    );
}

type MultiSelectProps = {
    label: string;
    options: FilterOption[];
    selected: string[];
    onToggle: (value: string) => void;
    onClear: () => void;
    summary: string;
};

function MultiSelect({ label, options, selected, onToggle, onClear, summary }: MultiSelectProps) {
    return (
        <details className="relative group">
            <summary className="list-none cursor-pointer flex items-center gap-2 bg-[var(--a-bg-2)] border border-[var(--a-border)] rounded px-2 py-1 text-xs select-none">
                <span className="a-muted uppercase tracking-[0.15em] text-[10px]">{label}</span>
                <span className="a-mono">{summary}</span>
                <span className="a-muted text-[10px]">▾</span>
            </summary>
            <div className="absolute left-0 mt-1 a-card p-2 z-20 min-w-[180px] max-h-[280px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                    <span className="a-muted text-[10px] uppercase tracking-[0.15em]">{label}</span>
                    {selected.length > 0 && (
                        <button onClick={onClear} className="a-muted text-[10px] underline">
                            Clear
                        </button>
                    )}
                </div>
                <ul className="space-y-1">
                    {options.map((opt) => {
                        const checked = selected.includes(opt.value);
                        return (
                            <li key={opt.value}>
                                <label className="flex items-center gap-2 text-xs cursor-pointer py-1">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => onToggle(opt.value)}
                                        className="accent-[var(--a-accent-cyan)]"
                                    />
                                    <span>{opt.label}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </details>
    );
}

function defaultStart(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function defaultEnd(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
