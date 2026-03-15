"use client"

import { LogbookNoteType } from "@/lib/types"

interface LogbookFilterBarProps {
    filterType: string;
    setFilterType: (type: string) => void;
}

export function LogbookFilterBar({ filterType, setFilterType }: LogbookFilterBarProps) {
    const tabs = [
        { value: "all", label: "All Notes" },
        { value: "general", label: "General" },
        { value: "task", label: "Task" },
        { value: "urgent", label: "Urgent" },
        { value: "stock", label: "Stock" },
        { value: "vip", label: "VIP" }
    ]

    return (
        <div className="flex bg-slate-100 p-1 rounded-lg">
            {tabs.map(tab => (
                <button
                    key={tab.value}
                    onClick={() => setFilterType(tab.value)}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${filterType === tab.value ? 'bg-[var(--bg-surface)] text-brand-700 shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]'}`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    )
}
