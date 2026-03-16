"use client"

import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { LogbookMention, LogbookNote, LogbookNoteLink } from "@/lib/types"
import { LogbookLinkPicker } from "./LogbookLinkPicker"
import { getNoteRichBody, getRichBodyTextareaStyle, plainTextToHtml } from "./logbook-rich"
import { resolveLogbookLinkHref } from "./logbook-link-navigation"

type NoteUpdateOptions = {
  historyMode?: "coalesced" | "immediate" | "none"
  saveMode?: "debounced" | "immediate"
}

const NOTE_COLORS = {
  general: "border-[var(--border-default)] bg-[var(--bg-surface)]",
  task: "border-amber-300 bg-amber-50",
  urgent: "border-rose-300 bg-rose-50",
  stock: "border-emerald-300 bg-emerald-50",
  vip: "border-purple-300 bg-purple-50",
}

interface MobileListProps {
  notes: LogbookNote[]
  onUpdateContent: (id: string, updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => void
  onArchive: (id: string) => void
  onOpenFullView: (id: string) => void
  onAddLink: (noteId: string, link: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => void
  onDeleteLink: (noteId: string, linkId: string) => void
  onAddMention: (noteId: string, mention: Pick<LogbookMention, "mention_type" | "staff_id">) => void
  onDeleteMention: (noteId: string, mentionId: string) => void
}

function mentionLabel(mention: LogbookMention) {
  if (mention.mention_type === "group_all") return "@all"
  if (mention.mention_type === "group_frontdesk") return "@Front Desk"
  return `@${mention.staff?.display_name || "Staff"}`
}

export function LogbookMobileList({
  notes,
  onUpdateContent,
  onArchive,
  onOpenFullView,
  onAddLink,
  onDeleteLink,
  onAddMention,
  onDeleteMention,
}: MobileListProps) {
  const router = useRouter()

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-sm text-[var(--text-muted)]">
        No notes found for this filter.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {notes.map((note) => {
        const borderColor = NOTE_COLORS[note.note_type] || NOTE_COLORS.general
        const richBody = getNoteRichBody(note)

        return (
          <Card key={note.id} className={`flex flex-col overflow-hidden border-l-4 shadow-sm ${borderColor}`}>
            <div className="flex items-start justify-between gap-2 border-b border-black/5 bg-[var(--bg-body)] p-3">
              <input
                value={note.title}
                onChange={(event) =>
                  onUpdateContent(
                    note.id,
                    { title: event.target.value },
                    { historyMode: "coalesced", saveMode: "debounced" }
                  )
                }
                className="w-full rounded px-1 text-sm font-bold text-[var(--text-primary)] outline-none"
                placeholder="Note Title"
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onOpenFullView(note.id)}
                  className="rounded px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] hover:bg-slate-200 hover:text-[var(--text-secondary)]"
                >
                  Open
                </button>
                <button
                  onClick={() => onArchive(note.id)}
                  className="rounded px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Archive
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Type</span>
                <select
                  value={note.note_type}
                  onChange={(event) =>
                    onUpdateContent(
                      note.id,
                      { note_type: event.target.value as LogbookNote["note_type"] },
                      { historyMode: "immediate", saveMode: "immediate" }
                    )
                  }
                  className="h-7 rounded border border-[var(--border-input)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-secondary)]"
                >
                  <option value="general">General</option>
                  <option value="task">Task</option>
                  <option value="urgent">Urgent</option>
                  <option value="stock">Stock</option>
                  <option value="vip">VIP</option>
                </select>
              </div>

              <textarea
                value={note.body}
                onChange={(event) =>
                  onUpdateContent(
                    note.id,
                    {
                      body: event.target.value,
                      body_rich: {
                        ...richBody,
                        html: plainTextToHtml(event.target.value),
                      },
                    },
                    { historyMode: "coalesced", saveMode: "debounced" }
                  )
                }
                style={getRichBodyTextareaStyle(richBody)}
                className="min-h-[96px] w-full resize-none rounded border border-[var(--border-default)] bg-[var(--bg-surface)]/70 p-2 text-sm outline-none"
                placeholder="Type your notes here..."
              />

              <div className="flex flex-wrap items-start gap-1">
                {note.links?.map((link) => (
                  <div
                    key={link.id}
                    className={`rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-bold ${
                      link.link_type === "room"
                        ? "bg-rose-200 text-rose-800"
                        : link.link_type === "guest"
                          ? "bg-purple-200 text-purple-800"
                          : link.link_type === "stock"
                            ? "bg-blue-200 text-blue-800"
                            : "bg-slate-200 text-[var(--text-primary)]"
                    }`}
                    onClick={async () => {
                      const href = await resolveLogbookLinkHref(link)
                      router.push(href)
                    }}
                  >
                    {link.label}
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteLink(note.id, link.id)
                      }}
                      className="ml-1 font-bold opacity-50 hover:text-red-700 hover:opacity-100"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {note.mentions?.map((mention) => (
                  <div
                    key={mention.id}
                    className="rounded-full border border-black/10 bg-yellow-100 px-2 py-0.5 text-[10px] font-bold text-yellow-900 shadow-sm"
                  >
                    {mentionLabel(mention)}
                    <button
                      onClick={() => onDeleteMention(note.id, mention.id)}
                      className="ml-1 font-bold opacity-50 hover:text-red-700 hover:opacity-100"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <LogbookLinkPicker
                  onAddLink={(link) => onAddLink(note.id, link)}
                  onAddMention={(mention) => onAddMention(note.id, mention)}
                />
              </div>

              <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                <span>By {note.author?.display_name || "Admin"}</span>
                <span>{new Date(note.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
