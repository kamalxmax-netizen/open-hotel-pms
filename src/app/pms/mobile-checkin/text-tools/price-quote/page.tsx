"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Plus, Trash2 } from "lucide-react";
import NightCounter from "@/components/night-counter";
import { copyToClipboardWithHistory } from "@/lib/copy-board";
import { addDays } from "@/lib/dates";
import { MOBILE_TEXT_ROOM_DISPLAY } from "@/lib/mobile-text";

type QuoteRoomRow = {
  id: string;
  room_type_key: string;
  quantity: number;
};

type AvailabilityViolation = {
  room_type_key: string;
  room_type_name: string;
  requested: number;
  available: number;
};

function makeRow(index: number): QuoteRoomRow {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    room_type_key: MOBILE_TEXT_ROOM_DISPLAY[index % MOBILE_TEXT_ROOM_DISPLAY.length]?.key ?? "double_standard",
    quantity: 1,
  };
}

export default function MobilePriceQuoteTextPage() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);
  const [customerName, setCustomerName] = useState("");
  const [checkin, setCheckin] = useState(today);
  const [checkout, setCheckout] = useState(tomorrow);
  const [nights, setNights] = useState(1);
  const [rooms, setRooms] = useState<QuoteRoomRow[]>(() => [makeRow(0)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [violations, setViolations] = useState<AvailabilityViolation[]>([]);
  const [text, setText] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const canGenerate = useMemo(
    () => Boolean(customerName.trim() && checkin && checkout && checkout > checkin && rooms.some((room) => room.quantity > 0)),
    [checkin, checkout, customerName, rooms]
  );

  const clearOutput = () => {
    setText("");
    setError("");
    setViolations([]);
    setCopySuccess(false);
  };

  const updateRoom = (id: string, patch: Partial<QuoteRoomRow>) => {
    setRooms((current) => current.map((room) => (room.id === id ? { ...room, ...patch } : room)));
    clearOutput();
  };

  const addRoom = () => {
    setRooms((current) => [...current, makeRow(current.length)]);
    clearOutput();
  };

  const removeRoom = (id: string) => {
    setRooms((current) => (current.length <= 1 ? current : current.filter((room) => room.id !== id)));
    clearOutput();
  };

  const generateText = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    setViolations([]);
    setCopySuccess(false);
    try {
      const res = await fetch("/api/mobile-text/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          checkin,
          checkout,
          rooms: rooms.map((room) => ({
            room_type_key: room.room_type_key,
            quantity: room.quantity,
          })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const nextViolations = Array.isArray(json?.data?.violations) ? json.data.violations as AvailabilityViolation[] : [];
        setViolations(nextViolations);
        throw new Error(json?.error || "Failed to generate price quote.");
      }
      setText(String(json.data?.text ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate price quote.");
      setText("");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!text) return;
    const copied = await copyToClipboardWithHistory(text, { sourceLabel: "Price Quote" });
    if (!copied) return;
    setCopySuccess(true);
    window.setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-4">
        <Link
          href="/pms/mobile-checkin/text-tools"
          className="-ml-3 rounded-full p-3 text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface-hover)]"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Price Quote</h1>
          <p className="text-sm text-[var(--text-secondary)]">Recheck room inventory, then copy Thai quote text.</p>
        </div>
      </header>

      <main className="flex-1 space-y-4 p-6">
        <div className="space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div>
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Customer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(event) => {
                setCustomerName(event.target.value);
                clearOutput();
              }}
              placeholder="เช่น สมชาย"
              className="form-input w-full"
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Stay Range
            </label>
            <NightCounter
              checkinDate={checkin}
              checkoutDate={checkout}
              nights={nights}
              useNativeDatePicker
              compact
              onChange={(nextCheckin, nextCheckout, nextNights) => {
                setCheckin(nextCheckin);
                setCheckout(nextCheckout);
                setNights(nextNights);
                clearOutput();
              }}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-[var(--text-primary)]">Room Types</h2>
              <p className="text-xs text-[var(--text-secondary)]">Add multiple room types and quantities.</p>
            </div>
            <button type="button" className="btn btn-secondary inline-flex items-center gap-2" onClick={addRoom}>
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          <div className="space-y-3">
            {rooms.map((room) => (
              <div key={room.id} className="grid grid-cols-[1fr_92px_44px] gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Room Type
                  </label>
                  <select
                    value={room.room_type_key}
                    onChange={(event) => updateRoom(room.id, { room_type_key: event.target.value })}
                    className="form-select w-full text-sm"
                  >
                    {MOBILE_TEXT_ROOM_DISPLAY.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Rooms
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={room.quantity}
                    onChange={(event) => {
                      const nextQuantity = Number(event.target.value || 1);
                      updateRoom(room.id, { quantity: Number.isFinite(nextQuantity) ? Math.max(1, nextQuantity) : 1 });
                    }}
                    className="form-input w-full text-center text-sm font-bold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRoom(room.id)}
                  disabled={rooms.length <= 1}
                  className="mt-5 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Remove room type"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary px-6" onClick={generateText} disabled={!canGenerate || loading}>
              {loading ? <span className="btn-spinner border-white" /> : "Generate"}
            </button>
          </div>
        </div>

        {(error || violations.length > 0) && (
          <div className="space-y-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
            {error && <p>{error}</p>}
            {violations.map((item) => (
              <p key={item.room_type_key}>
                {item.room_type_name}: เลือก {item.requested} ห้อง แต่เหลือว่างเพียง {item.available} ห้อง
              </p>
            ))}
          </div>
        )}

        {text && (
          <div className="space-y-3 rounded-2xl border border-emerald-300 bg-[var(--bg-surface)] p-4">
            <textarea value={text} readOnly className="min-h-[320px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-sm" />
            <div className="flex items-center justify-between gap-3">
              <p className={`text-sm ${copySuccess ? "text-emerald-600" : "text-[var(--text-secondary)]"}`}>
                {copySuccess ? "Copied." : "Quote text is ready to send in LINE or chat."}
              </p>
              <button type="button" className="btn btn-secondary inline-flex items-center gap-2" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
                Copy Text
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
