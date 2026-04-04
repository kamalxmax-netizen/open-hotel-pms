"use client";

import { LostFoundGuestAlert } from "@/lib/types";
import { AlertCircle, Package, X } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";

interface LfReturnGuestPopupProps {
    data: LostFoundGuestAlert;
    onClose: () => void;
}

export default function LfReturnGuestPopup({ data, onClose }: LfReturnGuestPopupProps) {
    if (!data.items?.length) return null;

    return (
        <div className="modal-overlay z-[200]">
            <div className="modal-panel md p-0 overflow-hidden ring-1 ring-rose-500/50 shadow-[0_0_40px_-10px_rgba(244,63,94,0.3)]">
                <div className="flex items-center justify-between border-b border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 px-5 py-4">
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <span>Lost & Found Alert</span>
                    </div>
                    <button onClick={onClose} className="rounded-full p-1 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-5 overflow-y-auto max-h-[60vh]">
                    <p className="text-sm font-medium mb-4 text-[var(--text-primary)]">
                        Guest <span className="font-bold">"{data.guest_name || "Unknown"}"</span> มีของลืมจากการเข้าพักครั้งก่อน:
                    </p>
                    
                    <div className="space-y-3">
                        {data.items.map(item => (
                            <div key={item.id} className="flex gap-3 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-body)]">
                                <div className="mt-0.5 text-slate-400">
                                    <Package className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <p className="font-bold text-sm text-[var(--text-primary)] leading-tight mb-1">{item.description}</p>
                                    <p className="text-xs text-[var(--text-secondary)]">
                                        Room {item.room_number || "-"} · Booking {item.booking_code || "-"} · พบ {format(new Date(item.found_date), "d MMM yyyy", { locale: th })}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-[var(--border-default)] bg-[var(--bg-body)]">
                    <Link 
                        href={`/pms/lost-found?guest_id=${data.guest_profile_id}`}
                        onClick={onClose}
                        className="btn-ghost flex-1 justify-center border border-[var(--border-strong)] text-[var(--text-secondary)] font-semibold text-sm hover:bg-[var(--bg-surface-hover)]"
                    >
                        View in L&F
                    </Link>
                    <button 
                        onClick={onClose}
                        className="btn-primary flex-1 justify-center bg-rose-500 hover:bg-rose-600 focus:ring-rose-500 text-white font-semibold text-sm"
                    >
                        OK, Acknowledge
                    </button>
                </div>
            </div>
        </div>
    );
}
