import { useState, useEffect } from "react";
import PmsModal from "./pms-modal";
import { formatMoney } from "@/lib/money";

export interface CancelFeePayload {
    cancel_reason: string;
    fee_amount?: number;
    fee_collect_method?: "cash" | "transfer" | "credit_card";
    refund_method?: "cash" | "transfer";
    fee_note?: string;
    refund_note?: string;
}

interface CancelFeeModalProps {
    isOpen: boolean;
    reservationId: string;
    guestName: string;
    onClose: () => void;
    onConfirm: (payload: CancelFeePayload) => void;
}

export default function CancelFeeModal({
    isOpen,
    reservationId,
    guestName,
    onClose,
    onConfirm
}: CancelFeeModalProps) {
    const [noFee, setNoFee] = useState(false);
    const [amount, setAmount] = useState("0");
    const [collectMethod, setCollectMethod] = useState<"cash" | "transfer" | "credit_card">("cash");
    const [refundMethod, setRefundMethod] = useState<"cash" | "transfer">("cash");
    const [feeNote, setFeeNote] = useState("Cancellation fee");
    const [refundNote, setRefundNote] = useState("Refund (Cancel)");
    const [cancelReason, setCancelReason] = useState("");
    const [showValidation, setShowValidation] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [prepaidNet, setPrepaidNet] = useState(0);
    const [feeCap, setFeeCap] = useState(0);
    const [warning, setWarning] = useState<string | null>(null);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setNoFee(true);
            setAmount("0");
            setCollectMethod("cash");
            setRefundMethod("cash");
            setFeeNote("Cancellation fee");
            setRefundNote("Refund (Cancel)");
            setCancelReason("");
            setShowValidation(false);
            setPreviewError("");
            setWarning(null);
            setPrepaidNet(0);
            setFeeCap(0);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !reservationId) return;
        let cancelled = false;
        setPreviewLoading(true);
        setPreviewError("");
        fetch(`/api/bookings/${reservationId}/settlement-preview?action=cancel`)
            .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
            .then(({ ok, data }) => {
                if (cancelled) return;
                if (!ok || !data?.success) {
                    setPreviewError(data?.error || "Failed to load cancellation settlement preview.");
                    return;
                }
                const previewPrepaid = Number(data.prepaid_net ?? 0);
                setPrepaidNet(previewPrepaid);
                setFeeCap(Number(data.fee_cap ?? previewPrepaid));
                setWarning(typeof data.warning === "string" ? data.warning : null);
                setNoFee(Boolean(data.default_no_fee));
                setRefundMethod(data.suggested_refund_method === "transfer" ? "transfer" : "cash");
            })
            .catch(() => {
                if (!cancelled) setPreviewError("Failed to load cancellation settlement preview.");
            })
            .finally(() => {
                if (!cancelled) setPreviewLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, reservationId]);

    if (!isOpen) return null;

    const trimmedReason = cancelReason.trim();
    const numAmount = Number.parseFloat(amount);
    const feeInputAmount = noFee ? 0 : (Number.isFinite(numAmount) ? numAmount : 0);
    const canUsePrepaidSettlement = prepaidNet > 0;
    const exceedsFeeCap = canUsePrepaidSettlement && !noFee && feeInputAmount > feeCap;
    const refundDuePreview = canUsePrepaidSettlement
        ? Math.max(0, prepaidNet - feeInputAmount)
        : 0;
    const reasonInvalid = showValidation && !trimmedReason;
    const amountInvalid = showValidation && !noFee && (
        !Number.isFinite(numAmount) || numAmount <= 0 || exceedsFeeCap
    );

    const handleSubmit = () => {
        setShowValidation(true);
        if (!trimmedReason) {
            return;
        }

        if (!noFee && (!Number.isFinite(numAmount) || numAmount <= 0 || exceedsFeeCap)) {
            return;
        }

        onConfirm({
            cancel_reason: trimmedReason,
            fee_amount: feeInputAmount > 0 ? feeInputAmount : undefined,
            fee_collect_method: !canUsePrepaidSettlement && feeInputAmount > 0 ? collectMethod : undefined,
            refund_method: canUsePrepaidSettlement ? refundMethod : undefined,
            fee_note: feeInputAmount > 0 ? feeNote.trim() : undefined,
            refund_note: canUsePrepaidSettlement && refundDuePreview > 0 ? refundNote.trim() : undefined,
        });
    };

    return (
        <PmsModal
            title="Cancel Reservation"
            size="sm"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-800 text-sm">
                    <strong>Cancelling {guestName || "Reservation"}</strong>
                    <p className="mt-1">
                        Are you sure you want to cancel this booking? This action cannot be reversed.
                    </p>
                    <div className="mt-2 text-xs">
                        Guest pre-paid: <span className="font-bold">฿{formatMoney(prepaidNet)}</span>
                    </div>
                    {warning && <p className="mt-2 text-xs text-rose-700">{warning}</p>}
                    {previewError && <p className="mt-2 text-xs text-rose-700">{previewError}</p>}
                </div>

                <div>
                    <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                        Cancellation Reason <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                        className="form-input w-full text-sm resize-none"
                        rows={2}
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        required
                        aria-invalid={reasonInvalid}
                        placeholder="E.g., Guest requested cancellation..."
                    />
                    {reasonInvalid && (
                        <p className="mt-1 text-xs text-rose-600">Cancellation reason is required.</p>
                    )}
                </div>

                <div className="flex items-center gap-2 mb-2">
                    <input
                        type="checkbox"
                        id="noFeeCancel"
                        checked={noFee}
                        onChange={(e) => setNoFee(e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-[var(--border-input)] focus:ring-brand-500"
                    />
                    <label htmlFor="noFeeCancel" className="text-sm font-semibold text-[var(--text-table-cell)] select-none cursor-pointer">
                        No fee
                    </label>
                </div>

                {!noFee && (
                    <div className="space-y-3 p-4 bg-[var(--bg-body)] border border-[var(--border-default)] rounded-lg animate-fade-in">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Penalty Amount (฿)
                            </label>
                            <input
                                type="number"
                                className="form-input w-full font-bold text-lg"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required={!noFee}
                                aria-invalid={amountInvalid}
                                min="1"
                                step="0.01"
                            />
                            {amountInvalid && (
                                <p className="mt-1 text-xs text-rose-600">
                                    {exceedsFeeCap
                                        ? `Fee amount must not exceed pre-paid (฿${formatMoney(feeCap)}).`
                                        : "Fee amount must be greater than 0."}
                                </p>
                            )}
                            {canUsePrepaidSettlement && (
                                <p className="mt-1 text-xs text-[var(--text-secondary)]">Fee cap: ฿{formatMoney(feeCap)}</p>
                            )}
                        </div>

                        {!canUsePrepaidSettlement && (
                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                    Collect Method
                                </label>
                                <select
                                    className="form-select w-full"
                                    value={collectMethod}
                                    onChange={(e) =>
                                        setCollectMethod(
                                            e.target.value === "transfer"
                                                ? "transfer"
                                                : e.target.value === "credit_card"
                                                    ? "credit_card"
                                                    : "cash"
                                        )
                                    }
                                >
                                    <option value="cash">Cash</option>
                                    <option value="transfer">Transfer</option>
                                    <option value="credit_card">Card</option>
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Fee Note
                            </label>
                            <input
                                type="text"
                                className="form-input w-full text-sm"
                                value={feeNote}
                                onChange={(e) => setFeeNote(e.target.value)}
                                placeholder="E.g., Late cancellation penalty..."
                            />
                        </div>
                    </div>
                )}

                {canUsePrepaidSettlement && (
                    <div className="space-y-3 p-4 bg-sky-50 border border-sky-200 rounded-lg">
                        <div className="text-xs font-bold text-sky-700 uppercase tracking-wider">Refund Summary</div>
                        <div className="text-sm text-[var(--text-table-cell)] space-y-1">
                            <p>Pre-paid: ฿{formatMoney(prepaidNet)}</p>
                            <p>Less fee: ฿{formatMoney(feeInputAmount)}</p>
                            <p className="font-semibold text-emerald-700">Refund due: ฿{formatMoney(refundDuePreview)}</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Refund Method
                            </label>
                            <select
                                className="form-select w-full"
                                value={refundMethod}
                                onChange={(e) => setRefundMethod(e.target.value === "transfer" ? "transfer" : "cash")}
                                disabled={previewLoading}
                            >
                                <option value="cash">Cash</option>
                                <option value="transfer">Transfer</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Refund Note
                            </label>
                            <input
                                type="text"
                                className="form-input w-full text-sm"
                                value={refundNote}
                                onChange={(e) => setRefundNote(e.target.value)}
                                placeholder="Refund (Cancel)"
                            />
                        </div>
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-default)]">
                    <button
                        className="btn bg-[var(--bg-surface)] border border-[var(--border-input)] text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]"
                        onClick={onClose}
                    >
                        Keep Booking
                    </button>
                    <button
                        className="btn bg-rose-600 hover:bg-rose-700 text-white font-bold px-4"
                        onClick={handleSubmit}
                        disabled={previewLoading}
                    >
                        Confirm Cancel
                    </button>
                </div>
            </div>
        </PmsModal>
    );
}
