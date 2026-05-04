"use client";

import React, { useState, useEffect } from "react";

type Props = {
  startAt: Date;
  value: Date | null;
  onChange: (endAt: Date | null, preset?: string) => void;
};

type Preset = "24h" | "2d" | "3d" | "7d" | "custom";

function getBkkEndOfDay(baseDate: Date, offsetDays: number): Date {
  const bkkString = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(baseDate);
  const [mm, dd, yyyy] = bkkString.split("/");
  const date = new Date(`${yyyy}-${mm}-${dd}T23:59:59+07:00`);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function formatBkk(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date);
}

export function LogbookDatePresetPicker({ startAt, value, onChange }: Props) {
  const [selectedPreset, setSelectedPreset] = useState<Preset>("24h");
  const [customValue, setCustomValue] = useState<string>("");

  // Initialize value if empty
  useEffect(() => {
    if (!value && selectedPreset === "24h") {
      onChange(getBkkEndOfDay(startAt, 0), "24h");
    }
  }, [value, startAt, onChange, selectedPreset]);

  const handlePresetClick = (preset: Preset) => {
    setSelectedPreset(preset);
    if (preset === "24h") onChange(getBkkEndOfDay(startAt, 0), "24h");
    else if (preset === "2d") onChange(getBkkEndOfDay(startAt, 1), "2d");
    else if (preset === "3d") onChange(getBkkEndOfDay(startAt, 2), "3d");
    else if (preset === "7d") onChange(getBkkEndOfDay(startAt, 6), "7d");
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(e.target.value);
    setSelectedPreset("custom");
    if (e.target.value) {
      const d = new Date(e.target.value);
      if (!Number.isNaN(d.getTime())) {
        onChange(d, "custom");
      }
    }
  };

  const presets: { id: Preset; label: string }[] = [
    { id: "24h", label: "+24h" },
    { id: "2d", label: "+2d" },
    { id: "3d", label: "+3d" },
    { id: "7d", label: "+7d" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const isSelected = selectedPreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePresetClick(p.id)}
              className={`flex items-center justify-center rounded-[var(--logbook-pill-radius)] px-4 py-[7px] text-[14px] font-semibold transition active:scale-95 ${
                isSelected
                  ? "bg-[var(--logbook-cta-fill)] text-[var(--logbook-cta-text)]"
                  : "bg-transparent border border-[var(--logbook-cta-fill)] text-[var(--logbook-cta-outline-text)] hover:bg-[var(--logbook-canvas-alt)]"
              }`}
            >
              {p.label}
              {isSelected && <span className="ml-1.5 text-[10px]">●</span>}
            </button>
          );
        })}

        <div className="relative flex items-center">
          <input
            type="datetime-local"
            value={customValue}
            onChange={handleCustomChange}
            onFocus={() => setSelectedPreset("custom")}
            className={`flex items-center justify-center rounded-[var(--logbook-pill-radius)] px-4 py-[6px] text-[14px] font-semibold transition active:scale-95 outline-none ${
              selectedPreset === "custom"
                ? "bg-[var(--logbook-cta-fill)] text-[var(--logbook-cta-text)] border border-[var(--logbook-cta-fill)]"
                : "bg-transparent border border-[var(--logbook-cta-fill)] text-[var(--logbook-cta-outline-text)] hover:bg-[var(--logbook-canvas-alt)]"
            }`}
          />
        </div>
      </div>

      {value && (
        <div className="text-[13px] text-[var(--logbook-text-secondary)] font-normal">
          → ends {formatBkk(value)}
        </div>
      )}
    </div>
  );
}
