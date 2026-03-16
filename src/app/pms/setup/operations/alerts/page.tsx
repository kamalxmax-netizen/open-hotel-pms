"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AlertTemplate = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string;
  display_surfaces: string[];
  severity: "info" | "warning" | "critical";
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  icon?: string | null;
};

const SURFACES = [
  { value: "arrivals", label: "Arrivals" },
  { value: "room_diary", label: "Room Diary" },
  { value: "calendar", label: "Calendar" },
  { value: "reservation", label: "Reservation" },
  { value: "inhouse", label: "In-House" },
  { value: "room_drawer", label: "Room Drawer" },
  { value: "hk_dashboard", label: "HK Dashboard" },
] as const;

const CATEGORIES = ["arrival", "housekeeping", "policy", "transport", "other"] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;

function createEmptyForm() {
  return {
    code: "",
    name: "",
    description: "",
    category: "arrival",
    display_surfaces: ["reservation"] as string[],
    severity: "info",
    is_system: false,
    is_active: true,
    sort_order: 0,
    icon: "",
  };
}

export default function AlertTemplatesSetupPage() {
  const [templates, setTemplates] = useState<AlertTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AlertTemplate | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [form, setForm] = useState(createEmptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alert-templates");
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
      item.code.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      String(item.category).toLowerCase().includes(q)
    );
  }, [query, templates]);

  function toggleSurface(surface: string) {
    setForm((current) => ({
      ...current,
      display_surfaces: current.display_surfaces.includes(surface)
        ? current.display_surfaces.filter((item) => item !== surface)
        : [...current.display_surfaces, surface],
    }));
  }

  function startCreate() {
    setEditing(null);
    setForm(createEmptyForm());
    setShowForm(true);
  }

  function startEdit(template: AlertTemplate) {
    setEditing(template);
    setForm({
      code: template.code,
      name: template.name,
      description: template.description ?? "",
      category: template.category,
      display_surfaces: Array.isArray(template.display_surfaces) ? template.display_surfaces : ["reservation"],
      severity: template.severity,
      is_system: template.is_system,
      is_active: template.is_active,
      sort_order: Number(template.sort_order ?? 0),
      icon: template.icon ?? "",
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
        code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
      };

      const res = await fetch(editing ? `/api/alert-templates/${editing.id}` : "/api/alert-templates", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save alert template.");
      }
      setMessage({ text: editing ? "Alert template updated." : "Alert template created.", type: "ok" });
      setShowForm(false);
      setEditing(null);
      setForm(createEmptyForm());
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to save alert template.", type: "err" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: AlertTemplate) {
    if (!window.confirm(`Delete alert template "${template.name}"?`)) return;
    setDeletingId(template.id);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch(`/api/alert-templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete alert template.");
      }
      if (editing?.id === template.id) {
        setEditing(null);
        setShowForm(false);
        setForm(createEmptyForm());
      }
      setMessage({ text: "Alert template deleted.", type: "ok" });
      await load();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to delete alert template.", type: "err" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Operations Setup</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Alert Templates</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Configure reusable alert templates, severity, and display surfaces.</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>+ New Alert Template</button>
      </div>

      {message.text && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}>
          {message.text}
        </div>
      )}

      <div className="card p-4 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label className="form-label">Search</label>
          <input className="form-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code, name, or category..." />
        </div>
      </div>

      {showForm && (
        <form onSubmit={saveForm} className="rounded-2xl border border-brand-200 bg-brand-50 p-5 space-y-4">
          <h2 className="text-base font-bold text-[var(--text-primary)]">{editing ? "Edit Alert Template" : "New Alert Template"}</h2>
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
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Severity</label>
              <select className="form-select" value={form.severity} onChange={(e) => setForm((current) => ({ ...current, severity: e.target.value }))}>
                {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Icon</label>
              <input className="form-input" value={form.icon} onChange={(e) => setForm((current) => ({ ...current, icon: e.target.value }))} placeholder="Optional icon / emoji" />
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input type="number" className="form-input" value={form.sort_order} onChange={(e) => setForm((current) => ({ ...current, sort_order: Number(e.target.value) || 0 }))} />
            </div>
          </div>

          <div>
            <label className="form-label">Description</label>
            <textarea className="form-input min-h-[80px]" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} />
          </div>

          <div>
            <p className="form-label mb-2">Display Surfaces</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SURFACES.map((surface) => (
                <label key={surface.value} className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm">
                  <input type="checkbox" checked={form.display_surfaces.includes(surface.value)} onChange={() => toggleSurface(surface.value)} />
                  <span>{surface.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_system} onChange={(e) => setForm((current) => ({ ...current, is_system: e.target.checked }))} />
              System template
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))} />
              Active
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Template"}</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-11 rounded-lg bg-[var(--bg-muted)] animate-pulse" />)}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Surfaces</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td className="font-mono font-semibold">{item.code}</td>
                  <td>
                    <div className="font-semibold text-[var(--text-primary)]">{item.name}</div>
                    {item.description && <div className="text-xs text-[var(--text-secondary)]">{item.description}</div>}
                  </td>
                  <td className="capitalize">{item.category}</td>
                  <td className="capitalize">{item.severity}</td>
                  <td className="text-sm text-[var(--text-secondary)]">{(item.display_surfaces ?? []).join(", ")}</td>
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
