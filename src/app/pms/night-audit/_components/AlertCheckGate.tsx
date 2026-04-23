"use client";

import { useState, useEffect } from "react";
import { AlertItem } from "@/lib/types/alerts";

type Props = {
    businessDate: string;
    onAdvance: () => void;
    onBack: () => void;
};

export function AlertCheckGate({ businessDate, onAdvance, onBack }: Props) {
    const [loading, setLoading] = useState(true);
    const [pendingCount, setPendingCount] = useState(0);
    const [items, setItems] = useState<AlertItem[]>([]);
    const [error, setError] = useState("");
    
    // Bulk snooze modal
    const [showSnoozeModal, setShowSnoozeModal] = useState(false);
    const [snoozeNote, setSnoozeNote] = useState("");
    const [snoozing, setSnoozing] = useState(false);

    useEffect(() => {
        if (!businessDate || businessDate.includes("Error") || businessDate.includes("Loading")) return;
        
        let isMounted = true;
        setLoading(true);

        fetch(`/api/night-audit/alert-check?date=${businessDate}`)
            .then(r => r.json())
            .then(d => {
                if (!isMounted) return;
                if (d.success) {
                    setPendingCount(d.pending);
                    setItems(d.items || []);
                    if (d.pending === 0) {
                        // Auto-advance if nothing pending
                        onAdvance();
                    }
                } else {
                    setError(d.error || "Failed to check alerts.");
                }
            })
            .catch(e => {
                if (isMounted) setError("Network error checking alerts.");
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => { isMounted = false; };
    }, [businessDate, onAdvance]);

    const handleBulkSnooze = async () => {
        if (!snoozeNote) return;
        setSnoozing(true);
        setError("");

        try {
            // Calculate next business date (businessDate + 1 day)
            const d = new Date(businessDate);
            d.setDate(d.getDate() + 1);
            const nextDate = d.toISOString().split("T")[0];

            const res = await fetch("/api/night-audit/alert-bulk-snooze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: businessDate,
                    next_date: nextDate,
                    note: snoozeNote
                })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                setShowSnoozeModal(false);
                onAdvance();
            } else {
                setError(data.error || "Failed to bulk snooze alerts.");
            }
        } catch (e: any) {
            setError(e.message || "Network error during bulk snooze.");
        } finally {
            setSnoozing(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600 mb-4" />
                <p className="text-[var(--text-secondary)]">Checking for pending alerts...</p>
            </div>
        );
    }

    if (pendingCount === 0 && !error) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <p className="text-emerald-600 font-medium">All alerts cleared. Advancing...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-800 dark:bg-amber-900/20 dark:border-amber-500/30 dark:text-amber-400">
                <h3 className="font-bold flex items-center gap-2 text-lg">
                    <span>⚠️</span> {pendingCount} Pending Alert{pendingCount !== 1 ? 's' : ''} for {businessDate}
                </h3>
                <p className="text-sm mt-1">
                    You cannot run Night Audit while there are pending alerts. Please clear them or snooze them to the next business date.
                </p>
            </div>

            {error && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-700 text-sm">
                    {error}
                </div>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {items.map(item => (
                    <div key={item.daily_state_id} className="rounded border border-[var(--border-default)] p-3 text-sm flex items-center justify-between">
                        <div>
                            <span className="font-bold">{item.alert_type === 'prepayment' ? '💰 Pre-payment' : '⏰ Custom Alarm'}</span>
                            <span className="mx-2 text-[var(--text-muted)]">|</span>
                            <span>{item.booking.guest_name}</span>
                        </div>
                        {item.alert_type === 'custom' && item.note && (
                            <span className="text-[var(--text-muted)] truncate max-w-[200px] ml-4">{item.note}</span>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-[var(--border-default)] mt-6 justify-between items-center">
                <button
                    onClick={onBack}
                    className="w-full sm:w-auto btn btn-secondary"
                >
                    ← Back to Pre-Check
                </button>
                <div className="flex gap-2 w-full sm:w-auto">
                    <a
                        href="/pms/alerts"
                        target="_blank"
                        className="btn btn-secondary flex-1 sm:flex-none justify-center text-brand-600"
                    >
                        Go to Alerts Page ↗
                    </a>
                    <button
                        onClick={() => setShowSnoozeModal(true)}
                        className="btn btn-primary flex-1 sm:flex-none"
                    >
                        Bulk Snooze → Next Business Date
                    </button>
                </div>
            </div>

            {/* Bulk Snooze Modal */}
            {showSnoozeModal && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[400px] max-w-full overflow-hidden shadow-xl p-6">
                        <h3 className="font-bold mb-2 text-[var(--text-primary)] text-lg">Bulk Snooze Alerts</h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-4">
                            This will move all {pendingCount} pending alerts to the next business date. Please provide a reason.
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label className="form-label block mb-1">Reason (Note) *</label>
                                <textarea
                                    className="form-input w-full min-h-[80px]"
                                    value={snoozeNote}
                                    onChange={e => setSnoozeNote(e.target.value)}
                                    placeholder="e.g. Will contact guests tomorrow morning"
                                />
                            </div>
                            <div className="flex justify-end gap-2 mt-2">
                                <button className="btn btn-secondary" onClick={() => setShowSnoozeModal(false)}>Cancel</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={snoozing || !snoozeNote}
                                    onClick={handleBulkSnooze}
                                >
                                    {snoozing ? "Snoozing..." : "Confirm Bulk Snooze"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
