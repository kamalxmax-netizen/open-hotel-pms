"use client";

import React, { useState } from "react";
import type { CalendarReservation } from "@/lib/types";
import { formatDateRangeDisplay } from "@/lib/date-display";

// Helper strictly for the UI presentation
function getBadgeColor(source: string) {
    switch (source?.toLowerCase()) {
        case "walkin": return "bg-sky-500 text-white";
        case "ota": return "bg-purple-500 text-white";
        case "corporate": return "bg-pink-500 text-white";
        case "gov": return "bg-emerald-500 text-white";
        case "line": return "bg-[#06c755] text-white";
        case "agent": return "bg-slate-700 text-white";
        case "event": return "bg-orange-500 text-white";
        case "facebook": return "bg-blue-600 text-white";
        default: return "bg-slate-400 text-white";
    }
}

interface UnassignedSidebarProps {
    reservations: CalendarReservation[];
    onDragStart: (e: React.DragEvent<HTMLDivElement>, res: CalendarReservation) => void;
    onDropToPool?: (reservationId: string, fromRoomId: string) => void;
}

export function UnassignedSidebar({ reservations, onDragStart, onDropToPool }: UnassignedSidebarProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    // Sort by checkin date, then by room type
    const sorted = [...reservations].sort((a, b) => {
        if (a.checkin_date !== b.checkin_date) {
            return a.checkin_date.localeCompare(b.checkin_date);
        }
        return a.room_type.localeCompare(b.room_type);
    });

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        try {
            const payload = JSON.parse(e.dataTransfer.getData("application/json"));
            if (payload.type === "ASSIGNED" && onDropToPool) {
                onDropToPool(payload.reservation_id, payload.from_room_id);
            }
        } catch {
            // ignore invalid drop
        }
    };

    if (isCollapsed) {
        return (
            <div
                className="flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-body)] w-12 transition-all"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <button 
                    onClick={() => setIsCollapsed(false)}
                    className="p-3 hover:bg-[var(--bg-surface-hover)] transition-colors border-b border-[var(--border-default)] flex justify-center"
                    title="Expand Sidebar"
                >
                    <span className="text-xl leading-none">◀</span>
                </button>
                <div className="[writing-mode:vertical-rl] p-4 font-bold text-sm tracking-widest text-[var(--text-secondary)] whitespace-nowrap">
                    UNASSIGNED ({reservations.length})
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-body)] w-72 flex-shrink-0 transition-all overflow-hidden h-full"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <div className="flex items-center justify-between p-3 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2">
                    <h2 className="font-bold text-[var(--text-primary)] leading-none mt-1">Unassigned</h2>
                    <span className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {reservations.length}
                    </span>
                </div>
                <button 
                    onClick={() => setIsCollapsed(true)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    title="Collapse"
                >
                    <span className="text-xl leading-none">▶</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                {sorted.length === 0 ? (
                    <div className="text-center py-6 text-sm text-[var(--text-muted)] italic">
                        All bookings assigned
                    </div>
                ) : (
                    sorted.map(res => (
                        <div 
                            key={res.reservation_id}
                            draggable
                            onDragStart={(e) => onDragStart(e, res)}
                            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-2.5 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-500/50 cursor-grab active:cursor-grabbing transition-all select-none"
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${getBadgeColor(res.source)}`}>
                                    {res.source}
                                </span>
                                <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                                    {res.nights.length > 0 ? `${res.nights.length}N` : '0N'}
                                </span>
                            </div>
                            
                            <h3 className="font-bold text-sm text-[var(--text-primary)] truncate" title={res.guest_name}>
                                {res.guest_name}
                            </h3>
                            
                            <div className="flex flex-col gap-0.5 text-xs mt-1.5 text-[var(--text-secondary)]">
                                <div className="flex items-center gap-1.5">
                                    <span className="opacity-60">Type:</span>
                                    <span className="font-semibold truncate">{res.room_type}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="opacity-60">Dates:</span>
                                    <span className="font-medium whitespace-nowrap">{formatDateRangeDisplay(res.checkin_date, res.checkout_date, { separator: " → " })}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
