"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ─── Types ────────────────────────────────────── */
type RoomRow = {
    room_id: string;
    room_number: string;
    rates: Record<string, number | null>; // date → price
};

type RoomTypeGroup = {
    type_id: string;
    type_name: string;
    type_code: string;
    rooms: RoomRow[];
};

type RatesData = {
    success: boolean;
    start_date: string;
    end_date: string;
    days: string[];
    room_types: RoomTypeGroup[];
};

/* ─── helpers ───────────────────────────────────── */
function addDays(date: string, n: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + n);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function today() { return new Date().toISOString().slice(0, 10); }

function dayLabel(date: string) {
    const d = new Date(date + "T00:00:00");
    return { d: d.getDate(), dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()], isWeekend: d.getDay() === 0 || d.getDay() === 6 };
}

function fmt(n: number | null) {
    if (n === null) return "—";
    return n.toLocaleString("th-TH");
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ─── Inline editable cell ──────────────────────── */
function PriceCell({
    price, onSave, weekend, isToday
}: {
    price: number | null;
    onSave: (p: number) => Promise<void>;
    weekend: boolean;
    isToday: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(String(price ?? ""));
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

    async function commit() {
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) { setEditing(false); setVal(String(price ?? "")); return; }
        setSaving(true);
        await onSave(num);
        setSaving(false);
        setEditing(false);
    }

    const baseClass = `h-full w-full flex items-center justify-center text-xs font-semibold transition cursor-pointer
    ${isToday ? "bg-brand-50" : weekend ? "bg-rose-50/60" : "bg-white"}
    ${price === null ? "text-slate-300" : "text-slate-800"}
    hover:bg-brand-100`;

    if (saving) return <div className={baseClass}><span className="animate-spin text-brand-500">↻</span></div>;

    if (editing) {
        return (
            <div className={`h-full w-full flex items-center justify-center ${isToday ? "bg-brand-50" : weekend ? "bg-rose-50" : "bg-white"}`}>
                <input
                    ref={inputRef}
                    className="w-full text-center text-xs font-bold border-0 outline-none bg-transparent text-brand-700"
                    value={val}
                    onChange={(e) => setVal(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
                />
            </div>
        );
    }

    return (
        <div className={baseClass} onClick={() => { setEditing(true); setVal(String(price ?? "")); }}>
            {price === null ? <span className="text-[10px] text-slate-300">+ Set</span> : `฿${fmt(price)}`}
        </div>
    );
}

/* ─── Bulk Update Modal ──────────────────────────── */
function BulkUpdateModal({
    roomTypes,
    startDate,
    endDate,
    onClose,
    onSuccess
}: {
    roomTypes: RoomTypeGroup[];
    startDate: string;
    endDate: string;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [typeId, setTypeId] = useState(roomTypes[0]?.type_id ?? "");
    const [from, setFrom] = useState(startDate);
    const [to, setTo] = useState(endDate);
    const [price, setPrice] = useState("");
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [error, setError] = useState("");

    function toggleDay(d: number) {
        setWeekdays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(""); setMsg("");
        const num = parseFloat(price);
        if (isNaN(num) || num < 0) { setError("Please enter a valid price"); return; }
        setLoading(true);
        try {
            const res = await fetch("/api/rates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_type_id: typeId,
                    start_date: from,
                    end_date: to,
                    weekdays,
                    price: num
                })
            });
            const d = await res.json();
            if (res.ok) {
                setMsg(`✓ Updated ${d.total_rows} items (${d.updated_rooms} rooms × ${d.updated_dates} days)`);
                setTimeout(() => { onSuccess(); onClose(); }, 1200);
            } else {
                setError(d.error ?? "An error occurred");
            }
        } finally {
            setLoading(false);
        }
    }

    const selectedType = roomTypes.find((t) => t.type_id === typeId);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-panel max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="text-lg font-bold">Bulk Rate Update</h2>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>
                <form onSubmit={handleSubmit} className="modal-body space-y-4">
                    {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
                    {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

                    {/* Room Type */}
                    <div>
                        <label className="form-label">Room Type</label>
                        <select className="form-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                            {roomTypes.map((t) => (
                                <option key={t.type_id} value={t.type_id}>
                                    {t.type_name} ({t.rooms.length} rooms)
                                </option>
                            ))}
                        </select>
                        {selectedType && (
                            <p className="text-xs text-slate-400 mt-1">
                                Rooms: {selectedType.rooms.map((r) => r.room_number).join(", ")}
                            </p>
                        )}
                    </div>

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="form-label">From Date</label>
                            <input type="date" className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} required />
                        </div>
                        <div>
                            <label className="form-label">To Date</label>
                            <input type="date" className="form-input" value={to} onChange={(e) => setTo(e.target.value)} required />
                        </div>
                    </div>

                    {/* Weekday filter */}
                    <div>
                        <label className="form-label">Specific Days (if none selected = everyday)</label>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                            {WEEKDAY_LABELS.map((label, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => toggleDay(i)}
                                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition
                    ${weekdays.includes(i)
                                            ? (i === 0 || i === 6 ? "border-rose-500 bg-rose-500 text-white" : "border-brand-500 bg-brand-600 text-white")
                                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                        }
                  `}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {weekdays.length > 0 && (
                            <p className="text-xs text-slate-400 mt-1">
                                Selected: {weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")}
                            </p>
                        )}
                    </div>

                    {/* Price */}
                    <div>
                        <label className="form-label">Price (THB/night) *</label>
                        <div className="relative">
                            <span className="absolute left-3 top-2.5 text-sm text-slate-400">฿</span>
                            <input
                                required
                                type="number"
                                min="0"
                                step="0.01"
                                className="form-input pl-7"
                                placeholder="e.g. 590"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
                            {loading ? "Updating..." : "🚀 Update Rates"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

/* ─── Main page ─────────────────────────────────── */
const COL_W = 68;   // px per day
const ROW_H = 36;   // px per room row
const LABEL_W = 100; // frozen left column

export default function RatesPage() {
    const t = today();
    const [startDate, setStartDate] = useState(t);
    const [spanDays, setSpanDays] = useState(30);
    const endDate = addDays(startDate, spanDays - 1);

    const [data, setData] = useState<RatesData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [showBulk, setShowBulk] = useState(false);
    const [toast, setToast] = useState("");

    const scrollRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setLoading(true); setError("");
        try {
            const res = await fetch(`/api/rates?start=${startDate}&end=${endDate}`);
            const d = await res.json();
            if (d.success) setData(d);
            else setError(d.error ?? "Failed to load data");
        } catch { setError("Network error"); }
        finally { setLoading(false); }
    }, [startDate, endDate]);

    useEffect(() => { load(); }, [load]);

    // Scroll to today on first load
    useEffect(() => {
        if (!loading && scrollRef.current && data) {
            const idx = data.days.indexOf(t);
            if (idx > 0) scrollRef.current.scrollLeft = idx * COL_W - 40;
        }
    }, [loading, data, t]);

    function showToast(msg: string) {
        setToast(msg); setTimeout(() => setToast(""), 3000);
    }

    async function updateSingleRate(roomId: string, date: string, price: number) {
        try {
            // Find the room_type_id for this room so we can call the bulk API with just one room
            // Actually we'll call a targeted upsert via a special POST
            const res = await fetch("/api/rates/single", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: roomId, date, price })
            });
            if (res.ok) {
                setData((prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        room_types: prev.room_types.map((rt) => ({
                            ...rt,
                            rooms: rt.rooms.map((r) =>
                                r.room_id === roomId ? { ...r, rates: { ...r.rates, [date]: price } } : r
                            )
                        }))
                    };
                });
                showToast(`✓ Rate updated`);
            } else {
                const d = await res.json();
                showToast(`Error: ${d.error}`);
            }
        } catch { showToast("Network error"); }
    }

    const days = data?.days ?? [];
    const totalW = days.length * COL_W;

    const todayDate = t;
    const monthLabel = (() => {
        if (days.length === 0) return "";
        const first = new Date(days[0] + "T00:00:00");
        return first.toLocaleDateString("th-TH", { month: "long", year: "numeric" });
    })();

    return (
        <div className="flex flex-col gap-4 max-w-full">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Revenue</p>
                    <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Daily Rate Grid</h1>
                    {monthLabel && <p className="text-sm text-slate-400 mt-0.5">{monthLabel}</p>}
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
                    <button className="btn btn-primary" onClick={() => setShowBulk(true)}>
                        🚀 Bulk Update
                    </button>
                </div>
            </div>

            {/* Controls */}
            <div className="card p-3 flex flex-wrap items-center gap-3">
                <div className="flex gap-1">
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(addDays(startDate, -7))}>‹ 7D</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(t)}>Today</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setStartDate(addDays(startDate, 7))}>7D ›</button>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">Start</label>
                    <input type="date" className="form-input py-1 text-sm w-36" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-500">Span</label>
                    {[14, 30, 60, 90].map((n) => (
                        <button key={n} onClick={() => setSpanDays(n)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${spanDays === n ? "border-brand-400 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                        >{n}D</button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-rose-200 inline-block" />Weekend</span>
                    <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded bg-brand-100 inline-block" />Today</span>
                    <span className="text-slate-300">Click cell to edit rate</span>
                </div>
            </div>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {/* Grid */}
            <div className="card overflow-hidden">
                <div className="flex">
                    {/* Frozen label column */}
                    <div className="flex-shrink-0 border-r border-slate-200 z-10" style={{ width: LABEL_W }}>
                        {/* Header spacer */}
                        <div className="border-b border-slate-200 bg-slate-50" style={{ height: ROW_H }}>
                            <div className="h-full flex items-center px-3 text-[10px] font-bold uppercase text-slate-400">Room</div>
                        </div>
                        {loading
                            ? Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="border-b border-slate-100 flex items-center px-3" style={{ height: ROW_H }}>
                                    <div className="h-3 w-16 rounded bg-slate-200 animate-pulse" />
                                </div>
                            ))
                            : (data?.room_types ?? []).flatMap((rt) => [
                                // Room type header
                                <div key={`th-${rt.type_id}`}
                                    className="border-b border-slate-200 bg-slate-800 flex items-center px-3"
                                    style={{ height: ROW_H }}
                                >
                                    <span className="text-[10px] font-bold text-white">{rt.type_name}</span>
                                </div>,
                                // Individual room rows
                                ...rt.rooms.map((room) => (
                                    <div key={room.room_id}
                                        className="border-b border-slate-100 flex items-center px-3 bg-white"
                                        style={{ height: ROW_H }}
                                    >
                                        <span className="text-sm font-bold text-slate-800">{room.room_number}</span>
                                    </div>
                                ))
                            ])
                        }
                    </div>

                    {/* Scrollable date grid */}
                    <div ref={scrollRef} className="overflow-x-auto flex-1">
                        <div style={{ width: totalW, minWidth: totalW }}>
                            {/* Date header */}
                            <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-10" style={{ height: ROW_H }}>
                                {days.map((day) => {
                                    const { d, dow, isWeekend } = dayLabel(day);
                                    const isToday = day === todayDate;
                                    return (
                                        <div key={day}
                                            className={`flex-shrink-0 flex flex-col items-center justify-center border-r border-slate-200 text-center select-none
                        ${isToday ? "bg-brand-100" : isWeekend ? "bg-rose-50" : ""}`}
                                            style={{ width: COL_W }}
                                        >
                                            <span className={`text-[9px] font-bold ${isWeekend ? "text-rose-500" : "text-slate-400"}`}>{dow}</span>
                                            <span className={`text-sm font-bold leading-none ${isToday ? "text-brand-700" : isWeekend ? "text-rose-600" : "text-slate-700"}`}>{d}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Data rows */}
                            {loading
                                ? Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="flex border-b border-slate-100" style={{ height: ROW_H }}>
                                        {Array.from({ length: Math.min(days.length, 10) }).map((_, j) => (
                                            <div key={j} className="flex-shrink-0 border-r border-slate-100 animate-pulse bg-slate-100 m-0.5 rounded" style={{ width: COL_W - 2 }} />
                                        ))}
                                    </div>
                                ))
                                : (data?.room_types ?? []).flatMap((rt) => [
                                    // Room type header row — shows avg per day
                                    <div key={`th-${rt.type_id}`} className="flex border-b border-slate-200 bg-slate-800" style={{ height: ROW_H }}>
                                        {days.map((day) => {
                                            const isWeekend = dayLabel(day).isWeekend;
                                            const isToday = day === todayDate;
                                            // avg price for this type/day
                                            const prices = rt.rooms.map((r) => r.rates[day]).filter((p): p is number => p !== null);
                                            const avg = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
                                            return (
                                                <div key={day}
                                                    className={`flex-shrink-0 border-r border-slate-700 flex items-center justify-center text-[11px] font-bold
                              ${isToday ? "bg-brand-900/40" : isWeekend ? "bg-rose-900/20" : ""}`}
                                                    style={{ width: COL_W }}
                                                >
                                                    <span className="text-slate-300">{avg !== null ? `฿${avg.toLocaleString("th-TH")}` : "—"}</span>
                                                </div>
                                            );
                                        })}
                                    </div>,

                                    // Individual room rows
                                    ...rt.rooms.map((room) => (
                                        <div key={room.room_id} className="flex border-b border-slate-100" style={{ height: ROW_H }}>
                                            {days.map((day) => {
                                                const { isWeekend } = dayLabel(day);
                                                const isToday = day === todayDate;
                                                return (
                                                    <div key={day} className="flex-shrink-0 border-r border-slate-100" style={{ width: COL_W, height: ROW_H }}>
                                                        <PriceCell
                                                            price={room.rates[day]}
                                                            weekend={isWeekend}
                                                            isToday={isToday}
                                                            onSave={(p) => updateSingleRate(room.room_id, day, p)}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))
                                ])
                            }
                        </div>
                    </div>
                </div>

                {/* Footer summary */}
                {data && !loading && (
                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 flex gap-6 text-xs text-slate-500">
                        <span>{data.room_types.reduce((a, rt) => a + rt.rooms.length, 0)} rooms</span>
                        <span>{data.days.length} days ({startDate} → {endDate})</span>
                        <span className="ml-auto text-slate-400 italic">Click any price cell to edit individually</span>
                    </div>
                )}
            </div>

            {/* Bulk update modal */}
            {showBulk && data && (
                <BulkUpdateModal
                    roomTypes={data.room_types}
                    startDate={startDate}
                    endDate={endDate}
                    onClose={() => setShowBulk(false)}
                    onSuccess={() => { load(); showToast("✓ Rates successfully updated!"); }}
                />
            )}

            {toast && (
                <div className="toast-bar toast-success fixed bottom-6 right-6 z-50">{toast}</div>
            )}
        </div>
    );
}
