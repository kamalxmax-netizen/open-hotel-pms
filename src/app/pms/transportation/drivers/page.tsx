"use client";

import { useState, useEffect, useCallback } from "react";
import type { Driver, Vehicle } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────
type Tab = "drivers" | "vehicles";

interface DriverForm {
    name: string;
    phone: string;
    company: string;
    license_type: string;
    notes: string;
}

interface VehicleForm {
    plate_number: string;
    vehicle_type: string;
    capacity: string;
    color: string;
    default_driver_id: string;
    notes: string;
}

const EMPTY_DRIVER: DriverForm = { name: "", phone: "", company: "", license_type: "", notes: "" };
const EMPTY_VEHICLE: VehicleForm = { plate_number: "", vehicle_type: "sedan", capacity: "4", color: "", default_driver_id: "", notes: "" };
const VEHICLE_TYPES = ["sedan", "van", "suv", "pickup", "minibus", "bus", "bike", "other"];

// ─── Star Rating helper ───────────────────────────────
function Stars({ avg }: { avg: number }) {
    return (
        <span className="text-amber-400 text-sm" title={`${avg.toFixed(2)}/5`}>
            {"★".repeat(Math.floor(avg))}
            {avg - Math.floor(avg) >= 0.5 ? "½" : ""}
            {"☆".repeat(5 - Math.ceil(avg))}
            <span className="text-[var(--text-muted)] ml-1 text-xs">({avg.toFixed(1)})</span>
        </span>
    );
}

// ─── Driver Modal ──────────────────────────────────────
function DriverModal({
    initial,
    onClose,
    onSave,
}: {
    initial?: Driver;
    onClose: () => void;
    onSave: () => void;
}) {
    const [form, setForm] = useState<DriverForm>(
        initial
            ? { name: initial.name, phone: initial.phone ?? "", company: initial.company ?? "", license_type: initial.license_type ?? "", notes: initial.notes ?? "" }
            : EMPTY_DRIVER
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setShowValidation(true);
        if (!form.name.trim()) { setError("Driver name is required"); return; }
        setSaving(true); setError("");
        try {
            const payload = {
                name: form.name.trim(),
                phone: form.phone.trim() || null,
                company: form.company.trim() || null,
                license_type: form.license_type.trim() || null,
                notes: form.notes.trim() || null,
            };
            const res = await fetch(
                initial ? `/api/transportation/drivers/${initial.id}` : "/api/transportation/drivers",
                { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error ?? "Failed to save driver");
            onSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unexpected error");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={handleSubmit} className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5">{initial ? "Edit Driver" : "Add Driver"}</h2>
                {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <div className="space-y-4">
                    <Field
                        label="Name *"
                        value={form.name}
                        onChange={v => setForm(f => ({ ...f, name: v }))}
                        placeholder="Full name"
                        required
                        invalid={showValidation && !form.name.trim()}
                    />
                    <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="e.g. 081-234-5678" />
                    <Field label="Company" value={form.company} onChange={v => setForm(f => ({ ...f, company: v }))} placeholder="Company or freelance" />
                    <Field label="License Type" value={form.license_type} onChange={v => setForm(f => ({ ...f, license_type: v }))} placeholder="e.g. ท.2, bus" />
                    <Field label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Optional notes" textarea />
                </div>

                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] transition-colors">Cancel</button>
                    <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ─── Vehicle Modal ─────────────────────────────────────
function VehicleModal({
    initial,
    drivers,
    onClose,
    onSave,
}: {
    initial?: Vehicle;
    drivers: Driver[];
    onClose: () => void;
    onSave: () => void;
}) {
    const [form, setForm] = useState<VehicleForm>(
        initial
            ? { plate_number: initial.plate_number, vehicle_type: initial.vehicle_type, capacity: String(initial.capacity), color: initial.color ?? "", default_driver_id: initial.default_driver_id ?? "", notes: initial.notes ?? "" }
            : EMPTY_VEHICLE
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setShowValidation(true);
        if (!form.plate_number.trim()) { setError("Plate number is required"); return; }
        if (!form.vehicle_type.trim()) { setError("Vehicle type is required"); return; }
        setSaving(true); setError("");
        try {
            const payload = {
                plate_number: form.plate_number.trim().toUpperCase(),
                vehicle_type: form.vehicle_type.trim(),
                capacity: parseInt(form.capacity) || 4,
                color: form.color.trim() || null,
                default_driver_id: form.default_driver_id || null,
                notes: form.notes.trim() || null,
            };
            const res = await fetch(
                initial ? `/api/transportation/vehicles/${initial.id}` : "/api/transportation/vehicles",
                { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error ?? "Failed to save vehicle");
            onSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unexpected error");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={handleSubmit} className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5">{initial ? "Edit Vehicle" : "Add Vehicle"}</h2>
                {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <div className="space-y-4">
                    <Field
                        label="Plate Number *"
                        value={form.plate_number}
                        onChange={v => setForm(f => ({ ...f, plate_number: v }))}
                        placeholder="e.g. กข-1234"
                        required
                        invalid={showValidation && !form.plate_number.trim()}
                    />
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Type *</label>
                        <select value={form.vehicle_type} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
                            className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            required
                            aria-invalid={showValidation && !form.vehicle_type.trim()}
                        >
                            {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <Field label="Capacity (pax)" value={form.capacity} onChange={v => setForm(f => ({ ...f, capacity: v }))} placeholder="4" type="number" />
                    <Field label="Color" value={form.color} onChange={v => setForm(f => ({ ...f, color: v }))} placeholder="e.g. White" />
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Default Driver</label>
                        <select value={form.default_driver_id} onChange={e => setForm(f => ({ ...f, default_driver_id: e.target.value }))}
                            className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="">— None —</option>
                            {drivers.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}{d.phone ? ` (${d.phone})` : ""}</option>)}
                        </select>
                    </div>
                    <Field label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Optional notes" textarea />
                </div>

                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] transition-colors">Cancel</button>
                    <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ─── Field helper ─────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", textarea = false, required = false, invalid = false }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; textarea?: boolean; required?: boolean; invalid?: boolean;
}) {
    const cls = "w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
    return (
        <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{label}</label>
            {textarea
                ? <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} required={required} aria-invalid={invalid} />
                : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} required={required} aria-invalid={invalid} />
            }
        </div>
    );
}

// ─── Confirm dialog ───────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
                <p className="text-[var(--text-primary)] mb-6">{message}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">Cancel</button>
                    <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700">Deactivate</button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────
export default function DriversVehiclesPage() {
    const [tab, setTab] = useState<Tab>("drivers");
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showAll, setShowAll] = useState(false);

    // Modal states
    const [driverModal, setDriverModal] = useState<{ open: boolean; editing?: Driver }>({ open: false });
    const [vehicleModal, setVehicleModal] = useState<{ open: boolean; editing?: Vehicle }>({ open: false });
    const [confirmDeactivate, setConfirmDeactivate] = useState<{ type: "driver" | "vehicle"; id: string; name: string } | null>(null);

    const fetchDrivers = useCallback(async () => {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (showAll) params.set("is_active", "all");
        const res = await fetch(`/api/transportation/drivers?${params}`);
        const json = await res.json();
        if (json.success) setDrivers(json.drivers ?? []);
    }, [search, showAll]);

    const fetchVehicles = useCallback(async () => {
        const params = new URLSearchParams();
        if (showAll) params.set("is_active", "all");
        const res = await fetch(`/api/transportation/vehicles?${params}`);
        const json = await res.json();
        if (json.success) setVehicles(json.vehicles ?? []);
    }, [showAll]);

    const refresh = useCallback(() => {
        setLoading(true);
        Promise.all([fetchDrivers(), fetchVehicles()]).finally(() => setLoading(false));
    }, [fetchDrivers, fetchVehicles]);

    useEffect(() => { refresh(); }, [refresh]);

    async function deactivate(type: "driver" | "vehicle", id: string) {
        const url = type === "driver" ? `/api/transportation/drivers/${id}` : `/api/transportation/vehicles/${id}`;
        await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) });
        setConfirmDeactivate(null);
        refresh();
    }

    const activeDrivers = drivers.filter(d => d.is_active);
    const activeVehicles = vehicles.filter(v => v.is_active);

    return (
        <div className="p-6 max-w-[1400px] mx-auto">
            {/* Modals */}
            {driverModal.open && (
                <DriverModal
                    initial={driverModal.editing}
                    onClose={() => setDriverModal({ open: false })}
                    onSave={() => { setDriverModal({ open: false }); refresh(); }}
                />
            )}
            {vehicleModal.open && (
                <VehicleModal
                    initial={vehicleModal.editing}
                    drivers={drivers}
                    onClose={() => setVehicleModal({ open: false })}
                    onSave={() => { setVehicleModal({ open: false }); refresh(); }}
                />
            )}
            {confirmDeactivate && (
                <ConfirmDialog
                    message={`Deactivate "${confirmDeactivate.name}"? They will be hidden from active lists but data is preserved.`}
                    onConfirm={() => deactivate(confirmDeactivate.type, confirmDeactivate.id)}
                    onCancel={() => setConfirmDeactivate(null)}
                />
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Drivers & Vehicles</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Manage drivers and vehicle fleet</p>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                        <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded" />
                        Show inactive
                    </label>
                    {tab === "drivers"
                        ? <button onClick={() => setDriverModal({ open: true })} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">+ Add Driver</button>
                        : <button onClick={() => setVehicleModal({ open: true })} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">+ Add Vehicle</button>
                    }
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-[var(--bg-muted)] rounded-xl p-1 w-fit">
                {(["drivers", "vehicles"] as Tab[]).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]"}`}>
                        {t === "drivers" ? `🚗 Drivers (${activeDrivers.length})` : `🚐 Vehicles (${activeVehicles.length})`}
                    </button>
                ))}
            </div>

            {/* Search (drivers only) */}
            {tab === "drivers" && (
                <div className="mb-4">
                    <input type="text" placeholder="Search name or phone…" value={search} onChange={e => setSearch(e.target.value)}
                        className="px-4 py-2 border border-[var(--border-input)] rounded-xl text-sm w-72 focus:ring-2 focus:ring-blue-500" />
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                </div>
            ) : tab === "drivers" ? (
                /* ── Drivers table ── */
                <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] overflow-hidden shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Name</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Phone</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Company</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">License</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Rating</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Trips</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Status</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {drivers.length === 0 ? (
                                <tr><td colSpan={8} className="px-4 py-14 text-center text-[var(--text-muted)]">
                                    No drivers found. <button className="text-blue-600" onClick={() => setDriverModal({ open: true })}>Add the first driver →</button>
                                </td></tr>
                            ) : drivers.map(d => (
                                <tr key={d.id} className={`border-b border-[var(--border-subtle)] transition-colors ${d.is_active ? "hover:bg-[var(--bg-body)]" : "opacity-50 bg-[var(--bg-body)]"}`}>
                                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{d.name}</td>
                                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{d.phone ?? "—"}</td>
                                    <td className="px-4 py-3 text-[var(--text-secondary)]">{d.company ?? "—"}</td>
                                    <td className="px-4 py-3 text-[var(--text-secondary)]">{d.license_type ?? "—"}</td>
                                    <td className="px-4 py-3 text-center">{d.rating_avg > 0 ? <Stars avg={d.rating_avg} /> : <span className="text-[var(--text-muted)] text-xs">No ratings</span>}</td>
                                    <td className="px-4 py-3 text-center font-mono">{d.total_trips}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                                            {d.is_active ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button onClick={() => setDriverModal({ open: true, editing: d })}
                                                className="px-3 py-1 text-xs border border-[var(--border-input)] rounded-lg hover:bg-[var(--bg-body)]">Edit</button>
                                            {d.is_active && (
                                                <button onClick={() => setConfirmDeactivate({ type: "driver", id: d.id, name: d.name })}
                                                    className="px-3 py-1 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Deactivate</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                /* ── Vehicles table ── */
                <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] overflow-hidden shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Plate</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Capacity</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Color</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Default Driver</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Status</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicles.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-14 text-center text-[var(--text-muted)]">
                                    No vehicles found. <button className="text-blue-600" onClick={() => setVehicleModal({ open: true })}>Add the first vehicle →</button>
                                </td></tr>
                            ) : vehicles.map(v => (
                                <tr key={v.id} className={`border-b border-[var(--border-subtle)] transition-colors ${v.is_active ? "hover:bg-[var(--bg-body)]" : "opacity-50 bg-[var(--bg-body)]"}`}>
                                    <td className="px-4 py-3 font-mono font-semibold text-[var(--text-primary)]">{v.plate_number}</td>
                                    <td className="px-4 py-3">
                                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">{v.vehicle_type}</span>
                                    </td>
                                    <td className="px-4 py-3 text-center">{v.capacity} pax</td>
                                    <td className="px-4 py-3 text-[var(--text-secondary)]">{v.color ?? "—"}</td>
                                    <td className="px-4 py-3 text-[var(--text-secondary)]">{(v as any).default_driver_name ?? <span className="text-[var(--text-muted)] italic">None</span>}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${v.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                                            {v.is_active ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <button onClick={() => setVehicleModal({ open: true, editing: v })}
                                                className="px-3 py-1 text-xs border border-[var(--border-input)] rounded-lg hover:bg-[var(--bg-body)]">Edit</button>
                                            {v.is_active && (
                                                <button onClick={() => setConfirmDeactivate({ type: "vehicle", id: v.id, name: v.plate_number })}
                                                    className="px-3 py-1 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Deactivate</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
