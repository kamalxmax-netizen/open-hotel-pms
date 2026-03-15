"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TraceTemplate = {
  id: number;
  name: string;
  dept: "FD" | "HK" | "MAINT" | "MGMT" | "OTHER";
  template_text: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

const TRACE_DEPTS = ["FD", "HK", "MAINT", "MGMT", "OTHER"] as const;

function createEmptyForm() {
  return {
    name: "",
    dept: "FD",
    template_text: "",
    is_active: true,
    sort_order: 0,
  };
}

export default function TraceTemplatesSetupPage() {
  const [templates, setTemplates] = useState<TraceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TraceTemplate | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [form, setForm] = useState(createEmptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trace-templates");
      const data = await res.json();
      if (res.ok && data?.success) setTemplates(data.templates ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((item) =>
      item.name.toLowerCase().includes(q) ||
      item.dept.toLowerCase().includes(q) ||
      item.template_text.toLowerCase().includes(q)
    );
  }, [query, templates]);

  function startCreate() {
    setEditing(null);
    setForm(createEmptyForm());
    setShowForm(true);
  }

  function startEdit(template: TraceTemplate) {
    setEditing(template);
    setForm({
      name: template.name,
      dept: template.dept,
      template_text: template.template_text,
      is_active: template.is_active,
      sort_order: Number(template.sort_order ?? 0),
    });
    setShowForm(true);
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch(editing ? `/api/trace-templates/${editing.id}` : "/api/trace-templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save trace template.");
      }
      setMessage({ text: editing ? "Trace template updated." : "Trace template created.", type: "ok" });
      setShowForm(false);
      setEditing(null);
      setForm(createEmptyForm());
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to save trace template.", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: TraceTemplate) {
    if (!window.confirm(`Delete trace template "${template.name}"?`)) return;
    setDeletingId(template.id);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch(`/api/trace-templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete trace template.");
      }
      if (editing?.id === template.id) {
        setEditing(null);
        setShowForm(false);
        setForm(createEmptyForm());
      }
      setMessage({ text: "Trace template deleted.", type: "ok" });
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to delete trace template.", type: "err" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Operations Setup</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Trace Templates</h1>
          <p className="text-sm text-slate-500 mt-1">Manage quick text templates used in the reservation trace workflow.</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>+ New Trace Template</button>
      </div>

      {message.text && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
          {message.text}
        </div>
      )}

      <div className="card p-4">
        <label className="form-label">Search</label>
        <input className="form-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, dept, or text..." />
      </div>

      {showForm && (
        <form onSubmit={saveForm} className="rounded-2xl border border-brand-200 bg-brand-50 p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">{editing ? "Edit Trace Template" : "New Trace Template"}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="form-label">Name</label>
              <input className="form-input" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Department</label>
              <select className="form-select" value={form.dept} onChange={(e) => setForm((current) => ({ ...current, dept: e.target.value as typeof current.dept }))}>
                {TRACE_DEPTS.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input type="number" className="form-input" value={form.sort_order} onChange={(e) => setForm((current) => ({ ...current, sort_order: Number(e.target.value) || 0 }))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))} />
                Active
              </label>
            </div>
          </div>
          <div>
            <label className="form-label">Template Text</label>
            <textarea className="form-input min-h-[100px]" value={form.template_text} onChange={(e) => setForm((current) => ({ ...current, template_text: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Template"}</button>
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
                <th>Name</th>
                <th>Dept</th>
                <th>Template Text</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td className="font-semibold text-slate-800">{item.name}</td>
                  <td>{item.dept}</td>
                  <td className="text-sm text-slate-600">{item.template_text}</td>
                  <td>{item.is_active ? "Active" : "Inactive"}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>Edit</button>
                      <button
                        className="btn btn-secondary btn-sm text-rose-700"
                        onClick={() => void deleteTemplate(item)}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id ? "Deleting..." : "Delete"}
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
