"use client";

import { useState, useEffect, useCallback } from "react";

type FeeTemplate = {
    code: string;
    name: string;
    category: "service" | "damage" | "penalty" | "policy";
    default_price: number;
    is_active: boolean;
    sort_order?: number;
};

const CATEGORIES: FeeTemplate["category"][] = ["service", "damage", "penalty", "policy"];

export default function FeeTemplatesPage() {
    const [templates, setTemplates] = useState<FeeTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState({ text: "", type: "" });
    const [showForm, setShowForm] = useState(false);

    const [form, setForm] = useState<Partial<FeeTemplate>>({
        code: "",
        name: "",
        category: "service",
        default_price: 0,
        is_active: true
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/extra-fee-templates");
            const data = await res.json();
            if (data.success && data.templates) {
                setTemplates(data.templates);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    async function toggleActive(code: string, currentActive: boolean) {
        setSaving(true);
        setMsg({ text: "", type: "" });
        try {
            const res = await fetch(`/api/extra-fee-templates/${code}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ is_active: !currentActive })
            });
            const data = await res.json();
            if (res.ok) {
                setTemplates(prev => prev.map(t => t.code === code ? { ...t, is_active: !currentActive } : t));
                setMsg({ text: `Template ${code} ${!currentActive ? 'activated' : 'deactivated'}.`, type: "ok" });
            } else {
                setMsg({ text: data.error ?? "Failed to update.", type: "err" });
            }
        } finally {
            setSaving(false);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        if (!form.code || !form.name) return;
        setSaving(true);
        setMsg({ text: "", type: "" });

        try {
            // uppercase code
            const submitData = { ...form, code: form.code.toUpperCase().replace(/\s+/g, "_") };
            const res = await fetch("/api/extra-fee-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(submitData)
            });
            const data = await res.json();
            if (res.ok) {
                setMsg({ text: "✓ Template created successfully.", type: "ok" });
                setShowForm(false);
                setForm({ code: "", name: "", category: "service", default_price: 0, is_active: true });
                load();
            } else {
                setMsg({ text: data.error ?? "Failed to create.", type: "err" });
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-12">
            <div>
                <h1 className="page-title">Fee Templates</h1>
                <p className="text-sm text-[var(--text-secondary)]">Manage extra charges, penalties, and policy fees</p>
            </div>

            {msg.text && (
                <div className={`rounded-lg border px-3 py-2 text-sm whitespace-pre-line ${msg.type === "ok"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}>
                    {msg.text}
                </div>
            )}

            <div className="flex justify-end">
                <button
                    className="btn btn-primary"
                    onClick={() => setShowForm(!showForm)}
                >
                    {showForm ? "Cancel" : "+ Add Template"}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className="rounded-xl border border-brand-200 bg-brand-50 p-4 space-y-4">
                    <h2 className="text-sm font-bold text-brand-900 uppercase tracking-wide">New Fee Template</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">Template Code</label>
                            <input
                                className="form-input uppercase"
                                value={form.code}
                                onChange={(e) => setForm({ ...form, code: e.target.value })}
                                placeholder="E.g. AIRPORT_TRANSFER"
                                required
                            />
                            <p className="text-[10px] text-[var(--text-muted)] mt-1">Unique identifier (letters and underscores only)</p>
                        </div>
                        <div>
                            <label className="form-label">Display Name</label>
                            <input
                                className="form-input"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="E.g. Airport Transfer"
                                required
                            />
                        </div>
                        <div>
                            <label className="form-label">Category</label>
                            <select
                                className="form-select capitalize"
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                            >
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Default Amount (฿)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="form-input font-mono"
                                value={form.default_price}
                                onChange={(e) => setForm({ ...form, default_price: parseFloat(e.target.value) || 0 })}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? "Saving…" : "Save Template"}
                        </button>
                    </div>
                </form>
            )}

            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden text-sm">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)] text-[var(--text-secondary)] font-semibold text-xs uppercase tracking-wider">
                            <th className="px-4 py-3">Code</th>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Category</th>
                            <th className="px-4 py-3 text-right">Default ฿</th>
                            <th className="px-4 py-3 text-center">Status</th>
                            <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                    <div className="btn-spinner mx-auto" />
                                </td>
                            </tr>
                        ) : templates.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                    No fee templates found.
                                </td>
                            </tr>
                        ) : (
                            templates.map((t) => (
                                <tr key={t.code} className={!t.is_active ? "opacity-50 bg-[var(--bg-body)]" : "hover:bg-[var(--bg-body)]"}>
                                    <td className="px-4 py-3 font-mono font-semibold text-[var(--text-table-cell)]">{t.code}</td>
                                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{t.name}</td>
                                    <td className="px-4 py-3">
                                        <span className="capitalize px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                            {t.category}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-[var(--text-secondary)]">
                                        {Number(t.default_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {t.is_active ? (
                                            <span className="text-emerald-600 text-[10px] font-bold bg-emerald-100 px-2 py-0.5 rounded">ACTIVE</span>
                                        ) : (
                                            <span className="text-[var(--text-muted)] text-[10px] font-bold bg-slate-200 px-2 py-0.5 rounded">INACTIVE</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            className={`text-xs font-semibold px-3 py-1 rounded border ${t.is_active ? 'text-rose-600 border-rose-200 hover:bg-rose-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'}`}
                                            onClick={() => toggleActive(t.code, t.is_active)}
                                            disabled={saving}
                                        >
                                            {t.is_active ? "Deactivate" : "Activate"}
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
