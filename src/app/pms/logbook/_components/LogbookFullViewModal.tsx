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
      <DialogContent className="max-w-[min(92vw,1100px)] p-0">
        <div className="flex h-[88vh] flex-col overflow-visible rounded-xl bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Full View</h2>
              <p className="text-xs text-[var(--text-secondary)]">Large editor for detailed reading and staff-friendly editing.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onArchive(note.id)}>
                Archive
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-x-visible overflow-y-auto px-5 py-5">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Title</label>
                <Input
                  value={note.title}
                  onChange={(event) =>
                    onUpdateContent(
                      note.id,
                      { title: event.target.value },
                      { historyMode: "coalesced", saveMode: "debounced" }
                    )
                  }
                  className="h-11 text-base font-semibold"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Type</label>
                <select
                  value={note.note_type}
                  onChange={(event) =>
                    onUpdateContent(
                      note.id,
                      { note_type: event.target.value as LogbookNote["note_type"] },
                      { historyMode: "immediate", saveMode: "immediate" }
                    )
                  }
                  className="form-select h-11 rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 text-sm"
                >
                  <option value="general">General</option>
                  <option value="task">Task</option>
                  <option value="urgent">Urgent</option>
                  <option value="stock">Stock</option>
                  <option value="vip">VIP</option>
                </select>
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
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Body</label>
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
                  className="min-h-[360px] resize-none bg-[var(--bg-body)] text-base leading-7"
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Links and Mentions</label>
                  <LogbookLinkPicker
                    onAddLink={(link) => onAddLink(note.id, link)}
                    onAddMention={(mention) => onAddMention(note.id, mention)}
                    align="right"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                  {note.links?.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className="rounded-full border border-black/10 bg-[var(--bg-surface)] px-2 py-1 text-xs font-semibold text-[var(--text-table-cell)] shadow-sm"
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
                    <span className="text-xs text-[var(--text-secondary)]">No links or mentions yet.</span>
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
