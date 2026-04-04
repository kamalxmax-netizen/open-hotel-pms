"use client";

import { CameraOff, CheckSquare, Square } from "lucide-react";
import { format } from "date-fns";

interface LfExpiredTableProps {
    items: any[];
    isLoading: boolean;
    selectedIds: string[];
    onToggleSelect: (id: string) => void;
    onToggleSelectAll: () => void;
}

export default function LfTableExpired({ items, isLoading, selectedIds, onToggleSelect, onToggleSelectAll }: LfExpiredTableProps) {
    if (isLoading) {
        return (
            <div className="card p-8 flex justify-center text-[var(--text-muted)]">
                <div className="animate-pulse">Loading expired items...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="card p-12 flex flex-col items-center justify-center text-center">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">No Expired Items</h3>
                <p className="text-[var(--text-secondary)] mt-1">There are no unclaimed items older than 1 year.</p>
            </div>
        );
    }

    const allSelected = items.length > 0 && selectedIds.length === items.filter(i => !i.cleared_at).length;

    return (
        <div className="card overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                            <th className="px-4 py-3 w-12 text-center" onClick={onToggleSelectAll}>
                                <button className="text-[var(--text-muted)] hover:text-brand-500 transition-colors">
                                    {allSelected ? <CheckSquare className="w-5 h-5 text-brand-500" /> : <Square className="w-5 h-5" />}
                                </button>
                            </th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-16 text-center shadow-[inset_-1px_0_0_var(--border-subtle)]">Photo</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-20">Room</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)]">Item Description</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-48">Guest</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-32">Found Date</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-32">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                        {items.map((item) => {
                            const isCleared = !!item.cleared_at;
                            const isSelected = selectedIds.includes(item.id);
                            
                            return (
                                <tr key={item.id} className={`transition-colors ${isCleared ? "bg-[var(--bg-muted)] opacity-60" : isSelected ? "bg-brand-50 dark:bg-brand-900/20" : "hover:bg-[var(--bg-surface-hover)]"}`}>
                                    <td className="px-4 py-3 text-center">
                                        {!isCleared && (
                                            <button onClick={() => onToggleSelect(item.id)} className="text-[var(--text-muted)] hover:text-brand-500 transition-colors">
                                                {isSelected ? <CheckSquare className="w-5 h-5 text-brand-500" /> : <Square className="w-5 h-5" />}
                                            </button>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center shadow-[inset_-1px_0_0_var(--border-subtle)]">
                                        {item.photo_path ? (
                                            <div className="w-10 h-10 mx-auto rounded overflow-hidden bg-slate-100 dark:bg-slate-800 border border-[var(--border-subtle)]">
                                                <img src={`/api/lost-found/${item.id}/photo`} alt="item photo" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 mx-auto rounded bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-muted)]" title="No photo">
                                                <CameraOff className="w-4 h-4" />
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                                        {item.room_number || "-"}
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className={`font-semibold text-[var(--text-primary)] ${isCleared ? "line-through text-[var(--text-muted)]" : ""}`}>
                                            {item.description}
                                        </p>
                                    </td>
                                    <td className="px-4 py-3 text-[var(--text-primary)]">
                                        {item.guest_name || "-"}
                                    </td>
                                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                                        {format(new Date(item.found_date), "yyyy-MM")}
                                    </td>
                                    <td className="px-4 py-3">
                                        {isCleared ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                                Cleared
                                            </span>
                                        ) : (
                                            <span className="text-rose-600 dark:text-rose-400 font-semibold text-xs">
                                                Expired (&gt;1yr)
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
