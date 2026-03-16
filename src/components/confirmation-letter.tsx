"use client";

import { useEffect, useMemo, useState } from "react";

interface ConfirmationData {
  hotel_name: string;
  hotel_address: string;
  hotel_phone: string;
  booking_code: string;
  guest_name: string;
  guest_phone: string;
  room_type: string;
  room_number: string;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  rate_per_night: number;
  total_price: number;
  deposit_amount: number;
  balance_due: number;
  source: string;
  note: string;
  created_at: string;
  confirmation_number: string;
}

interface ConfirmationLetterProps {
  reservationId: string;
  onClose: () => void;
}

function fmtMoney(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB");
}

export default function ConfirmationLetter({ reservationId, onClose }: ConfirmationLetterProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ConfirmationData | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/bookings/${reservationId}/confirmation`);
        const payload = await res.json();
        if (!res.ok || !payload.success) {
          throw new Error(payload.error ?? "Failed to load confirmation.");
        }
        if (alive) setData(payload.confirmation as ConfirmationData);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [reservationId]);

  const generatedDate = useMemo(() => {
    if (!data?.created_at) return new Date().toLocaleDateString("en-GB");
    return fmtDate(data.created_at);
  }, [data?.created_at]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 overflow-auto">
      <div className="mx-auto max-w-4xl bg-[var(--bg-surface)] rounded-xl shadow-xl">
        <div className="no-print flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Booking Confirmation</h2>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print</button>
          </div>
        </div>

        {loading && (
          <div className="p-10 text-center text-[var(--text-muted)]">Loading confirmation...</div>
        )}

        {!loading && error && (
          <div className="p-6">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          </div>
        )}

        {!loading && data && (
          <div className="print-container p-8 text-[var(--text-primary)]">
            <header className="border-b border-[var(--border-default)] pb-4 mb-6">
              <h1 className="text-2xl font-extrabold tracking-tight">{data.hotel_name}</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{data.hotel_address}</p>
              <p className="text-sm text-[var(--text-secondary)]">{data.hotel_phone}</p>
            </header>

            <section className="mb-6">
              <h2 className="text-xl font-bold">BOOKING CONFIRMATION</h2>
              <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                <p><span className="text-[var(--text-muted)]">Confirmation #:</span> <strong>{data.confirmation_number}</strong></p>
                <p><span className="text-[var(--text-muted)]">Date:</span> <strong>{generatedDate}</strong></p>
              </div>
            </section>

            <section className="mb-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Guest Details</h3>
              <table className="w-full border border-[var(--border-default)] text-sm">
                <tbody>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="w-48 bg-[var(--bg-body)] px-3 py-2 font-semibold">Guest Name</td>
                    <td className="px-3 py-2">{data.guest_name}</td>
                  </tr>
                  <tr>
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Phone</td>
                    <td className="px-3 py-2">{data.guest_phone || "—"}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="mb-6">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Stay Details</h3>
              <table className="w-full border border-[var(--border-default)] text-sm">
                <tbody>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="w-48 bg-[var(--bg-body)] px-3 py-2 font-semibold">Room Type</td>
                    <td className="px-3 py-2">{data.room_type}</td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Room Number</td>
                    <td className="px-3 py-2">{data.room_number}</td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Check-in</td>
                    <td className="px-3 py-2">{fmtDate(data.checkin_date)}</td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Check-out</td>
                    <td className="px-3 py-2">{fmtDate(data.checkout_date)}</td>
                  </tr>
                  <tr>
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Nights</td>
                    <td className="px-3 py-2">{data.nights}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="mb-8">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Rate Breakdown</h3>
              <table className="w-full border border-[var(--border-default)] text-sm">
                <tbody>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="w-48 bg-[var(--bg-body)] px-3 py-2 font-semibold">Rate / Night</td>
                    <td className="px-3 py-2 text-right">฿ {fmtMoney(data.rate_per_night)}</td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right">฿ {fmtMoney(data.total_price)}</td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Deposit</td>
                    <td className="px-3 py-2 text-right">฿ {fmtMoney(data.deposit_amount)}</td>
                  </tr>
                  <tr>
                    <td className="bg-[var(--bg-body)] px-3 py-2 font-semibold">Room Balance Due</td>
                    <td className="px-3 py-2 text-right font-bold">฿ {fmtMoney(data.balance_due)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                Deposit is held separately and is refunded on check-out unless used for incidentals/damages.
              </p>
            </section>

            <section className="mb-8">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">Terms & Conditions</h3>
              <div className="text-xs leading-6 text-[var(--text-secondary)] border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                <p>1. กรุณาแสดงเอกสารยืนยันตัวตนเมื่อเช็คอิน</p>
                <p>2. เวลาเช็คอินและเช็คเอาต์เป็นไปตามนโยบายของโรงแรม</p>
                <p>3. กรุณาตรวจสอบรายละเอียดการจองและแจ้งแก้ไขก่อนวันเข้าพัก</p>
              </div>
            </section>

            <footer className="pt-6 border-t border-[var(--border-default)]">
              <div className="grid grid-cols-2 gap-8 text-sm">
                <div>
                  <p className="text-[var(--text-muted)] mb-12">Guest Signature</p>
                  <p className="border-t border-slate-400 pt-1">({data.guest_name})</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] mb-12">Front Desk</p>
                  <p className="border-t border-slate-400 pt-1">Authorized Signature</p>
                </div>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
