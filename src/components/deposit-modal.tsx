"use client";

import { useMemo, useState } from "react";
import {
    buildDepositSnapshotNote,
    formatDepositMethodLabel,
    parseDepositSnapshotNote,
} from "@/lib/deposit-ledger";
import { fromSatang, toSatang } from "@/lib/money";
import { formatDateDisplay } from "@/lib/date-display";
import PmsModal from "./pms-modal";

interface DepositModalProps {
    reservationId: string;
    bookingCode: string;
    guestName: string;
    totalPrice: number;
    existingDeposit?: number | null;
    existingDepositNote?: string | null;
    existingDepositPaidAt?: string | null;
    existingDepositPaidDate?: string | null;
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
    existingDepositPaidDate,
    onClose,
    onSuccess
}: DepositModalProps) {
    const hasPaid = Number(existingDeposit ?? 0) > 0;
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
    const [refunding, setRefunding] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const refundMethodLockedToCash = method === "Cash";

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

    async function handleRefund() {
        setError("");
        setSuccess("");
        if (!refundMethodLockedToCash) {
            setError("Refund Deposit in this screen is Cash only.");
            return;
        }

        const currentDepositSatang = toSatang(existingDeposit ?? 0);
        if (currentDepositSatang <= 0) {
            setError("No deposit to refund.");
            return;
        }

        const entered = amount.trim();
        const enteredValue = Number(entered);
        const requestedRefundSatang =
            entered.length > 0 && Number.isFinite(enteredValue) && enteredValue > 0
                ? toSatang(enteredValue)
                : currentDepositSatang;

        if (requestedRefundSatang <= 0) {
            setError("Please enter a valid refund amount.");
            return;
        }

        const refundSatang = Math.min(requestedRefundSatang, currentDepositSatang);
        const nextDepositSatang = Math.max(0, currentDepositSatang - refundSatang);

        const baseLines = parsedExistingDeposit.lines.length > 0
            ? parsedExistingDeposit.lines.map((line) => ({ ...line }))
            : [{
                method: "cash",
                amount: fromSatang(currentDepositSatang),
                note: null
            }];

        // Refund method is forced to cash on this page.
        const preferredMethod = "cash";
        const orderedLines = [
            ...baseLines.filter((line) => line.method === preferredMethod),
            ...baseLines.filter((line) => line.method !== preferredMethod),
        ];

        let remainingToDeduct = refundSatang;
        for (const line of orderedLines) {
            if (remainingToDeduct <= 0) break;
            const lineSatang = toSatang(line.amount);
            const deduct = Math.min(lineSatang, remainingToDeduct);
            line.amount = fromSatang(lineSatang - deduct);
            remainingToDeduct -= deduct;
        }

        const nextLines = orderedLines
            .filter((line) => toSatang(line.amount) > 0)
            .map((line) => ({
                method: line.method,
                amount: line.amount,
                note: line.note ?? null,
            }));

        const nextDepositAmount = fromSatang(nextDepositSatang);
        const nextNote = nextDepositSatang > 0
            ? buildDepositSnapshotNote(nextLines, existingGeneralNote)
            : null;

        setRefunding(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/deposit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    deposit_amount: nextDepositAmount,
                    deposit_note: nextNote,
                }),
            });
            const d = await res.json().catch(() => null);
            if (!res.ok || !d?.success) {
                setError(d?.error ?? "Could not refund deposit.");
                return;
            }
            setSuccess(`Refunded ฿${fromSatang(refundSatang).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in cash successfully.`);
            setTimeout(() => { onSuccess(); onClose(); }, 1000);
        } finally {
            setRefunding(false);
        }
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
                        <button
                            type="button"
                            className="btn btn-danger flex-shrink-0"
                            onClick={handleRefund}
                            disabled={refunding || !refundMethodLockedToCash}
                            title={refundMethodLockedToCash ? "Refund deposit in cash" : "Refund is allowed only when Payment Method is Cash"}
                        >
                            {refunding ? "…" : "Refund Deposit"}
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
                <div className="rounded-lg bg-[var(--bg-body)] border border-[var(--border-default)] px-3 py-2 text-sm">
                    <div className="font-bold text-[var(--text-primary)]">{guestName}</div>
                    <div className="text-[var(--text-muted)] text-xs">{bookingCode} · Total ฿{totalPrice.toLocaleString()}</div>
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
                                {existingDepositPaidDate
                                    ? ` · ${formatDateDisplay(existingDepositPaidDate)}`
                                    : existingDepositPaidAt
                                        ? ` · ${formatDateDisplay(existingDepositPaidAt)}`
                                        : ""}
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
                {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div>}

                {/* Amount */}
                <div>
                    <label className="form-label">{hasPaid ? "Amount (THB) *" : "Deposit Amount (THB) *"}</label>
                    <div className="relative">
                        <input
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            className="form-input pl-3"
                            placeholder={hasPaid ? "e.g. 200" : "e.g. 500"}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                        />
                    </div>
                    {depositPct > 0 && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            = {depositPct}% of total ฿{totalPrice.toLocaleString()}
                        </p>
                    )}
                    {hasPaid && (
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                            Refund method is Cash only. Leave blank to refund all.
                        </p>
                    )}
                    {hasPaid && !refundMethodLockedToCash && (
                        <p className="text-xs text-rose-700 mt-1">
                            Switch Payment Method to Cash before refund.
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
                                        : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                                    }`}
                            >{m}</button>
                        ))}
                    </div>
                </div>
            </form>
        </PmsModal>
    );
}
