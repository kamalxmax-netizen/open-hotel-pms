"use client";

import { useMemo, useState } from "react";
import {
    buildDepositSnapshotNote,
    formatDepositMethodLabel,
    parseDepositSnapshotNote,
} from "@/lib/deposit-ledger";
import PmsModal from "./pms-modal";

interface DepositModalProps {
    reservationId: string;
    bookingCode: string;
    guestName: string;
    totalPrice: number;
    existingDeposit?: number | null;
    existingDepositNote?: string | null;
    existingDepositPaidAt?: string | null;
    onClose: () => void;
    onSuccess: () => void;
}

const PAYMENT_METHODS = ["Cash", "Transfer", "Credit Card"];

export default function DepositModal({
    reservationId,
    bookingCode,
    guestName,
    totalPrice,
    existingDeposit,
    existingDepositNote,
    existingDepositPaidAt,
    onClose,
    onSuccess
}: DepositModalProps) {
    const hasPaid = !!(existingDepositPaidAt && existingDeposit && existingDeposit > 0);
    const modalTitle = hasPaid ? "💰 Top Up Deposit" : "💰 Collect Deposit";
    const parsedExistingDeposit = useMemo(
        () => parseDepositSnapshotNote(existingDepositNote),
        [existingDepositNote]
    );
    const existingMethodLabel = useMemo(() => {
        const firstLine = parsedExistingDeposit.lines[0];
        return firstLine ? formatDepositMethodLabel(firstLine.method) : "Cash";
    }, [parsedExistingDeposit]);
    const existingGeneralNote = parsedExistingDeposit.generalNote ?? "";

    const [amount, setAmount] = useState(hasPaid ? "" : (existingDeposit ? String(existingDeposit) : ""));
    const [method, setMethod] = useState(existingMethodLabel);
    const [loading, setLoading] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(""); setSuccess("");
        const num = parseFloat(amount);
        if (isNaN(num) || num <= 0) { setError("Please enter a valid amount."); return; }
        const normalizedAmount = Math.round(num * 100) / 100;
        const existingLines = parsedExistingDeposit.lines.map((line) => ({ ...line }));
        const targetLines = hasPaid
            ? (() => {
                const matched = existingLines.find((line) => formatDepositMethodLabel(line.method) === method);
                if (matched) {
                    matched.amount = Math.round((matched.amount + normalizedAmount) * 100) / 100;
                    return existingLines;
                }
                return [...existingLines, { method: method.toLowerCase().replace(" ", "_"), amount: normalizedAmount, note: null }];
            })()
            : [{ method: method.toLowerCase().replace(" ", "_"), amount: normalizedAmount, note: null }];
        const nextTotal = Math.round(targetLines.reduce((sum, line) => sum + Number(line.amount || 0), 0) * 100) / 100;
        const nextNote = buildDepositSnapshotNote(targetLines, existingGeneralNote);
        setLoading(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/deposit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deposit_amount: nextTotal, deposit_note: nextNote })
            });
            const d = await res.json();
            if (res.ok) {
                setSuccess(`✓ Deposit of ฿${normalizedAmount.toLocaleString()} recorded successfully!`);
                setTimeout(() => { onSuccess(); onClose(); }, 1200);
            } else {
                setError(d.error ?? "An error occurred.");
            }
        } finally { setLoading(false); }
    }

    async function handleClear() {
        setError(""); setSuccess(""); setClearing(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/deposit`, { method: "DELETE" });
            if (res.ok) {
                setSuccess("Deposit cleared.");
                setTimeout(() => { onSuccess(); onClose(); }, 1000);
            } else {
                const d = await res.json();
                setError(d.error ?? "Could not clear deposit.");
            }
        } finally { setClearing(false); }
    }

    const depositPct = totalPrice > 0 && parseFloat(amount) > 0
        ? Math.round((parseFloat(amount) / totalPrice) * 100)
        : 0;

    return (
        <PmsModal
            title={modalTitle}
            size="sm"
            onClose={onClose}
            footer={
                <div className="flex gap-2 w-full">
                    <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cancel</button>
                    {hasPaid && (
                        <button type="button" className="btn btn-danger flex-shrink-0" onClick={handleClear} disabled={clearing}>
                            {clearing ? "…" : "Refund Deposit"}
                        </button>
                    )}
                    <button form="deposit-form" type="submit" className="btn btn-primary flex-1" disabled={loading}>
                        {loading ? "Saving…" : hasPaid ? "Top Up Deposit" : "Collect Deposit"}
                    </button>
                </div>
            }
        >
            <form id="deposit-form" onSubmit={handleSubmit} className="space-y-4">
                {/* Booking summary */}
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
                    <div className="font-bold text-slate-800">{guestName}</div>
                    <div className="text-slate-400 text-xs">{bookingCode} · Total ฿{totalPrice.toLocaleString()}</div>
                </div>

                {/* Existing deposit badge */}
                {hasPaid && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-center gap-2">
                        <span className="text-lg">✓</span>
                        <div>
                            <div className="font-bold">Deposit collected: ฿{existingDeposit?.toLocaleString()}</div>
                            <div className="text-xs text-amber-600">
                                {existingMethodLabel}
                                {existingGeneralNote ? ` · ${existingGeneralNote}` : ""}
                                {existingDepositPaidAt ? ` · ${new Date(existingDepositPaidAt).toLocaleDateString("en-GB")}` : ""}
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
                {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}

                {/* Amount */}
                <div>
                    <label className="form-label">{hasPaid ? "Top Up Amount (THB) *" : "Deposit Amount (THB) *"}</label>
                    <div className="relative">
                        <span className="absolute left-3 top-2.5 text-sm text-slate-400">฿</span>
                        <input
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            className="form-input pl-7"
                            placeholder={hasPaid ? "e.g. 200" : "e.g. 500"}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                        />
                    </div>
                    {depositPct > 0 && (
                        <p className="text-xs text-slate-400 mt-1">
                            = {depositPct}% of total ฿{totalPrice.toLocaleString()}
                        </p>
                    )}
                </div>

                {/* Payment method */}
                <div>
                    <label className="form-label">Payment Method</label>
                    <div className="flex flex-wrap gap-1.5">
                        {PAYMENT_METHODS.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMethod(m)}
                                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition
                  ${method === m
                                        ? "border-brand-500 bg-brand-600 text-white"
                                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    }`}
                            >{m}</button>
                        ))}
                    </div>
                </div>
            </form>
        </PmsModal>
    );
}
