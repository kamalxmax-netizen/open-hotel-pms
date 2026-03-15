import React from "react";
import { addDays, compareDateStrings } from "@/lib/dates";

interface NightCounterProps {
    checkinDate: string;
    checkoutDate: string;
    nights: number;
    onChange: (checkin: string, checkout: string, nights: number) => void;
    disabled?: boolean;
    lockCheckin?: boolean;
}

export default function NightCounter({
    checkinDate,
    checkoutDate,
    nights,
    onChange,
    disabled = false,
    lockCheckin = false,
}: NightCounterProps) {

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

    return (
        <div className="flex items-center gap-4 bg-[var(--bg-body)] p-3 rounded-xl border border-[var(--border-default)] shadow-sm w-full">
            {/* Check-in */}
            <div className="flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-1">
                    Check-in
                </label>
                <input
                    type="date"
                    required
                    disabled={disabled || lockCheckin}
                    readOnly={lockCheckin}
                    className={`form-input w-full text-sm font-semibold bg-[var(--bg-surface)] ${lockCheckin ? "cursor-not-allowed" : "cursor-pointer"} disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed`}
                    value={checkinDate}
                    onChange={(e) => handleCheckinChange(e.target.value)}
                />
            </div>

            {/* Nights Counter (Center) */}
            <div className="flex flex-col items-center justify-center pt-2">
                <div className="text-[10px] uppercase font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1 tracking-wider">
                    <span className="text-slate-300">←</span> Night{nights > 1 ? "s" : ""} <span className="text-slate-300">→</span>
                </div>
                <div className="flex items-center bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] shadow-sm overflow-hidden">
                    <button
                        type="button"
                        disabled={disabled || nights <= 1}
                        onClick={() => handleNightsChange(nights - 1)}
                        className="px-2 py-1.5 bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] disabled:opacity-50 transition-colors border-r border-[var(--border-default)]"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <div className="w-12 text-center font-bold text-[var(--text-table-cell)] text-sm">
                        {nights}
                    </div>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleNightsChange(nights + 1)}
                        className="px-2 py-1.5 bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] disabled:opacity-50 transition-colors border-l border-[var(--border-default)]"
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
                <input
                    type="date"
                    required
                    disabled={disabled}
                    className="form-input w-full text-sm font-semibold bg-[var(--bg-surface)] cursor-pointer disabled:bg-[var(--bg-muted)] disabled:cursor-not-allowed"
                    value={checkoutDate}
                    onChange={(e) => handleCheckoutChange(e.target.value)}
                    min={checkinDate ? addDays(checkinDate, 1) : undefined}
                />
            </div>
        </div>
    );
}
