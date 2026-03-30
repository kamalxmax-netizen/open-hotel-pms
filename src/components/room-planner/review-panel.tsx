"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { DraftAction } from "@/lib/types";
import { formatDateRangeDisplay } from "@/lib/date-display";

interface PricingPreviewNight {
    stay_date: string;
    current_price: number;
    new_price: number;
    is_ota: boolean;
    editable: boolean;
}

interface ActionPricingPreview {
    action_index: number;
    reservation_id: string;
    booking_code?: string | null;
    guest_name?: string | null;
    source: string;
    current_total: number;
    new_total: number;
    delta: number;
    nights: PricingPreviewNight[];
    rate_plan_name?: string;
    from_room_number?: string;
    to_room_number?: string;
}

interface PreviewResult {
    previews: ActionPricingPreview[];
    warnings: string[];
}

interface ReviewPanelProps {
    actions: DraftAction[];
    onClose: () => void;
    onSuccess: () => void;
}

export function ReviewPanel({ actions, onClose, onSuccess }: ReviewPanelProps) {
    const [loading, setLoading] = useState(true);
    const [committing, setCommitting] = useState(false);
    const [result, setResult] = useState<PreviewResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    // OTA night overrides: reservation_id -> stay_date -> new_price
    const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});

    const buildPayload = useCallback(() => {
        return actions.map((a) => {
            const overrideMap = new Map<string, number>();
            for (const row of a.ota_night_overrides || []) {
                if (row?.stay_date) {
                    overrideMap.set(String(row.stay_date), Number(row.price ?? 0));
                }
            }
            const resOverrides = overrides[a.reservation_id];
            if (resOverrides) {
                for (const [stay_date, price] of Object.entries(resOverrides)) {
                    overrideMap.set(stay_date, Number(price));
                }
            }
            const mergedOverrides = Array.from(overrideMap.entries()).map(([stay_date, nightly_price]) => ({
                stay_date,
                nightly_price: Number(nightly_price),
            }));

            return {
                type: a.type,
                reservation_id: a.reservation_id,
                from_room_id: a.from_room_id,
                to_room_id: a.to_room_id,
                swap_pair_id: a.swap_pair_id,
                affected_nights: a.affected_nights,
                new_checkin_date: a.new_checkin_date,
                new_checkout_date: a.new_checkout_date,
                ota_night_overrides: mergedOverrides.length > 0 ? mergedOverrides : undefined,
            };
        });
    }, [actions, overrides]);

    useEffect(() => {
        let active = true;
        const fetchPreview = async () => {
            setLoading(true);
            setError(null);
            try {
                const payloadActions = buildPayload();

                const res = await fetch("/api/room-planner/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ actions: payloadActions })
                });

                const json = await res.json();
                if (!res.ok || !json.success) {
                    throw new Error(json.error || "Failed to preview changes");
                }
                
                if (active) {
                    setResult(json);
                }
            } catch (err: any) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        };

        fetchPreview();
        return () => { active = false; };
    }, [buildPayload]);

    const handleCommit = async () => {
        setCommitting(true);
        setError(null);
        try {
            const payloadActions = buildPayload();

            const res = await fetch("/api/room-planner/commit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actions: payloadActions })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || "Failed to commit changes");
            }
            onSuccess();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setCommitting(false);
        }
    };

    const handlePriceChange = (resId: string, date: string, val: string) => {
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return;
        setOverrides(prev => ({
            ...prev,
            [resId]: {
                ...(prev[resId] || {}),
                [date]: num
            }
        }));
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
            <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden ring-1 ring-white/10 relative">
                <div className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-body)] flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-[var(--text-primary)]">Review Changes</h2>
                        <p className="text-sm text-[var(--text-secondary)] mt-0.5">Please review the price impacts before saving to database.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] transition-colors">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-body)]">
                    {error && (
                        <div className="mb-4 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm dark:bg-rose-950/50 dark:border-rose-900/50 dark:text-rose-200">
                            {error}
                        </div>
                    )}

                    {loading && !result ? (
                        <div className="py-12 flex justify-center">
                            <div className="h-8 w-8 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
                        </div>
                    ) : result && (
                        <>
                            {result.warnings.length > 0 && (
                                <div className="mb-4 space-y-1">
                                    {result.warnings.map((w, i) => (
                                        <div key={i} className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded text-xs dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-200">
                                            ⚠️ {w}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="space-y-4">
                                {(() => {
                                    const groups: Array<{ type: 'single', preview: ActionPricingPreview } | { type: 'swap', previews: ActionPricingPreview[], swapPairs: {from: string, to: string}[] }> = [];
                                    const handledIndices = new Set<number>();
                                    
                                    for (const preview of result.previews) {
                                        if (handledIndices.has(preview.action_index)) continue;
                                        
                                        const action = actions[preview.action_index];
                                        if (action.swap_pair_id) {
                                            const pairedPreviews = result.previews.filter(p => actions[p.action_index]?.swap_pair_id === action.swap_pair_id);
                                            groups.push({ 
                                                type: 'swap', 
                                                previews: pairedPreviews,
                                                swapPairs: pairedPreviews.map(p => {
                                                    const act = actions[p.action_index];
                                                    return { from: act.from_room_id || '?', to: act.to_room_id || '?' };
                                                })
                                            });
                                            pairedPreviews.forEach(p => handledIndices.add(p.action_index));
                                        } else {
                                            groups.push({ type: 'single', preview });
                                            handledIndices.add(preview.action_index);
                                        }
                                    }

                                    return groups.map((g, idx) => {
                                        if (g.type === 'single') {
                                            const preview = g.preview;
                                            const action = actions[preview.action_index];
                                            const isOta = preview.source.toLowerCase() === "ota" || preview.source.toLowerCase() === "agent";
                                            const hasDelta = preview.delta !== 0;

                                            return (
                                                <div key={`single-${idx}`} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 mb-3">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div>
                                                            <span className="font-bold text-sm text-[var(--text-primary)]">
                                                                {action.type === 'MOVE_NIGHTS' ? 'PER-NIGHT MOVE' : action.type}
                                                                {preview.to_room_number ? ` → Room ${preview.to_room_number}` : ''}
                                                                {(action.new_checkin_date || action.new_checkout_date) && ` (${formatDateRangeDisplay(action.new_checkin_date || '?', action.new_checkout_date || '?')})`}
                                                            </span>
                                                            <div className="text-xs text-[var(--text-secondary)]">{preview.guest_name || `Booking ${(preview.booking_code || preview.reservation_id).slice(0, 8)}`}{preview.from_room_number ? ` (from ${preview.from_room_number})` : ''}</div>
                                                        </div>
                                                        {hasDelta && (
                                                            <div className={`text-sm font-bold px-2 py-1 rounded ${preview.delta > 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400"}`}>
                                                                {preview.delta > 0 ? "+" : ""}฿{preview.delta.toLocaleString()}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {isOta && preview.nights.length > 0 && (
                                                        <div className="mt-3 bg-[var(--bg-body)] rounded border border-[var(--border-default)] overflow-hidden">
                                                            <div className="bg-[var(--bg-surface-hover)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] border-b border-[var(--border-default)]">
                                                                OTA Nightly Overrides
                                                            </div>
                                                            <div className="p-2 space-y-2">
                                                                {preview.nights.map(n => (
                                                                    <div key={n.stay_date} className="flex items-center justify-between text-xs">
                                                                        <span className="text-[var(--text-muted)] font-mono">{n.stay_date}</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[var(--text-secondary)] line-through">฿{n.current_price.toLocaleString()}</span>
                                                                            <input 
                                                                                type="number" 
                                                                                className="input input-sm w-24 text-right" 
                                                                                defaultValue={n.new_price}
                                                                                onBlur={(e) => handlePriceChange(preview.reservation_id, n.stay_date, e.target.value)}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        } else {
                                            // Render SWAP pair
                                            const roomTextA = g.previews[0]?.from_room_number || g.swapPairs[0]?.from?.slice(0, 8) || '?';
                                            const roomTextB = g.previews[1]?.from_room_number || g.swapPairs[1]?.from?.slice(0, 8) || '?';
                                            const roomText = `Room ${roomTextA} ↔ Room ${roomTextB}`;

                                            return (
                                                <div key={`swap-${idx}`} className="bg-[var(--bg-surface)] border border-indigo-200 dark:border-indigo-500/30 rounded-lg overflow-hidden mb-3 shadow-sm">
                                                    <div className="bg-indigo-50 dark:bg-indigo-500/10 px-4 py-2 border-b border-indigo-100 dark:border-indigo-500/20 font-bold text-sm text-indigo-800 dark:text-indigo-300">
                                                        SWAP: {roomText}
                                                    </div>
                                                    <div className="p-4 space-y-4">
                                                        {g.previews.map((preview, j) => {
                                                            const act = actions[preview.action_index];
                                                            const isOta = preview.source.toLowerCase() === "ota" || preview.source.toLowerCase() === "agent";
                                                            const hasDelta = preview.delta !== 0;

                                                            return (
                                                                <div key={j} className="flex flex-col gap-2 pb-4 border-b border-[var(--border-subtle)] last:border-0 last:pb-0">
                                                                    <div className="flex justify-between items-center">
                                                                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                                                                            {preview.guest_name || `Booking ${(preview.booking_code || preview.reservation_id).slice(0, 8)}`} <span className="text-[var(--text-muted)] text-xs font-normal">({preview.from_room_number || '?'} → {preview.to_room_number || '?'})</span>
                                                                        </div>
                                                                        {hasDelta && (
                                                                            <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${preview.delta > 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400"}`}>
                                                                                {preview.delta > 0 ? "+" : ""}฿{preview.delta.toLocaleString()}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {isOta && preview.nights.length > 0 && (
                                                                        <div className="mt-1 bg-[var(--bg-body)] rounded border border-[var(--border-default)] overflow-hidden">
                                                                            <div className="p-2 space-y-2">
                                                                                {preview.nights.map(n => (
                                                                                    <div key={n.stay_date} className="flex items-center justify-between text-xs">
                                                                                        <span className="text-[var(--text-muted)] font-mono">{n.stay_date}</span>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="text-[var(--text-secondary)] line-through">฿{n.current_price.toLocaleString()}</span>
                                                                                            <input 
                                                                                                type="number" 
                                                                                                className="input input-sm w-20 text-right" 
                                                                                                defaultValue={n.new_price}
                                                                                                onBlur={(e) => handlePriceChange(preview.reservation_id, n.stay_date, e.target.value)}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        }
                                    });
                                })()}
                            </div>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-[var(--border-default)] bg-[var(--bg-surface)] flex justify-end gap-3">
                    <button 
                        className="btn btn-outline" 
                        onClick={onClose}
                        disabled={committing}
                    >
                        Cancel
                    </button>
                    <button 
                        className="btn btn-primary" 
                        onClick={handleCommit}
                        disabled={loading || committing || !!error}
                    >
                        {committing ? "Saving..." : "Confirm & Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}
