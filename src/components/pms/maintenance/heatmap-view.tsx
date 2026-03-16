"use client";

import { useMemo } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeatmapViewProps {
    rooms: any[];
    groupBy: "floor" | "type";
    onClickRoom?: (room_id: string) => void;
}

export function MaintenanceHeatmapView({ rooms, groupBy, onClickRoom }: HeatmapViewProps) {
    // Color gradient logic based on Phase 9 Rules (A5)
    const getHeatColor = (percent: number): string => {
        // 0-50%: green to yellow (HSL hue 120->60)
        // 50-100%: yellow to red (HSL hue 60->0)
        // >100%: solid red
        let hue = 120;
        if (percent > 100) hue = 0;
        else if (percent > 50) hue = 60 - ((percent - 50) / 50) * 60;
        else hue = 120 - (percent / 50) * 60;

        return `hsl(${hue}, 80%, 45%)`; // Slightly darker for text readiness
    };

    const getCellColor = (room: any) => {
        // Find the task with the highest warning/overdue percentage
        if (!room.tasks || room.tasks.length === 0) return "bg-emerald-100 text-emerald-800";

        let maxPercent = 0;
        let hasOverdue = false;

        room.tasks.forEach((t: any) => {
            if (t.status === 'OVERDUE') hasOverdue = true;
            const pct = (t.stays_since_last / t.threshold_count) * 100;
            if (pct > maxPercent) maxPercent = pct;
        });

        if (hasOverdue) return "bg-red-500 text-white animate-pulse shadow-md";

        // For normal/warning states, use gradient
        const color = getHeatColor(maxPercent);
        // Darken text if bg is bright (green/yellow), white if red/dark orange
        const textColor = maxPercent > 70 ? "text-white" : "text-[var(--text-primary)]";

        return { backgroundColor: color, color: textColor };
    };

    // Grouping logic
    const groupedRooms = useMemo(() => {
        const map = new Map<string | number, any[]>();
        rooms.forEach(room => {
            const key = groupBy === "floor" ? (room.floor_number || "Other") : room.room_type_code;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(room);
        });
        return Array.from(map.entries()).sort((a, b) => {
            if (typeof a[0] === 'number' && typeof b[0] === 'number') return a[0] - b[0];
            return String(a[0]).localeCompare(String(b[0]));
        });
    }, [rooms, groupBy]);

    return (
        <div className="space-y-8">
            {groupedRooms.map(([groupName, groupRooms]) => {
                // Floor Summary
                const overdue = groupRooms.filter(r => r.tasks.some((t: any) => t.status === 'OVERDUE')).length;
                const warning = groupRooms.filter(r => !r.tasks.some((t: any) => t.status === 'OVERDUE') && r.tasks.some((t: any) => t.status === 'WARNING')).length;

                return (
                    <div key={groupName} className="space-y-3 border p-4 rounded-xl bg-[var(--bg-body)]/30">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h3 className="font-semibold text-lg">
                                {groupBy === 'floor'
                                    ? `Floor ${typeof groupName === "number" ? groupName : groupName || "Other"}`
                                    : `Type: ${groupName}`}
                            </h3>
                            <div className="text-sm flex gap-3 text-muted-foreground font-medium">
                                {overdue > 0 && <span className="text-red-600">Overdue: {overdue}</span>}
                                {warning > 0 && <span className="text-amber-600">Warning: {warning}</span>}
                                <span className="text-[var(--text-muted)]">Total: {groupRooms.length} rooms</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 md:gap-3">
                            <TooltipProvider delayDuration={200}>
                                {groupRooms.map(room => {
                                    const styleProps = typeof getCellColor(room) === 'string'
                                        ? { className: `relative h-20 rounded-md border shadow-sm cursor-pointer transition-transform hover:scale-105 flex flex-col items-center justify-center ${getCellColor(room)}` }
                                        : {
                                            className: "relative h-20 rounded-md border shadow-sm cursor-pointer transition-transform hover:scale-105 flex flex-col items-center justify-center",
                                            style: getCellColor(room) as React.CSSProperties
                                        };

                                    return (
                                        <Tooltip key={room.room_id}>
                                            <TooltipTrigger asChild>
                                                <div
                                                    {...styleProps}
                                                    onClick={() => onClickRoom?.(room.room_id)}
                                                >
                                                    <span className="font-bold text-lg">{room.room_number}</span>

                                                    {/* Segmented Mini-bar */}
                                                    {room.tasks && room.tasks.length > 0 && (
                                                        <div className="absolute bottom-1 left-0 w-full px-2 flex gap-0.5 justify-center h-1.5 opacity-80">
                                                            {room.tasks.map((t: any, i: number) => {
                                                                let barBg = "bg-emerald-300";
                                                                if (t.status === 'OVERDUE') barBg = "bg-red-200";
                                                                else if (t.status === 'WARNING') barBg = "bg-amber-300";
                                                                return <div key={i} className={`flex-1 rounded-sm ${barBg}`} />;
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent className="w-64 p-0 shadow-lg border-muted">
                                                <div className="bg-slate-900 text-white p-2 font-semibold border-b border-slate-700">
                                                    Room {room.room_number} ({room.room_type_code})
                                                </div>
                                                <div className="p-2 space-y-2 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] max-h-60 overflow-y-auto">
                                                    {room.tasks.map((t: any) => (
                                                        <div key={t.task_id} className="border-b last:border-0 pb-2 last:pb-0">
                                                            <div className="flex justify-between font-medium">
                                                                <span>{t.task_name}</span>
                                                                <span className={t.status === 'OVERDUE' ? 'text-red-600' : t.status === 'WARNING' ? 'text-amber-600' : 'text-emerald-600'}>
                                                                    {Math.min(100, Math.round((t.stays_since_last / t.threshold_count) * 100))}%
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                                                                <span>Last done: {t.last_done_at ? new Date(t.last_done_at).toLocaleDateString() : 'Never'}</span>
                                                                <span>{t.stays_since_last} / {t.threshold_count} stays</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                })}
                            </TooltipProvider>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
