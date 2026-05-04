"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogbookCreateModal } from "../_components/LogbookCreateModal"

export default function NewNotePage() {
  const router = useRouter()

  const returnToBoard = () => {
    router.push("/pms/logbook")
  }

  return (
    <div className="logbook-shell flex min-h-[100dvh] w-full flex-col bg-[var(--logbook-canvas)]">
      <div className="flex w-full min-w-0 flex-none border-b border-[var(--logbook-header-border)] bg-[var(--logbook-header-bg)] px-6 py-4 shadow-[var(--logbook-card-shadow)]">
        <div className="flex w-full min-w-0 items-center gap-5 overflow-x-auto">
          <h1 className="whitespace-nowrap text-2xl font-bold text-[var(--logbook-brand-heading)] tracking-[0]">Logbook</h1>
          <div className="flex items-center rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1">
            <Link href="/pms/logbook" className="rounded-[var(--logbook-pill-radius)] px-3 py-1 text-sm font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]">
              Board
            </Link>
            <Link href="/pms/logbook/calendar" className="rounded-[var(--logbook-pill-radius)] px-3 py-1 text-sm font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]">
              Calendar
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--logbook-text-secondary)]">
        Opening new note...
      </div>

      <LogbookCreateModal isOpen onClose={returnToBoard} />
    </div>
  )
}
