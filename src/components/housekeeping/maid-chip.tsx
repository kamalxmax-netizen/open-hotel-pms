import React from "react";

export default function MaidChip({ maidName, priority, className = "" }: { maidName: string | null; priority?: number | null; className?: string }) {
    if (!maidName) return null;

    return (
        <div className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
            <span className="inline-flex items-center justify-center bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider shadow-sm">
                {maidName}
            </span>
            {priority != null && (
                <span className="inline-flex items-center justify-center bg-slate-200 text-[var(--text-secondary)] font-bold px-1.5 py-0.5 rounded text-[10px] shadow-sm">
                    P{priority}
                </span>
            )}
        </div>
    );
}
