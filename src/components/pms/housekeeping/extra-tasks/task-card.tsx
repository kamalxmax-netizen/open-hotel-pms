"use client";

import { useState, useEffect } from "react";
import { ExtraTaskAssignment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PlayIcon, PauseIcon, CheckIcon, XIcon, ClockIcon } from "lucide-react";

interface ExtraTaskCardProps {
    assignment: ExtraTaskAssignment;
    onStatusChange: (
        id: string,
        action: "start" | "pause" | "finish" | "cancel",
        notes?: string
    ) => Promise<void>;
    disabled?: boolean;
}

const STATUS_STYLES: Record<string, { border: string; badge: string; label: string }> = {
    pending: { border: "border-l-slate-300", badge: "bg-slate-100 text-slate-600", label: "Pending" },
    in_progress: { border: "border-l-sky-500", badge: "bg-sky-100 text-sky-700", label: "In Progress" },
    paused: { border: "border-l-amber-400", badge: "bg-amber-100 text-amber-700", label: "Paused" },
    done: { border: "border-l-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Done" },
    cancelled: { border: "border-l-red-400", badge: "bg-red-100 text-red-600", label: "Cancelled" },
};

export function ExtraTaskCard({ assignment, onStatusChange, disabled }: ExtraTaskCardProps) {
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [elapsedMs, setElapsedMs] = useState(assignment.accumulated_ms);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (assignment.status === "in_progress" && assignment.started_at) {
            const startTime = new Date(assignment.started_at).getTime();
            const initialAccumulated = assignment.accumulated_ms;
            interval = setInterval(() => {
                setElapsedMs(initialAccumulated + Math.max(0, Date.now() - startTime));
            }, 1000);
        } else {
            setElapsedMs(assignment.accumulated_ms);
        }
        return () => { if (interval) clearInterval(interval); };
    }, [assignment.status, assignment.started_at, assignment.accumulated_ms]);

    const handleAction = async (action: "start" | "pause" | "finish" | "cancel") => {
        try {
            setLoadingAction(action);
            await onStatusChange(assignment.id, action);
        } finally {
            setLoadingAction(null);
        }
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    const style = STATUS_STYLES[assignment.status] || STATUS_STYLES.pending;
    const isWorking = assignment.status === "in_progress" || assignment.status === "paused";
    const isDone = assignment.status === "done" || assignment.status === "cancelled";
    const isLoading = loadingAction !== null;

    return (
        <div className={`bg-white rounded-lg border border-l-4 ${style.border} shadow-sm hover:shadow-md transition-all`}>
            {/* Header row */}
            <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-slate-900 truncate">{assignment.task_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                            <ClockIcon className="w-3 h-3" /> {assignment.duration_min}m
                        </span>
                        {assignment.priority !== undefined && assignment.priority > 0 && (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                P{assignment.priority}
                            </span>
                        )}
                    </div>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${style.badge}`}>
                    {style.label}
                </span>
            </div>

            {/* Timer row — only show when relevant */}
            {(isWorking || assignment.status === "done") && (
                <div className="px-3 pb-2">
                    <div className={`font-mono text-lg font-bold text-center rounded-md py-1 ${
                        assignment.status === "in_progress"
                            ? "bg-sky-50 text-sky-700"
                            : assignment.status === "paused"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700"
                    }`}>
                        {formatTime(elapsedMs)}
                    </div>
                </div>
            )}

            {/* Action buttons */}
            {!isDone && (
                <div className="px-3 pb-3 flex gap-1.5 justify-end border-t border-slate-100 pt-2">
                    {assignment.status === "pending" && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={() => handleAction("cancel")}
                                disabled={disabled || isLoading}
                            >
                                <XIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Cancel</span>
                            </Button>
                            <Button
                                size="sm"
                                className="h-8 bg-sky-600 hover:bg-sky-700 text-white"
                                onClick={() => handleAction("start")}
                                disabled={disabled || isLoading}
                            >
                                <PlayIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Start</span>
                            </Button>
                        </>
                    )}
                    {assignment.status === "in_progress" && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-amber-600 border-amber-200 hover:bg-amber-50"
                                onClick={() => handleAction("pause")}
                                disabled={disabled || isLoading}
                            >
                                <PauseIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Pause</span>
                            </Button>
                            <Button
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => handleAction("finish")}
                                disabled={disabled || isLoading}
                            >
                                <CheckIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Finish</span>
                            </Button>
                        </>
                    )}
                    {assignment.status === "paused" && (
                        <>
                            <Button
                                size="sm"
                                className="h-8 bg-amber-500 hover:bg-amber-600 text-white"
                                onClick={() => handleAction("start")}
                                disabled={disabled || isLoading}
                            >
                                <PlayIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Resume</span>
                            </Button>
                            <Button
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => handleAction("finish")}
                                disabled={disabled || isLoading}
                            >
                                <CheckIcon className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Finish</span>
                            </Button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
