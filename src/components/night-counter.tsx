import React, { KeyboardEvent, MouseEvent, useEffect, useState } from "react";
import { addDays, compareDateStrings } from "@/lib/dates";
import { formatDateDisplay } from "@/lib/date-display";

interface NightCounterProps {
    checkinDate: string;
    checkoutDate: string;
    nights: number;
    onChange: (checkin: string, checkout: string, nights: number) => void;
    disabled?: boolean;
    lockCheckin?: boolean;
    useNativeDatePicker?: boolean;
    compact?: boolean;
}

export default function NightCounter({
    checkinDate,
    checkoutDate,
    nights,
    onChange,
    disabled = false,
    lockCheckin = false,
    useNativeDatePicker = false,
    compact = false,
}: NightCounterProps) {
    const [checkinInput, setCheckinInput] = useState(() => formatDateDisplay(checkinDate));
    const [checkoutInput, setCheckoutInput] = useState(() => formatDateDisplay(checkoutDate));

    const openNativePicker = (event: MouseEvent<HTMLInputElement>) => {
        const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
        if (typeof input.showPicker === "function") {
            try {
                input.showPicker();
            } catch {
                input.click();
            }
        }
    };

    useEffect(() => {
        setCheckinInput(formatDateDisplay(checkinDate));
    }, [checkinDate]);

    useEffect(() => {
        setCheckoutInput(formatDateDisplay(checkoutDate));
    }, [checkoutDate]);

    const parseDateInputToYmd = (value: string): string | null => {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
        if (ymdMatch) {
            const [, year, month, day] = ymdMatch;
            const candidate = `${year}-${month}-${day}`;
            const date = new Date(`${candidate}T12:00:00`);
            if (Number.isNaN(date.getTime())) return null;
            if (
                date.getFullYear() !== Number(year) ||
                date.getMonth() + 1 !== Number(month) ||
                date.getDate() !== Number(day)
            ) {
                return null;
            }
            return candidate;
        }

        const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (dmyMatch) {
            const [, dayRaw, monthRaw, year] = dmyMatch;
            const day = dayRaw.padStart(2, "0");
            const month = monthRaw.padStart(2, "0");
            const candidate = `${year}-${month}-${day}`;
            const date = new Date(`${candidate}T12:00:00`);
            if (Number.isNaN(date.getTime())) return null;
            if (
                date.getFullYear() !== Number(year) ||
                date.getMonth() + 1 !== Number(month) ||
                date.getDate() !== Number(day)
            ) {
                return null;
            }
            return candidate;
        }

        return null;
    };

    const handleCheckinChange = (newCheckin: string) => {
        if (!newCheckin) return;
        try {
            // Keep nights same, shift checkout
            const newCheckout = addDays(newCheckin, nights);
            onChange(newCheckin, newCheckout, nights);
        } catch (e) {
            // invalid date fallback
            onChange(newCheckin, checkoutDate, nights);
        }
    };

    const handleCheckoutChange = (newCheckout: string) => {
        if (!newCheckout) return;
        try {
            if (compareDateStrings(newCheckout, checkinDate) <= 0) {
                // Must be at least 1 night
                const fixedCheckout = addDays(checkinDate, 1);
                onChange(checkinDate, fixedCheckout, 1);
                return;
            }
            const cIn = new Date(checkinDate);
            const cOut = new Date(newCheckout);
            const diffTime = cOut.getTime() - cIn.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            onChange(checkinDate, newCheckout, diffDays);
        } catch (e) {
            onChange(checkinDate, newCheckout, nights);
        }
    };

    const handleNightsChange = (newNights: number) => {
        if (newNights < 1 || isNaN(newNights)) newNights = 1;
        try {
            const newCheckout = addDays(checkinDate, newNights);
            onChange(checkinDate, newCheckout, newNights);
        } catch (e) {
            // fallback
        }
    };

    const commitCheckinInput = () => {
        const parsed = parseDateInputToYmd(checkinInput);
        if (!parsed) {
            setCheckinInput(formatDateDisplay(checkinDate));
            return;
        }
        handleCheckinChange(parsed);
    };

    const commitCheckoutInput = () => {
        const parsed = parseDateInputToYmd(checkoutInput);
        if (!parsed) {
            setCheckoutInput(formatDateDisplay(checkoutDate));
            return;
        }
        handleCheckoutChange(parsed);
    };

    const handleDateKeyDown = (
        event: KeyboardEvent<HTMLInputElement>,
        commit: () => void
    ) => {
        if (event.key === "Enter") {
            event.preventDefault();
            commit();
        }
    };

    const wrapperClass = compact
        ? "flex items-center gap-2 bg-[var(--bg-body)] p-2 rounded-xl border border-[var(--border-default)] shadow-sm w-full"
        : "flex items-center gap-4 bg-[var(--bg-body)] p-3 rounded-xl border border-[var(--border-default)] shadow-sm w-full";
    const inputClass = compact
        ? "form-input w-full text-xs font-semibold bg-[var(--bg-surface)]"
        : "form-input w-full text-sm font-semibold bg-[var(--bg-surface)]";
    const nightValueClass = compact
        ? "w-8 text-center font-bold text-[var(--text-table-cell)] text-xs"
        : "w-12 text-center font-bold text-[var(--text-table-cell)] text-sm";
    const nightButtonClass = compact
        ? "px-1.5 py-1 bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] disabled:opacity-50 transition-colors"
        : "px-2 py-1.5 bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] disabled:opacity-50 transition-colors";

    return (
        <div className={wrapperClass}>
            {/* Check-in */}
            <div className="flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">
                    Check-in
                </label>
                {useNativeDatePicker ? (
                    <input
                        type="date"
                        required
                        disabled={disabled || lockCheckin}
                        readOnly={lockCheckin}
                        className={`${inputClass} ${lockCheckin ? "cursor-not-allowed" : "cursor-pointer"} disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed`}
                        value={checkinDate}
                        onChange={(e) => handleCheckinChange(e.target.value)}
                        onClick={openNativePicker}
                    />
                ) : (
                    <input
                        type="text"
                        required
                        disabled={disabled || lockCheckin}
                        readOnly={lockCheckin}
                        className={`${inputClass} ${lockCheckin ? "cursor-not-allowed" : "cursor-pointer"} disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed`}
                        value={checkinInput}
                        onChange={(e) => setCheckinInput(e.target.value)}
                        onBlur={commitCheckinInput}
                        onKeyDown={(e) => handleDateKeyDown(e, commitCheckinInput)}
                        inputMode="numeric"
                        placeholder="DD/MM/YYYY"
                    />
                )}
            </div>

            {/* Nights Counter (Center) */}
            <div className="flex flex-col items-center justify-center pt-2">
                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1 tracking-wider">
                    {compact ? (
                        <span>Night</span>
                    ) : (
                        <>
                            <span className="text-[var(--text-muted)]">←</span> Night{nights > 1 ? "s" : ""} <span className="text-[var(--text-muted)]">→</span>
                        </>
                    )}
                </div>
                <div className="flex items-center bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] shadow-sm overflow-hidden">
                    <button
                        type="button"
                        disabled={disabled || nights <= 1}
                        onClick={() => handleNightsChange(nights - 1)}
                        className={`${nightButtonClass} border-r border-[var(--border-default)]`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <div className={nightValueClass}>
                        {nights}
                    </div>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleNightsChange(nights + 1)}
                        className={`${nightButtonClass} border-l border-[var(--border-default)]`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </div>
            </div>

            {/* Check-out */}
            <div className="flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">
                    Check-out
                </label>
                {useNativeDatePicker ? (
                    <input
                        type="date"
                        required
                        disabled={disabled}
                        className={`${inputClass} cursor-pointer disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed`}
                        value={checkoutDate}
                        onChange={(e) => handleCheckoutChange(e.target.value)}
                        onClick={openNativePicker}
                    />
                ) : (
                    <input
                        type="text"
                        required
                        disabled={disabled}
                        className={`${inputClass} cursor-pointer disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed`}
                        value={checkoutInput}
                        onChange={(e) => setCheckoutInput(e.target.value)}
                        onBlur={commitCheckoutInput}
                        onKeyDown={(e) => handleDateKeyDown(e, commitCheckoutInput)}
                        inputMode="numeric"
                        placeholder="DD/MM/YYYY"
                    />
                )}
            </div>
        </div>
    );
}
