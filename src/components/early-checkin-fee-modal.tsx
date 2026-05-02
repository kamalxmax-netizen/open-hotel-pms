import { useState, useEffect } from "react";
import PmsModal from "./pms-modal";
import { formatMoney } from "@/lib/money";

export interface PolicyFeePayload {
    fee_template_code: string;
    amount: number;
    payment_method: string;
    note: string;
    waived?: boolean;
    fee_collect_method?: "cash" | "transfer" | "credit_card";
    refund_method?: "cash" | "transfer";
    refund_note?: string;
}

interface EarlyCheckinFeeModalProps {
    isOpen: boolean;
    suggestedFee: number;
    onClose: () => void;
    onConfirm: (payload: PolicyFeePayload | null) => void;
}

export default function EarlyCheckinFeeModal({
    isOpen,
    suggestedFee,
    onClose,
    onConfirm
}: EarlyCheckinFeeModalProps) {
    const [noFee, setNoFee] = useState(false);
    const [amount, setAmount] = useState(suggestedFee.toString());
    const [method, setMethod] = useState("cash");
    const [note, setNote] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    // Reset state when opened or suggested fee changes
    useEffect(() => {
        if (isOpen) {
            setNoFee(false);
            setAmount(suggestedFee.toString());
            setMethod("cash");
            setNote("Early check-in fee");
            setShowValidation(false);
        }
    }, [isOpen, suggestedFee]);

    if (!isOpen) return null;

    const numAmount = Number.parseFloat(amount);
    const amountInvalid = showValidation && !noFee && (!Number.isFinite(numAmount) || numAmount <= 0);

    const handleSubmit = () => {
        setShowValidation(true);
        if (noFee) {
            onConfirm({
                fee_template_code: "EARLY_CHECKIN_FEE",
                amount: 0,
                payment_method: "cash",
                note: "Early check-in fee waived",
                waived: true,
            });
            return;
        }

        if (!Number.isFinite(numAmount) || numAmount <= 0) {
            return;
        }

        onConfirm({
            fee_template_code: "EARLY_CHECKIN_FEE",
            amount: numAmount,
            payment_method: method,
            note: note.trim()
        });
    };

    return (
        <PmsModal
            title="Early Check-in Policy"
            size="sm"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
                    <strong>Early Arrival Detected (04:00 - 08:59)</strong>
                    <p className="mt-1">
                        The suggested policy fee is 50% of the first night's rate. You can adjust the amount or waive the fee entirely.
                    </p>
                </div>

                <div className="flex items-center gap-2 mb-2">
                    <input
                        type="checkbox"
                        id="noFeeEarly"
                        checked={noFee}
                        onChange={(e) => setNoFee(e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-[var(--border-input)] focus:ring-brand-500"
                    />
                    <label htmlFor="noFeeEarly" className="text-sm font-semibold text-[var(--text-table-cell)] select-none cursor-pointer">
                        No fee (Waive early check-in charge)
                    </label>
                </div>

                {!noFee && (
                    <div className="space-y-3 p-4 bg-[var(--bg-body)] border border-[var(--border-default)] rounded-lg animate-fade-in">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Fee Amount (฿)
                            </label>
                            <input
                                type="number"
                                className="form-input w-full font-bold text-lg"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required={!noFee}
                                aria-invalid={amountInvalid}
                                min="1"
                                step="1"
                            />
                            {amountInvalid && (
                                <div className="text-xs text-rose-600 mt-1">Fee amount must be greater than 0.</div>
                            )}
                            <div className="text-xs text-[var(--text-secondary)] mt-1">
                                Suggested: ฿{formatMoney(suggestedFee)}
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                                Payment Method
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
                                placeholder="E.g., Early flight arrival..."
                            />
                        </div>
                    </div>
                )}

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
                        Confirm & Continue
                    </button>
                </div>
            </div>
        </PmsModal>
    );
}
