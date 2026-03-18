"use client"

import { useState } from "react"
import { StaffListTab } from "./StaffListTab"
import { RosterTab } from "./RosterTab"
import { ScheduleCalendarTab } from "./ScheduleCalendarTab"

export function TeamTabs() {
    const [activeTab, setActiveTab] = useState<"staff" | "roster" | "schedule">("staff")

    return (
        <div className="space-y-4">
            {/* Tab Navigation */}
            <div className="flex items-center gap-2 border-b border-[var(--border-default)]">
                <button
                    onClick={() => setActiveTab("staff")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "staff"
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                        }`}
                >
                    Staff Directory
                </button>
                <button
                    onClick={() => setActiveTab("roster")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "roster"
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                        }`}
                >
                    Daily Roster
                </button>
                <button
                    onClick={() => setActiveTab("schedule")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule"
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                        }`}
                >
                    Monthly Schedule
                </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {activeTab === "staff" && <StaffListTab />}
                {activeTab === "roster" && <RosterTab />}
                {activeTab === "schedule" && <ScheduleCalendarTab />}
            </div>
        </div>
    )
}
