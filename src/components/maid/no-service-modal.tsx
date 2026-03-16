import { useEffect, useState } from "react";
import { X } from "lucide-react";

export default function NoServiceModal({
    isOpen,
    roomNumber,
    onClose,
    onSubmit,
    isSubmitting
}: {
    isOpen: boolean;
    roomNumber: string;
    onClose: () => void;
    onSubmit: (note: string) => void;
    isSubmitting: boolean;
}) {
    const [note, setNote] = useState("");

    useEffect(() => {
        if (isOpen) {
            setNote("");
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
            <div
                className="w-full max-w-sm bg-[var(--bg-surface)] rounded-2xl shadow-xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-body)]">
                    <h3 className="font-bold text-[var(--text-primary)]">No Service Room {roomNumber}</h3>
                    <button
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-slate-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 flex-1">
                    <p className="text-sm text-[var(--text-muted)] mb-3">
                        ลูกค้างดทำความสะอาด / แขวนป้าย DND (Do Not Disturb)
                        ระบบจะเปิด Checklist ต่อเพื่อบันทึกของที่เติม/เปลี่ยนจริง
                    </p>

                    <label className="block text-sm font-semibold text-[var(--text-secondary)] mb-1.5">
                        Note (Optional)
                    </label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={isSubmitting}
                        placeholder="Type reason here e.g. DND Sign"
                        className="w-full p-3 border border-[var(--border-default)] rounded-xl bg-[var(--bg-surface)] text-sm outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all resize-none h-24"
                    />
                </div>

                <div className="p-4 pt-2 flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-3 rounded-xl font-bold text-[var(--text-secondary)] bg-[var(--bg-surface-hover)] hover:bg-slate-200 transition-colors text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSubmit(note)}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors text-sm disabled:opacity-50 flex justify-center items-center"
                    >
                        {isSubmitting ? (
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : "Confirm"}
                    </button>
                </div>
            </div>
        </div>
    );
}
