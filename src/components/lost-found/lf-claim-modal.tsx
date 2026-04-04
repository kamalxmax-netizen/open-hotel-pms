"use client";

import { useState } from "react";
import { CheckCircle, X } from "lucide-react";

interface LfClaimModalProps {
    item: any;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function LfClaimModal({ item, isOpen, onClose, onSuccess }: LfClaimModalProps) {
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen || !item) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!note.trim()) {
            setError("Claim note is required");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const res = await fetch(`/api/lost-found/${item.id}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ claim_note: note.trim() })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || "Failed to claim item");
            }

            setNote("");
            onSuccess();
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-panel md">
                <div className="modal-header">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">Claim Item</h2>
                    <button onClick={onClose} className="rounded-full p-1.5 hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="mb-4 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{item.description}</p>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">Found on {item.found_date}</p>
                        </div>

                        <div className="mb-2">
                            <label className="form-label">Claim Note <span className="text-rose-500">*</span></label>
                            <textarea 
                                className="form-input min-h-[100px] resize-none"
                                placeholder="E.g. Guest picked it up at front desk, sent via Express delivery..."
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                required
                            />
                            {error && <p className="text-xs text-rose-500 mt-2 font-medium">{error}</p>}
                        </div>
                        
                        <div className="mt-4 p-3 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-400 text-xs flex items-start gap-2">
                            <span className="text-amber-500 font-bold">!</span>
                            <p>Marking this item as claimed will permanently delete any associated photos from the system.</p>
                        </div>
                    </div>
                    
                    <div className="modal-footer bg-[var(--bg-body)]">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            disabled={isSubmitting}
                            className="btn-ghost font-semibold"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                            {isSubmitting ? "Claiming..." : (
                                <>
                                    <CheckCircle className="w-4 h-4 mr-1.5" />
                                    Confirm Claim
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
