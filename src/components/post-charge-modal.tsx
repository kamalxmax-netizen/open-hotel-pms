"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { PAYMENT_METHODS } from "@/lib/constants";

interface ExtraFeeTemplate {
  id: string;
  code: string;
  name: string;
  category: string;
  defaultPrice: number | null;
  description: string | null;
}

function normalizeTemplate(row: any): ExtraFeeTemplate {
  return {
    id: String(row?.id ?? row?.code ?? ""),
    code: String(row?.code ?? ""),
    name: String(row?.name ?? ""),
    category: String(row?.category ?? ""),
    defaultPrice:
      row?.defaultPrice != null
        ? Number(row.defaultPrice)
        : row?.default_price != null
          ? Number(row.default_price)
          : null,
    description:
      typeof row?.description === "string"
        ? row.description
        : typeof row?.note === "string"
          ? row.note
          : null,
  };
}

interface PostChargeModalProps {
  open: boolean;
  onClose: () => void;
  reservationId: string;
  onChargePosted: () => void;
}

export function PostChargeModal({
  open,
  onClose,
  reservationId,
  onChargePosted,
}: PostChargeModalProps) {
  const [templates, setTemplates] = useState<ExtraFeeTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [selectedCode, setSelectedCode] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [depositHeld, setDepositHeld] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Fetch templates when modal opens
  useEffect(() => {
    if (open) {
      void Promise.all([loadTemplates(), loadDepositSummary()]);
      resetForm();
    }
  }, [open]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/extra-fee-templates");
      if (!res.ok) throw new Error("Failed to load fee templates");
      const data = await res.json();
      const templateRows = Array.isArray(data?.templates)
        ? data.templates.map(normalizeTemplate)
        : [];
      
      // Filter only service & damage for in-house FO posting
      const filtered = templateRows.filter(
        (t: ExtraFeeTemplate) => t.category === "service" || t.category === "damage"
      );
      setTemplates(filtered);
    } catch (err: any) {
      setError(err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  const loadDepositSummary = async () => {
    try {
      const res = await fetch(`/api/bookings/${reservationId}/payments`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load deposit summary");
      const data = await res.json();
      const held = Number(data?.summary?.deposit_held ?? 0);
      setDepositHeld(Number.isFinite(held) ? held : 0);
    } catch {
      setDepositHeld(0);
    }
  };

  const resetForm = () => {
    setSelectedCode("");
    setAmount("");
    setMethod("cash");
    setNote("");
    setError(null);
  };

  const handleTemplateChange = (code: string) => {
    setSelectedCode(code);
    const tmpl = templates.find((t) => t.code === code);
    if (tmpl && tmpl.defaultPrice !== null) {
      setAmount(tmpl.defaultPrice.toString());
    } else {
      setAmount("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const nativeEvent = e.nativeEvent as Event & { stopImmediatePropagation?: () => void };
    if (typeof nativeEvent.stopImmediatePropagation === "function") {
      nativeEvent.stopImmediatePropagation();
    }
    if (!selectedCode) {
      setError("Please select a fee type");
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (method === "deposit" && depositHeld <= 0) {
      setError("No deposit held for this reservation.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      
      const payload = {
        fee_template_code: selectedCode,
        amount: amt,
        payment_method: method,
        method: method,
        note: note.trim() || undefined,
      };

      const res = await fetch(`/api/bookings/${reservationId}/extra-charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to post charge");
      }

      onChargePosted();
      onClose();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  if (!open || !mounted) return null;

  const amountNumber = Number(amount);
  const amountValue = Number.isFinite(amountNumber) ? amountNumber : 0;
  const usingDeposit = method === "deposit";
  const postingUnpaid = method === "record_only";
  const depositApplied = usingDeposit ? Math.min(amountValue, depositHeld) : 0;
  const depositRemaining = usingDeposit ? Math.max(amountValue - depositApplied, 0) : 0;

  // Group templates for optgroup display
  const serviceTemplates = templates.filter((t) => t.category === "service");
  const damageTemplates = templates.filter((t) => t.category === "damage");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-0">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-[var(--bg-body)]">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--text-primary)]">
            Post Extra Charge
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="rounded-md bg-rose-50 p-2 text-sm text-rose-700 border border-rose-200">
              {error}
            </div>
          )}

          <div>
            <label className="form-label">Fee Type</label>
            <select
              className="form-select"
              value={selectedCode}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={loading || saving}
              required
            >
              <option value="" disabled>-- Select Charge Type --</option>
              {serviceTemplates.length > 0 && (
                <optgroup label="Service Charges">
                  {serviceTemplates.map((t) => (
                    <option key={t.id} value={t.code}>{t.name}</option>
                  ))}
                </optgroup>
              )}
              {damageTemplates.length > 0 && (
                <optgroup label="Damage & Penalties">
                  {damageTemplates.map((t) => (
                    <option key={t.id} value={t.code}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Amount (฿)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="form-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={saving}
                required
              />
            </div>
            <div>
              <label className="form-label">Payment Method</label>
              <select
                className="form-select"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                disabled={saving}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                {depositHeld > 0 ? <option value="deposit">Deposit</option> : null}
                <option value="record_only">Post only / unpaid</option>
              </select>
            </div>
          </div>

          {usingDeposit ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="font-semibold">Deposit Held: ฿{depositHeld.toFixed(2)}</div>
              {depositRemaining > 0 ? (
                <div className="mt-1">
                  Charge ฿{amountValue.toFixed(2)} exceeds deposit. ฿{depositApplied.toFixed(2)} will be applied, ฿{depositRemaining.toFixed(2)} remains outstanding.
                </div>
              ) : null}
            </div>
          ) : null}

          {postingUnpaid ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              Post this charge to the folio without collecting money now. It will remain in the outstanding balance until paid later.
            </div>
          ) : null}

          <div>
            <label className="form-label">Note (Optional)</label>
            <input
              type="text"
              className="form-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="E.g., Extra person night 3"
              disabled={saving}
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !selectedCode || !amount || (usingDeposit && depositHeld <= 0)}
            >
              {saving ? "Posting..." : "Post Charge"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
