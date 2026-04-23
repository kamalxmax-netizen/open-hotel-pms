"use client";

import { AlertItem } from "@/lib/types/alerts";
import NationalityFlag from "@/components/nationality-flag";
import Link from "next/link";

type BaseCardProps = {
    item: AlertItem;
    isPreview: boolean;
    isAdmin: boolean;
    onSnooze: (id: string) => void;
    onClear: (id: string, note?: string) => void;
    onAdminClear: (id: string) => void;
    businessDate: string;
};

export function PrepaymentCard({ item, isPreview, isAdmin, onSnooze, onClear, onAdminClear, businessDate }: BaseCardProps) {
    const b = item.booking;
    const isProjected = item.daily_state_id.startsWith("projected:");
    
    // Status colors
    let bg = "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-500/30";
    if (item.status === 'snoozed') bg = "bg-slate-50 border-slate-200 dark:bg-slate-800/50 dark:border-slate-700/50 opacity-70";
    if (item.status === 'cleared_auto' || item.status === 'cleared_manual') bg = "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-500/30 opacity-60";
    if (item.status === 'cleared_admin_override') bg = "bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-500/30 opacity-60";

    const isCleared = item.status.startsWith('cleared');

    // Calculate days until
    const today = businessDate ? new Date(businessDate) : new Date();
    today.setHours(0,0,0,0);
    const checkIn = new Date(b.check_in_date);
    checkIn.setHours(0,0,0,0);
    const daysUntil = Math.round((checkIn.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    return (
        <div className={`rounded-xl border p-4 shadow-sm flex flex-col gap-3 transition-colors ${bg}`}>
            <div className="flex justify-between items-start gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-[var(--text-primary)] text-lg">
                            {b.guest_name}
                        </span>
                        {b.is_thai && (
                            <span title="Thai Customer">🇹🇭</span>
                        )}
                        {b.has_phone ? (
                            <span title="Phone available">📱</span>
                        ) : (
                            <span className="text-[var(--text-muted)]" title="No phone">—</span>
                        )}
                        {isCleared && (
                            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-bold ${
                                item.status === 'cleared_admin_override' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                                {item.status.replace('cleared_', '')}
                            </span>
                        )}
                        {isProjected && (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold bg-sky-100 text-sky-700">
                                projected
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-3 gap-y-1 mt-1">
                        {b.room_label && <span>🚪 {b.room_label}</span>}
                        <span>📅 Check-in: {b.check_in_date} ({daysUntil > 0 ? `In ${daysUntil} days` : daysUntil === 0 ? 'Today' : `${Math.abs(daysUntil)} days ago`})</span>
                        {b.channel && <span className="bg-[var(--bg-body)] border px-1 rounded">{b.channel}</span>}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <div className="font-bold text-amber-700 dark:text-amber-400 text-lg">
                        ฿{b.total_amount.toLocaleString()}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                        Paid: ฿{b.total_paid.toLocaleString()}
                    </div>
                </div>
            </div>

            {!isCleared && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-amber-200/50 dark:border-amber-500/20">
                    <Link href={`/pms/reservations?open=${encodeURIComponent(b.id)}`} className="btn btn-secondary btn-sm bg-[var(--bg-body)]" target="_blank">
                        เปิด Booking ↗
                    </Link>
                    
                    {!isPreview && (
                        <button className="btn btn-secondary btn-sm bg-[var(--bg-body)]" onClick={() => onSnooze(item.daily_state_id)}>
                            → Snooze พรุ่งนี้
                        </button>
                    )}
                    
                    {isPreview && !isProjected && (
                        <button className="btn btn-sm bg-amber-100 text-amber-800 hover:bg-amber-200" onClick={() => onClear(item.daily_state_id)}>
                            ทำล่วงหน้า (Clear)
                        </button>
                    )}

                    {isAdmin && !isPreview && (
                        <button className="btn btn-sm text-rose-700 hover:bg-rose-100 ml-auto" onClick={() => onAdminClear(item.daily_state_id)}>
                            🔴 Force-Clear (Admin)
                        </button>
                    )}
                </div>
            )}
            
            {isCleared && item.clear_note && (
                <div className="text-xs mt-2 p-2 rounded bg-[var(--bg-body)] opacity-80">
                    <span className="font-semibold text-[var(--text-secondary)]">Note:</span> {item.clear_note}
                    {item.cleared_by && <span className="text-[var(--text-muted)] ml-1">- {item.cleared_by}</span>}
                </div>
            )}
        </div>
    );
}

export function CustomAlarmCard({ item, isPreview, onSnooze, onClear, businessDate }: BaseCardProps) {
    const b = item.booking;
    const isProjected = item.daily_state_id.startsWith("projected:");
    
    // Status colors
    let bg = "bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-500/30";
    if (item.status === 'snoozed') bg = "bg-slate-50 border-slate-200 dark:bg-slate-800/50 dark:border-slate-700/50 opacity-70";
    if (item.status === 'cleared_manual') bg = "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-500/30 opacity-60";

    const isCleared = item.status === 'cleared_manual';

    return (
        <div className={`rounded-xl border p-4 shadow-sm flex flex-col gap-3 transition-colors ${bg}`}>
            <div className="flex justify-between items-start gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-indigo-700 dark:text-indigo-400">
                            ⏰ Custom Alarm
                        </span>
                        {isCleared && (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700">
                                Completed
                            </span>
                        )}
                        {isProjected && (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold bg-sky-100 text-sky-700">
                                projected
                            </span>
                        )}
                    </div>
                    <p className="text-sm font-medium text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                        {item.note}
                    </p>
                    <div className="text-xs text-[var(--text-muted)] mt-2 flex gap-2">
                        <span>Ref: {b.booking_code || 'N/A'}</span>
                        <span>•</span>
                        <span>{b.guest_name}</span>
                    </div>
                </div>
            </div>

            {!isCleared && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-indigo-200/50 dark:border-indigo-500/20">
                    <Link href={`/pms/reservations?open=${encodeURIComponent(b.id)}`} className="btn btn-secondary btn-sm bg-[var(--bg-body)]" target="_blank">
                        เปิด Booking ↗
                    </Link>
                    
                    {!isPreview && (
                        <>
                            <button className="btn btn-sm bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => onClear(item.daily_state_id)}>
                                ✓ เสร็จ + Note
                            </button>
                            <button className="btn btn-secondary btn-sm bg-[var(--bg-body)] ml-auto" onClick={() => onSnooze(item.daily_state_id)}>
                                → Snooze
                            </button>
                        </>
                    )}
                    
                    {isPreview && !isProjected && (
                        <button className="btn btn-sm bg-indigo-100 text-indigo-800 hover:bg-indigo-200" onClick={() => onClear(item.daily_state_id)}>
                            ทำล่วงหน้า (Clear)
                        </button>
                    )}
                </div>
            )}
            
            {isCleared && item.clear_note && (
                <div className="text-xs mt-2 p-2 rounded bg-[var(--bg-body)] opacity-80">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">✓ Done:</span> {item.clear_note}
                </div>
            )}
        </div>
    );
}
