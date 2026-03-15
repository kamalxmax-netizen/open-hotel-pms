"use client"

import { useState, useEffect, useCallback } from "react"
import { NoShowPending } from "@/lib/types"

interface NoShowTableProps {
  onAllClear: () => void
}

function parseMoneyInput(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100) / 100
}

export function NoShowTable({ onAllClear }: NoShowTableProps) {
  const [noShows, setNoShows] = useState<NoShowPending[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [markItem, setMarkItem] = useState<NoShowPending | null>(null)
  const [chargeAmountInput, setChargeAmountInput] = useState("0")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [actionLoading, setActionLoading] = useState(false)
  const [showMarkValidation, setShowMarkValidation] = useState(false)
  const [markValidationError, setMarkValidationError] = useState("")

  const fetchNoShows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/night-audit/no-shows")
      const data = await res.json()
      if (data.success) {
        setNoShows(data.no_shows || [])
      } else {
        setError(data.error || "Failed to load no-shows")
      }
    } catch (e: any) {
      setError("Network error loading no-shows")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNoShows()
  }, [fetchNoShows])

  useEffect(() => {
    // Lead P2-1: Call onAllClear inside useEffect, not during render
    if (!loading && !error && noShows.length === 0) {
      onAllClear()
    }
  }, [loading, error, noShows.length, onAllClear])

  const handleMarkConfirm = async () => {
    if (!markItem) return
    setShowMarkValidation(true)
    setMarkValidationError("")
    const feeAmount = parseMoneyInput(chargeAmountInput)
    if (feeAmount === null) {
      setMarkValidationError("Invalid charge amount.")
      return
    }

    setActionLoading(true)
    try {
      const res = await fetch(`/api/night-audit/no-shows/${markItem.id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fee_amount: feeAmount,
          payment_method: paymentMethod
        })
      })
      const data = await res.json()
      if (data.success) {
        setMarkItem(null)
        setShowMarkValidation(false)
        setMarkValidationError("")
        fetchNoShows() // refresh list
      } else {
        alert(data.error || "Failed to mark no-show")
      }
    } catch (e) {
      alert("Network error marking no-show")
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-secondary)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600 mb-4"></div>
        <p className="text-sm">Loading pending no-shows...</p>
      </div>
    )
  }

  if (error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
  }

  if (noShows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-[var(--text-secondary)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 mb-4">
          <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-[var(--text-primary)]">All pending no-shows resolved</h3>
        <p className="mt-1 text-sm">Proceed to the Pre-Check step.</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {actionLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm rounded-lg">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600"></div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
        <table className="w-full text-left text-sm text-[var(--text-secondary)]">
          <thead className="bg-[var(--bg-body)] text-xs uppercase text-[var(--text-table-cell)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Guest</th>
              <th className="px-4 py-3 font-semibold">Booking</th>
              <th className="px-4 py-3 font-semibold">Check-in</th>
              <th className="px-4 py-3 font-semibold">Room</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {noShows.map((ns) => (
              <tr key={ns.id} className="hover:bg-[var(--bg-body)]">
                <td className="px-4 py-3">
                  <div className="font-semibold text-[var(--text-primary)]">{ns.guest_name}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{ns.phone}</div>
                </td>
                <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[var(--text-secondary)]">{ns.booking_code}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-rose-600 font-medium">{ns.checkin_date}</span>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--text-table-cell)]">{ns.room_number || "Unassigned"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="rounded bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                      onClick={() => {
                        setChargeAmountInput("0")
                        setPaymentMethod("cash")
                        setShowMarkValidation(false)
                        setMarkValidationError("")
                        setMarkItem(ns)
                      }}
                    >
                      Mark No-Show
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mark Dialog */}
      {markItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--bg-surface)] p-6 shadow-lg">
            <h3 className="text-lg font-bold text-rose-700 mb-2">Mark as No-Show?</h3>
            <div className="mb-6 space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                Enter charge amount for <span className="font-semibold text-[var(--text-primary)]">{markItem.guest_name}</span>. Default is 0 (no charge).
              </p>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-table-cell)] mb-1">Charge Amount (THB)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full rounded-lg border border-[var(--border-input)] p-2 text-sm bg-[var(--bg-surface)]"
                  value={chargeAmountInput}
                  onChange={(e) => {
                    setChargeAmountInput(e.target.value)
                    if (showMarkValidation && parseMoneyInput(e.target.value) !== null) {
                      setMarkValidationError("")
                    }
                  }}
                  required
                  aria-invalid={showMarkValidation && parseMoneyInput(chargeAmountInput) === null}
                />
                {showMarkValidation && parseMoneyInput(chargeAmountInput) === null && (
                  <p className="mt-1 text-xs text-rose-600">Enter a valid charge amount (0 or higher).</p>
                )}
              </div>
              <label className="block text-xs font-semibold text-[var(--text-table-cell)] mb-1">Charge From</label>
              <select
                className="w-full rounded-lg border border-[var(--border-input)] p-2 text-sm bg-[var(--bg-surface)]"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="transfer">Bank Transfer</option>
                <option value="credit_card">Credit Card</option>
              </select>
              {markValidationError && (
                <p className="mt-1 text-xs text-rose-600">{markValidationError}</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-3">
              <button
                onClick={() => {
                  setMarkItem(null)
                  setShowMarkValidation(false)
                  setMarkValidationError("")
                }}
                className="w-full sm:w-auto justify-center rounded-lg border border-[var(--border-input)] px-4 py-2 text-sm font-medium text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkConfirm}
                className="w-full sm:w-auto justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Confirm No-Show
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
