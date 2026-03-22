"use client";

import React, { useState, useEffect } from "react";
import type { DraftAction } from "@/lib/types";

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
    source: string;
    current_total: number;
    new_total: number;
    delta: number;
    nights: PricingPreviewNight[];
    rate_plan_name?: string;
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

    useEffect(() => {
        let active = true;
        const fetchPreview = async () => {
            setLoading(true);
            setError(null);
            try {
                // Build payload matching API
                const payloadActions = actions.map((a, idx) => {
                    // For APIs, we map our draft action type to the API's format
                    const ota_night_overrides = [];
                    const resOverrides = overrides[a.reservation_id];
                    if (resOverrides) {
                        for (const [stay_date, nightly_price] of Object.entries(resOverrides)) {
                            ota_night_overrides.push({ stay_date, nightly_price: Number(nightly_price) });
                        }
                    }

                    return {
                        type: a.type,
                        reservation_id: a.reservation_id,
                        to_room_id: a.to_room_id,
                        ota_night_overrides: ota_night_overrides.length > 0 ? ota_night_overrides : undefined
                    };
                });

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
        // We DO want to re-fetch when `overrides` change, but we should debounce it if users type.
        // For simplicity, we just trigger on blur or when they press "Apply" for overrides.
        // Currently, we'll re-run it every time `overrides` changes.
    }, [actions, overrides]);

    const handleCommit = async () => {
        setCommitting(true);
        setError(null);
        try {
            const payloadActions = actions.map((a, idx) => {
                const ota_night_overrides = [];
                const resOverrides = overrides[a.reservation_id];
                if (resOverrides) {
                    for (const [stay_date, nightly_price] of Object.entries(resOverrides)) {
                        ota_night_overrides.push({ stay_date, nightly_price: Number(nightly_price) });
                    }
                }
                return {
                    type: a.type,
                    reservation_id: a.reservation_id,
                    to_room_id: a.to_room_id,
                    ota_night_overrides: ota_night_overrides.length > 0 ? ota_night_overrides : undefined
                };
            });

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
                                {result.previews.map((preview, i) => {
                                    const action = actions[preview.action_index];
                                    const isOta = preview.source.toLowerCase() === "ota" || preview.source.toLowerCase() === "agent";
                                    const hasDelta = preview.delta !== 0;

                                    return (
                                        <div key={i} className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-4 mb-3">
                                            <div className="flex justify-between items-start mb-2">
                                                <div>
                                                    <span className="font-bold text-sm text-[var(--text-primary)]">Action: {action.type}</span>
                                                    <div className="text-xs text-[var(--text-secondary)]">Booking {preview.reservation_id.split("-")[0]}</div>
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
                                })}
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
