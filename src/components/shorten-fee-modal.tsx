import { useState, useEffect } from "react";
import PmsModal from "./pms-modal";
import { formatMoney } from "@/lib/money";
import type { PolicyFeePayload } from "./early-checkin-fee-modal";

type ShortenSettlementPreview = {
    prepaid_net: number;
    old_total: number;
    new_total: number;
    overpaid: number;
    fee_cap: number;
    default_no_fee: boolean;
    warning?: string | null;
    suggested_refund_method?: "cash" | "transfer";
};

interface ShortenFeeModalProps {
    isOpen: boolean;
    preview: ShortenSettlementPreview | null;
    onClose: () => void;
    onConfirm: (payload: PolicyFeePayload) => void;
}

export default function ShortenFeeModal({
    isOpen,
    preview,
    onClose,
    onConfirm
}: ShortenFeeModalProps) {
    const [noFee, setNoFee] = useState(false);
    const [amount, setAmount] = useState("0");
    const [method, setMethod] = useState("cash");
    const [note, setNote] = useState("");
    const [refundMethod, setRefundMethod] = useState<"cash" | "transfer">("cash");
    const [refundNote, setRefundNote] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setNoFee(Boolean(preview?.default_no_fee));
            setAmount("0");
            setMethod("cash");
            setNote("Shorten stay fee");
            setRefundMethod(preview?.suggested_refund_method === "transfer" ? "transfer" : "cash");
            setRefundNote("Refund (Shorten)");
            setShowValidation(false);
        }
    }, [isOpen, preview?.default_no_fee, preview?.suggested_refund_method]);

    if (!isOpen) return null;

    const feeCap = Number(preview?.fee_cap ?? 0);
    const prepaidNet = Number(preview?.prepaid_net ?? 0);
    const overpaid = Number(preview?.overpaid ?? 0);
    const numAmount = Number.parseFloat(amount);
    const feeInputAmount = noFee ? 0 : (Number.isFinite(numAmount) ? numAmount : 0);
    const exceedsCap = !noFee && feeCap > 0 && feeInputAmount > feeCap;
    const amountInvalid = showValidation && !noFee && (
        !Number.isFinite(numAmount) || numAmount <= 0 || exceedsCap
    );
    const refundDuePreview = Math.max(0, overpaid - feeInputAmount);

    const handleSubmit = () => {
        setShowValidation(true);
        if (!noFee && (!Number.isFinite(numAmount) || numAmount <= 0 || exceedsCap)) {
            return;
        }

        onConfirm({
            fee_template_code: "SHORTEN_FEE",
            amount: noFee ? 0 : numAmount,
            payment_method: method,
            fee_collect_method: method === "cash" || method === "transfer" || method === "credit_card"
                ? method
                : "cash",
            note: note.trim() || "Shorten stay fee",
            refund_method: refundMethod,
            refund_note: refundNote.trim() || "Refund (Shorten)"
        });
    };

    return (
        <PmsModal
            title="Shorten Stay Settlement"
            size="sm"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                    <strong>Reduced Stay Duration</strong>
                    <div className="mt-2 space-y-1 text-xs">
                        <p>Pre-paid: <span className="font-bold">฿{formatMoney(prepaidNet)}</span></p>
                        <p>Original total: <span className="font-bold">฿{formatMoney(Number(preview?.old_total ?? 0))}</span></p>
                        <p>New total: <span className="font-bold">฿{formatMoney(Number(preview?.new_total ?? 0))}</span></p>
                        <p>Overpaid: <span className="font-bold">฿{formatMoney(overpaid)}</span></p>
                    </div>
                    {preview?.warning && (
                        <p className="mt-2 text-xs text-amber-700">{preview.warning}</p>
                    )}
                </div>

                <div className="flex items-center gap-2 mb-2">
                    <input
                        type="checkbox"
                        id="noFeeShorten"
                        checked={noFee}
                        onChange={(e) => setNoFee(e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-[var(--border-input)] focus:ring-brand-500"
                    />
                    <label htmlFor="noFeeShorten" className="text-sm font-semibold text-[var(--text-table-cell)] select-none cursor-pointer">
                        No fee (Waive shorten stay penalty)
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
                                className="form-input w-full font-bold text-lg dark:aria-invalid:bg-rose-500/10"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required={!noFee}
                                aria-invalid={amountInvalid}
                                min="1"
                                step="0.01"
                            />
                            {amountInvalid && (
                                <p className="mt-1 text-xs text-rose-600">
                                    {exceedsCap
                                        ? `Penalty amount must not exceed overpaid (฿${formatMoney(feeCap)}).`
                                        : "Penalty amount must be greater than 0."}
                                </p>
                            )}
                            {feeCap > 0 && (
                                <p className="mt-1 text-xs text-[var(--text-secondary)]">Fee cap: ฿{formatMoney(feeCap)}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Collect Method (for no pre-paid path)
                            </label>
                            <select
                                className="form-select w-full"
                                value={method}
                                onChange={(e) => setMethod(e.target.value)}
                            >
                                <option value="cash">Cash</option>
                                <option value="transfer">Transfer</option>
                                <option value="credit_card">Card</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Note
                            </label>
                            <input
                                type="text"
                                className="form-input w-full text-sm"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="E.g., 1 night penalty..."
                            />
                        </div>
                    </div>
                )}

                <div className="space-y-3 p-4 bg-sky-50 border border-sky-200 rounded-lg dark:bg-sky-500/10 dark:border-sky-500/30">
                    <div className="text-xs font-bold text-sky-700 uppercase tracking-wider dark:text-sky-400">Refund Summary</div>
                    <div className="text-sm text-[var(--text-table-cell)] space-y-1">
                        <p>Overpaid: ฿{formatMoney(overpaid)}</p>
                        <p>Less fee: ฿{formatMoney(feeInputAmount)}</p>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-400">Refund due: ฿{formatMoney(refundDuePreview)}</p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                            Refund Method
                        </label>
                        <select
                            className="form-select w-full"
                            value={refundMethod}
                            onChange={(e) => setRefundMethod(e.target.value === "transfer" ? "transfer" : "cash")}
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
                            placeholder="Refund (Shorten)"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-default)]">
                    <button
                        className="btn bg-[var(--bg-surface)] border border-[var(--border-input)] text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                    >
                        Confirm & Update Dates
                    </button>
                </div>
            </div>
        </PmsModal>
    );
}
