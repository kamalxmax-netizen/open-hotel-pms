"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LoanItem = {
  code: string;
  name: string;
  total_qty: number;
  available: number;
  icon: string | null;
  requires_hk_collection?: boolean;
  requires_extra_charge_reminder?: boolean;
  linked_fee_template_code?: string | null;
};

type FeeTemplate = {
  code: string;
  name: string;
  is_active: boolean;
};

function createEmptyForm() {
  return {
    code: "",
    name: "",
    total_qty: 0,
    available: 0,
    icon: "",
    requires_hk_collection: false,
    requires_extra_charge_reminder: false,
    linked_fee_template_code: "",
  };
}

export default function LoanItemsSetupPage() {
  const [items, setItems] = useState<LoanItem[]>([]);
  const [feeTemplates, setFeeTemplates] = useState<FeeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LoanItem | null>(null);
  const [form, setForm] = useState(createEmptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, feesRes] = await Promise.all([
        fetch("/api/loan-items"),
        fetch("/api/extra-fee-templates?active=true"),
      ]);
      const itemsJson = await itemsRes.json().catch(() => ({}));
      const feesJson = await feesRes.json().catch(() => ({}));
      if (itemsRes.ok && itemsJson?.success) setItems(itemsJson.items ?? []);
      if (feesRes.ok && feesJson?.success) setFeeTemplates(feesJson.templates ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      item.code.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q)
    );
  }, [items, query]);

  function startCreate() {
    setEditing(null);
    setForm(createEmptyForm());
    setShowForm(true);
  }

  function startEdit(item: LoanItem) {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      total_qty: Number(item.total_qty ?? 0),
      available: Number(item.available ?? 0),
      icon: item.icon ?? "",
      requires_hk_collection: Boolean(item.requires_hk_collection),
      requires_extra_charge_reminder: Boolean(item.requires_extra_charge_reminder),
      linked_fee_template_code: item.linked_fee_template_code ?? "",
    });
    setShowForm(true);
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: "", type: "" });
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        linked_fee_template_code: form.linked_fee_template_code || null,
      };
      const url = editing ? `/api/loan-items/${editing.code}` : "/api/loan-items";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save loan item.");
      }
      setMessage({ text: editing ? "Loan item updated." : "Loan item created.", type: "ok" });
      setShowForm(false);
      setEditing(null);
      setForm(createEmptyForm());
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to save loan item.", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item: LoanItem) {
    if (!window.confirm(`Delete loan item "${item.name}"?`)) return;
    setDeletingCode(item.code);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch(`/api/loan-items/${item.code}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete loan item.");
      }
      if (editing?.code === item.code) {
        setEditing(null);
        setShowForm(false);
        setForm(createEmptyForm());
      }
      setMessage({ text: "Loan item deleted.", type: "ok" });
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to delete loan item.", type: "err" });
    } finally {
      setDeletingCode(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Operations Setup</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Loan Items</h1>
          <p className="text-sm text-slate-500 mt-1">Manage inventory, HK collection flags, and extra charge reminder links.</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>+ New Loan Item</button>
      </div>

      {message.text && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
          {message.text}
        </div>
      )}

      <div className="card p-4">
        <label className="form-label">Search</label>
        <input className="form-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code or name..." />
      </div>

      {showForm && (
        <form onSubmit={saveForm} className="rounded-2xl border border-brand-200 bg-brand-50 p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">{editing ? "Edit Loan Item" : "New Loan Item"}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="form-label">Code</label>
              <input className="form-input" value={form.code} onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Total Qty</label>
              <input type="number" min={0} className="form-input" value={form.total_qty} onChange={(e) => setForm((current) => ({ ...current, total_qty: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="form-label">Available</label>
              <input type="number" min={0} className="form-input" value={form.available} onChange={(e) => setForm((current) => ({ ...current, available: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="form-label">Icon</label>
              <input className="form-input" value={form.icon} onChange={(e) => setForm((current) => ({ ...current, icon: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Linked Extra Charge</label>
              <select className="form-select" value={form.linked_fee_template_code} onChange={(e) => setForm((current) => ({ ...current, linked_fee_template_code: e.target.value }))}>
                <option value="">None</option>
                {feeTemplates.map((template) => (
                  <option key={template.code} value={template.code}>{template.code} — {template.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requires_hk_collection} onChange={(e) => setForm((current) => ({ ...current, requires_hk_collection: e.target.checked }))} />
              Requires HK collection
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requires_extra_charge_reminder} onChange={(e) => setForm((current) => ({ ...current, requires_extra_charge_reminder: e.target.checked }))} />
              Requires extra charge reminder
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Item"}</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-11 rounded-lg bg-slate-100 animate-pulse" />)}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Stock</th>
                <th>HK Collect</th>
                <th>Charge Reminder</th>
                <th>Linked Fee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.code}>
                  <td className="font-mono font-semibold">{item.code}</td>
                  <td>{item.icon ? `${item.icon} ` : ""}{item.name}</td>
                  <td>{item.available}/{item.total_qty}</td>
                  <td>{item.requires_hk_collection ? "Yes" : "No"}</td>
                  <td>{item.requires_extra_charge_reminder ? "Yes" : "No"}</td>
                  <td>{item.linked_fee_template_code ?? "—"}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>Edit</button>
                      <button
                        className="btn btn-secondary btn-sm text-rose-700"
                        onClick={() => void deleteItem(item)}
                        disabled={deletingCode === item.code}
                      >
                        {deletingCode === item.code ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
