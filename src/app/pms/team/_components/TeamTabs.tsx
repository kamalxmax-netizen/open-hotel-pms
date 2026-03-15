"use client"

import { useState } from "react"
import { StaffListTab } from "./StaffListTab"
import { RosterTab } from "./RosterTab"

export function TeamTabs() {
    const [activeTab, setActiveTab] = useState<"staff" | "roster">("staff")

    return (
        <div className="space-y-4">
            {/* Tab Navigation */}
            <div className="flex items-center gap-2 border-b border-slate-200">
                <button
                    onClick={() => setActiveTab("staff")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "staff"
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                        }`}
                >
                    Staff Directory
                </button>
                <button
                    onClick={() => setActiveTab("roster")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "roster"
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                        }`}
                >
                    Daily Roster
                </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {activeTab === "staff" && <StaffListTab />}
                {activeTab === "roster" && <RosterTab />}
            </div>
        </div>
    )
}
