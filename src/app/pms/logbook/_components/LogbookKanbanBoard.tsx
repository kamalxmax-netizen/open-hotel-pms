"use client"

import { Card } from "@/components/ui/card"

export function LogbookKanbanBoard() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full min-h-[500px] min-w-[900px]">
            {/* Open Column */}
            <div className="bg-slate-100/50 rounded-2xl p-4 flex flex-col gap-4 border border-slate-200">
                <h3 className="font-bold text-sm flex items-center justify-between text-slate-700 uppercase tracking-widest pl-1">
                    Open
                    <span className="bg-white border border-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-semibold shadow-sm">0</span>
                </h3>
                <Card className="p-4 border-dashed border-2 bg-transparent shadow-none text-center text-slate-400 text-sm py-12 flex flex-col items-center gap-2">
                    <span className="text-2xl">📥</span>
                    No open notes
                </Card>
            </div>

            {/* In Progress Column */}
            <div className="bg-blue-50/50 rounded-2xl p-4 flex flex-col gap-4 border border-blue-100">
                <h3 className="font-bold text-sm flex items-center justify-between text-blue-800 uppercase tracking-widest pl-1">
                    In Progress
                    <span className="bg-white border border-blue-200 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-semibold shadow-sm">0</span>
                </h3>
                <Card className="p-4 border-dashed border-2 border-blue-200 bg-transparent shadow-none text-center text-blue-400 text-sm py-12 flex flex-col items-center gap-2">
                    <span className="text-2xl">⏳</span>
                    No notes in progress
                </Card>
            </div>

            {/* Resolved Column */}
            <div className="bg-emerald-50/50 rounded-2xl p-4 flex flex-col gap-4 border border-emerald-100">
                <h3 className="font-bold text-sm flex items-center justify-between text-emerald-800 uppercase tracking-widest pl-1">
                    Resolved
                    <span className="bg-white border border-emerald-200 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-semibold shadow-sm">0</span>
                </h3>
                <Card className="p-4 border-dashed border-2 border-emerald-200 bg-transparent shadow-none text-center text-emerald-400 text-sm py-12 flex flex-col items-center gap-2">
                    <span className="text-2xl">✅</span>
                    No resolved notes
                </Card>
            </div>
        </div>
    )
}
