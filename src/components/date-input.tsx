"use client";

import { formatDateDisplay } from "@/lib/date-display";
import { Calendar } from "lucide-react";
import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type DateInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

function parseDateInputToYmd(value: string): string | null {
  const thaiDigitMap: Record<string, string> = {
    "๐": "0",
    "๑": "1",
    "๒": "2",
    "๓": "3",
    "๔": "4",
    "๕": "5",
    "๖": "6",
    "๗": "7",
    "๘": "8",
    "๙": "9",
  };
  const trimmed = value.trim().replace(/[๐-๙]/g, (digit) => thaiDigitMap[digit] ?? digit);
  if (!trimmed) return null;

  const normalizeYear = (rawYear: string) => {
    const year = Number(rawYear);
    return year >= 2400 ? year - 543 : year;
  };

  const buildValidYmd = (rawYear: string, rawMonth: string, rawDay: string): string | null => {
    const year = normalizeYear(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${candidate}T12:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    if (
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== day
    ) {
      return null;
    }
    return candidate;
  };

  const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    return buildValidYmd(year, month, day);
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const [, dayRaw, monthRaw, year] = dmyMatch;
    return buildValidYmd(year, monthRaw, dayRaw);
  }

  const compactMatch = trimmed.match(/^(\d{8})$/);
  if (compactMatch) {
    const compact = compactMatch[1];
    const ymdCandidate = buildValidYmd(compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8));
    if (ymdCandidate) return ymdCandidate;
    return buildValidYmd(compact.slice(4, 8), compact.slice(2, 4), compact.slice(0, 2));
  }

  return null;
}

export default function DateInput({
  value,
  onChange,
  disabled = false,
  className = "",
  placeholder = "DD/MM/YYYY",
}: DateInputProps) {
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const [textValue, setTextValue] = useState(() => formatDateDisplay(value));

  useEffect(() => {
    setTextValue(formatDateDisplay(value));
  }, [value]);

  const composedClassName = useMemo(
    () => `form-input pr-10 ${className}`.trim(),
    [className]
  );

  const commitTextValue = () => {
    const parsed = parseDateInputToYmd(textValue);
    if (!parsed) {
      setTextValue(formatDateDisplay(value));
      return;
    }
    onChange(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTextValue();
    }
  };

  const openPicker = () => {
    if (disabled) return;
    const input = nativeInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        input.click();
        return;
      }
    }
    input.click();
  };

  return (
    <div className="relative">
      <input
        ref={nativeInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <input
        type="text"
        inputMode="numeric"
        className={composedClassName}
        value={textValue}
        onChange={(event) => setTextValue(event.target.value)}
        onBlur={commitTextValue}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--text-muted)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open calendar"
      >
        <Calendar className="h-4 w-4" />
      </button>
    </div>
  );
}
