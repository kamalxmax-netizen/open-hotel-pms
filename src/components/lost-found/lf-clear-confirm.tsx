"use client";

import { useState } from "react";
import { X, Trash2, Loader2, AlertTriangle } from "lucide-react";

interface LfClearConfirmProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    selectedIds: string[];
}

export default function LfClearConfirm({ isOpen, onClose, onSuccess, selectedIds }: LfClearConfirmProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            // In a real app we'd likely have a batch endpoint, but per specs we call clear API per item
            // or the API handles it. The spec says "call clear API per item"
            const promises = selectedIds.map(id => 
                fetch(`/api/lost-found/${id}/clear`, { method: "POST" })
            );

            const results = await Promise.allSettled(promises);
            
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
                console.error("Some items failed to clear", failed);
                // Even if some failed, we probably want to refresh
            }

            onSuccess();
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-panel sm">
                <div className="p-6">
                    <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-4">
                        <Trash2 className="w-6 h-6" />
                    </div>
                    <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Clear {selectedIds.length} Expired Items?</h2>
                    
                    <p className="text-[var(--text-secondary)] text-sm mb-4">
                        You are about to soft-delete <span className="font-bold text-[var(--text-primary)]">{selectedIds.length} item(s)</span>. 
                        These items have been unclaimed for over 1 year.
                    </p>

                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-900/40 flex gap-3 text-sm text-amber-800 dark:text-amber-400">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <div>
                            <p className="font-bold">Permanent Action</p>
                            <p className="mt-0.5">This action will permanently delete any associated photos from the storage to save space.</p>
                        </div>
                    </div>

                    {error && <p className="text-sm font-medium text-rose-500 mt-4">{error}</p>}
                </div>
                
                <div className="modal-footer bg-[var(--bg-body)]">
                    <button 
                        type="button" 
                        onClick={onClose} 
                        disabled={isSubmitting}
                        className="btn-ghost font-semibold text-[var(--text-secondary)]"
                    >
                        Cancel
                    </button>
                    <button 
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className="btn-primary bg-rose-600 hover:bg-rose-700 focus:ring-rose-500 text-white font-bold"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                Clearing...
                            </>
                        ) : (
                            "Yes, Clear Items"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
