"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RateGridResponseV2, RateEditMode, RoomTypeGroup } from "@/lib/rates/types";
import { RateRibbon } from "./_components/RateRibbon";
import { ModeToggle } from "./_components/ModeToggle";
import { occTint } from "./_components/OccHeat";
import { PriceCellV2 } from "./_components/PriceCellV2";
import { FloorGuardModal } from "./_components/FloorGuardModal";
import { DeltaConfirmModal } from "./_components/DeltaConfirmModal";

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        setMsg(`✓ Updated ${d.total_rows} items`);
        onSuccess();
      } else {
        setError(d.error ?? "An error occurred");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  const selectedType = roomTypes.find((t) => t.type_id === typeId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Bulk Rate Update</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body space-y-4">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">{error}</div>}
          {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{msg}</div>}

          <div>
            <label className="form-label">Room Type</label>
            <select className="form-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {roomTypes.map((t) => (
                <option key={t.type_id} value={t.type_id}>
                  {t.type_name} ({t.rooms.length} rooms)
                </option>
              ))}
            </select>
          </div>

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

          <div>
            <label className="form-label">Specific Days</label>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {WEEKDAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    weekdays.includes(i) ? "border-brand-500 bg-brand-600 text-white" : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">Price (THB/night) *</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm text-[var(--text-muted)]">฿</span>
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
              {loading ? "Updating..." : "Update Rates"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────── */
const COL_W = 68;
const ROW_H = 36;
const LABEL_W = 120;

export default function RatesPage() {
  const t = today();
  const [startDate, setStartDate] = useState(t);
  const [spanDays, setSpanDays] = useState(30);
  const endDate = addDays(startDate, spanDays - 1);

  const [data, setData] = useState<RateGridResponseV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [toast, setToast] = useState("");

  const [mode, setMode] = useState<RateEditMode>("type");
  const [deltaThreshold, setDeltaThreshold] = useState(0.20);
  const [otaAlertCount, setOtaAlertCount] = useState(0);

  // Modal Promise State
  const [deltaModal, setDeltaModal] = useState<{ oldP: number; newP: number; pct: number; resolve: (val: boolean) => void } | null>(null);
  const [floorModal, setFloorModal] = useState<{ price: number; floor: number; typeName: string; resolve: (token: string | null) => void } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const m = localStorage.getItem("ratesGridMode");
      if (m === "room" || m === "type") setMode(m);
    }
  }, []);

  const handleModeChange = (m: RateEditMode) => {
    setMode(m);
    localStorage.setItem("ratesGridMode", m);
  };

  const loadSettingsAndAlerts = useCallback(async () => {
    try {
      const [setRes, otaRes] = await Promise.all([
        fetch("/api/admin/settings?scope=rates").catch(() => null),
        fetch("/api/ota-sync").catch(() => null)
      ]);
      if (setRes?.ok) {
        const j = await setRes.json();
        if (typeof j.price_delta_warn_threshold === "number") {
          setDeltaThreshold(j.price_delta_warn_threshold);
        }
      }
      if (otaRes?.ok) {
        const j = await otaRes.json();
        setOtaAlertCount(j.total_pending || 0);
      }
    } catch {}
  }, []);

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

  useEffect(() => { 
    load(); 
    loadSettingsAndAlerts();
  }, [load, loadSettingsAndAlerts]);

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3000);
  }

  async function callSaveApi(targetMode: RateEditMode, id: string, date: string, price: number, token?: string) {
    const body: any = { date, price, mode: targetMode };
    if (targetMode === "room") body.room_id = id;
    else body.room_type_id = id;
    if (token) body.override_token = token;

    const res = await fetch("/api/rates/single", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function handleCellSave(
    targetMode: RateEditMode,
    id: string,
    roomTypeName: string,
    date: string,
    newPrice: number,
    oldPrice: number | null,
    resetInput: () => void
  ) {
    // 1. Check delta warning
    if (oldPrice !== null && oldPrice > 0) {
      const pctChange = (newPrice - oldPrice) / oldPrice;
      if (Math.abs(pctChange) > deltaThreshold) {
        const confirmed = await new Promise<boolean>((resolve) => {
          setDeltaModal({ oldP: oldPrice, newP: newPrice, pct: pctChange * 100, resolve });
        });
        setDeltaModal(null);
        if (!confirmed) return resetInput();
      }
    }

    // 2. Try saving
    const res = await callSaveApi(targetMode, id, date, newPrice);
    
    // 3. Floor Violation Check
    if (res.floor_violation) {
      const token = await new Promise<string | null>((resolve) => {
        setFloorModal({ price: newPrice, floor: res.floor, typeName: roomTypeName, resolve });
      });
      setFloorModal(null);
      if (!token) return resetInput();

      // Retry with token
      const retryRes = await callSaveApi(targetMode, id, date, newPrice, token);
      if (!retryRes.success) {
        showToast(`Error: ${retryRes.error}`);
        return resetInput();
      }
    } else if (!res.success) {
      showToast(`Error: ${res.error}`);
      return resetInput();
    }

    // 4. Success -> reload to get fresh data (or we could do optimistic update, but reload gets fresh OCC)
    showToast("✓ Rate updated");
    load();
  }

  const days = data?.days ?? [];
  const totalW = days.length * COL_W;
  const todayDate = t;

  return (
    <div className="flex flex-col gap-4 max-w-full pb-10">
      {/* Header & Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Revenue</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Daily Rate Grid</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={load}>↻ Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowBulk(true)}>🚀 Bulk Update</button>
        </div>
      </div>

      <RateRibbon occupancy={data?.occupancy} days={days} otaAlertCount={otaAlertCount} />

      <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <ModeToggle mode={mode} onChange={handleModeChange} />
          
          <div className="flex items-center gap-2">
            <input type="date" className="form-input py-1 text-sm w-36" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <select className="form-select py-1 text-sm w-24" value={spanDays} onChange={(e) => setSpanDays(Number(e.target.value))}>
              <option value={7}>7 Days</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
              <option value={60}>60 Days</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-50 dark:bg-emerald-950 border border-emerald-200"></span>&lt;30%</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-50 dark:bg-amber-950 border border-amber-200"></span>30-60%</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-50 dark:bg-orange-950 border border-orange-200"></span>60-85%</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-rose-100 dark:bg-rose-950 border border-rose-300"></span>&gt;85%</div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">{error}</div>}

      {/* Grid */}
      <div className="card overflow-hidden">
        <div className="flex">
          {/* Frozen left column */}
          <div className="flex-shrink-0 border-r border-[var(--border-default)] z-10 bg-[var(--bg-body)]" style={{ width: LABEL_W }}>
            <div className="border-b border-[var(--border-default)] h-[36px] flex items-center px-3 text-[10px] font-bold uppercase text-[var(--text-muted)]">
              {mode === "type" ? "Room Type" : "Room"}
            </div>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[36px] border-b border-[var(--border-subtle)]" />)
            ) : (
              (data?.room_types ?? []).flatMap((rt) => {
                if (mode === "type") {
                  return [
                    <div key={rt.type_id} className="border-b border-[var(--border-default)] h-[36px] flex items-center px-3 bg-slate-800 text-white font-bold text-xs">
                      {rt.type_name}
                    </div>
                  ];
                } else {
                  return [
                    <div key={`th-${rt.type_id}`} className="border-b border-[var(--border-default)] h-[36px] flex items-center px-3 bg-slate-800 text-white font-bold text-[10px]">
                      {rt.type_name}
                    </div>,
                    ...rt.rooms.map((room) => (
                      <div key={room.room_id} className="border-b border-[var(--border-subtle)] h-[36px] flex items-center px-3 bg-[var(--bg-surface)] text-sm font-bold text-[var(--text-primary)]">
                        {room.room_number}
                      </div>
                    ))
                  ];
                }
              })
            )}
          </div>

          {/* Scrollable date grid */}
          <div ref={scrollRef} className="overflow-x-auto flex-1">
            <div style={{ width: totalW, minWidth: totalW }}>
              {/* Header */}
              <div className="flex border-b border-[var(--border-default)] bg-[var(--bg-body)] sticky top-0 z-10 h-[36px]">
                {days.map((day) => {
                  const { d, dow, isWeekend } = dayLabel(day);
                  const isToday = day === todayDate;
                  const occPct = data?.occupancy?.hotel_wide?.[day]?.pct ?? 0;
                  // Hotel-wide OCC strip tint across header
                  const headerBg = isToday ? "bg-brand-100 dark:bg-brand-900/30" : isWeekend ? "bg-rose-50 dark:bg-rose-900/20" : "";
                  
                  return (
                    <div key={day} className={`flex-shrink-0 flex flex-col items-center justify-center border-r border-[var(--border-default)] text-center select-none ${headerBg}`} style={{ width: COL_W }}>
                      <span className={`text-[9px] font-bold ${isWeekend ? "text-rose-500 dark:text-rose-400" : "text-[var(--text-muted)]"}`}>{dow}</span>
                      <span className={`text-sm font-bold leading-none ${isToday ? "text-brand-700 dark:text-brand-400" : isWeekend ? "text-rose-600 dark:text-rose-400" : "text-[var(--text-table-cell)]"}`}>{d}</span>
                      {/* small OCC bar */}
                      <div className="w-full h-[3px] bg-[var(--bg-muted)] mt-0.5 absolute bottom-0 left-0 overflow-hidden">
                        <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, occPct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Data rows */}
              {!loading && (data?.room_types ?? []).flatMap((rt) => {
                if (mode === "type") {
                  return [
                    <div key={rt.type_id} className="flex border-b border-[var(--border-default)] h-[36px]">
                      {days.map((day) => {
                        const { isWeekend } = dayLabel(day);
                        const isToday = day === todayDate;
                        const pct = data?.occupancy?.per_room_type?.[rt.type_id]?.[day]?.pct ?? 0;
                        const tierClass = occTint(pct);
                        
                        // Show avg price (or distinct price if uniform)
                        const prices = rt.rooms.map(r => r.rates[day]).filter(p => p !== null);
                        const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a,b) => a+b, 0) / prices.length) : null;
                        
                        return (
                          <div key={day} className="flex-shrink-0 border-r border-[var(--border-subtle)]" style={{ width: COL_W }}>
                            <PriceCellV2 
                              price={avgPrice} 
                              onSave={(newP, oldP, reset) => handleCellSave("type", rt.type_id, rt.type_name, day, newP, oldP, reset)} 
                              weekend={isWeekend} 
                              isToday={isToday} 
                              occTierClass={tierClass} 
                            />
                          </div>
                        );
                      })}
                    </div>
                  ];
                } else {
                  return [
                    <div key={`th-${rt.type_id}`} className="flex border-b border-[var(--border-default)] bg-slate-800 h-[36px]">
                      {days.map(day => (
                        <div key={day} className="flex-shrink-0 border-r border-slate-700 flex items-center justify-center" style={{ width: COL_W }}>
                          <span className="text-[10px] text-[var(--text-muted)] font-bold">{data?.occupancy?.per_room_type?.[rt.type_id]?.[day]?.pct ?? 0}%</span>
                        </div>
                      ))}
                    </div>,
                    ...rt.rooms.map(room => (
                      <div key={room.room_id} className="flex border-b border-[var(--border-subtle)] h-[36px]">
                        {days.map(day => {
                          const { isWeekend } = dayLabel(day);
                          const isToday = day === todayDate;
                          return (
                            <div key={day} className="flex-shrink-0 border-r border-[var(--border-subtle)]" style={{ width: COL_W }}>
                              <PriceCellV2 
                                price={room.rates[day]} 
                                onSave={(newP, oldP, reset) => handleCellSave("room", room.room_id, rt.type_name, day, newP, oldP, reset)} 
                                weekend={isWeekend} 
                                isToday={isToday} 
                              />
                            </div>
                          );
                        })}
                      </div>
                    ))
                  ];
                }
              })}
            </div>
          </div>
        </div>
      </div>

      {showBulk && data && (
        <BulkUpdateModal
          roomTypes={data.room_types}
          startDate={startDate}
          endDate={endDate}
          onClose={() => setShowBulk(false)}
          onSuccess={() => { load(); showToast("✓ Rates successfully updated!"); }}
        />
      )}

      {deltaModal && (
        <DeltaConfirmModal
          oldPrice={deltaModal.oldP}
          newPrice={deltaModal.newP}
          pctChange={deltaModal.pct}
          onCancel={() => deltaModal.resolve(false)}
          onConfirm={() => deltaModal.resolve(true)}
        />
      )}

      {floorModal && (
        <FloorGuardModal
          price={floorModal.price}
          floor={floorModal.floor}
          roomTypeName={floorModal.typeName}
          onCancel={() => floorModal.resolve(null)}
          onOverride={(token) => floorModal.resolve(token)}
        />
      )}

      {toast && <div className="toast-bar toast-success z-50">{toast}</div>}
    </div>
  );
}
