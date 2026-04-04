"use client";

import { X, Calendar, User, Package, MapPin, CheckCircle, CameraOff } from "lucide-react";
import { format } from "date-fns";
import { th } from "date-fns/locale";

interface LfDetailDrawerProps {
    item: any;
    isOpen: boolean;
    onClose: () => void;
    onClaimClick: (item: any) => void;
}

export default function LfDetailDrawer({ item, isOpen, onClose, onClaimClick }: LfDetailDrawerProps) {
    if (!isOpen || !item) return null;

    return (
        <>
            <div className="drawer-overlay" onClick={onClose} />
            <div className="drawer-panel pb-6 overflow-hidden">
                <div className="drawer-header border-b border-[var(--border-default)]">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">Item Details</h2>
                    <button onClick={onClose} className="rounded-full p-2 hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* Photo Area */}
                    <div className="w-full h-64 bg-slate-100 dark:bg-slate-800 border-b border-[var(--border-subtle)] relative flex items-center justify-center">
                        {item.photo_url ? (
                            <img src={item.photo_url} alt="Lost item" className="max-w-full max-h-full object-contain" />
                        ) : (
                            <div className="flex flex-col items-center text-[var(--text-muted)]">
                                <CameraOff className="w-10 h-10 mb-2 opacity-50" />
                                <span className="text-sm font-medium">No photo available</span>
                            </div>
                        )}
                        {item.status === 'claimed' && (
                            <div className="absolute top-4 right-4 bg-emerald-500 text-white px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-lg border border-emerald-400">
                                <CheckCircle className="w-4 h-4" />
                                Claimed
                            </div>
                        )}
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Item Description & Meta */}
                        <div>
                            <div className="flex items-start justify-between gap-4 mb-2">
                                <h3 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{item.description}</h3>
                            </div>
                            <div className="flex flex-wrap gap-2 text-sm text-[var(--text-secondary)]">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-muted)] font-medium">
                                    <Package className="w-4 h-4" />
                                    {item.category}
                                </span>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-muted)] font-medium">
                                    <MapPin className="w-4 h-4" />
                                    {item.room_number ? `Room ${item.room_number}` : "No room"}
                                </span>
                                {item.location_detail && (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-muted)] font-medium">
                                        Loc: {item.location_detail}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Guest & Reservation */}
                        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-body)]">
                            <h4 className="text-xs font-bold tracking-wider text-[var(--text-muted)] uppercase mb-3 px-1">Guest & Booking Info</h4>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center text-brand-600 dark:text-brand-400">
                                        <User className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-[var(--text-primary)]">{item.guest_name || "Unknown Guest"}</p>
                                        {item.guest_profile_id && (
                                            <a href={`/pms/profiles/${item.guest_profile_id}`} className="text-xs text-brand-500 hover:underline">View Profile</a>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                        <Calendar className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">Booking: {item.booking_code || "-"}</p>
                                        <p className="text-xs text-[var(--text-secondary)]">Stay: {item.checkin_date} to {item.checkout_date}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Timeline */}
                        <div className="relative pl-6 space-y-6 before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[var(--border-default)] before:to-transparent">
                            <div className="relative">
                                <div className="absolute left-0 top-1 w-5 h-5 -ml-6 bg-[var(--bg-surface)] ring-4 ring-[var(--bg-surface)] rounded-full flex items-center justify-center">
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-400"></div>
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--text-primary)]">Reported Found</h4>
                                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                        {format(new Date(item.found_date), "dd MMM yyyy")} by <span className="font-medium text-[var(--text-primary)]">{item.found_by}</span>
                                    </p>
                                </div>
                            </div>

                            {item.status === 'claimed' && (
                                <div className="relative">
                                    <div className="absolute left-0 top-1 w-5 h-5 -ml-6 bg-[var(--bg-surface)] ring-4 ring-[var(--bg-surface)] rounded-full flex items-center justify-center">
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">Claimed</h4>
                                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                            {item.claimed_at ? format(new Date(item.claimed_at), "dd MMM yyyy HH:mm") : "-"} by <span className="font-medium text-[var(--text-primary)]">{item.claimed_by || "-"}</span>
                                        </p>
                                        {item.claim_note && (
                                            <div className="mt-2 text-sm p-3 rounded bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800/50">
                                                <span className="font-semibold block mb-1">Note:</span>
                                                {item.claim_note}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                {item.status === 'pending' && (
                    <div className="drawer-footer bg-[var(--bg-body)]">
                        <button 
                            onClick={() => onClaimClick(item)}
                            className="btn-primary w-full justify-center bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 shadow-lg shadow-emerald-600/20"
                        >
                            <CheckCircle className="w-5 h-5 mr-2" />
                            Mark as Claimed
                        </button>
                        <p className="text-[10px] text-center text-[var(--text-muted)] mt-3 flex items-center justify-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            Photo will be permanently deleted after claiming
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}
