import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NewNotePage() {
    return (
        <div className="max-w-3xl mx-auto p-6 space-y-6">
            <div className="flex items-center gap-4 border-b pb-4">
                <Link href="/pms/logbook">
                    <Button variant="outline" size="sm" className="shadow-sm">← Back to Board</Button>
                </Link>
                <h1 className="text-xl font-bold text-slate-800">Create New Note</h1>
            </div>

            <div className="bg-[var(--bg-surface)] p-6 rounded-2xl border shadow-sm text-center text-[var(--text-secondary)] flex flex-col items-center gap-3 py-24">
                <p className="text-5xl mb-2">📝</p>
                <h3 className="font-bold text-[var(--text-table-cell)] text-lg">Note Form Generation Pending</h3>
                <p className="max-w-md mx-auto text-sm leading-relaxed">
                    The complex Logbook Note Form (with @mentions, room relations, and priority settings) will be implemented in Phase 12C.
                </p>
                <div className="mt-4 bg-amber-50 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-200 uppercase tracking-wider">
                    Waiting for Backend RPC "create_logbook_note"
                </div>
            </div>
        </div>
    )
}
