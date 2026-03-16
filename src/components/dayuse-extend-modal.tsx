"use client";

import { useEffect, useState } from "react";
import PmsModal from "./pms-modal";
import type { DayUseSettings } from "@/lib/types";

type PaymentMethod = "cash" | "transfer" | "credit_card";

type DayUseExtendModalProps = {
  reservationId: string;
  roomNumber: string;
  guestName: string;
  onClose: () => void;
  onSuccess: (payload: { new_expires_at: string; extension_charge: number; new_total: number }) => void;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function DayUseExtendModal({
  reservationId,
  roomNumber,
  guestName,
  onClose,
  onSuccess,
}: DayUseExtendModalProps) {
  const [settings, setSettings] = useState<DayUseSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentNote, setPaymentNote] = useState("");
  const parsedPaymentAmount = Number(paymentAmount);
  const paymentAmountInvalid =
    showValidation && (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount < 0);

  useEffect(() => {
    let active = true;

    async function loadSettings() {
      setLoadingSettings(true);
      setError("");
      try {
        const res = await fetch("/api/dayuse/settings");
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "Failed to load day use settings.");
        }
        if (!active) return;
        const nextSettings = data.settings as DayUseSettings;
        setSettings(nextSettings);
        setPaymentAmount(String(round2(Number(nextSettings.dayuse_extend_rate ?? 100))));
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        if (active) setLoadingSettings(false);
      }
    }

    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setShowValidation(true);
    const parsedAmount = round2(Number(paymentAmount));
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError("Invalid payment amount.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/dayuse/${reservationId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: paymentMethod,
          payment_amount: parsedAmount,
          payment_note: paymentNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Failed to extend day use session.");
        return;
      }
      onSuccess({
        new_expires_at: String(data.new_expires_at ?? ""),
        extension_charge: Number(data.extension_charge ?? 0),
        new_total: Number(data.new_total ?? 0),
      });
      setShowValidation(false);
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PmsModal
      title={`Extend Day Use · Room ${roomNumber}`}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full gap-2">
          <button className="btn btn-secondary flex-1" onClick={onClose} type="button" disabled={submitting}>
            Cancel
          </button>
          <button form="dayuse-extend-form" className="btn btn-primary flex-1" type="submit" disabled={loadingSettings || submitting}>
            {submitting ? "Extending..." : "Confirm Extend"}
          </button>
        </div>
      }
    >
      <form id="dayuse-extend-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-[var(--dayuse-border)] bg-[var(--dayuse-bg)] px-3 py-2 text-sm">
          <div className="font-semibold text-[var(--text-primary)]">{guestName || "Day Use Guest"}</div>
          <div className="text-xs text-[var(--dayuse-text-secondary)]">Room {roomNumber}</div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div>
          <label className="form-label">Payment Amount (THB)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className="form-input"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            disabled={loadingSettings || submitting}
            required
            aria-invalid={paymentAmountInvalid ? "true" : "false"}
          />
          {paymentAmountInvalid && (
            <p className="mt-1 text-xs text-rose-600">Please enter a valid payment amount (0 or higher).</p>
          )}
        </div>

        <div>
          <label className="form-label">Payment Method</label>
          <select
            className="form-input"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            disabled={loadingSettings || submitting}
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank Transfer</option>
            <option value="credit_card">Credit Card</option>
          </select>
        </div>

        <div>
          <label className="form-label">Payment Note (optional)</label>
          <input
            className="form-input"
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            placeholder="Reference / cashier note"
            disabled={loadingSettings || submitting}
          />
        </div>

        {settings && (
          <p className="text-xs text-[var(--text-muted)]">
            Default extension: {settings.dayuse_extend_min} min · Suggested charge ฿{settings.dayuse_extend_rate}
          </p>
        )}
      </form>
    </PmsModal>
  );
}
