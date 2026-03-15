import { useState, useEffect } from "react";
import PmsModal from "./pms-modal";
import { formatMoney } from "@/lib/money";

export interface PolicyFeePayload {
    fee_template_code: string;
    amount: number;
    payment_method: string;
    note: string;
}

interface LateCheckoutFeeModalProps {
    isOpen: boolean;
    isAfter1600: boolean;
    suggestedFee: number;
    onClose: () => void;
    onExtendStay: () => void;
    onConfirm: (payload: PolicyFeePayload | null) => void;
}

export default function LateCheckoutFeeModal({
    isOpen,
    isAfter1600,
    suggestedFee,
    onClose,
    onExtendStay,
    onConfirm
}: LateCheckoutFeeModalProps) {
    // 0: Initial warning (only if after 16:00), 1: Fee form
    const [step, setStep] = useState<0 | 1>(0);
    const [noFee, setNoFee] = useState(false);
    const [amount, setAmount] = useState(suggestedFee.toString());
    const [method, setMethod] = useState("cash");
    const [note, setNote] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setStep(isAfter1600 ? 0 : 1);
            setNoFee(false);
            setAmount(suggestedFee.toString());
            setMethod("cash");
            setNote("Late checkout fee");
            setShowValidation(false);
        }
    }, [isOpen, isAfter1600, suggestedFee]);

    if (!isOpen) return null;

    const numAmount = Number.parseFloat(amount);
    const amountInvalid = showValidation && !noFee && (!Number.isFinite(numAmount) || numAmount <= 0);

    const handleSubmit = () => {
        setShowValidation(true);
        if (noFee) {
            onConfirm(null); // Omit payload entirely
            return;
        }

        if (!Number.isFinite(numAmount) || numAmount <= 0) {
            return;
        }

        onConfirm({
            fee_template_code: "LATE_CHECKOUT_FEE",
            amount: numAmount,
            payment_method: method,
            note: note.trim()
        });
    };

    if (step === 0 && isAfter1600) {
        return (
            <PmsModal
                title="Late Checkout Warning"
                size="sm"
                onClose={onClose}
            >
                <div className="space-y-4">
                    <div className="bg-rose-50 border border-rose-200 rounded-lg p-5 flex flex-col items-center text-center">
                        <span className="text-3xl mb-2">⚠</span>
                        <h4 className="font-bold text-rose-800 text-lg">Checkout after 16:00</h4>
                        <p className="text-sm text-rose-700 mt-2">
                            The current time is past the late checkout limit. It is highly recommended to extend the reservation for 1 more night instead of processing a checkout.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 pt-4 border-t border-[var(--border-default)]">
                        <button
                            className="btn bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 shadow-sm w-full"
                            onClick={onExtendStay}
                        >
                            Extend Stay (Recommended)
                        </button>
                        <button
                            className="btn bg-[var(--bg-surface)] border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold w-full"
                            onClick={() => setStep(1)}
                        >
                            Continue Checkout
                        </button>
                    </div>
                </div>
            </PmsModal>
        );
    }

    return (
        <PmsModal
            title="Late Checkout Policy"
            size="sm"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
                    <strong>Late Departure Detected ({isAfter1600 ? "After 16:00" : "13:01 - 16:00"})</strong>
                    <p className="mt-1">
                        The suggested policy fee is {isAfter1600 ? "100%" : "50%"} of the last night's rate. You can adjust the amount or waive the fee entirely.
                    </p>
                </div>

                <div className="flex items-center gap-2 mb-2">
                    <input
                        type="checkbox"
                        id="noFeeLate"
                        checked={noFee}
                        onChange={(e) => setNoFee(e.target.checked)}
                        className="w-4 h-4 text-brand-600 rounded border-[var(--border-input)] focus:ring-brand-500"
                    />
                    <label htmlFor="noFeeLate" className="text-sm font-semibold text-[var(--text-table-cell)] select-none cursor-pointer">
                        No fee (Waive late checkout charge)
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
                                placeholder="E.g., Late check-out authorized..."
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
