"use client";

import { RateEditMode } from "@/lib/rates/types";

export function ModeToggle({
  mode,
  onChange
}: {
  mode: RateEditMode;
  onChange: (m: RateEditMode) => void;
}) {
  return (
    <div className="flex bg-[var(--bg-muted)] p-1 rounded-lg border border-[var(--border-default)] w-fit">
      <button
        onClick={() => onChange("type")}
        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
          mode === "type"
            ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
        }`}
      >
        Per Room-Type
      </button>
      <button
        onClick={() => onChange("room")}
        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
          mode === "room"
            ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-subtle)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
        }`}
      >
        Per Room
      </button>
    </div>
  );
}
