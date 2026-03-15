"use client"

import { useEffect, useState } from "react"
import { PreCheckResult } from "@/lib/types"

interface PreCheckStatusProps {
  onReadyChange: (isReady: boolean) => void
}

export function PreCheckStatus({ onReadyChange }: PreCheckStatusProps) {
  const [result, setResult] = useState<PreCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/night-audit/pre-check")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setResult(d)
          onReadyChange(d.can_run)
        } else {
          setError(d.error || "Failed to run pre-check")
          onReadyChange(false)
        }
      })
      .catch(() => {
        setError("Network error running pre-check")
        onReadyChange(false)
      })
      .finally(() => setLoading(false))
  }, [onReadyChange])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-600 mb-4"></div>
        <p className="text-sm">Running system pre-checks...</p>
      </div>
    )
  }

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
  }

  if (!result) return null

  const blockers = result.blockers || []
  const warnings = result.warnings || []
  const isReady = result.can_run

  if (isReady && warnings.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-900">All Clear</h3>
            <p className="mt-1 text-sm">System is ready for Night Audit.</p>
        </div>
      )
  }

  return (
    <div className="flex flex-col gap-4">
      {blockers.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-3">
             <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
                {blockers.length}
             </div>
             <div>
               <h3 className="text-sm font-bold text-rose-800">Blockers detected</h3>
               <p className="text-[13px] text-rose-600 mb-2">Must be resolved before you can run the audit.</p>
               <ul className="list-inside list-disc text-[13px] text-rose-700 font-medium space-y-1">
                 {blockers.map((b, i) => (
                   <li key={i}>{b.message}</li>
                 ))}
               </ul>
             </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
             <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {warnings.length}
             </div>
             <div>
               <h3 className="text-sm font-bold text-amber-800">Warnings</h3>
               <p className="text-[13px] text-amber-700 mb-2">These will not stop the audit, but please review.</p>
               <ul className="list-inside list-disc text-[13px] text-amber-700 space-y-1">
                 {warnings.map((w, i) => (
                   <li key={i}>{w.message}</li>
                 ))}
               </ul>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}
