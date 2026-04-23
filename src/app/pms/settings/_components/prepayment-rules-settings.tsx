"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertRule, AlertRuleInput } from "@/lib/types/alerts";

export function PrepaymentRulesSettings() {
    const [rules, setRules] = useState<AlertRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

    // Form state
    const [name, setName] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [triggerMode, setTriggerMode] = useState<"all_year" | "date_range">("all_year");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");
    const [occThreshold, setOccThreshold] = useState(0);
    const [scope, setScope] = useState<"all" | "individual" | "group">("all");

    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [conflicts, setConflicts] = useState<any[]>([]);

    const loadRules = useCallback(async () => {
        setLoading(true);
        try {
            const url = `/api/alert-rules${showArchived ? '?include_archived=1' : ''}`;
            const res = await fetch(url).then(r => r.json());
            
            if (res.success) {
                setRules(res.rules || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [showArchived]);

    useEffect(() => {
        loadRules();
    }, [loadRules]);

    const handleEdit = (rule: AlertRule) => {
        setEditingRule(rule);
        setName(rule.name);
        setIsActive(rule.is_active);
        setTriggerMode(rule.trigger_mode);
        setDateStart(rule.date_start || "");
        setDateEnd(rule.date_end || "");
        setOccThreshold(rule.occ_threshold);
        setScope(rule.scope);
        setConflicts([]);
        setErrorMsg("");
        setShowModal(true);
    };

    const handleAdd = () => {
        setEditingRule(null);
        setName("");
        setIsActive(true);
        setTriggerMode("all_year");
        setDateStart("");
        setDateEnd("");
        setOccThreshold(0);
        setScope("all");
        setConflicts([]);
        setErrorMsg("");
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!name) {
            setErrorMsg("Name is required");
            return;
        }
        if (triggerMode === "date_range" && (!dateStart || !dateEnd)) {
            setErrorMsg("Start and End dates are required for date range trigger");
            return;
        }

        setSaving(true);
        setErrorMsg("");
        setConflicts([]);

        const payload: AlertRuleInput = {
            name,
            is_active: isActive,
            trigger_mode: triggerMode,
            date_start: triggerMode === "date_range" ? dateStart : null,
            date_end: triggerMode === "date_range" ? dateEnd : null,
            occ_threshold: occThreshold,
            scope
        };

        try {
            const url = `/api/alert-rules`;
            const method = editingRule ? "PATCH" : "POST";
            const requestBody = editingRule ? { id: editingRule.id, ...payload } : payload;
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                setShowModal(false);
                loadRules();
            } else if (res.status === 409) {
                setErrorMsg(data.error || "Overlap conflict detected");
                setConflicts(data.conflicts || []);
            } else {
                setErrorMsg(data.error || "Failed to save rule");
            }
        } catch (e: any) {
            setErrorMsg(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this rule?")) return;
        try {
            const res = await fetch(`/api/alert-rules`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id })
            });
            if (res.ok) loadRules();
        } catch (e) {
            console.error(e);
        }
    };

    const handleToggleActive = async (rule: AlertRule) => {
        try {
            const res = await fetch(`/api/alert-rules`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: rule.id, is_active: !rule.is_active })
            });
            if (res.ok) loadRules();
            else {
                const data = await res.json();
                if (res.status === 409) alert("Cannot activate due to overlap conflict.");
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--text-table-cell)] uppercase tracking-wide">Pre-payment Rules</h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleAdd}>+ เพิ่ม Rule</button>
            </div>

            {loading ? (
                <div className="h-16 rounded bg-[var(--bg-surface-hover)] animate-pulse" />
            ) : rules.length === 0 ? (
                <div className="text-center text-sm text-[var(--text-muted)] py-4">No rules found</div>
            ) : (
                <div className="space-y-3">
                    {rules.map(rule => (
                        <div key={rule.id} className="rounded-lg border border-[var(--border-default)] p-3 flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-[var(--text-secondary)]">{rule.name}</span>
                                    <span className={`badge text-[10px] ${rule.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                                        {rule.is_active ? '● on' : 'off'}
                                    </span>
                                    {!rule.is_active && rule.date_end && new Date(rule.date_end) < new Date() && (
                                        <span className="badge bg-rose-100 text-rose-700 text-[10px] dark:bg-rose-900/30 dark:text-rose-400">Expired</span>
                                    )}
                                </div>
                                <div className="text-xs text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                                    <span>
                                        Range: {rule.trigger_mode === 'all_year' ? 'All Year' : `${rule.date_start} → ${rule.date_end}`}
                                    </span>
                                    <span>· OCC ≥ {rule.occ_threshold}%</span>
                                    <span>· Scope: {rule.scope}</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => handleEdit(rule)}>แก้ไข</button>
                                <button type="button" className="text-xs text-[var(--text-muted)] hover:underline" onClick={() => handleToggleActive(rule)}>
                                    {rule.is_active ? 'ปิด' : 'เปิด'}
                                </button>
                                <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => handleDelete(rule.id)}>ลบ</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <button type="button" className="text-xs text-brand-600 hover:underline mt-2" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? 'Hide archived rules ▴' : 'Show archived (expired) rules ▸'}
            </button>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[500px] max-w-full overflow-hidden shadow-xl p-5">
                        <h3 className="font-bold mb-4 text-[var(--text-primary)]">{editingRule ? 'Edit Rule' : 'New Pre-payment Rule'}</h3>
                        
                        {errorMsg && (
                            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm">
                                <p className="font-bold">⚠️ {errorMsg}</p>
                                {conflicts.length > 0 && (
                                    <ul className="mt-2 list-disc pl-5">
                                        {conflicts.map(c => (
                                            <li key={c.id}>{c.name} ({c.date_start || 'All Year'} to {c.date_end || 'All Year'})</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        <div className="space-y-4 text-sm">
                            <div>
                                <label className="form-label block mb-1">Rule Name</label>
                                <input className="form-input w-full" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="form-label block mb-1">Trigger Mode</label>
                                    <select className="form-select w-full" value={triggerMode} onChange={e => setTriggerMode(e.target.value as any)}>
                                        <option value="all_year">All Year</option>
                                        <option value="date_range">Date Range</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="form-label block mb-1">Scope</label>
                                    <select className="form-select w-full" value={scope} onChange={e => setScope(e.target.value as any)}>
                                        <option value="all">All</option>
                                        <option value="individual">Individual</option>
                                        <option value="group">Group</option>
                                    </select>
                                </div>
                            </div>

                            {triggerMode === "date_range" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="form-label block mb-1">Start Date</label>
                                        <input type="date" className="form-input w-full" value={dateStart} onChange={e => setDateStart(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="form-label block mb-1">End Date</label>
                                        <input type="date" className="form-input w-full" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="form-label block mb-1">OCC Threshold % (0 = skip OCC check)</label>
                                <input type="number" min="0" max="100" className="form-input w-full" value={occThreshold} onChange={e => setOccThreshold(Number(e.target.value))} />
                            </div>

                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                                <span>Active</span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--border-default)]">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                                {saving ? "Saving..." : "Save Rule"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
