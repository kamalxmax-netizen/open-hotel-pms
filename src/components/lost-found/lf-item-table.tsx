"use client";

import { Eye, CheckCircle, CameraOff } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale";

interface LfItemTableProps {
    items: any[]; // Using any to bypass exact types, or we can use LostFoundItem
    isLoading: boolean;
    onViewDetail: (item: any) => void;
    onClaimClick: (item: any) => void;
}

export default function LfItemTable({ items, isLoading, onViewDetail, onClaimClick }: LfItemTableProps) {
    if (isLoading) {
        return (
            <div className="card p-8 flex justify-center text-[var(--text-muted)]">
                <div className="animate-pulse">Loading items...</div>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="card p-12 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4 text-[var(--text-muted)]">
                    <CheckCircle className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">No Items Found</h3>
                <p className="text-[var(--text-secondary)] mt-1">Try adjusting your filters or check the Expired tab.</p>
            </div>
        );
    }

    return (
        <div className="card overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-16 text-center shadow-[inset_-1px_0_0_var(--border-subtle)]">Photo</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-20">Room</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)]">Item Description</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-32">Category</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-48">Guest</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-32">Found Date</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-32">By</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-24">Status</th>
                            <th className="px-4 py-3 font-semibold text-[var(--text-secondary)] w-24 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                        {items.map((item) => (
                            <tr key={item.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors group">
                                <td className="px-4 py-3 text-center shadow-[inset_-1px_0_0_var(--border-subtle)]">
                                    {item.photo_url ? (
                                        <div className="w-10 h-10 mx-auto rounded overflow-hidden bg-slate-100 dark:bg-slate-800 border border-[var(--border-subtle)] group-hover:ring-2 ring-brand-400 transition-all cursor-pointer" onClick={() => onViewDetail(item)}>
                                            <img src={item.photo_url} alt="item photo" className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="w-10 h-10 mx-auto rounded bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-muted)]" title="No photo">
                                            <CameraOff className="w-4 h-4" />
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                                    {item.room_number || "No room"}
                                </td>
                                <td className="px-4 py-3">
                                    <p className="font-semibold text-[var(--text-primary)] line-clamp-1 truncate max-w-[200px]" title={item.description}>
                                        {item.description}
                                    </p>
                                </td>
                                <td className="px-4 py-3">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                        {item.category}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    {item.guest_name ? (
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-brand-600 dark:text-brand-400 truncate max-w-[150px] cursor-pointer hover:underline">
                                                {item.guest_name}
                                            </span>
                                            {item.booking_code && (
                                                <span className="text-[10px] text-[var(--text-muted)]">
                                                    {item.booking_code}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-[var(--text-muted)] italic">Unknown</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-[var(--text-secondary)]">
                                    {format(new Date(item.found_date), "dd MMM yy")}
                                </td>
                                <td className="px-4 py-3">
                                    <p className="truncate max-w-[100px] text-[var(--text-secondary)]" title={item.found_by}>
                                        {item.found_by}
                                    </p>
                                </td>
                                <td className="px-4 py-3">
                                    {item.status === 'pending' ? (
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                                            Pending
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                            Claimed
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button 
                                            onClick={() => onViewDetail(item)}
                                            className="p-1.5 rounded-md hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-900/30 dark:hover:text-brand-400 transition-colors text-[var(--text-muted)]"
                                            title="View Detail"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        {item.status === 'pending' && (
                                            <button 
                                                onClick={() => onClaimClick(item)}
                                                className="p-1.5 rounded-md hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400 transition-colors text-[var(--text-muted)]"
                                                title="Mark as Claimed"
                                            >
                                                <CheckCircle className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
