import { useState } from "react";

type AssignResult = {
    reservation_id: string;
    guest: string;
    status: "success" | "failed" | "error" | "recommendation";
    room?: string;
    score?: number;
    extra_charge?: boolean;
    breakdown?: Record<string, number>;
    reasons?: string[];
    all_scores?: any[];
    reason?: string; // on error or failure
};

type Props = {
    results: AssignResult[];
    onClose: () => void;
};

export default function AutoAssignResultsModal({ results, onClose }: Props) {
    const successCount = results.filter(r => r.status === "success").length;
    const failCount = results.length - successCount;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-body)]/50">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Auto-Assign Results</h2>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">
                            {successCount} assigned successfully, {failCount} failed.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-surface-hover)] transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-4 flex-1">
                    {results.length === 0 ? (
                        <p className="text-sm text-[var(--text-secondary)] text-center py-8">No arrivals needed auto-assignment.</p>
                    ) : (
                        results.map(r => (
                            <div key={r.reservation_id} className={`rounded-xl border p-4 ${r.status !== 'success' ? 'border-rose-200 bg-rose-50/30' : 'border-[var(--border-default)] bg-[var(--bg-surface)]'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-semibold text-[var(--text-primary)]">{r.guest}</h3>
                                        <div className="flex gap-2 items-center mt-1">
                                            {r.status === "success" ? (
                                                <span className="badge bg-emerald-100 text-emerald-700">✓ Assigned Room {r.room}</span>
                                            ) : (
                                                <span className="badge bg-rose-100 text-rose-700">✗ Failed: {r.reason}</span>
                                            )}
                                            {r.extra_charge && (
                                                <span className="badge bg-amber-100 text-amber-700">+$ Extra Guest</span>
                                            )}
                                            {r.score !== undefined && (
                                                <span className="text-xs font-semibold text-brand-600">Score: {r.score}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {r.status === "success" && r.breakdown && (
                                    <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                                        <div className="bg-[var(--bg-body)] p-2 rounded-lg border border-[var(--border-subtle)]">
                                            <div className="text-[var(--text-secondary)] mb-0.5">Preferences</div>
                                            <div className="font-medium text-[var(--text-table-cell)]">{r.breakdown.preference ?? 0} pts</div>
                                        </div>
                                        <div className="bg-[var(--bg-body)] p-2 rounded-lg border border-[var(--border-subtle)]">
                                            <div className="text-[var(--text-secondary)] mb-0.5">Bed Capacity</div>
                                            <div className="font-medium text-[var(--text-table-cell)]">{r.breakdown.bed ?? 0} pts</div>
                                        </div>
                                        <div className="bg-[var(--bg-body)] p-2 rounded-lg border border-[var(--border-subtle)]">
                                            <div className="text-[var(--text-secondary)] mb-0.5">Quality & HK</div>
                                            <div className="font-medium text-[var(--text-table-cell)]">{(r.breakdown.quality ?? 0) + (r.breakdown.hk ?? 0)} pts</div>
                                        </div>
                                        <div className="bg-[var(--bg-body)] p-2 rounded-lg border border-[var(--border-subtle)]">
                                            <div className="text-[var(--text-secondary)] mb-0.5">Proximity Bonus</div>
                                            <div className="font-medium text-emerald-600">+{r.breakdown.proximity ?? 0} pts</div>
                                        </div>
                                    </div>
                                )}

                                {r.reasons && r.reasons.length > 0 && (
                                    <div className="mt-3 bg-[var(--bg-body)] p-3 rounded-lg border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] space-y-1">
                                        {r.reasons.map((rsn, i) => (
                                            <div key={i}>{rsn}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-body)] flex justify-end">
                    <button className="btn btn-primary px-8" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
