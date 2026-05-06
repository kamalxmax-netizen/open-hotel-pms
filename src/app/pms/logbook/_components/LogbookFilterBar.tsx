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
        <div className="min-w-max overflow-x-auto">
            <div className="flex w-max items-center gap-1 rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1 whitespace-nowrap">
                {tabs.map(tab => {
                    const isActive = tab.value === "all"
                        ? isAllSelected
                        : !isAllSelected && filterTypes.includes(tab.value)

                    return (
                        <button
                            key={tab.value}
                            type="button"
                            onClick={() => toggleFilterType(tab.value)}
                            className={`h-6 rounded-[var(--logbook-pill-radius)] px-3 text-xs font-semibold transition-colors ${isActive ? 'bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm' : 'text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]'}`}
                        >
                            {tab.label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
