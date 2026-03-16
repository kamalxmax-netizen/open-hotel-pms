"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────
interface Pier {
    id: string;
    name: string;
    location_note: string | null;
}

interface BoatCompany {
    id: string;
    name: string;
    contact_phone: string | null;
    contact_line: string | null;
    contact_whatsapp: string | null;
    website: string | null;
    notes: string | null;
    is_active: boolean;
    piers: Pier[];
}

interface BoatRoute {
    id: string;
    company_id: string;
    company_name?: string;
    departure_pier_id: string | null;
    departure_pier_name?: string;
    origin: string;
    destination: string;
    boat_type: string;
    departure_times: string[];
    duration_minutes: number | null;
    ticket_price: number | null;
    cost_price: number | null;
    includes_pickup: boolean;
    pickup_fee: number | null;
    season_label: string | null;
    notes: string | null;
    is_active: boolean;
}

type ViewTab = "timetable" | "companies";

function normalizeClockTime(value: string): string | null {
    const normalizedInput = value.trim().replace(/\./g, ":");
    const m = normalizedInput.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTimeArray(values: string[]): string[] {
    const normalized = values
        .map((v) => normalizeClockTime(v))
        .filter((v): v is string => Boolean(v));
    return Array.from(new Set(normalized)).sort();
}

function firstValidationMessage(details: any): string | null {
    const fieldErrors = details?.fieldErrors;
    if (!fieldErrors || typeof fieldErrors !== "object") return null;
    for (const key of Object.keys(fieldErrors)) {
        const arr = fieldErrors[key];
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") {
            return `${key}: ${arr[0]}`;
        }
    }
    const formErrors = details?.formErrors;
    if (Array.isArray(formErrors) && formErrors.length > 0 && typeof formErrors[0] === "string") {
        return formErrors[0];
    }
    return null;
}

function parseNumberOrNull(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// ─── Helper components ───────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", textarea = false, required = false, invalid = false }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; textarea?: boolean; required?: boolean; invalid?: boolean;
}) {
    const cls = "w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
    return (
        <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{label}{required && " *"}</label>
            {textarea
                ? <textarea rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} required={required} aria-invalid={invalid} />
                : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} required={required} aria-invalid={invalid} />
            }
        </div>
    );
}

// ─── Departure Times chip input ───────────────────────
function DepartureTimesInput({ times, onChange, invalid = false }: { times: string[]; onChange: (t: string[]) => void; invalid?: boolean }) {
    const [input, setInput] = useState("");
    function add() {
        const normalized = normalizeClockTime(input);
        if (!normalized) { alert("Use HH:MM format (e.g. 07:30)"); return; }
        if (times.includes(normalized)) { setInput(""); return; }
        onChange(normalizeTimeArray([...times, normalized]));
        setInput("");
    }
    return (
        <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Departure Times *</label>
            <div
                className={`flex flex-wrap gap-1 mb-2 rounded-md border px-2 py-1 min-h-9 ${
                    invalid ? "border-rose-300 bg-rose-50" : "border-transparent"
                }`}
                aria-invalid={invalid}
            >
                {times.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-mono">
                        {t}
                        <button type="button" onClick={() => onChange(times.filter(x => x !== t))} className="text-blue-500 hover:text-red-500 ml-0.5">×</button>
                    </span>
                ))}
                {times.length === 0 && <span className="text-xs text-[var(--text-muted)] italic">No times added yet</span>}
            </div>
            <div className="flex gap-2">
                <input type="text" placeholder="HH:MM (e.g. 07:30)" value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), add())}
                    className="flex-1 px-3 py-1.5 border border-[var(--border-input)] rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500" />
                <button type="button" onClick={add} className="px-3 py-1.5 bg-[var(--bg-muted)] text-[var(--text-table-cell)] rounded-lg text-sm hover:bg-[var(--bg-muted)]">Add</button>
            </div>
            {invalid && <p className="text-xs text-rose-600 mt-1">At least one departure time is required.</p>}
        </div>
    );
}

// ─── Company Modal ────────────────────────────────────
function CompanyModal({ initial, onClose, onSave }: {
    initial?: BoatCompany; onClose: () => void; onSave: () => void;
}) {
    const [name, setName] = useState(initial?.name ?? "");
    const [phone, setPhone] = useState(initial?.contact_phone ?? "");
    const [lineId, setLineId] = useState(initial?.contact_line ?? "");
    const [whatsapp, setWhatsapp] = useState(initial?.contact_whatsapp ?? "");
    const [website, setWebsite] = useState(initial?.website ?? "");
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setShowValidation(true);
        if (!name.trim()) { setError("Company name is required"); return; }
        setSaving(true); setError("");
        try {
            const payload = {
                name: name.trim(),
                contact_phone: phone.trim() || null,
                contact_line: lineId.trim() || null,
                contact_whatsapp: whatsapp.trim() || null,
                website: website.trim() || null,
                notes: notes.trim() || null,
            };
            const res = await fetch(
                initial ? `/api/transportation/companies/${initial.id}` : "/api/transportation/companies",
                { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error ?? "Failed");
            onSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unexpected error");
        } finally { setSaving(false); }
    }

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={handleSubmit} className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5">{initial ? "Edit Company" : "Add Boat Company"}</h2>
                {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <div className="space-y-3">
                    <Field label="Company Name" required invalid={showValidation && !name.trim()} value={name} onChange={setName} placeholder="e.g. Lomprayah" />
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Phone" value={phone} onChange={setPhone} placeholder="Tel" />
                        <Field label="LINE ID" value={lineId} onChange={setLineId} placeholder="@lineid" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} placeholder="+66..." />
                        <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
                    </div>
                    <Field label="Notes" value={notes} onChange={setNotes} placeholder="Internal notes" textarea />
                </div>
                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">Cancel</button>
                    <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-60">
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ─── Piers inline expander ────────────────────────────
function PierManager({ company, onUpdate }: { company: BoatCompany; onUpdate: () => void }) {
    const [addName, setAddName] = useState("");
    const [addNote, setAddNote] = useState("");
    const [saving, setSaving] = useState(false);
    const [showValidation, setShowValidation] = useState(false);

    async function addPier(e: React.FormEvent) {
        e.preventDefault();
        setShowValidation(true);
        if (!addName.trim()) return;
        setSaving(true);
        await fetch(`/api/transportation/companies/${company.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ piers: [...company.piers, { name: addName.trim(), location_note: addNote.trim() || null }] }),
        });
        setAddName(""); setAddNote("");
        setShowValidation(false);
        setSaving(false); onUpdate();
    }

    return (
        <div className="mt-3 pl-4 border-l-2 border-blue-200">
            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">PIERS</p>
            <div className="space-y-1 mb-3">
                {company.piers.length === 0 && <p className="text-xs text-[var(--text-muted)] italic">No piers yet</p>}
                {company.piers.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                        <span className="text-[var(--text-secondary)]">⚓ {p.name}</span>
                        {p.location_note && <span className="text-[var(--text-muted)] text-xs">({p.location_note})</span>}
                    </div>
                ))}
            </div>
            <form onSubmit={addPier} className="flex gap-2">
                <input type="text" placeholder="Pier name *" value={addName} onChange={e => setAddName(e.target.value)}
                    className="flex-1 px-2 py-1 border border-[var(--border-input)] rounded-lg text-xs focus:ring-1 focus:ring-blue-500"
                    required
                    aria-invalid={showValidation && !addName.trim()}
                />
                <input type="text" placeholder="Notes" value={addNote} onChange={e => setAddNote(e.target.value)}
                    className="w-32 px-2 py-1 border border-[var(--border-input)] rounded-lg text-xs focus:ring-1 focus:ring-blue-500" />
                <button type="submit" disabled={saving} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs hover:bg-blue-200 disabled:opacity-60">
                    {saving ? "…" : "+Add"}
                </button>
            </form>
        </div>
    );
}

// ─── Route Modal ──────────────────────────────────────
function RouteModal({ initial, companies, onClose, onSave, defaultCompanyId }: {
    initial?: BoatRoute; companies: BoatCompany[]; onClose: () => void; onSave: () => void; defaultCompanyId?: string;
}) {
    const [companyId, setCompanyId] = useState(initial?.company_id ?? defaultCompanyId ?? "");
    const [origin, setOrigin] = useState(initial?.origin ?? "");
    const [destination, setDestination] = useState(initial?.destination ?? "");
    const [boatType, setBoatType] = useState(initial?.boat_type ?? "speedboat");
    const [departureTimes, setDepartureTimes] = useState<string[]>(normalizeTimeArray(initial?.departure_times ?? []));
    const [departurePierId, setDeparturePierId] = useState(initial?.departure_pier_id ?? "");
    const [durationMin, setDurationMin] = useState(String(initial?.duration_minutes ?? ""));
    const [ticketPrice, setTicketPrice] = useState(String(initial?.ticket_price ?? ""));
    const [costPrice, setCostPrice] = useState(String(initial?.cost_price ?? ""));
    const [includesPickup, setIncludesPickup] = useState(initial?.includes_pickup ?? false);
    const [pickupFee, setPickupFee] = useState(String(initial?.pickup_fee ?? ""));
    const [seasonLabel, setSeasonLabel] = useState(initial?.season_label ?? "");
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    const selectedCompany = companies.find(c => c.id === companyId);
    const piers = selectedCompany?.piers ?? [];

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setShowValidation(true);
        if (!companyId) { setError("Company is required"); return; }
        if (!origin.trim()) { setError("Origin is required"); return; }
        if (!destination.trim()) { setError("Destination is required"); return; }
        if (departureTimes.length === 0) { setError("At least one departure time is required"); return; }
        setSaving(true); setError("");
        try {
            const normalizedDepartureTimes = normalizeTimeArray(departureTimes);
            if (normalizedDepartureTimes.length === 0) {
                setError("Departure times must be valid HH:MM.");
                return;
            }

            const payload = {
                company_id: companyId,
                origin: origin.trim(),
                destination: destination.trim(),
                boat_type: boatType,
                departure_times: normalizedDepartureTimes,
                departure_pier_id: departurePierId || null,
                duration_minutes: parseNumberOrNull(durationMin),
                ticket_price: parseNumberOrNull(ticketPrice),
                cost_price: parseNumberOrNull(costPrice),
                includes_pickup: includesPickup,
                pickup_fee: parseNumberOrNull(pickupFee),
                season_label: seasonLabel.trim() || null,
                notes: notes.trim() || null,
            };
            const res = await fetch(
                initial ? `/api/transportation/routes/${initial.id}` : "/api/transportation/routes",
                { method: initial ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
            );
            const json = await res.json();
            if (!json.success) {
                const detailMsg = firstValidationMessage(json.details);
                throw new Error(detailMsg ?? json.error ?? "Failed");
            }
            onSave();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error");
        } finally { setSaving(false); }
    }

    const inputCls = "w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <form onSubmit={handleSubmit} className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5">{initial ? "Edit Route" : "Add Route"}</h2>
                {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

                <div className="space-y-4">
                    {/* Company */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Company *</label>
                        <select
                            value={companyId}
                            onChange={e => { setCompanyId(e.target.value); setDeparturePierId(""); }}
                            className={inputCls}
                            required
                            aria-invalid={showValidation && !companyId}
                        >
                            <option value="">— Select company —</option>
                            {companies.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Origin" required invalid={showValidation && !origin.trim()} value={origin} onChange={setOrigin} placeholder="e.g. Island A" />
                        <Field label="Destination" required invalid={showValidation && !destination.trim()} value={destination} onChange={setDestination} placeholder="e.g. Island C" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Boat Type</label>
                            <select value={boatType} onChange={e => setBoatType(e.target.value)} className={inputCls}>
                                {["speedboat", "ferry", "catamaran", "longtail", "private", "other"].map(t => <option key={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Departure Pier</label>
                            <select value={departurePierId} onChange={e => setDeparturePierId(e.target.value)} className={inputCls} disabled={piers.length === 0}>
                                <option value="">{piers.length === 0 ? "— No piers on file —" : "— Any pier —"}</option>
                                {piers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <DepartureTimesInput
                        times={departureTimes}
                        onChange={setDepartureTimes}
                        invalid={showValidation && departureTimes.length === 0}
                    />

                    <div className="grid grid-cols-3 gap-3">
                        <Field label="Duration (min)" value={durationMin} onChange={setDurationMin} placeholder="90" type="number" />
                        <Field label="Ticket Price ฿" value={ticketPrice} onChange={setTicketPrice} placeholder="600" type="number" />
                        <Field label="Cost Price ฿" value={costPrice} onChange={setCostPrice} placeholder="450" type="number" />
                    </div>

                    <div className="flex items-center gap-3 py-2">
                        <input type="checkbox" id="includes_pickup" checked={includesPickup} onChange={e => setIncludesPickup(e.target.checked)} className="rounded" />
                        <label htmlFor="includes_pickup" className="text-sm text-[var(--text-secondary)]">Includes hotel pickup</label>
                        {includesPickup && (
                            <div className="ml-auto">
                                <Field label="Pickup Fee ฿ (extra)" value={pickupFee} onChange={setPickupFee} placeholder="0" type="number" />
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Season Label" value={seasonLabel} onChange={setSeasonLabel} placeholder="e.g. High Season" />
                    </div>
                    <Field label="Notes" value={notes} onChange={setNotes} placeholder="Internal notes" textarea />
                </div>

                <div className="flex gap-3 mt-6">
                    <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">Cancel</button>
                    <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-60">
                        {saving ? "Saving…" : "Save Route"}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────
export default function BoatTicketsPage() {
    const [viewTab, setViewTab] = useState<ViewTab>("timetable");
    const [routes, setRoutes] = useState<BoatRoute[]>([]);
    const [companies, setCompanies] = useState<BoatCompany[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [filterCompany, setFilterCompany] = useState("");
    const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

    // Modals
    const [companyModal, setCompanyModal] = useState<{ open: boolean; editing?: BoatCompany }>({ open: false });
    const [routeModal, setRouteModal] = useState<{ open: boolean; editing?: BoatRoute; defaultCompanyId?: string }>({ open: false });

    const fetchData = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const [rRes, cRes] = await Promise.allSettled([
                fetch("/api/transportation/routes?is_active=all", { cache: "no-store" }).then(async (r) => {
                    const json = await r.json();
                    if (!r.ok || !json?.success) throw new Error(json?.error ?? "routes API failed");
                    return json;
                }),
                fetch("/api/transportation/companies?is_active=all", { cache: "no-store" }).then(async (r) => {
                    const json = await r.json();
                    if (!r.ok || !json?.success) throw new Error(json?.error ?? "companies API failed");
                    return json;
                }),
            ]);

            const failed: string[] = [];
            if (rRes.status === "fulfilled") setRoutes(rRes.value.routes ?? []);
            else {
                setRoutes([]);
                failed.push(`routes (${rRes.reason?.message ?? "unknown error"})`);
            }

            if (cRes.status === "fulfilled") setCompanies(cRes.value.companies ?? []);
            else {
                setCompanies([]);
                failed.push(`companies (${cRes.reason?.message ?? "unknown error"})`);
            }

            if (failed.length > 0) {
                setLoadError(`Failed to load: ${failed.join(", ")}`);
            }
        } catch (err) {
            console.error(err);
            setRoutes([]);
            setCompanies([]);
            setLoadError(err instanceof Error ? err.message : "Failed to load data");
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    async function deactivateRoute(id: string) {
        if (!confirm("Deactivate this route?")) return;
        await fetch(`/api/transportation/routes/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) });
        fetchData();
    }
    async function deactivateCompany(id: string) {
        if (!confirm("Deactivate this company? Routes will still exist but be hidden.")) return;
        await fetch(`/api/transportation/companies/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) });
        fetchData();
    }

    const activeRoutes = routes.filter(r => r.is_active && (!filterCompany || r.company_id === filterCompany));
    const grouped = activeRoutes.reduce<Record<string, { company: BoatCompany | undefined; routes: BoatRoute[] }>>((acc, r) => {
        const key = r.company_id;
        if (!acc[key]) acc[key] = { company: companies.find(c => c.id === key), routes: [] };
        acc[key].routes.push(r);
        return acc;
    }, {});

    return (
        <div className="p-6 max-w-[1400px] mx-auto">
            {/* Modals */}
            {companyModal.open && (
                <CompanyModal
                    initial={companyModal.editing}
                    onClose={() => setCompanyModal({ open: false })}
                    onSave={() => { setCompanyModal({ open: false }); fetchData(); }}
                />
            )}
            {routeModal.open && (
                <RouteModal
                    initial={routeModal.editing}
                    companies={companies}
                    defaultCompanyId={routeModal.defaultCompanyId}
                    onClose={() => setRouteModal({ open: false })}
                    onSave={() => { setRouteModal({ open: false }); fetchData(); }}
                />
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">⛵ Boat Tickets & Timetable</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Manage companies, piers, routes, and schedules</p>
                </div>
                <div className="flex items-center gap-3">
                    {viewTab === "timetable" ? (
                        <button onClick={() => setRouteModal({ open: true })} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
                            + Add Route
                        </button>
                    ) : (
                        <button onClick={() => setCompanyModal({ open: true })} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
                            + Add Company
                        </button>
                    )}
                </div>
            </div>

            {/* View tabs */}
            <div className="flex gap-1 mb-6 bg-[var(--bg-muted)] rounded-xl p-1 w-fit">
                {([["timetable", "📅 Timetable"], ["companies", "🏢 Companies"]] as [ViewTab, string][]).map(([t, label]) => (
                    <button key={t} onClick={() => setViewTab(t)}
                        className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${viewTab === t ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]"}`}>
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                </div>
            ) : viewTab === "timetable" ? (
                /* ── Timetable view ── */
                <div className="space-y-6">
                    {loadError && (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {loadError}
                        </div>
                    )}
                    {/* Company filter */}
                    <div>
                        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
                            className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm focus:ring-2 focus:ring-blue-500 w-56">
                            <option value="">All Companies</option>
                            {companies.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>

                    {Object.keys(grouped).length === 0 ? (
                        <div className="text-center py-20 text-[var(--text-muted)]">
                            <p className="text-lg">No routes configured</p>
                            <button onClick={() => setRouteModal({ open: true })} className="mt-2 text-blue-600 text-sm">Add the first route →</button>
                        </div>
                    ) : Object.entries(grouped).map(([companyId, { company, routes: compRoutes }]) => (
                        <div key={companyId} className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] overflow-hidden shadow-sm">
                            <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-4 border-b border-[var(--border-default)]">
                                <h2 className="text-base font-bold text-blue-900">⛵ {company?.name ?? "Unknown Company"}</h2>
                                <button onClick={() => setRouteModal({ open: true, defaultCompanyId: companyId })}
                                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Add Route</button>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Route</th>
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Pier</th>
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Departures</th>
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Duration</th>
                                        <th className="px-4 py-2 text-right font-semibold text-[var(--text-secondary)]">Ticket ฿</th>
                                        <th className="px-4 py-2 text-right font-semibold text-[var(--text-secondary)]">Cost ฿</th>
                                        <th className="px-4 py-2 text-left font-semibold text-[var(--text-secondary)]">Pickup</th>
                                        <th className="px-4 py-2 text-center font-semibold text-[var(--text-secondary)]">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {compRoutes.map(r => (
                                        <tr key={r.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-body)] transition-colors">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-[var(--text-primary)]">{r.origin}</p>
                                                <p className="text-xs text-[var(--text-muted)]">→ {r.destination}</p>
                                            </td>
                                            <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{r.departure_pier_name ?? "—"}</td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">{r.boat_type}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {(r.departure_times ?? []).map(t => (
                                                        <span key={t} className="inline-flex px-1.5 py-0.5 rounded bg-[var(--bg-muted)] text-[var(--text-table-cell)] font-mono text-xs">{t}</span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{r.duration_minutes ? `${r.duration_minutes}m` : "—"}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm">{r.ticket_price != null ? r.ticket_price.toLocaleString() : "—"}</td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text-muted)]">{r.cost_price != null ? r.cost_price.toLocaleString() : "—"}</td>
                                            <td className="px-4 py-3 text-xs">
                                                {r.includes_pickup ? <span className="text-green-600">✓{r.pickup_fee ? ` +฿${r.pickup_fee}` : ""}</span> : <span className="text-[var(--text-muted)]">No</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button onClick={() => setRouteModal({ open: true, editing: r })}
                                                        className="px-2 py-1 text-xs border border-[var(--border-input)] rounded-lg hover:bg-[var(--bg-body)]">Edit</button>
                                                    <button onClick={() => deactivateRoute(r.id)}
                                                        className="px-2 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50">Disable</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            ) : (
                /* ── Companies view ── */
                <div className="space-y-4">
                    {companies.length === 0 ? (
                        <div className="text-center py-20 text-[var(--text-muted)]">
                            <p className="text-lg">No companies yet</p>
                            <button onClick={() => setCompanyModal({ open: true })} className="mt-2 text-blue-600 text-sm">Add the first company →</button>
                        </div>
                    ) : companies.map(c => (
                        <div key={c.id} className={`bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] shadow-sm overflow-hidden ${!c.is_active ? "opacity-60" : ""}`}>
                            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
                                <div>
                                    <h3 className="font-bold text-[var(--text-primary)]">{c.name}</h3>
                                    <div className="flex gap-4 mt-1 text-xs text-[var(--text-muted)]">
                                        {c.contact_phone && <span>📞 {c.contact_phone}</span>}
                                        {c.contact_line && <span>LINE: {c.contact_line}</span>}
                                        {c.contact_whatsapp && <span>WA: {c.contact_whatsapp}</span>}
                                        {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{c.website}</a>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                                        {c.is_active ? "Active" : "Inactive"}
                                    </span>
                                    <button onClick={() => setCompanyModal({ open: true, editing: c })}
                                        className="px-3 py-1 text-xs border border-[var(--border-input)] rounded-lg hover:bg-[var(--bg-body)]">Edit</button>
                                    <button onClick={() => setExpandedCompany(expandedCompany === c.id ? null : c.id)}
                                        className="px-3 py-1 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50">
                                        {expandedCompany === c.id ? "Hide Piers" : `Piers (${c.piers.length})`}
                                    </button>
                                    {c.is_active && (
                                        <button onClick={() => deactivateCompany(c.id)}
                                            className="px-3 py-1 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50">Deactivate</button>
                                    )}
                                </div>
                            </div>
                            {expandedCompany === c.id && (
                                <div className="px-6 py-4 bg-[var(--bg-body)]">
                                    <PierManager company={c} onUpdate={fetchData} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
