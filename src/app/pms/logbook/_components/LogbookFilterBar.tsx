"use client"

import { LogbookNoteType } from "@/lib/types"

interface LogbookFilterBarProps {
    filterTypes: Array<"all" | LogbookNoteType>;
    toggleFilterType: (type: "all" | LogbookNoteType) => void;
}

export function LogbookFilterBar({ filterTypes, toggleFilterType }: LogbookFilterBarProps) {
    const tabs = [
        { value: "all", label: "All Notes" },
        { value: "general", label: "General" },
        { value: "task", label: "Task" },
        { value: "urgent", label: "Urgent" },
        { value: "stock", label: "Stock" },
        { value: "vip", label: "VIP" }
    ] as const

    const isAllSelected = filterTypes.includes("all")

    return (
        <div className="w-full min-w-0 overflow-x-auto">
            <div className="flex w-max items-center gap-1 rounded-lg bg-[var(--bg-surface-hover)] p-1 whitespace-nowrap">
                {tabs.map(tab => {
                    const isActive = tab.value === "all"
                        ? isAllSelected
                        : !isAllSelected && filterTypes.includes(tab.value)

                    return (
                        <button
                            key={tab.value}
                            type="button"
                            onClick={() => toggleFilterType(tab.value)}
                            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-[var(--bg-surface)] text-brand-700 shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]'}`}
                        >
                            {tab.label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
