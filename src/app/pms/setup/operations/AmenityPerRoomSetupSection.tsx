"use client";

import { useEffect, useMemo, useState } from "react";

type RoomType = { id: number; code: string; name_en: string };
type Product = { id: string; name: string; stock_tracking_mode: string };
type SetupRow = { room_type_id: number; product_id: string; units_per_occupied_night: number };

type ApiPayload = {
  room_types: RoomType[];
  products: Product[];
  setups: Array<SetupRow & { updated_at?: string }>;
};

function key(roomTypeId: number, productId: string) {
  return `${roomTypeId}:${productId}`;
}

export function AmenityPerRoomSetupSection() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch("/api/setup/amenity-per-room")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body?.success) throw new Error(body?.error ?? "Failed to load amenity setup");
        return body.data as ApiPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        const nextValues: Record<string, number> = {};
        for (const row of payload.setups) {
          nextValues[key(row.room_type_id, row.product_id)] = Number(row.units_per_occupied_night ?? 0);
        }
        setData(payload);
        setValues(nextValues);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load amenity setup");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const next: SetupRow[] = [];
    for (const roomType of data.room_types) {
      for (const product of data.products) {
        const value = values[key(roomType.id, product.id)] ?? 0;
        if (value > 0) {
          next.push({
            room_type_id: roomType.id,
            product_id: product.id,
            units_per_occupied_night: value,
          });
        }
      }
    }
    return next;
  }, [data, values]);

  async function save() {
    setIsSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/setup/amenity-per-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.error ?? "Failed to save amenity setup");
      setMessage(`Saved ${body.saved ?? rows.length} amenity setup rows.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save amenity setup");
    } finally {
      setIsSaving(false);
    }
  }

  function setCell(roomTypeId: number, productId: string, raw: string) {
    const parsed = Math.max(0, Math.min(50, Number.parseInt(raw || "0", 10) || 0));
    setValues((prev) => ({ ...prev, [key(roomTypeId, productId)]: parsed }));
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-emerald-950 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-bold">Amenity Per Room Setup</h2>
          <p className="text-sm opacity-80 mt-1">
            Set the maximum possible amenity use per occupied night by room type. Analytics Max uses sold rooms from the previous night.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={isLoading || isSaving || !data}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Setup"}
        </button>
      </div>

      {isLoading && <div className="mt-4 text-sm opacity-70">Loading amenity setup...</div>}
      {error && <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {message && <div className="mt-4 rounded-xl border border-emerald-300 bg-white/70 p-3 text-sm text-emerald-800">{message}</div>}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-200 bg-white/80 dark:bg-slate-950/40 dark:border-emerald-500/20">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-emerald-100 dark:border-emerald-500/20">
                <th className="sticky left-0 bg-white/95 dark:bg-slate-950/95 px-3 py-2 text-left text-xs uppercase tracking-wide opacity-70">Room Type</th>
                {data.products.map((product) => (
                  <th key={product.id} className="px-3 py-2 text-center text-xs uppercase tracking-wide opacity-70">
                    {product.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.room_types.map((roomType) => (
                <tr key={roomType.id} className="border-b border-emerald-100/70 last:border-0 dark:border-emerald-500/10">
                  <td className="sticky left-0 bg-white/95 dark:bg-slate-950/95 px-3 py-2 font-semibold">
                    {roomType.code}
                    <span className="block text-xs font-normal opacity-60">{roomType.name_en}</span>
                  </td>
                  {data.products.map((product) => (
                    <td key={product.id} className="px-3 py-2 text-center">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={50}
                        value={values[key(roomType.id, product.id)] ?? 0}
                        onChange={(event) => setCell(roomType.id, product.id, event.target.value)}
                        className="w-20 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-center font-semibold text-slate-900 dark:border-emerald-500/30"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
