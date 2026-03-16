"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type BedType = { code: string; name: string; width_ft: number };
type RoomBed = { bed_type_code: string; quantity: number };

type RoomDetail = {
    ac_base: number; furniture_base: number; bathroom_base: number; wifi_base: number;
    ac_deduct: number; furniture_deduct: number; bathroom_deduct: number; wifi_deduct: number;
    quality_score: number;
    ac_model?: string; last_renovated?: string; tv_size_inch?: number;
    floor_number?: number; extra_notes?: string;
};

type Deduction = { id: string; category: string; label: string; deduct_points: number };
type DeductTemplate = { id: string; category: string; label: string; deduct_points: number };

type Room = {
    id: string;
    room_number: string;
    room_type: string;
    room_type_code: string;
    room_type_id: string | number;
    max_guests: number;
    is_sellable: boolean;
    features: string[];
    beds: RoomBed[];
    detail: RoomDetail | null;
    deductions: Deduction[];
    quality_score: number | null;
    total_nights: number;
};

type RoomFeature = { code: string; name: string; category: string };
type AmenityItem = {
    id?: string;
    room_type_code: string;
    item_name: string;
    default_quantity: number;
    category: string;
    sort_order?: number;
    is_active?: boolean;
    product_id?: string | null;
};
type AmenityProduct = {
    id: string;
    name: string;
    category: "amenity" | "pos" | "both";
    unit: string;
    is_active: boolean;
};
type RoomTypeTiming = {
    id: number;
    code: string;
    name_en: string;
    cleaning_duration_min: number;
};

const BED_TYPES: BedType[] = [
    { code: "KING", name: "King 6ft", width_ft: 6 },
    { code: "QUEEN", name: "Queen 5ft", width_ft: 5 },
    { code: "SINGLE", name: "Single 3.5ft", width_ft: 3.5 },
];

const CONDITION_CATEGORIES = [
    { key: "ac", label: "🌬 แอร์", base_key: "ac_base", deduct_key: "ac_deduct" },
    { key: "furniture", label: "🛋 เฟอร์นิเจอร์", base_key: "furniture_base", deduct_key: "furniture_deduct" },
    { key: "bathroom", label: "🚿 ห้องน้ำ", base_key: "bathroom_base", deduct_key: "bathroom_deduct" },
    { key: "wifi", label: "📶 WiFi", base_key: "wifi_base", deduct_key: "wifi_deduct" },
] as const;

function qualityColor(score: number | null) {
    if (!score) return "text-[var(--text-muted)]";
    if (score >= 8) return "text-emerald-600";
    if (score >= 6) return "text-amber-500";
    return "text-rose-500";
}

function qualityBadge(score: number | null) {
    if (!score) return "⬜";
    if (score >= 8) return "✅";
    if (score >= 6) return "🟡";
    return "🔴";
}

// ── Room Card ──────────────────────────────────────────────────────────────

function RoomCard({
    room,
    features: allFeatures,
    deductTemplates,
    amenitiesByRoomType,
    avgNights,
    onOpenAmenitySetup,
}: {
    room: Room;
    features: RoomFeature[];
    deductTemplates: DeductTemplate[];
    amenitiesByRoomType: Record<string, AmenityItem[]>;
    avgNights: number;
    onOpenAmenitySetup: (roomTypeCode: string) => void;
}) {
    const [open, setOpen] = useState<"beds" | "features" | "condition" | "amenity" | null>(null);
    const [beds, setBeds] = useState<RoomBed[]>(room.beds);
    const [localFeatures, setLocalFeatures] = useState<string[]>(room.features);
    const [detail, setDetail] = useState<Partial<RoomDetail>>(room.detail || {
        ac_base: 5, furniture_base: 5, bathroom_base: 5, wifi_base: 5,
        ac_deduct: 0, furniture_deduct: 0, bathroom_deduct: 0, wifi_deduct: 0,
    });
    const [deductions, setDeductions] = useState<Deduction[]>(room.deductions ?? []);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");

    // Deduction picker state
    const [deductPicker, setDeductPicker] = useState<string | null>(null); // category
    const [customLabel, setCustomLabel] = useState("");
    const [customPts, setCustomPts] = useState(1);
    const [addingDeduct, setAddingDeduct] = useState(false);

    // Computed quality score (live preview)
    const computedScore = (() => {
        const ac = Math.max(1, (detail.ac_base ?? 5) - (detail.ac_deduct ?? 0));
        const fu = Math.max(1, (detail.furniture_base ?? 5) - (detail.furniture_deduct ?? 0));
        const ba = Math.max(1, (detail.bathroom_base ?? 5) - (detail.bathroom_deduct ?? 0));
        const wi = Math.max(1, (detail.wifi_base ?? 5) - (detail.wifi_deduct ?? 0));
        return ((ac + fu + ba + wi) / 4) * 2;
    })();

    const featuresByCategory = allFeatures.reduce((acc, f) => {
        acc[f.category] = acc[f.category] || [];
        acc[f.category].push(f);
        return acc;
    }, {} as Record<string, RoomFeature[]>);
    const roomAmenities = amenitiesByRoomType[room.room_type_code] ?? [];

    async function saveBeds() {
        setSaving(true);
        const res = await fetch(`/api/setup/rooms/${room.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ beds }),
        });
        const d = await res.json();
        setSaving(false);
        if (d.success) { setMsg("✓ Beds saved"); }
        else setMsg("⚠ " + d.error);
        setTimeout(() => setMsg(""), 3000);
    }

    async function saveDetail() {
        setSaving(true);
        const res = await fetch(`/api/setup/rooms/${room.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ detail }),
        });
        const d = await res.json();
        setSaving(false);
        if (d.success) { setMsg("✓ Condition saved"); }
        else setMsg("⚠ " + d.error);
        setTimeout(() => setMsg(""), 3000);
    }

    async function toggleFeature(featureCode: string, has: boolean) {
        // Optimistic update first
        setLocalFeatures(prev => has ? prev.filter(f => f !== featureCode) : [...prev, featureCode]);
        const res = await fetch("/api/setup/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ room_id: room.id, feature_code: featureCode, action: has ? "remove" : "add" }),
        });
        const d = await res.json();
        // Rollback on error
        if (!d.success) setLocalFeatures(prev => has ? [...prev, featureCode] : prev.filter(f => f !== featureCode));
    }

    async function addDeduction(category: string, label: string, pts: number, templateId?: string) {
        setAddingDeduct(true);
        const res = await fetch(`/api/setup/rooms/${room.id}/deductions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category, label, deduct_points: pts, template_id: templateId }),
        });
        const d = await res.json();
        setAddingDeduct(false);
        if (d.success) {
            setDeductions(prev => [...prev, d.deduction]);
            if (d.updated_detail) {
                setDetail(prev => ({
                    ...prev,
                    [`${category}_deduct`]: d.updated_detail[`${category}_deduct`],
                }));
            }
            setDeductPicker(null);
            setCustomLabel(""); setCustomPts(1);
        }
    }

    async function removeDeduction(id: string, category: string) {
        const res = await fetch(`/api/setup/rooms/${room.id}/deductions?deduction_id=${id}`, { method: "DELETE" });
        const d = await res.json();
        if (d.success) {
            setDeductions(prev => prev.filter(x => x.id !== id));
            if (d.updated_detail) {
                setDetail(prev => ({
                    ...prev,
                    [`${category}_deduct`]: d.updated_detail[`${category}_deduct`],
                }));
            }
        }
    }

    const usagePct = avgNights > 0 ? Math.min(100, (room.total_nights / (avgNights * 1.5)) * 100) : 0;
    const usageDiff = room.total_nights - avgNights;

    return (
        <div className="card overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-body)]/80">
                <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-lg text-[var(--text-primary)]">{room.room_number}</span>
                        <span className="text-sm text-[var(--text-secondary)]">·</span>
                        <span className="text-sm text-[var(--text-secondary)]">{room.room_type}</span>
                        {beds.length > 0 && (
                            <span className="text-xs text-[var(--text-muted)] ml-1">
                                🛏 {beds.map(b => `${b.quantity}×${BED_TYPES.find(bt => bt.code === b.bed_type_code)?.name ?? b.bed_type_code}`).join(", ")}
                            </span>
                        )}
                        {!room.is_sellable && (
                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">DO NOT SELL</span>
                        )}
                    </div>
                    {/* Usage bar */}
                    <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden max-w-[200px]">
                            <div
                                className={`h-full rounded-full transition-all ${usageDiff > 20 ? "bg-rose-400" : usageDiff > 0 ? "bg-amber-400" : "bg-emerald-400"}`}
                                style={{ width: `${usagePct}%` }}
                            />
                        </div>
                        <span className="text-xs text-[var(--text-secondary)]">
                            {room.total_nights} nights
                            {avgNights > 0 && (
                                <span className={usageDiff > 0 ? "text-rose-500" : "text-emerald-500"}>
                                    {" "}({usageDiff >= 0 ? "+" : ""}{Math.round(usageDiff)} vs avg)
                                </span>
                            )}
                        </span>
                    </div>
                </div>
                {/* Quality score badge */}
                <div className="text-right">
                    <div className={`text-2xl font-bold ${qualityColor(computedScore)}`}>
                        {computedScore.toFixed(1)}
                        <span className="text-xs font-normal text-[var(--text-muted)]">/10</span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{qualityBadge(computedScore)} Quality</div>
                </div>
            </div>

            {/* Tab buttons */}
            <div className="flex border-b border-[var(--border-subtle)]">
                {(["beds", "features", "condition", "amenity"] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setOpen(open === tab ? null : tab)}
                        className={`flex-1 py-2 text-xs font-semibold transition-colors ${open === tab
                            ? "bg-brand-50 text-brand-700 border-b-2 border-brand-500"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                            }`}
                    >
                        {tab === "beds" ? "🛏 Beds" : tab === "features" ? "✨ Features" : tab === "condition" ? "📊 Condition" : "💧 Amenity"}
                    </button>
                ))}
            </div>

            {/* ── Beds panel ── */}
            {open === "beds" && (
                <div className="p-4 space-y-3">
                    <p className="text-xs text-[var(--text-secondary)]">เลือกประเภทเตียงและจำนวนในห้องนี้</p>
                    {BED_TYPES.map(bt => {
                        const existing = beds.find(b => b.bed_type_code === bt.code);
                        const checked = !!existing;
                        return (
                            <div key={bt.code} className="flex items-center gap-3">
                                <input type="checkbox" className="h-4 w-4 accent-brand-600"
                                    checked={checked}
                                    onChange={() => {
                                        if (checked) {
                                            setBeds(prev => prev.filter(b => b.bed_type_code !== bt.code));
                                        } else {
                                            setBeds(prev => [...prev, { bed_type_code: bt.code, quantity: 1 }]);
                                        }
                                    }}
                                />
                                <label className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                                    {bt.name}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">({bt.width_ft} ft)</span>
                                </label>
                                {checked && (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            className="h-7 w-7 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)] text-sm font-bold"
                                            onClick={() => setBeds(prev => prev.map(b => b.bed_type_code === bt.code ? { ...b, quantity: Math.max(1, b.quantity - 1) } : b))}
                                        >−</button>
                                        <span className="w-6 text-center text-sm font-semibold">{existing?.quantity}</span>
                                        <button
                                            className="h-7 w-7 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)] text-sm font-bold"
                                            onClick={() => setBeds(prev => prev.map(b => b.bed_type_code === bt.code ? { ...b, quantity: b.quantity + 1 } : b))}
                                        >+</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-between pt-2">
                        {msg && <span className="text-xs text-emerald-600">{msg}</span>}
                        <button className="btn btn-primary text-sm ml-auto" onClick={saveBeds} disabled={saving}>
                            {saving ? "Saving..." : "Save Beds"}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Features panel ── */}
            {open === "features" && (
                <div className="p-4 space-y-4">
                    {Object.entries(featuresByCategory).map(([cat, feats]) => (
                        <div key={cat}>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">{cat}</div>
                            <div className="flex flex-wrap gap-2">
                                {feats.map(f => {
                                    const has = localFeatures.includes(f.code);
                                    return (
                                        <button
                                            key={f.code}
                                            onClick={() => toggleFeature(f.code, has)}
                                            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${has
                                                ? "bg-brand-50 border-brand-200 text-brand-700"
                                                : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                                                }`}
                                        >
                                            {has ? "✓ " : ""}{f.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Amenity panel (read-only per room) ── */}
            {open === "amenity" && (
                <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="text-xs text-[var(--text-secondary)]">
                                Room type <span className="font-semibold text-[var(--text-table-cell)]">{room.room_type_code || "N/A"}</span>
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)]">
                                Amenity settings are managed by Room Type.
                            </p>
                        </div>
                        <button
                            className="btn btn-secondary text-xs"
                            onClick={() => onOpenAmenitySetup(room.room_type_code)}
                        >
                            Setup Amenity
                        </button>
                    </div>

                    {roomAmenities.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[var(--border-input)] bg-[var(--bg-body)] p-4 text-xs text-[var(--text-secondary)]">
                            No amenity configured for this room type yet.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {Object.entries(
                                roomAmenities.reduce((acc, item) => {
                                    const key = item.category || "Amenity";
                                    if (!acc[key]) acc[key] = [];
                                    acc[key].push(item);
                                    return acc;
                                }, {} as Record<string, AmenityItem[]>)
                            ).map(([category, items]) => (
                                <div key={category} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-body)]/60 p-3">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{category}</p>
                                    <div className="mt-2 space-y-1.5">
                                        {items.map((item) => (
                                            <div key={`${category}-${item.item_name}`} className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                                                <span className="text-sm font-medium text-[var(--text-table-cell)] flex items-center gap-1.5">
                                                    {item.item_name}
                                                    {item.product_id && (
                                                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded-full">📦 Inventory Linked</span>
                                                    )}
                                                </span>
                                                <span className="text-xs font-bold text-[var(--text-secondary)]">x{item.default_quantity}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Condition panel ── */}
            {open === "condition" && (
                <div className="p-4 space-y-4">
                    {/* Category rows */}
                    {CONDITION_CATEGORIES.map(cat => {
                        const base = (detail[cat.base_key as keyof RoomDetail] as number) ?? 5;
                        const deductTotal = deductions.filter(d => d.category === cat.key)
                            .reduce((s, d) => s + d.deduct_points, 0);
                        const net = Math.max(1, base - deductTotal);
                        const catDeductions = deductions.filter(d => d.category === cat.key);
                        const catTemplates = deductTemplates.filter(t => t.category === cat.key);

                        return (
                            <div key={cat.key} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-body)]/50 p-3">
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-sm font-semibold text-[var(--text-table-cell)] w-32">{cat.label}</span>
                                    {/* Base score selector */}
                                    <select
                                        className="text-xs border border-[var(--border-default)] rounded px-2 py-1 bg-[var(--bg-surface)]"
                                        value={base}
                                        onChange={e => setDetail(prev => ({ ...prev, [cat.base_key]: Number(e.target.value) }))}
                                    >
                                        {[5, 4, 3, 2, 1].map(v => (
                                            <option key={v} value={v}>Base {v}/5</option>
                                        ))}
                                    </select>
                                    <span className="text-xs text-[var(--text-muted)] flex-1">
                                        {deductTotal > 0 && <span className="text-rose-500">−{deductTotal} pts </span>}
                                    </span>
                                    <span className={`text-sm font-bold ${net >= 4 ? "text-emerald-600" : net >= 3 ? "text-amber-500" : "text-rose-500"}`}>
                                        {net}/5
                                    </span>
                                </div>

                                {/* Applied deductions */}
                                {catDeductions.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {catDeductions.map(d => (
                                            <span key={d.id} className="inline-flex items-center gap-1 text-xs bg-rose-50 border border-rose-100 text-rose-700 rounded-full px-2 py-0.5">
                                                {d.label} (−{d.deduct_points})
                                                <button
                                                    className="text-rose-400 hover:text-rose-600 ml-0.5"
                                                    onClick={() => removeDeduction(d.id, cat.key)}
                                                >×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Add deduction */}
                                {deductPicker === cat.key ? (
                                    <div className="border border-[var(--border-default)] rounded-lg p-3 bg-[var(--bg-surface)] space-y-2">
                                        <p className="text-xs font-semibold text-[var(--text-secondary)]">เลือก Preset หรือพิมพ์ใหม่</p>
                                        {catTemplates.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {catTemplates.map(t => (
                                                    <button
                                                        key={t.id}
                                                        onClick={() => addDeduction(cat.key, t.label, t.deduct_points, t.id)}
                                                        className="text-xs px-2.5 py-1 rounded-full border border-[var(--border-default)] hover:border-brand-300 hover:bg-brand-50 transition-colors"
                                                    >
                                                        {t.label} (−{t.deduct_points})
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="space-y-2 pt-1 border-t border-[var(--border-subtle)] mt-1">
                                            <p className="text-xs text-[var(--text-secondary)]">หรือพิมพ์รายการใหม่:</p>
                                            <input
                                                className="form-input text-sm w-full"
                                                placeholder="เช่น ผนังมีรอยแตก, พื้นลื่น..."
                                                value={customLabel}
                                                onChange={e => setCustomLabel(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter" && customLabel.trim() && !addingDeduct)
                                                        addDeduction(cat.key, customLabel.trim(), customPts);
                                                }}
                                            />
                                            <div className="flex gap-2 items-center">
                                                <select
                                                    className="form-select text-sm w-28"
                                                    value={customPts}
                                                    onChange={e => setCustomPts(Number(e.target.value))}
                                                >
                                                    {[0.5, 1, 1.5, 2, 2.5, 3].map(v => (
                                                        <option key={v} value={v}>−{v} pts</option>
                                                    ))}
                                                </select>
                                                <button
                                                    className="btn btn-primary text-sm px-4"
                                                    disabled={!customLabel.trim() || addingDeduct}
                                                    onClick={() => addDeduction(cat.key, customLabel.trim(), customPts)}
                                                >{addingDeduct ? "..." : "เพิ่ม"}</button>
                                                <button className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]" onClick={() => { setDeductPicker(null); setCustomLabel(""); }}>ยกเลิก</button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                                        onClick={() => setDeductPicker(cat.key)}
                                    >+ Add Deduction</button>
                                )}
                            </div>
                        );
                    })}

                    {/* Equipment fields */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                            <label className="form-label text-xs">รุ่นแอร์</label>
                            <input className="form-input text-sm" placeholder="เช่น Daikin 2020"
                                value={detail.ac_model ?? ""}
                                onChange={e => setDetail(prev => ({ ...prev, ac_model: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label text-xs">ปีปรับปรุงล่าสุด</label>
                            <input className="form-input text-sm" type="date"
                                value={detail.last_renovated ?? ""}
                                onChange={e => setDetail(prev => ({ ...prev, last_renovated: e.target.value }))} />
                        </div>
                        <div>
                            <label className="form-label text-xs">TV ขนาด (นิ้ว)</label>
                            <input className="form-input text-sm" type="number" placeholder="55"
                                value={detail.tv_size_inch ?? ""}
                                onChange={e => setDetail(prev => ({ ...prev, tv_size_inch: Number(e.target.value) || undefined }))} />
                        </div>
                        <div>
                            <label className="form-label text-xs">ชั้น</label>
                            <input className="form-input text-sm" type="number"
                                value={detail.floor_number ?? ""}
                                onChange={e => setDetail(prev => ({ ...prev, floor_number: Number(e.target.value) || undefined }))} />
                        </div>
                        <div className="col-span-2">
                            <label className="form-label text-xs">หมายเหตุ (Admin)</label>
                            <textarea className="form-textarea text-sm" rows={2}
                                placeholder="บันทึกสิ่งที่ต้องจำ เช่น ประตูฝืดนิดหน่อย..."
                                value={detail.extra_notes ?? ""}
                                onChange={e => setDetail(prev => ({ ...prev, extra_notes: e.target.value }))} />
                        </div>
                    </div>

                    {/* Quality preview + save */}
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-[var(--text-secondary)]">Quality Score:</span>
                            <span className={`text-xl font-bold ${qualityColor(computedScore)}`}>
                                {computedScore.toFixed(1)}/10
                            </span>
                            <span>{qualityBadge(computedScore)}</span>
                            {computedScore < 6 && (
                                <span className="text-xs text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">⚠ จะถูกขายท้ายสุด (Auto-Assign)</span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {msg && <span className="text-xs text-emerald-600">{msg}</span>}
                            <button className="btn btn-primary text-sm" onClick={saveDetail} disabled={saving}>
                                {saving ? "Saving..." : "Save Condition"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function RoomsSetupPage() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [features, setFeatures] = useState<RoomFeature[]>([]);
    const [deductTemplates, setDeductTemplates] = useState<DeductTemplate[]>([]);
    const [amenities, setAmenities] = useState<AmenityItem[]>([]);
    const [roomTypeTimings, setRoomTypeTimings] = useState<RoomTypeTiming[]>([]);
    const [roomTypeDurationDrafts, setRoomTypeDurationDrafts] = useState<Record<string, string>>({});
    const [timingSavingId, setTimingSavingId] = useState<string | null>(null);
    const [timingMsg, setTimingMsg] = useState("");
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [amenitySidebarOpen, setAmenitySidebarOpen] = useState(false);
    const [amenityRoomTypeCode, setAmenityRoomTypeCode] = useState("");
    const [amenityDraftItems, setAmenityDraftItems] = useState<AmenityItem[]>([]);
    const [amenityProducts, setAmenityProducts] = useState<AmenityProduct[]>([]);
    const [amenitySaving, setAmenitySaving] = useState(false);
    const [amenityMsg, setAmenityMsg] = useState("");

    // Only show spinner on the very first load; subsequent refreshes are silent
    const initialLoadDone = useRef(false);

    const loadData = useCallback(async () => {
        if (!initialLoadDone.current) setLoading(true);
        const [roomsRes, templatesRes, amenitiesRes, productsRes, roomTypesRes] = await Promise.all([
            fetch("/api/setup/rooms").then(r => r.json()),
            fetch("/api/setup/deduction-templates").then(r => r.json()),
            fetch("/api/setup/amenities").then(r => r.json()),
            fetch("/api/products?is_active=true").then(r => r.json()),
            fetch("/api/setup/room-types").then(r => r.json()),
        ]);
        if (roomsRes.success) {
            setRooms(roomsRes.rooms);
            setFeatures(roomsRes.features);
        }
        if (templatesRes.success) setDeductTemplates(templatesRes.templates);
        if (amenitiesRes.success) setAmenities(amenitiesRes.items ?? []);
        if (productsRes.success) {
            const allProducts = Array.isArray(productsRes.products) ? productsRes.products : [];
            setAmenityProducts(
                allProducts
                    .filter((p: any) => p && (p.category === "amenity" || p.category === "both"))
                    .map((p: any) => ({
                        id: String(p.id),
                        name: String(p.name ?? ""),
                        category: p.category === "both" ? "both" : "amenity",
                        unit: String(p.unit ?? "pcs"),
                        is_active: Boolean(p.is_active),
                    }))
            );
        } else {
            setAmenityProducts([]);
        }
        if (roomTypesRes.success) {
            const timingRows: RoomTypeTiming[] = (Array.isArray(roomTypesRes.room_types) ? roomTypesRes.room_types : [])
                .map((row: any) => ({
                    id: Number(row.id),
                    code: String(row.code ?? ""),
                    name_en: String(row.name_en ?? ""),
                    cleaning_duration_min: Math.max(Number(row.cleaning_duration_min ?? 60), 1),
                }))
                .filter((row: RoomTypeTiming) => Number.isFinite(row.id));
            setRoomTypeTimings(timingRows);
            setRoomTypeDurationDrafts((prev) => {
                const next = { ...prev };
                timingRows.forEach((row: RoomTypeTiming) => {
                    const key = String(row.id);
                    if (next[key] == null) next[key] = String(row.cleaning_duration_min);
                });
                return next;
            });
        }
        setLoading(false);
        initialLoadDone.current = true;
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    const avgNights = rooms.length > 0
        ? rooms.reduce((s, r) => s + r.total_nights, 0) / rooms.length
        : 0;

    const filtered = rooms.filter(r =>
        r.room_number.includes(search) || r.room_type.toLowerCase().includes(search.toLowerCase())
    );

    const roomTypeOptions = useMemo(() => {
        const map = new Map<string, string>();
        rooms.forEach((room) => {
            if (!room.room_type_code) return;
            if (!map.has(room.room_type_code)) map.set(room.room_type_code, room.room_type);
        });
        return Array.from(map.entries())
            .map(([code, name]) => ({ code, name }))
            .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }, [rooms]);

    const amenitiesByRoomType = useMemo(() => {
        const grouped: Record<string, AmenityItem[]> = {};
        for (const item of amenities) {
            if (!item.room_type_code) continue;
            if (!grouped[item.room_type_code]) grouped[item.room_type_code] = [];
            grouped[item.room_type_code].push(item);
        }
        Object.keys(grouped).forEach((key) => {
            grouped[key] = grouped[key].sort((a, b) => {
                const sa = Number(a.sort_order ?? 9999);
                const sb = Number(b.sort_order ?? 9999);
                if (sa !== sb) return sa - sb;
                return a.item_name.localeCompare(b.item_name, undefined, { numeric: true });
            });
        });
        return grouped;
    }, [amenities]);

    useEffect(() => {
        if (amenityRoomTypeCode) return;
        if (roomTypeOptions.length === 0) return;
        setAmenityRoomTypeCode(roomTypeOptions[0].code);
    }, [amenityRoomTypeCode, roomTypeOptions]);

    function openAmenitySidebar(roomTypeCode?: string) {
        const fallbackCode = roomTypeOptions[0]?.code ?? "";
        const targetCode = roomTypeCode || amenityRoomTypeCode || fallbackCode;
        if (!targetCode) return;
        setAmenityRoomTypeCode(targetCode);
        setAmenityDraftItems(
            (amenitiesByRoomType[targetCode] ?? []).map((item) => ({
                id: item.id,
                room_type_code: item.room_type_code,
                item_name: item.item_name,
                default_quantity: item.default_quantity,
                category: item.category || "Amenity",
                sort_order: item.sort_order,
                is_active: true,
                product_id: item.product_id ?? null,
            }))
        );
        setAmenityMsg("");
        setAmenitySidebarOpen(true);
    }

    function addAmenityDraftRow(category: "Amenity" | "Linen" | "Equipment") {
        if (!amenityRoomTypeCode) return;
        setAmenityDraftItems((prev) => [
            ...prev,
            {
                room_type_code: amenityRoomTypeCode,
                item_name: "",
                default_quantity: 1,
                category,
            },
        ]);
    }

    function updateAmenityDraftRow(index: number, patch: Partial<AmenityItem>) {
        setAmenityDraftItems((prev) =>
            prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
        );
    }

    function removeAmenityDraftRow(index: number) {
        setAmenityDraftItems((prev) => prev.filter((_, idx) => idx !== index));
    }

    async function saveAmenitySetup() {
        if (!amenityRoomTypeCode) return;
        const sanitized = amenityDraftItems
            .map((item) => ({
                item_name: item.item_name.trim(),
                default_quantity: Math.max(1, Number(item.default_quantity || 1)),
                category: (item.category || "Amenity").trim() || "Amenity",
                product_id: item.product_id ?? null,
            }))
            .filter((item) => item.item_name.length > 0);

        const duplicateSet = new Set<string>();
        for (const item of sanitized) {
            const key = item.item_name.toLowerCase();
            if (duplicateSet.has(key)) {
                setAmenityMsg(`Duplicate item: ${item.item_name}`);
                return;
            }
            duplicateSet.add(key);
        }

        setAmenitySaving(true);
        try {
            const res = await fetch("/api/setup/amenities", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_type_code: amenityRoomTypeCode,
                    items: sanitized,
                }),
            });
            const data = await res.json().catch(() => ({} as { success?: boolean; error?: string; items?: AmenityItem[] }));
            if (!res.ok || !data.success) {
                setAmenityMsg(data.error ?? "Failed to save amenity.");
                return;
            }

            setAmenities((prev) => {
                const retained = prev.filter((item) => item.room_type_code !== amenityRoomTypeCode);
                return [...retained, ...(data.items ?? [])];
            });
            setAmenityMsg("Amenity saved.");
        } finally {
            setAmenitySaving(false);
        }
    }

    async function saveRoomTypeDuration(roomTypeId: number) {
        const key = String(roomTypeId);
        const parsed = Number(roomTypeDurationDrafts[key] ?? "");
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
            setTimingMsg("Cleaning duration must be an integer between 1 and 600 minutes.");
            return;
        }

        setTimingSavingId(key);
        setTimingMsg("");
        try {
            const res = await fetch("/api/setup/room-types", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_type_id: roomTypeId,
                    cleaning_duration_min: parsed,
                }),
            });
            const data = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
            if (!res.ok || !data.success) {
                setTimingMsg(data.error ?? "Failed to save cleaning duration.");
                return;
            }

            setRoomTypeTimings((prev) =>
                prev.map((row) =>
                    row.id === roomTypeId
                        ? { ...row, cleaning_duration_min: parsed }
                        : row
                )
            );
            setRoomTypeDurationDrafts((prev) => ({ ...prev, [key]: String(parsed) }));
            setTimingMsg("Cleaning duration updated.");
            setTimeout(() => setTimingMsg(""), 2500);
        } finally {
            setTimingSavingId(null);
        }
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6 pb-16">
            {/* Page header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Room Detail & Mapping</h1>
                    <p className="text-[var(--text-secondary)] text-sm mt-0.5">Bed configuration, physical condition, and feature mapping for Auto-Assign scoring</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        className="btn btn-secondary text-sm"
                        onClick={() => openAmenitySidebar()}
                        disabled={roomTypeOptions.length === 0}
                    >
                        Setup Amenity
                    </button>
                    <input
                        className="form-input text-sm w-40"
                        placeholder="Search room..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {/* Legend */}
                    <div className="text-xs text-[var(--text-muted)] space-x-3 hidden sm:flex">
                        <span className="text-emerald-600 font-semibold">✅ 8–10</span>
                        <span className="text-amber-500 font-semibold">🟡 6–8</span>
                        <span className="text-rose-500 font-semibold">🔴 &lt;6</span>
                    </div>
                </div>
            </div>

            {/* Summary stats */}
            {!loading && (
                <div className="grid grid-cols-3 gap-4 text-center">
                    {[
                        { label: "Total Rooms", value: rooms.length },
                        { label: "Avg Nights/Room", value: Math.round(avgNights) },
                        { label: "Avg Quality Score", value: (rooms.reduce((s, r) => s + (r.quality_score ?? 5), 0) / Math.max(rooms.length, 1)).toFixed(1) + "/10" },
                    ].map(stat => (
                        <div key={stat.label} className="card p-4">
                            <div className="text-2xl font-bold text-[var(--text-primary)]">{stat.value}</div>
                            <div className="text-xs text-[var(--text-secondary)] mt-0.5">{stat.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {!loading && (
                <div className="card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                            <h2 className="text-sm font-bold text-[var(--text-primary)]">Housekeeping Cleaning Time by Room Type</h2>
                            <p className="text-xs text-[var(--text-secondary)]">
                                Base cleaning time per room type. System adds maintenance minutes on top automatically in HK Dashboard and Maid App.
                            </p>
                        </div>
                        {timingMsg && (
                            <span className="text-xs font-medium text-emerald-600">{timingMsg}</span>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--border-default)]">
                                    <th className="text-left py-2 pr-2 font-semibold text-[var(--text-secondary)]">Room Type</th>
                                    <th className="text-left py-2 pr-2 font-semibold text-[var(--text-secondary)]">Code</th>
                                    <th className="text-left py-2 pr-2 font-semibold text-[var(--text-secondary)]">Cleaning Duration (min)</th>
                                    <th className="text-right py-2 font-semibold text-[var(--text-secondary)]">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {roomTypeTimings.map((row) => {
                                    const key = String(row.id);
                                    const draftValue = roomTypeDurationDrafts[key] ?? String(row.cleaning_duration_min);
                                    const parsedDraft = Number(draftValue);
                                    const isValidDraft =
                                        Number.isInteger(parsedDraft) && parsedDraft >= 1 && parsedDraft <= 600;
                                    const isChanged = isValidDraft && parsedDraft !== row.cleaning_duration_min;
                                    const isSaving = timingSavingId === key;
                                    return (
                                        <tr key={row.id} className="border-b border-[var(--border-subtle)]">
                                            <td className="py-2 pr-2 font-medium text-[var(--text-primary)]">{row.name_en || "Unknown"}</td>
                                            <td className="py-2 pr-2 text-[var(--text-secondary)]">{row.code || "—"}</td>
                                            <td className="py-2 pr-2">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={600}
                                                    className="form-input w-28 text-sm"
                                                    value={draftValue}
                                                    onChange={(e) =>
                                                        setRoomTypeDurationDrafts((prev) => ({
                                                            ...prev,
                                                            [key]: e.target.value,
                                                        }))
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" && isChanged && !isSaving) {
                                                            void saveRoomTypeDuration(row.id);
                                                        }
                                                    }}
                                                />
                                            </td>
                                            <td className="py-2 text-right">
                                                <button
                                                    className="btn btn-secondary text-xs"
                                                    disabled={!isChanged || !isValidDraft || isSaving}
                                                    onClick={() => void saveRoomTypeDuration(row.id)}
                                                >
                                                    {isSaving ? "Saving..." : "Save"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {roomTypeTimings.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="py-4 text-xs text-[var(--text-secondary)]">
                                            No room types found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="p-12 flex justify-center"><div className="btn-spinner border-brand-500" /></div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(room => (
                        <RoomCard
                            key={room.id}
                            room={room}
                            features={features}
                            deductTemplates={deductTemplates}
                            amenitiesByRoomType={amenitiesByRoomType}
                            avgNights={avgNights}
                            onOpenAmenitySetup={openAmenitySidebar}
                        />
                    ))}
                </div>
            )}

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
                <h3 className="font-bold mb-1">💡 วิธีใช้ Room Condition Scoring</h3>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                    <li>Base score 5/5 = สภาพสมบูรณ์ — ลดลงโดยการเพิ่ม Deduction items</li>
                    <li>Deduction items สามารถเลือก preset หรือพิมพ์รายการเองได้ และจะบันทึกเป็น preset อัตโนมัติ</li>
                    <li>Quality &lt; 6/10 → ห้องจะถูก Auto-Assign ท้ายสุด และ Usage Balance ไม่นับ</li>
                    <li>Usage bar แสดงจำนวน nights สะสมเทียบกับค่าเฉลี่ย — ใช้กระจาย wear ของห้อง</li>
                </ul>
            </div>

            {amenitySidebarOpen && (
                <div className="fixed inset-0 z-50">
                    <div
                        className="absolute inset-0 bg-[var(--overlay-bg)]"
                        onClick={() => setAmenitySidebarOpen(false)}
                    />
                    <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-[var(--bg-surface)] shadow-2xl border-l border-[var(--border-default)] flex flex-col">
                        <div className="px-5 py-4 border-b border-[var(--border-default)] flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-bold text-[var(--text-primary)]">Setup Amenity</h3>
                                <p className="text-xs text-[var(--text-secondary)]">
                                    Configure amenity by room type. Maid finish displays all categories (category hidden).
                                </p>
                            </div>
                            <button
                                className="h-8 w-8 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                onClick={() => setAmenitySidebarOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-5 space-y-4 overflow-y-auto flex-1">
                            <div>
                                <label className="form-label text-xs">Room Type</label>
                                <select
                                    className="form-select text-sm w-full"
                                    value={amenityRoomTypeCode}
                                    onChange={(e) => {
                                        const nextCode = e.target.value;
                                        setAmenityRoomTypeCode(nextCode);
                                        setAmenityDraftItems(
                                            (amenitiesByRoomType[nextCode] ?? []).map((item) => ({
                                                id: item.id,
                                                room_type_code: item.room_type_code,
                                                item_name: item.item_name,
                                                default_quantity: item.default_quantity,
                                                category: item.category || "Amenity",
                                                sort_order: item.sort_order,
                                                is_active: true,
                                                product_id: item.product_id ?? null,
                                            }))
                                        );
                                        setAmenityMsg("");
                                    }}
                                >
                                    {roomTypeOptions.map((option) => (
                                        <option key={option.code} value={option.code}>
                                            {option.code} - {option.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className="btn btn-secondary text-xs"
                                    onClick={() => addAmenityDraftRow("Amenity")}
                                    disabled={!amenityRoomTypeCode}
                                >
                                    + Add Amenity
                                </button>
                                <button
                                    className="btn btn-secondary text-xs"
                                    onClick={() => addAmenityDraftRow("Linen")}
                                    disabled={!amenityRoomTypeCode}
                                >
                                    + Add Linen
                                </button>
                                <button
                                    className="btn btn-secondary text-xs"
                                    onClick={() => addAmenityDraftRow("Equipment")}
                                    disabled={!amenityRoomTypeCode}
                                >
                                    + Add Equipment
                                </button>
                            </div>

                            {amenityDraftItems.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-[var(--border-input)] bg-[var(--bg-body)] p-4 text-xs text-[var(--text-secondary)]">
                                    No amenity items yet. Add Amenity, Linen, or Equipment.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {amenityDraftItems.map((item, idx) => (
                                        <div key={`${item.id ?? "new"}-${idx}`} className="rounded-lg border border-[var(--border-default)] p-3 bg-[var(--bg-body)]/50">
                                            {item.product_id && (
                                                <div className="mb-1.5">
                                                    <span className="text-[9px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded-full">📦 Inventory Linked</span>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-12 gap-2 items-end">
                                                <div className="col-span-4">
                                                    <label className="form-label text-[11px]">Item</label>
                                                    <input
                                                        className="form-input text-sm w-full"
                                                        value={item.item_name}
                                                        placeholder="e.g. Towel, Water bottle, Hair dryer"
                                                        onChange={(e) =>
                                                            updateAmenityDraftRow(idx, { item_name: e.target.value })
                                                        }
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="form-label text-[11px]">Qty</label>
                                                    <input
                                                        className="form-input text-sm w-full"
                                                        type="number"
                                                        min={1}
                                                        max={99}
                                                        value={item.default_quantity}
                                                        onChange={(e) =>
                                                            updateAmenityDraftRow(idx, {
                                                                default_quantity: Math.max(1, Number(e.target.value || 1)),
                                                            })
                                                        }
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="form-label text-[11px]">Category</label>
                                                    <select
                                                        className="form-select text-sm w-full"
                                                        value={item.category || "Amenity"}
                                                        onChange={(e) =>
                                                            updateAmenityDraftRow(idx, { category: e.target.value })
                                                        }
                                                    >
                                                        <option value="Amenity">Amenity</option>
                                                        <option value="Linen">Linen</option>
                                                        <option value="Equipment">Equipment</option>
                                                    </select>
                                                </div>
                                                <div className="col-span-3">
                                                    <label className="form-label text-[11px]">Linked Product</label>
                                                    <select
                                                        className="form-select text-sm w-full"
                                                        value={item.product_id ?? ""}
                                                        onChange={(e) => {
                                                            const selectedProductId = e.target.value || null;
                                                            if (!selectedProductId) {
                                                                updateAmenityDraftRow(idx, { product_id: null });
                                                                return;
                                                            }
                                                            const selectedProduct = amenityProducts.find(
                                                                (p) => p.id === selectedProductId
                                                            );
                                                            updateAmenityDraftRow(idx, {
                                                                product_id: selectedProductId,
                                                                item_name:
                                                                    item.item_name.trim().length > 0
                                                                        ? item.item_name
                                                                        : (selectedProduct?.name ?? ""),
                                                            });
                                                        }}
                                                    >
                                                        <option value="">Not linked</option>
                                                        {amenityProducts.map((product) => (
                                                            <option key={product.id} value={product.id}>
                                                                {product.name} ({product.unit})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="col-span-1 flex justify-end">
                                                    <button
                                                        className="h-9 w-9 rounded border border-rose-200 text-rose-500 hover:bg-rose-50"
                                                        onClick={() => removeAmenityDraftRow(idx)}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-3 border-t border-[var(--border-default)] flex items-center justify-between gap-2">
                            <span className={`text-xs ${amenityMsg.includes("saved") ? "text-emerald-600" : "text-rose-500"}`}>
                                {amenityMsg || " "}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    className="btn btn-secondary text-sm"
                                    onClick={() => setAmenitySidebarOpen(false)}
                                    disabled={amenitySaving}
                                >
                                    Close
                                </button>
                                <button
                                    className="btn btn-primary text-sm"
                                    onClick={() => void saveAmenitySetup()}
                                    disabled={amenitySaving || !amenityRoomTypeCode}
                                >
                                    {amenitySaving ? "Saving..." : "Save Amenity"}
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
}
