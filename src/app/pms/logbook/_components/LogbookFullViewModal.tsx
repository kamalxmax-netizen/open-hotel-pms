"use client"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { LogbookMention, LogbookNote, LogbookNoteLink } from "@/lib/types"
import { LogbookRichToolbar } from "./LogbookRichToolbar"
import { getNoteRichBody, getRichBodyTextareaStyle, plainTextToHtml } from "./logbook-rich"
import { LogbookLinkPicker } from "./LogbookLinkPicker"
import { useRouter } from "next/navigation"
import { resolveLogbookLinkHref } from "./logbook-link-navigation"

type NoteUpdateOptions = {
  historyMode?: "coalesced" | "immediate" | "none"
  saveMode?: "debounced" | "immediate"
}

interface LogbookFullViewModalProps {
  open: boolean
  note: LogbookNote | null
  canUndo: boolean
  canRedo: boolean
  onOpenChange: (open: boolean) => void
  onUpdateContent: (noteId: string, updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => void
  onAddLink: (noteId: string, link: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => void
  onDeleteLink: (noteId: string, linkId: string) => void
  onAddMention: (noteId: string, mention: Pick<LogbookMention, "mention_type" | "staff_id">) => void
  onDeleteMention: (noteId: string, mentionId: string) => void
  onUndo: (noteId: string) => void
  onRedo: (noteId: string) => void
  onArchive: (noteId: string) => void
}

function mentionLabel(mention: LogbookMention) {
  if (mention.mention_type === "group_all") return "@all"
  if (mention.mention_type === "group_frontdesk") return "@Front Desk"
  return `@${mention.staff?.display_name || "Staff"}`
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromDateTimeLocalValue(value: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const NOTE_TYPES: Array<{ value: LogbookNote["note_type"]; label: string }> = [
  { value: "general", label: "General" },
  { value: "task", label: "Task" },
  { value: "urgent", label: "Urgent" },
  { value: "stock", label: "Stock" },
  { value: "vip", label: "VIP" },
]

export function LogbookFullViewModal({
  open,
  note,
  canUndo,
  canRedo,
  onOpenChange,
  onUpdateContent,
  onAddLink,
  onDeleteLink,
  onAddMention,
  onDeleteMention,
  onUndo,
  onRedo,
  onArchive,
}: LogbookFullViewModalProps) {
  const router = useRouter()

  if (!note) return null

  const richBody = getNoteRichBody(note)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="logbook-shell z-[10000] max-w-[min(92vw,1100px)] border-[var(--logbook-card-border)] bg-[var(--logbook-card)] p-0 text-[var(--logbook-text-primary)] shadow-2xl">
        <div className="flex h-[88vh] flex-col overflow-visible rounded-2xl bg-[var(--logbook-card)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--logbook-hairline)] px-5 py-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--logbook-brand-heading)]">Edit Note</h2>
              <p className="text-xs text-[var(--logbook-text-secondary)]">Update content, calendar window, links, and mentions.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="rounded-[var(--logbook-pill-radius)] border-[var(--logbook-field-border)] bg-[var(--logbook-canvas-alt)] text-[var(--logbook-text-primary)] hover:bg-[var(--logbook-card)]" onClick={() => onArchive(note.id)}>
                Archive
              </Button>
              <Button variant="ghost" size="sm" className="rounded-[var(--logbook-pill-radius)] text-[var(--logbook-text-secondary)] hover:bg-[var(--logbook-canvas-alt)] hover:text-[var(--logbook-text-primary)]" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-x-visible overflow-y-auto px-5 py-5">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--logbook-text-secondary)]">Title</label>
                <Input
                  value={note.title}
                  onChange={(event) =>
                    onUpdateContent(
                      note.id,
                      { title: event.target.value },
                      { historyMode: "coalesced", saveMode: "debounced" }
                    )
                  }
                  className="h-11 rounded-lg border-[var(--logbook-field-border)] bg-[var(--logbook-card)] text-base font-semibold text-[var(--logbook-text-primary)]"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--logbook-text-secondary)]">Type</label>
                <div className="flex flex-wrap gap-2">
                  {NOTE_TYPES.map((type) => {
                    const isActive = note.note_type === type.value
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() =>
                          onUpdateContent(
                            note.id,
                            { note_type: type.value },
                            { historyMode: "immediate", saveMode: "immediate" }
                          )
                        }
                        className="rounded-[var(--logbook-pill-radius)] border px-3 py-1.5 text-xs font-semibold transition active:scale-95"
                        style={{
                          backgroundColor: isActive ? `var(--logbook-bar-${type.value})` : "transparent",
                          borderColor: `var(--logbook-bar-${type.value})`,
                          color: isActive ? "#ffffff" : `var(--logbook-bar-${type.value})`,
                        }}
                      >
                        {type.label} {isActive && <span className="ml-1 text-[8px]">●</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-2 rounded-xl border border-[var(--logbook-hairline)] bg-[var(--logbook-canvas-alt)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--logbook-text-secondary)]">Calendar Window</label>
                  <span className="text-[11px] text-[var(--logbook-text-secondary)]">Controls where this note appears on Calendar.</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <label className="text-[11px] font-semibold text-[var(--logbook-text-secondary)]">Start</label>
                    <Input
                      type="datetime-local"
                      value={toDateTimeLocalValue(note.start_at)}
                      onChange={(event) => {
                        const nextStart = fromDateTimeLocalValue(event.target.value)
                        if (!nextStart) return
                        onUpdateContent(
                          note.id,
                          { start_at: nextStart },
                          { historyMode: "immediate", saveMode: "immediate" }
                        )
                      }}
                      className="h-10 rounded-lg border-[var(--logbook-field-border)] bg-[var(--logbook-card)] text-sm text-[var(--logbook-text-primary)]"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <label className="text-[11px] font-semibold text-[var(--logbook-text-secondary)]">End</label>
                    <Input
                      type="datetime-local"
                      value={toDateTimeLocalValue(note.end_at)}
                      onChange={(event) =>
                        onUpdateContent(
                          note.id,
                          { end_at: fromDateTimeLocalValue(event.target.value) },
                          { historyMode: "immediate", saveMode: "immediate" }
                        )
                      }
                      className="h-10 rounded-lg border-[var(--logbook-field-border)] bg-[var(--logbook-card)] text-sm text-[var(--logbook-text-primary)]"
                    />
                  </div>
                </div>
              </div>

              <LogbookRichToolbar
                richBody={richBody}
                remindAt={note.remind_at}
                canUndo={canUndo}
                canRedo={canRedo}
                variant="full"
                onUndo={() => onUndo(note.id)}
                onRedo={() => onRedo(note.id)}
                onChangeRemindAt={(value) =>
                  onUpdateContent(
                    note.id,
                    { remind_at: value },
                    { historyMode: "immediate", saveMode: "immediate" }
                  )
                }
                onChangeRichBody={(nextRichBody) =>
                  onUpdateContent(
                    note.id,
                    { body: note.body, body_rich: nextRichBody },
                    { historyMode: "immediate", saveMode: "immediate" }
                  )
                }
              />

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--logbook-text-secondary)]">Body</label>
                <Textarea
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
                  className="min-h-[360px] resize-none rounded-lg border-[var(--logbook-field-border)] bg-[var(--logbook-card)] text-base leading-7 text-[var(--logbook-text-primary)]"
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--logbook-text-secondary)]">Links and Mentions</label>
                  <LogbookLinkPicker
                    onAddLink={(link) => onAddLink(note.id, link)}
                    onAddMention={(mention) => onAddMention(note.id, mention)}
                    align="right"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--logbook-hairline)] bg-[var(--logbook-canvas-alt)] p-3">
                  {note.links?.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className="rounded-full border border-[var(--logbook-hairline)] bg-[var(--logbook-card)] px-2 py-1 text-xs font-semibold text-[var(--logbook-text-primary)] shadow-sm"
                      onClick={async () => {
                        const href = await resolveLogbookLinkHref(link)
                        router.push(href)
                      }}
                    >
                      {link.label}
                      <span
                        className="ml-1 text-rose-600"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteLink(note.id, link.id)
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                  {note.mentions?.map((mention) => (
                    <button
                      key={mention.id}
                      type="button"
                      className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-1 text-xs font-semibold text-yellow-800 shadow-sm"
                    >
                      {mentionLabel(mention)}
                      <span
                        className="ml-1 text-rose-600"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDeleteMention(note.id, mention.id)
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                  {!note.links?.length && !note.mentions?.length ? (
                    <span className="text-xs text-[var(--logbook-text-secondary)]">No links or mentions yet.</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
