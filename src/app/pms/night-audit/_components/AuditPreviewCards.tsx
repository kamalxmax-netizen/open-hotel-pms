"use client"

import { useEffect, useState } from "react"
import { NightAuditSnapshot } from "@/lib/types"

interface AuditPreviewCardsProps {
  onLoad: (snapshot: NightAuditSnapshot | null) => void
  snapshotOverride?: NightAuditSnapshot | null
}

function formatB(val: number) {
  return "฿" + val.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AuditPreviewCards({ onLoad, snapshotOverride }: AuditPreviewCardsProps) {
  const [snapshot, setSnapshot] = useState<NightAuditSnapshot | null>(snapshotOverride ?? null)
  const [loading, setLoading] = useState(snapshotOverride ? false : true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (snapshotOverride) {
      setSnapshot(snapshotOverride)
      setLoading(false)
      onLoad(snapshotOverride)
      return
    }

    fetch("/api/night-audit/preview")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSnapshot(d.preview)
          onLoad(d.preview)
        } else {
          setError(d.error || "Failed to load audit preview")
          onLoad(null)
        }
      })
      .catch(() => {
        setError("Network error loading audit preview")
        onLoad(null)
      })
      .finally(() => setLoading(false))
  }, [onLoad, snapshotOverride])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-secondary)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600 mb-4"></div>
        <p className="text-sm">Calculating end of day snapshot...</p>
      </div>
    )
  }

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400">{error}</div>
  }

  if (!snapshot) return null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Revenue Card */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Revenue (Accrual)</h3>
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">Total Room Revenue</p>
          <p className="text-2xl font-black text-brand-700 dark:text-brand-500">{formatB(snapshot.total_revenue)}</p>
        </div>
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span>Occupancy</span>
            <span className="font-semibold text-[var(--text-primary)]">{snapshot.occupancy_pct?.toFixed(1) || "0.0"}% ({snapshot.occupied_nights}/{snapshot.room_nights})</span>
          </div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span>ADR</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.adr)}</span>
          </div>
          <div className="flex justify-between">
            <span>RevPAR</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.revpar)}</span>
          </div>
        </div>
      </div>

      {/* Cash/Payments Card */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Payments Received (Cash)</h3>
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">Total Payments</p>
          <p className="text-2xl font-black text-[var(--text-primary)]">{formatB(snapshot.payment_total)}</p>
        </div>
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span>Cash</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.payment_cash)}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span>Transfer</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.payment_transfer)}</span>
          </div>
          <div className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span>Credit Card</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.payment_card)}</span>
          </div>
          <div className="flex justify-between">
            <span>Other</span>
            <span className="font-semibold text-[var(--text-primary)]">{formatB(snapshot.payment_other)}</span>
          </div>
        </div>
      </div>

      {/* Extras Card */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm md:col-span-2 flex flex-wrap gap-4 justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">POS Revenue</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatB(snapshot.pos_revenue)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">Transfer Margin</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatB(snapshot.transfer_margin)} <span className="text-xs font-normal text-[var(--text-secondary)]">(Rev: {formatB(snapshot.transfer_revenue)})</span></p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">Tips Recorded</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatB(snapshot.tip_total)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">No-Show Fees</p>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatB(snapshot.no_show_fee_total)} <span className="text-xs font-normal text-[var(--text-secondary)]">({snapshot.no_show_count} bookings)</span></p>
        </div>
      </div>
    </div>
  )
}
