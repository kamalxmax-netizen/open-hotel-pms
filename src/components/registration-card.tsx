"use client";

import { useEffect, useMemo, useState } from "react";

interface RegCardData {
  hotel_name: string;
  hotel_address: string;
  hotel_phone: string;
  booking_code: string;
  guest_name: string;
  guest_phone: string;
  room_type: string;
  room_number: string;
  room_floor: number | null;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  rate_per_night: number;
  total_price: number;
  deposit_amount: number;
  source: string;
  note: string;
  special_requests: string;
  guest_identity_type: string;
  guest_identity_number: string;
  guest_nationality: string;
  arrival_time: string;
  checked_in_at: string | null;
}

interface RegistrationCardProps {
  reservationId: string;
  onClose: () => void;
}

function fmtMoney(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB");
}

function fmtDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB");
}

export default function RegistrationCard({ reservationId, onClose }: RegistrationCardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<RegCardData | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/bookings/${reservationId}/reg-card`);
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to load registration card.");
        }
        if (alive) setData(payload.regCard as RegCardData);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [reservationId]);

  const roomLine = useMemo(() => {
    if (!data) return "";
    if (data.room_floor == null) return `${data.room_number} · ${data.room_type}`;
    return `${data.room_number} · ${data.room_type} · Floor ${data.room_floor}`;
  }, [data]);

  return (
    <div className="fixed inset-0 z-[260] bg-slate-900/40 p-4 overflow-auto">
      <div className="mx-auto max-w-3xl bg-[var(--bg-surface)] rounded-xl shadow-xl">
        <div className="no-print flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Registration Card</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {loading && (
          <div className="p-10 text-center text-[var(--text-muted)]">Loading registration card...</div>
        )}

        {!loading && error && (
          <div className="p-6">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          </div>
        )}

        {!loading && data && (
          <div className="reg-card-container p-8 text-[var(--text-primary)]">
            <header className="border-b border-[var(--border-default)] pb-3 mb-4">
              <h1 className="text-xl font-extrabold tracking-tight">{data.hotel_name}</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">{data.hotel_address}</p>
              <p className="text-sm text-[var(--text-secondary)]">{data.hotel_phone}</p>
            </header>

            <section className="mb-4">
              <h2 className="text-lg font-bold">REGISTRATION CARD</h2>
              <p className="text-sm text-[var(--text-secondary)]">Booking #{data.booking_code}</p>
            </section>

            <section className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
                <div className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Guest Info</div>
                <div className="p-3 space-y-1.5">
                  <p><span className="text-[var(--text-muted)]">Name:</span> {data.guest_name}</p>
                  <p><span className="text-[var(--text-muted)]">Phone:</span> {data.guest_phone || "—"}</p>
                  <p>
                    <span className="text-[var(--text-muted)]">
                      {data.guest_identity_type ? `${data.guest_identity_type}#:` : "Identity#:"}
                    </span>{" "}
                    {data.guest_identity_number || "—"}
                  </p>
                  <p><span className="text-[var(--text-muted)]">Nationality:</span> {data.guest_nationality || "—"}</p>
                </div>
              </div>

              <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
                <div className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Stay Info</div>
                <div className="p-3 space-y-1.5">
                  <p><span className="text-[var(--text-muted)]">Room:</span> {roomLine}</p>
                  <p><span className="text-[var(--text-muted)]">Arrival:</span> {fmtDate(data.checkin_date)} {data.arrival_time ? `(${data.arrival_time})` : ""}</p>
                  <p><span className="text-[var(--text-muted)]">Departure:</span> {fmtDate(data.checkout_date)}</p>
                  <p><span className="text-[var(--text-muted)]">Nights:</span> {data.nights}</p>
                  <p><span className="text-[var(--text-muted)]">Checked-in At:</span> {fmtDateTime(data.checked_in_at)}</p>
                </div>
              </div>
            </section>

            <section className="mb-4 border border-[var(--border-default)] rounded-lg overflow-hidden text-sm">
              <div className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Rate Details</div>
              <div className="p-3 grid grid-cols-2 gap-y-1">
                <p><span className="text-[var(--text-muted)]">Rate / Night:</span> ฿ {fmtMoney(data.rate_per_night)}</p>
                <p><span className="text-[var(--text-muted)]">Source:</span> {data.source}</p>
                <p><span className="text-[var(--text-muted)]">Total:</span> ฿ {fmtMoney(data.total_price)}</p>
                <p><span className="text-[var(--text-muted)]">Deposit:</span> ฿ {fmtMoney(data.deposit_amount)}</p>
              </div>
            </section>

            <section className="mb-6 text-sm">
              <h3 className="font-semibold mb-1.5">Special Requests</h3>
              <div className="min-h-[56px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-[var(--text-secondary)]">
                {data.special_requests || "—"}
              </div>
            </section>

            <footer className="grid grid-cols-2 gap-8 text-sm pt-4 border-t border-[var(--border-default)]">
              <div>
                <p className="text-[var(--text-muted)] mb-12">Guest Signature</p>
                <p className="border-t border-slate-400 pt-1">({data.guest_name})</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)] mb-12">Front Desk Signature</p>
                <p className="border-t border-slate-400 pt-1">Authorized Staff</p>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
