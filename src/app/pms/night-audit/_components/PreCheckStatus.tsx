"use client"

import { useEffect, useState } from "react"
import { PreCheckResult } from "@/lib/types"
import { StockReconcileSection } from "./StockReconcileSection"

interface PreCheckStatusProps {
  onReadyChange: (isReady: boolean) => void
}

export function PreCheckStatus({ onReadyChange }: PreCheckStatusProps) {
  const [result, setResult] = useState<PreCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [stockReconcileOk, setStockReconcileOk] = useState(false)

  useEffect(() => {
    fetch("/api/night-audit/pre-check")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setResult(d)
        } else {
          setError(d.error || "Failed to run pre-check")
        }
      })
      .catch(() => {
        setError("Network error running pre-check")
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (result && result.can_run && stockReconcileOk) {
      onReadyChange(true)
    } else {
      onReadyChange(false)
    }
  }, [result, stockReconcileOk, onReadyChange])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-secondary)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600 mb-4"></div>
        <p className="text-sm">Running system pre-checks...</p>
      </div>
    )
  }

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400">{error}</div>
  }

  if (!result) return null

  const blockers = result.blockers || []
  const warnings = result.warnings || []
  const isReady = result.can_run

  return (
    <div className="flex flex-col gap-4">
      {blockers.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
              {blockers.length}
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-800 dark:text-rose-400">Blockers detected</h3>
              <p className="text-[13px] text-rose-600 dark:text-rose-500 mb-2">Must be resolved before you can run the audit.</p>
              <ul className="list-inside list-disc text-[13px] text-rose-700 dark:text-rose-400 font-medium space-y-1">
                {blockers.map((b, i) => (
                  <li key={i}>{b.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
              {warnings.length}
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-400">Warnings</h3>
              <p className="text-[13px] text-amber-700 dark:text-amber-500 mb-2">These will not stop the audit, but please review.</p>
              <ul className="list-inside list-disc text-[13px] text-amber-700 dark:text-amber-400 space-y-1">
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {isReady && warnings.length === 0 && (
        <div className="flex flex-col items-center justify-center p-6 text-center text-[var(--text-secondary)] border border-green-200 bg-green-50 rounded-lg dark:bg-emerald-500/10 dark:border-emerald-500/20">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-emerald-500/20 mb-2">
            <svg className="h-5 w-5 text-green-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-emerald-800 dark:text-emerald-400">System Pre-Checks Clear</h3>
        </div>
      )}

      <StockReconcileSection onReconcileComplete={setStockReconcileOk} />
    </div>
  )
}
