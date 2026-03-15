import React, { useState } from "react";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";

export interface NightlyRate {
    date: string;
    rate: number;
}

export type BookingDiscountType = "percent" | "fixed_total" | "fixed_per_night";

interface RateSummaryPanelProps {
    nightDates?: string[];
    nightlyRates: NightlyRate[];
    discountType: BookingDiscountType;
    discountValue: number;
    discountPercent: number;
    discountReason: string;
    onDiscountChange?: (type: BookingDiscountType, value: number, reason: string) => void;
    onNightlyRateChange?: (index: number, value: number) => void;
    editable?: boolean;
    source: string;
}

export default function RateSummaryPanel({
    nightDates,
    nightlyRates,
    discountType,
    discountValue,
    discountPercent,
    discountReason,
    onDiscountChange,
    onNightlyRateChange,
    editable = false,
    source,
}: RateSummaryPanelProps) {
    const [expanded, setExpanded] = useState(true);
    const [discountExpanded, setDiscountExpanded] = useState(false);
    const subtotalSatang = nightlyRates.reduce((sum, item) => sum + toSatang(item.rate), 0);
    const fixedSatang = discountType === "fixed_total"
        ? toSatang(discountValue)
        : discountType === "fixed_per_night"
            ? toSatang(discountValue) * nightlyRates.length
            : 0;
    const percentSatang = Math.trunc((subtotalSatang * discountPercent) / 100);
    const discountAmountSatang = Math.max(0, Math.min(subtotalSatang, discountType === "percent" ? percentSatang : fixedSatang));
    const totalSatang = subtotalSatang - discountAmountSatang;
    const hasDiscount = discountValue > 0 || discountPercent > 0;
    const discountModeLabel =
        discountType === "percent"
            ? "Percent"
            : discountType === "fixed_total"
                ? "Fix for all"
                : "Fix per night";
    const discountReadonlyValueLabel =
        discountType === "percent"
            ? `${discountPercent.toFixed(discountPercent % 1 === 0 ? 0 : 2)}%`
            : discountType === "fixed_total"
                ? `฿ ${formatMoney(discountValue)} total`
                : `฿ ${formatMoney(discountValue)} / night`;

    const getDayDetails = (dateString: string) => {
        try {
            const d = new Date(dateString);
            const dayIndex = d.getDay();
            const isWeekend = dayIndex === 5 || dayIndex === 6; // Friday = 5, Saturday = 6
            const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
            const dateFormatted = d.toLocaleDateString("en-US", {
                month: "2-digit",
                day: "2-digit",
            });
            return { isWeekend, dayName, dateFormatted };
        } catch {
            return { isWeekend: false, dayName: "", dateFormatted: dateString };
        }
    };

    return (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-sm rounded-xl overflow-hidden text-sm w-full">
            {/* Header */}
            <div className="bg-[var(--bg-body)] px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
                        onClick={() => setExpanded((value) => !value)}
                        aria-label={expanded ? "Collapse rate breakdown" : "Expand rate breakdown"}
                    >
                        <span className={`text-xs transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}>▾</span>
                    </button>
                    <h4 className="font-bold text-[var(--text-table-cell)] uppercase tracking-widest text-[11px] flex items-center gap-2">
                        Rate Breakdown
                        {source === "ota" && (
                            <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px]">
                                OTA
                            </span>
                        )}
                    </h4>
                </div>
                <div className="text-[var(--text-secondary)] font-bold text-xs">
                    {nightlyRates.length} Night{nightlyRates.length > 1 ? "s" : ""}
                </div>
            </div>

            {expanded && (
                <>
                    {/* Nightly Rates List */}
                    <div className="p-4 space-y-2 max-h-48 overflow-y-auto">
                        {nightlyRates.length === 0 ? (
                            <div className="text-center text-[var(--text-muted)] py-4 italic text-xs">
                                No dates selected
                            </div>
                        ) : (
                            nightlyRates.map((nr, idx) => {
                                const { isWeekend, dayName, dateFormatted } = getDayDetails(nr.date);
                                return (
                                    <div
                                        key={idx}
                                        className={`flex items-center justify-between px-2 py-1.5 rounded-md ${isWeekend ? "bg-amber-50 text-amber-900" : "text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="w-8 font-semibold opacity-70">{dayName}</span>
                                            <span className="font-mono text-xs opacity-80">{dateFormatted}</span>
                                            {isWeekend && (
                                                <span title="Weekend Rate" className="text-amber-500 text-xs">
                                                    🔥
                                                </span>
                                            )}
                                        </div>
                                        <div className="font-mono font-medium">
                                            {source === "ota" && editable && onNightlyRateChange ? (
                                                <div className="relative w-28">
                                                    <span className="absolute left-2 top-1.5 text-[var(--text-muted)] text-xs">฿</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        className="w-full rounded-md border border-orange-200 bg-orange-50 pl-5 pr-2 py-1 text-right text-xs font-mono text-orange-900 focus:border-orange-300 focus:outline-none"
                                                        value={nr.rate}
                                                        onChange={(e) => {
                                                            const next = Number(e.target.value);
                                                            onNightlyRateChange(idx, Number.isFinite(next) ? Math.max(0, next) : 0);
                                                        }}
                                                    />
                                                </div>
                                            ) : (
                                                <>฿ {formatMoney(nr.rate)}</>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="border-t border-[var(--border-subtle)] mx-4" />

                    {/* Totals & Discount */}
                    <div className="p-4 space-y-3 bg-[var(--bg-body)]">
                        <div className="flex items-center justify-between text-[var(--text-secondary)] font-medium">
                            <div className="flex items-center gap-2">
                                <span>Subtotal</span>
                                {(editable || hasDiscount) && (
                                    <button
                                        type="button"
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-sm transition hover:bg-[var(--bg-body)]"
                                        onClick={() => setDiscountExpanded((value) => !value)}
                                        aria-label={discountExpanded ? "Collapse discount" : "Expand discount"}
                                    >
                                        <span className={`text-[10px] transition-transform ${discountExpanded ? "rotate-0" : "-rotate-90"}`}>▾</span>
                                    </button>
                                )}
                            </div>
                            <span className="font-mono">฿ {formatMoney(fromSatang(subtotalSatang))}</span>
                        </div>

                        {editable && discountExpanded && (
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-sm space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-[var(--text-secondary)]">
                                        {discountType === "percent" ? "Percent" : discountType === "fixed_total" ? "Fix for all" : "Fix per night"}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            min="0"
                                            max={discountType === "percent" ? 100 : undefined}
                                            placeholder={discountType === "percent" ? "%" : "THB"}
                                            className="form-input text-right text-sm w-20 py-1 px-2 border-[var(--border-default)]"
                                            value={discountValue || ""}
                                            onChange={(e) => {
                                                const rawValue = e.target.value;
                                                const nextRaw = Number(rawValue);
                                                const nextValue = Number.isFinite(nextRaw) ? Math.max(0, nextRaw) : 0;
                                                const normalizedValue = discountType === "percent"
                                                    ? Math.min(100, nextValue)
                                                    : nextValue;
                                                if (onDiscountChange) onDiscountChange(discountType, normalizedValue, discountReason);
                                            }}
                                        />
                                        <select
                                            className="form-select w-[132px] py-1 px-2 text-xs border-[var(--border-default)]"
                                            value={discountType}
                                            onChange={(e) => {
                                                const nextType = e.target.value as BookingDiscountType;
                                                const normalizedValue = nextType === "percent"
                                                    ? Math.min(100, Math.max(0, discountValue))
                                                    : Math.max(0, discountValue);
                                                if (onDiscountChange) onDiscountChange(nextType, normalizedValue, discountReason);
                                            }}
                                        >
                                            <option value="percent">Percent</option>
                                            <option value="fixed_total">Fix for all</option>
                                            <option value="fixed_per_night">Fix per night</option>
                                        </select>
                                    </div>
                                </div>
                                {discountValue > 0 && (
                                    <>
                                        <div>
                                            <input
                                                type="text"
                                                placeholder="Reason for discount..."
                                                className="form-input text-xs w-full py-1.5 border-[var(--border-default)]"
                                                value={discountReason || ""}
                                                onChange={(e) => {
                                                    if (onDiscountChange) onDiscountChange(discountType, discountValue, e.target.value);
                                                }}
                                            />
                                        </div>
                                        <div className="flex justify-end text-rose-600 font-mono text-sm font-medium mt-1">
                                            - ฿ {formatMoney(fromSatang(discountAmountSatang))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {!editable && hasDiscount && discountExpanded && (
                            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-sm text-rose-600">
                                <div className="flex items-center justify-between">
                                    <span className="font-medium">Discount ({discountReadonlyValueLabel})</span>
                                    <span className="font-mono font-medium">
                                        - ฿ {formatMoney(fromSatang(discountAmountSatang))}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-[var(--text-secondary)]">{discountModeLabel}</div>
                                {discountReason && (
                                    <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-xs text-rose-600/90">
                                        {discountReason}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Total Row */}
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-default)] text-lg">
                            <span className="font-black text-slate-800">TOTAL</span>
                            <span className="font-black font-mono text-brand-700">
                                ฿ {formatMoney(fromSatang(totalSatang))}
                            </span>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
