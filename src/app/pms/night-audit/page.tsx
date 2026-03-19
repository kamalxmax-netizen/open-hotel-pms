"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"

import { NoShowTable } from "./_components/NoShowTable"
import { PreCheckStatus } from "./_components/PreCheckStatus"
import { AuditPreviewCards } from "./_components/AuditPreviewCards"
import { NightAuditSnapshot } from "@/lib/types"

type AuditStep = "noshow" | "precheck" | "preview" | "confirm" | "summary"

export default function NightAuditPage() {
    const router = useRouter()
    const [step, setStep] = useState<AuditStep>("noshow")

    const [businessDate, setBusinessDate] = useState("Loading...")
    const [calendarDate, setCalendarDate] = useState("")
    const [nextBusinessDate, setNextBusinessDate] = useState("")
    const [isPreCheckReady, setIsPreCheckReady] = useState(false)
    const [snapshot, setSnapshot] = useState<NightAuditSnapshot | null>(null)
    const [staffNotes, setStaffNotes] = useState("")
    const [runLoading, setRunLoading] = useState(false)
    const [runError, setRunError] = useState("")

    const handlePreviewLoad = useCallback((nextSnapshot: NightAuditSnapshot | null) => {
        setSnapshot(nextSnapshot)
    }, [])

    const noopPreviewLoad = useCallback(() => {
        // Intentionally empty for summary read-only rendering.
    }, [])

    // UI state
    const [hasPendingNoShows, setHasPendingNoShows] = useState(true) // assume true to start to block P3-1
    const [isPageLoading, setIsPageLoading] = useState(true)

    // Lead P1-5: Fetch business_date จาก API
    useEffect(() => {
        fetch("/api/eod/status")
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setBusinessDate(d.business_date)
                    setCalendarDate(d.calendar_date)
                } else {
                    setBusinessDate("Error fetching date")
                }
            })
            .catch(() => setBusinessDate("Error"))
            .finally(() => setIsPageLoading(false))
    }, [])

    // P3-1 handler
    const handleNoShowsClear = useCallback(() => {
        setHasPendingNoShows(false)
        setStep("precheck")
    }, [])

    // Lead P1-6: Wire Confirm API
    const handleConfirmRun = async () => {
        setRunLoading(true)
        setRunError("")
        try {
            const res = await fetch("/api/eod/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notes: staffNotes })
            })
            const data = await res.json()
            if (data.success) {
                // Lead P2-3: get next date from backend run response
                setNextBusinessDate(data.new_business_date)
                if (data.snapshot) {
                    setSnapshot(data.snapshot as NightAuditSnapshot)
                }
                setStep("summary")
            } else {
                setRunError(data.error || "Failed to run night audit.")
            }
        } catch (e) {
            setRunError("Network error running night audit")
        } finally {
            setRunLoading(false)
        }
    }

    const renderStepIcon = (s: AuditStep, index: number) => {
        const steps: AuditStep[] = ["noshow", "precheck", "preview", "confirm", "summary"]
        const currentIndex = steps.indexOf(step)

        if (index < currentIndex) {
            return (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
            )
        }
        if (index === currentIndex) {
            return (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-500/20 font-bold shadow-sm">
                    {index + 1}
                </div>
            )
        }
        return (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-default)] font-medium">
                {index + 1}
            </div>
        )
    }

    const stepLabels = [
        "No-Show",
        "Pre-Check",
        "Preview",
        "Confirm",
        "Summary"
    ]

    if (isPageLoading) {
        return <div className="p-8 flex items-center justify-center text-[var(--text-secondary)]">Loading system status...</div>
    }

    return (
        <div className="min-h-screen flex flex-col bg-[var(--bg-body)]">
            <div className="sticky top-0 z-20 border-b bg-[var(--bg-surface)] p-4 sm:p-6 shadow-sm relative dark:border-white/5">
                <div className="mx-auto max-w-4xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Night Audit</h1>
                            <p className="text-sm text-[var(--text-secondary)] mt-1">Activating closure for: <strong className="text-[var(--text-primary)]">{businessDate}</strong></p>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative">
                        <div className="absolute top-4 left-0 w-full h-0.5 bg-[var(--bg-muted)] dark:bg-white/5 -z-10 hidden sm:block">
                            <div
                                className="h-full bg-brand-600 transition-all duration-300"
                                style={{ width: `${(Math.max(0, ["noshow", "precheck", "preview", "confirm", "summary"].indexOf(step)) / 4) * 100}%` }}
                            />
                        </div>

                        <div className="flex justify-between items-start">
                            {(["noshow", "precheck", "preview", "confirm", "summary"] as AuditStep[]).map((s, i) => (
                                <div key={s} className="flex flex-col items-center gap-2">
                                    {renderStepIcon(s, i)}
                                    <span className={`text-[11px] font-semibold hidden sm:block ${step === s ? "text-brand-700 dark:text-brand-400" : ["noshow", "precheck", "preview", "confirm", "summary"].indexOf(step) > i ? "text-[var(--text-table-cell)]" : "text-[var(--text-muted)]"
                                        }`}>
                                        {stepLabels[i]}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <main className="flex-1 p-4 sm:p-6 pb-20">
                <div className="mx-auto max-w-4xl">
                    {step === "noshow" && (
                        <div className="rounded-xl border border-[var(--border-default)] dark:border-white/5 bg-[var(--bg-surface)] p-6 shadow-sm min-h-[400px] flex flex-col justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Pending No-Shows</h2>
                                <p className="text-sm text-[var(--text-secondary)] mb-6 border-b border-[var(--border-subtle)] pb-4">
                                    Please mark all remaining no-shows for {businessDate}. If guest requests date changes, modify reservation manually before this step.
                                </p>
                                {/* Lead P1-4 & P3-1: Connect component API and pass state */}
                                <NoShowTable onAllClear={handleNoShowsClear} />
                            </div>
                            <div className="flex justify-end pt-6 border-t border-[var(--border-subtle)] dark:border-white/5 mt-6">
                                <button
                                    onClick={() => setStep("precheck")}
                                    disabled={hasPendingNoShows} // Lead P3-1 fix
                                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${hasPendingNoShows ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed" : "text-white bg-brand-600 hover:bg-brand-700"}`}
                                >
                                    Proceed to Pre-Check →
                                </button>
                            </div>
                        </div>
                    )}

                    {step === "precheck" && (
                        <div className="rounded-xl border border-[var(--border-default)] dark:border-white/5 bg-[var(--bg-surface)] p-6 shadow-sm min-h-[400px] flex flex-col justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Pre-Check System Status</h2>
                                <PreCheckStatus onReadyChange={setIsPreCheckReady} />
                            </div>
                            <div className="flex gap-3 items-center justify-end pt-6 border-t border-[var(--border-subtle)] dark:border-white/5 mt-6">
                                <button
                                    onClick={() => setStep("noshow")}
                                    className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] focus:outline-none"
                                >
                                    ← Back to No-Shows
                                </button>
                                <button
                                    onClick={() => setStep("preview")}
                                    disabled={!isPreCheckReady}
                                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${!isPreCheckReady ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed" : "text-white bg-brand-600 hover:bg-brand-700"}`}
                                >
                                    Proceed to Preview →
                                </button>
                            </div>
                        </div>
                    )}

                    {step === "preview" && (
                        <div className="rounded-xl border border-[var(--border-default)] dark:border-white/5 bg-[var(--bg-surface)] p-6 shadow-sm min-h-[400px] flex flex-col justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Preview Audit Snapshot</h2>
                                <AuditPreviewCards onLoad={handlePreviewLoad} />
                                <div className="mt-8 pt-6 border-t border-[var(--border-subtle)]">
                                    <label className="block text-sm font-semibold text-[var(--text-table-cell)] mb-2">Staff Notes (Optional)</label>
                                    <textarea
                                        className="w-full rounded-lg border border-[var(--border-input)] p-3 text-sm focus:ring-brand-500 focus:border-brand-500"
                                        rows={3}
                                        value={staffNotes}
                                        onChange={e => setStaffNotes(e.target.value)}
                                        placeholder="Add any shift handover notes or explanations for discrepancies here..."
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 items-center justify-end pt-6 border-t border-[var(--border-subtle)] dark:border-white/5 mt-6">
                                <button
                                    onClick={() => setStep("precheck")}
                                    className="w-full sm:w-auto rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] focus:outline-none"
                                >
                                    ← Back
                                </button>
                                <button
                                    onClick={() => setStep("confirm")}
                                    disabled={!snapshot}
                                    className={`w-full sm:w-auto rounded-lg px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 shadow-sm transition-colors ${!snapshot ? "bg-[var(--bg-muted)] text-[var(--text-muted)] cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    Ready to Run
                                </button>
                            </div>
                        </div>
                    )}

                    {step === "confirm" && (
                        <div className="rounded-xl border border-amber-200 bg-[var(--bg-surface)] p-8 shadow-sm flex flex-col items-center text-center max-w-lg mx-auto mt-6 dark:border-amber-500/30">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 mb-4 ring-8 ring-amber-50 dark:bg-amber-500/20 dark:ring-amber-500/10">
                                <svg className="h-7 w-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-[var(--text-primary)]">Close Day {businessDate}?</h2>
                            <p className="mt-2 text-sm text-[var(--text-secondary)] mb-8 px-4 leading-relaxed">
                                หลังจากกดยืนยัน จะไม่สามารถแก้ไขข้อมูลยอดเงิน ใบแจ้งหนี้ของวันที่ <strong className="text-[var(--text-primary)]">{businessDate}</strong> ได้อีก ระบบจะจัดเก็บข้อมูลลง Snapshot และเริ่มวันทำงานใหม่ทันที
                            </p>

                            {runError && (
                                <div className="w-full rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 font-medium mb-6 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400">
                                    {runError}
                                </div>
                            )}

                            <div className="flex w-full gap-3">
                                <button
                                    onClick={() => setStep("preview")}
                                    disabled={runLoading}
                                    className="flex-1 justify-center rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text-table-cell)] hover:bg-[var(--bg-body)] disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmRun}
                                    disabled={runLoading}
                                    className="flex-1 justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 shadow-sm flex items-center gap-2 disabled:bg-brand-400"
                                >
                                    {runLoading ? (
                                        <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div> Running...</>
                                    ) : (
                                        "Confirm & Run"
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === "summary" && (
                        <div className="rounded-xl border border-green-200 bg-[var(--bg-surface)] p-6 shadow-sm min-h-[400px] flex flex-col dark:border-emerald-500/30 dark:bg-emerald-500/5">
                            <div className="flex flex-col items-center text-center pb-8 border-b border-green-100 mb-8 bg-green-50/50 p-6 rounded-t-xl -mx-6 -mt-6 dark:border-emerald-500/10 dark:bg-emerald-500/10">
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-4 shadow-sm ring-8 ring-green-50 dark:bg-emerald-500/20 dark:ring-emerald-500/10">
                                    <svg className="h-8 w-8 text-green-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <h2 className="text-2xl font-bold text-green-800 dark:text-emerald-400">Night Audit Completed</h2>
                                <p className="mt-2 text-sm font-medium text-green-700 dark:text-emerald-500/80">
                                    Closed date: {businessDate}
                                </p>
                                <div className="mt-3 px-4 py-2 bg-[var(--bg-surface)] rounded-lg border border-green-200 shadow-sm inline-block dark:bg-emerald-500/10 dark:border-emerald-500/20">
                                    <p className="text-sm font-medium text-green-800 flex items-center gap-2 dark:text-emerald-400">
                                        ✨ New business date: <strong className="text-base">{nextBusinessDate || "Tomorrow"}</strong>
                                    </p>
                                </div>
                            </div>

                            <div className="flex-1 max-w-2xl mx-auto w-full">
                                <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4 text-center">Final Snapshot Captured</p>
                                {/* Re-pass snapshot to read-only mock component, avoiding re-fetch */}
                                {snapshot && (
                                    <div className="opacity-80 scale-95 origin-top transition-all pointer-events-none">
                                        <AuditPreviewCards onLoad={noopPreviewLoad} snapshotOverride={snapshot} />
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-center pt-8 mt-4 border-t border-[var(--border-subtle)]">
                                <button
                                    onClick={() => router.push("/pms")}
                                    className="rounded-lg bg-slate-900 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800 shadow-xl shadow-slate-900/10 flex items-center gap-2 transition-transform hover:scale-105"
                                >
                                    Return to Dashboard
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </main>
        </div>
    )
}
