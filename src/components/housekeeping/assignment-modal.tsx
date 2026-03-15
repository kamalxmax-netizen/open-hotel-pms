import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";

type AssignmentRoom = {
    room_id: string;
    room_number: string;
    plan_assigned_maid: string | null;
    plan_priority: number | null;
};

export default function AssignmentModal({
    isOpen,
    room,
    onClose,
    onSave,
    isSubmitting,
    maidNames
}: {
    isOpen: boolean;
    room: AssignmentRoom | null;
    onClose: () => void;
    onSave: (roomId: string, maidName: string, priority: number) => void;
    isSubmitting: boolean;
    maidNames: string[];
}) {
    const fallbackMaids = useMemo(
        () => (maidNames.length > 0 ? maidNames : ["Jan", "Tan", "Others"]),
        [maidNames]
    );
    const [maid, setMaid] = useState<string>(fallbackMaids[0]);
    const [priority, setPriority] = useState<number>(1);

    useEffect(() => {
        if (isOpen && room) {
            setMaid(room.plan_assigned_maid || fallbackMaids[0]);
            setPriority(room.plan_priority || 1);
        }
    }, [isOpen, room, fallbackMaids]);

    if (!isOpen || !room) return null;

    const normalizedPriority = Math.trunc(priority);
    const isPriorityValid =
        Number.isFinite(priority) &&
        Number.isInteger(normalizedPriority) &&
        normalizedPriority >= 1 &&
        normalizedPriority <= 15;
    const canSave = maid.trim().length > 0 && isPriorityValid && !isSubmitting;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[var(--bg-surface)] rounded-2xl shadow-xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-body)]">
                    <h3 className="font-bold text-slate-800">Assign Maid - Room {room.room_number}</h3>
                    <button
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-slate-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-[var(--text-table-cell)] mb-1.5">Select Maid</label>
                        <select
                            value={maid}
                            onChange={e => setMaid(e.target.value)}
                            disabled={isSubmitting}
                            className="w-full rounded-xl border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                        >
                            {fallbackMaids.map((m: string) => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-[var(--text-table-cell)] mb-1.5">Priority (1-15)</label>
                        <input
                            type="number"
                            min={1}
                            max={15}
                            value={priority}
                            onChange={e => setPriority(Number(e.target.value))}
                            disabled={isSubmitting}
                            className="w-full rounded-xl border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                        />
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">1 = Highest Priority (Morning), 15 = Lowest</p>
                        {!isPriorityValid && (
                            <p className="text-[11px] text-rose-600 mt-1">Priority must be a number between 1 and 15.</p>
                        )}
                    </div>
                </div>

                <div className="p-4 bg-[var(--bg-body)] flex justify-end gap-2 border-t border-[var(--border-subtle)]">
                    <button onClick={onClose} disabled={isSubmitting} className="px-4 py-2 rounded-xl text-sm font-bold text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-input)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                        Cancel
                    </button>
                    <button onClick={() => onSave(room.room_id, maid, normalizedPriority)} disabled={!canSave} className="flex-1 px-4 py-2 rounded-xl text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex justify-center items-center">
                        {isSubmitting ? (
                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : "Save Assignment"}
                    </button>
                </div>
            </div>
        </div>
    );
}
