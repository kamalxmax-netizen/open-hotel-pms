"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LogbookNote } from "@/lib/types"

interface LogbookArchiveDrawerProps {
  open: boolean
  notes: LogbookNote[]
  onClose: () => void
  onRestore: (noteId: string) => void
  onDelete: (noteId: string) => void
}

export function LogbookArchiveDrawer({
  open,
  notes,
  onClose,
  onRestore,
  onDelete,
}: LogbookArchiveDrawerProps) {
  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState<"all" | LogbookNote["note_type"]>("all")
  const [filterDate, setFilterDate] = useState("")

  const filtered = useMemo(() => {
    return notes.filter((note) => {
      const haystack = `${note.title} ${note.body}`.toLowerCase()
      const searchOk = search.trim().length === 0 || haystack.includes(search.trim().toLowerCase())
      const typeOk = filterType === "all" || note.note_type === filterType
      const dateOk =
        filterDate.length === 0 ||
        (note.archived_at ? new Date(note.archived_at).toISOString().slice(0, 10) === filterDate : false)
      return searchOk && typeOk && dateOk
    })
  }, [filterDate, filterType, notes, search])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-[var(--overlay-bg)]" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[440px] border-l border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="border-b border-[var(--border-default)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Archive</h2>
                <p className="text-xs text-[var(--text-secondary)]">Restore or permanently delete inactive notes.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or text"
                className="h-9 text-xs"
              />
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <select
                  value={filterType}
                  onChange={(event) => setFilterType(event.target.value as "all" | LogbookNote["note_type"])}
                  className="form-select h-9 rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 text-xs"
                >
                  <option value="all">All types</option>
                  <option value="general">General</option>
                  <option value="task">Task</option>
                  <option value="urgent">Urgent</option>
                  <option value="stock">Stock</option>
                  <option value="vip">VIP</option>
                </select>
                <Input
                  type="date"
                  value={filterDate}
                  onChange={(event) => setFilterDate(event.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-4 py-4">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-input)] bg-[var(--bg-body)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                No archived notes match this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((note) => (
                  <div key={note.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-[var(--bg-surface-hover)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                            {note.note_type}
                          </span>
                          {note.remind_at ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Alarm
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-2 truncate text-sm font-semibold text-[var(--text-primary)]">{note.title || "Untitled note"}</h3>
                        <p className="mt-1 line-clamp-3 text-xs text-[var(--text-secondary)]">{note.body || "No text content."}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-1 text-[11px] text-[var(--text-secondary)]">
                      <span>
                        Archived:{" "}
                        {note.archived_at ? new Date(note.archived_at).toLocaleString() : "Unknown"}
                      </span>
                      <span>Updated: {new Date(note.updated_at).toLocaleString()}</span>
                      <span>Archived by: {note.archived_by || "System"}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onRestore(note.id)}>
                        Restore
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          if (!window.confirm("Permanently delete this archived note?")) return
                          onDelete(note.id)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
