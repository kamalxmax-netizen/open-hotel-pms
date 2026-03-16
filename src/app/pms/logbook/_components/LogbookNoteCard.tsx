"use client"

import { MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { LogbookMention, LogbookNote, LogbookNoteLink } from "@/lib/types"
import { LogbookLinkPicker } from "./LogbookLinkPicker"
import {
  getNoteRichBody,
  getRichBodyTextareaStyle,
  plainTextToHtml,
} from "./logbook-rich"
import { resolveLogbookLinkHref } from "./logbook-link-navigation"

type NoteUpdateOptions = {
  historyMode?: "coalesced" | "immediate" | "none"
  saveMode?: "debounced" | "immediate"
}

interface NoteCardProps {
  note: LogbookNote
  onUpdatePosition: (updates: Partial<LogbookNote>) => void
  onUpdateContent: (updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => void
  onFocus: () => void
  onArchive: () => void
  onOpenFullView: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onAddLink: (link: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => void
  onDeleteLink: (linkId: string) => void
  onAddMention: (mention: Pick<LogbookMention, "mention_type" | "staff_id">) => void
  onDeleteMention: (mentionId: string) => void
}

const NOTE_COLORS: Record<LogbookNote["note_type"], { card: string; header: string; body: string }> = {
  general: { card: "bg-[var(--bg-surface)] border-[var(--border-input)]", header: "bg-[var(--bg-surface-hover)]/90", body: "bg-[var(--bg-body)]/85" },
  task: { card: "bg-yellow-100 border-yellow-400", header: "bg-yellow-200/90", body: "bg-yellow-50/90" },
  urgent: { card: "bg-rose-100 border-rose-400", header: "bg-rose-200/90", body: "bg-rose-50/90" },
  stock: { card: "bg-emerald-100 border-emerald-400", header: "bg-emerald-200/90", body: "bg-emerald-50/90" },
  vip: { card: "bg-purple-100 border-purple-400", header: "bg-purple-200/90", body: "bg-purple-50/90" },
}

const NOTE_TYPE_META: Record<LogbookNote["note_type"], { label: string; dot: string }> = {
  general: { label: "General", dot: "bg-slate-500" },
  task: { label: "Task", dot: "bg-yellow-500" },
  urgent: { label: "Urgent", dot: "bg-rose-500" },
  stock: { label: "Stock", dot: "bg-emerald-500" },
  vip: { label: "VIP", dot: "bg-purple-500" },
}

function formatCompactCreatedAt(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("hour")}:${get("minute")} ${get("day")}/${get("month")}`.trim()
}

type InlineAtAction =
  | { type: "mention_group_all" }
  | { type: "mention_group_frontdesk" }
  | { type: "mention_staff"; staff_id: string }
  | { type: "link_stock" }
  | { type: "link_room"; room_code: string }
  | { type: "link_guest"; guest_id: string }

type InlineAtOption = {
  key: string
  label: string
  hint: string
  insertText: string
  action: InlineAtAction
}

const slugTag = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36) || "tag"

function mentionLabel(mention: LogbookMention) {
  if (mention.mention_type === "group_all") return "@all"
  if (mention.mention_type === "group_frontdesk") return "@Front Desk"
  return `@${mention.staff?.display_name || "Staff"}`
}

export function LogbookNoteCard({
  note,
  onUpdatePosition,
  onUpdateContent,
  onFocus,
  onArchive,
  onOpenFullView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddLink,
  onDeleteLink,
  onAddMention,
  onDeleteMention,
}: NoteCardProps) {
  const router = useRouter()
  const [isDragging, setIsDragging] = useState(false)
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false)
  const [isAtPickerOpen, setIsAtPickerOpen] = useState(false)
  const [atQuery, setAtQuery] = useState("")
  const [atTokenStart, setAtTokenStart] = useState(0)
  const [atTokenEnd, setAtTokenEnd] = useState(0)
  const [atOptions, setAtOptions] = useState<InlineAtOption[]>([])
  const [atLoading, setAtLoading] = useState(false)
  const [atActiveIndex, setAtActiveIndex] = useState(0)
  const [pos, setPos] = useState({ x: note.x, y: note.y })
  const [size, setSize] = useState({ w: note.width, h: note.height })
  const lastMiddleSizeRef = useRef({ w: Math.max(note.width, 320), h: Math.max(note.height, 220) })
  const typeMenuRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const atSearchTimerRef = useRef<NodeJS.Timeout | null>(null)
  const supabaseRef = useRef(createBrowserSupabaseClient())

  const isMinimized = note.board_mode === "minimized"
  const richBody = getNoteRichBody(note)
  const noteColors = NOTE_COLORS[note.note_type] || NOTE_COLORS.general
  const minimizedTitle = note.title.trim() || "Note title"
  const minimizedTitleWidth = Math.min(200, Math.max(50, minimizedTitle.length * 16 + 12))
  const minimizedWidth = Math.min(560, minimizedTitleWidth + 118)
  const createdMeta = formatCompactCreatedAt(note.created_at)

  useEffect(() => setPos({ x: note.x, y: note.y }), [note.x, note.y])
  useEffect(() => {
    if (!isMinimized) {
      setSize({ w: note.width, h: note.height })
      lastMiddleSizeRef.current = { w: note.width, h: note.height }
    }
  }, [isMinimized, note.height, note.width])

  useEffect(() => {
    if (!isTypeMenuOpen) return
    const onDocMouseDown = (event: globalThis.MouseEvent) => {
      if (!typeMenuRef.current) return
      if (!typeMenuRef.current.contains(event.target as Node)) {
        setIsTypeMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [isTypeMenuOpen])

  const getPulseShadowStyle = () => {
    if (!note.remind_at) return null
    const remindDate = new Date(note.remind_at)
    const now = new Date()
    const diffMin = (remindDate.getTime() - now.getTime()) / 60000

    if (diffMin < 0) {
      return {
        animationDuration: "1s",
        boxShadow: "0 0 0 5px rgba(239,68,68,0.50), 0 22px 44px rgba(239,68,68,0.54)",
      }
    }
    if (diffMin <= 10) {
      return {
        animationDuration: "1s",
        boxShadow: "0 0 0 5px rgba(239,68,68,0.50), 0 22px 44px rgba(239,68,68,0.54)",
      }
    }
    if (diffMin <= 30) {
      return {
        animationDuration: "1.8s",
        boxShadow: "0 0 0 5px rgba(245,158,11,0.46), 0 20px 40px rgba(245,158,11,0.50)",
      }
    }
    return null
  }

  const openLink = async (link: LogbookNoteLink) => {
    const href = await resolveLogbookLinkHref(link)
    if (href) router.push(href)
  }

  const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await supabaseRef.current.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  const closeAtPicker = useCallback(() => {
    setIsAtPickerOpen(false)
    setAtOptions([])
    setAtQuery("")
    setAtActiveIndex(0)
    if (atSearchTimerRef.current) {
      clearTimeout(atSearchTimerRef.current)
      atSearchTimerRef.current = null
    }
  }, [])

  const openAtPickerFromCursor = useCallback(
    (body: string, cursor: number) => {
      const left = body.slice(0, cursor)
      const match = left.match(/(^|\s)@([^\s@]*)$/)
      if (!match) {
        closeAtPicker()
        return
      }
      const query = match[2] ?? ""
      const tokenStart = cursor - query.length - 1
      setAtTokenStart(tokenStart)
      setAtTokenEnd(cursor)
      setAtQuery(query)
      setIsAtPickerOpen(true)
    },
    [closeAtPicker]
  )

  useEffect(() => {
    if (!isAtPickerOpen) return

    const q = atQuery.trim().toLowerCase()
    const quickOptions: InlineAtOption[] = []

    const allow = (target: string) => q.length === 0 || target.includes(q)
    if (allow("all")) {
      quickOptions.push({
        key: "mention:all",
        label: "@all",
        hint: "Mention everyone",
        insertText: "@all",
        action: { type: "mention_group_all" },
      })
    }
    if (allow("frontdesk") || allow("fo")) {
      quickOptions.push({
        key: "mention:frontdesk",
        label: "@Front Desk",
        hint: "Mention front desk team",
        insertText: "@frontdesk",
        action: { type: "mention_group_frontdesk" },
      })
    }
    if (allow("stock")) {
      quickOptions.push({
        key: "link:stock",
        label: "@stock",
        hint: "Link inventory stock page",
        insertText: "@stock",
        action: { type: "link_stock" },
      })
    }

    const roomCandidate = q.match(/^(?:room|r)?(\d{1,4})$/)?.[1] ?? null
    if (roomCandidate) {
      quickOptions.push({
        key: `link:room:${roomCandidate}`,
        label: `Room ${roomCandidate}`,
        hint: "Link room diary",
        insertText: `@room${roomCandidate}`,
        action: { type: "link_room", room_code: roomCandidate },
      })
    }

    setAtOptions(quickOptions)
    setAtActiveIndex(0)

    if (q.length < 1) {
      setAtLoading(false)
      return
    }

    if (atSearchTimerRef.current) clearTimeout(atSearchTimerRef.current)
    atSearchTimerRef.current = setTimeout(async () => {
      try {
        setAtLoading(true)
        const headers = await getAuthHeader()
        const [staffRes, guestRes] = await Promise.all([
          fetch(`/api/staff?is_active=true`, { headers, cache: "no-store" }),
          fetch(`/api/guests?q=${encodeURIComponent(q)}&limit=6`, { headers, cache: "no-store" }),
        ])

        const staffJson = await staffRes.json().catch(() => ({}))
        const guestJson = await guestRes.json().catch(() => ({}))
        const dynamicOptions: InlineAtOption[] = []

        if (staffRes.ok && staffJson?.success) {
          const rows = Array.isArray(staffJson.data) ? staffJson.data : []
          for (const row of rows) {
            const id = String(row?.id ?? "")
            const name = String(row?.display_name ?? "").trim()
            if (!id || !name || !name.toLowerCase().includes(q)) continue
            dynamicOptions.push({
              key: `mention:staff:${id}`,
              label: `@${name}`,
              hint: "Mention staff",
              insertText: `@${slugTag(name)}`,
              action: { type: "mention_staff", staff_id: id },
            })
          }
        }

        if (guestRes.ok && guestJson?.success) {
          const rows = Array.isArray(guestJson.profiles) ? guestJson.profiles : []
          for (const row of rows) {
            const id = String(row?.id ?? "")
            const first = String(row?.first_name ?? "").trim()
            const last = String(row?.last_name ?? "").trim()
            const name = [first, last].filter(Boolean).join(" ").trim() || "Guest"
            if (!id) continue
            dynamicOptions.push({
              key: `link:guest:${id}`,
              label: `@${name}`,
              hint: "Link guest profile",
              insertText: `@${slugTag(name)}`,
              action: { type: "link_guest", guest_id: id },
            })
          }
        }

        setAtOptions((prev) => {
          const seen = new Set(prev.map((x) => x.key))
          const merged = [...prev]
          for (const item of dynamicOptions) {
            if (seen.has(item.key)) continue
            seen.add(item.key)
            merged.push(item)
          }
          return merged
        })
      } catch (error) {
        console.error("Inline @ search failed", error)
      } finally {
        setAtLoading(false)
      }
    }, 220)
  }, [atQuery, getAuthHeader, isAtPickerOpen])

  const applyAtOption = useCallback(
    (option: InlineAtOption) => {
      const safeBody = String(note.body ?? "")
      const nextBody = `${safeBody.slice(0, atTokenStart)}${option.insertText} ${safeBody.slice(atTokenEnd)}`
      onUpdateContent(
        {
          body: nextBody,
          body_rich: {
            ...richBody,
            html: plainTextToHtml(nextBody),
          },
        },
        { historyMode: "coalesced", saveMode: "debounced" }
      )

      if (option.action.type === "mention_group_all") {
        const exists = (note.mentions || []).some((mention) => mention.mention_type === "group_all")
        if (!exists) onAddMention({ mention_type: "group_all", staff_id: null })
      } else if (option.action.type === "mention_group_frontdesk") {
        const exists = (note.mentions || []).some((mention) => mention.mention_type === "group_frontdesk")
        if (!exists) onAddMention({ mention_type: "group_frontdesk", staff_id: null })
      } else if (option.action.type === "mention_staff") {
        const staffId = option.action.staff_id
        const exists = (note.mentions || []).some(
          (mention) => mention.mention_type === "staff" && mention.staff_id === staffId
        )
        if (!exists) onAddMention({ mention_type: "staff", staff_id: staffId })
      } else if (option.action.type === "link_stock") {
        const exists = (note.links || []).some((link) => link.link_type === "stock")
        if (!exists) onAddLink({ link_type: "stock", ref_id: null, ref_code: "stock", label: "Stock" })
      } else if (option.action.type === "link_room") {
        const roomCode = option.action.room_code
        const exists = (note.links || []).some(
          (link) => link.link_type === "room" && String(link.ref_code ?? "") === roomCode
        )
        if (!exists) {
          onAddLink({
            link_type: "room",
            ref_id: null,
            ref_code: roomCode,
            label: `Room ${roomCode}`,
          })
        }
      } else if (option.action.type === "link_guest") {
        const guestId = option.action.guest_id
        const exists = (note.links || []).some(
          (link) => link.link_type === "guest" && link.ref_id === guestId
        )
        if (!exists) {
          onAddLink({
            link_type: "guest",
            ref_id: guestId,
            ref_code: null,
            label: option.label.replace(/^@/, ""),
          })
        }
      }

      closeAtPicker()
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        textareaRef.current.focus()
        const nextCursor = atTokenStart + option.insertText.length + 1
        textareaRef.current.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [
      atTokenEnd,
      atTokenStart,
      closeAtPicker,
      note.body,
      note.links,
      note.mentions,
      onAddLink,
      onAddMention,
      onUpdateContent,
      richBody,
    ]
  )

  useEffect(() => {
    return () => {
      if (atSearchTimerRef.current) clearTimeout(atSearchTimerRef.current)
    }
  }, [])

  const handleDragStart = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest("input, textarea, button, select, option, a, [data-no-drag]")) return
    if (target.closest(".note-content")) return
    event.preventDefault()
    setIsDragging(true)
    onFocus()

    let startX = event.clientX
    let startY = event.clientY

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      setPos((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
      startX = moveEvent.clientX
      startY = moveEvent.clientY
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      setPos((finalPos) => {
        onUpdatePosition({ x: finalPos.x, y: finalPos.y })
        return finalPos
      })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  const handleResizeStart = (event: MouseEvent) => {
    if (isMinimized) return
    event.preventDefault()
    event.stopPropagation()
    onFocus()

    let startX = event.clientX
    let startY = event.clientY

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      setSize((prev) => ({
        w: Math.min(560, Math.max(300, prev.w + dx)),
        h: Math.min(420, Math.max(170, prev.h + dy)),
      }))
      startX = moveEvent.clientX
      startY = moveEvent.clientY
    }

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      setSize((finalSize) => {
        onUpdatePosition({ width: finalSize.w, height: finalSize.h })
        return finalSize
      })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  return (
    <Card
      onMouseDown={onFocus}
      style={{
        position: "absolute",
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: isMinimized ? `${minimizedWidth}px` : `${size.w}px`,
        height: isMinimized ? "40px" : `${size.h}px`,
        zIndex: note.z_index,
      }}
      className={`flex flex-col overflow-visible border shadow-lg transition-shadow duration-300 ${
        isDragging ? "cursor-grabbing opacity-90" : "cursor-grab"
      } ${noteColors.card} rounded-2xl`}
    >
      {getPulseShadowStyle() ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-2xl animate-pulse"
          style={getPulseShadowStyle() || undefined}
        />
      ) : null}
      <div
        className={`relative z-30 flex items-center border-b border-black/10 ${
          isMinimized ? "gap-1 px-2 py-2" : "gap-1 px-1.5 py-1"
        } ${
          isMinimized ? "rounded-2xl" : "rounded-t-2xl"
        } ${noteColors.header}`}
        onMouseDown={handleDragStart}
      >
        <input
          value={note.title}
          onChange={(event) =>
            onUpdateContent(
              { title: event.target.value },
              { historyMode: "coalesced", saveMode: "debounced" }
            )
          }
          className={`min-w-0 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${
            isMinimized ? "flex-none px-1 text-[19px] font-black leading-[1.2]" : "flex-1 px-1 text-[15px] font-black leading-[1.25]"
          }`}
          style={isMinimized ? { width: `${minimizedTitleWidth}px` } : undefined}
          placeholder="Note title"
        />

        <div className="relative z-40 flex shrink-0 items-center" ref={typeMenuRef} data-no-drag>
          <button
            type="button"
            className={`flex items-center justify-center rounded-full hover:bg-[var(--bg-surface)]/60 ${
              isMinimized ? "h-[22px] w-[22px]" : "h-5 w-5"
            }`}
            title={`Type: ${NOTE_TYPE_META[note.note_type].label}`}
            onClick={() => setIsTypeMenuOpen((value) => !value)}
          >
            <span className={`block ${isMinimized ? "h-4 w-4" : "h-3 w-3"} rounded-full ${NOTE_TYPE_META[note.note_type].dot}`} />
          </button>
          {isTypeMenuOpen ? (
            <div className="absolute right-0 top-full z-[80] mt-1 w-28 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 opacity-100 shadow-xl">
              {(Object.keys(NOTE_TYPE_META) as LogbookNote["note_type"][]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] ${
                    note.note_type === type
                      ? "bg-[var(--bg-surface-hover)] font-semibold text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                  }`}
                  onClick={() => {
                    onUpdateContent(
                      { note_type: type },
                      { historyMode: "immediate", saveMode: "immediate" }
                    )
                    setIsTypeMenuOpen(false)
                  }}
                >
                  <span className={`block h-2.5 w-2.5 rounded-full ${NOTE_TYPE_META[type].dot}`} />
                  <span>{NOTE_TYPE_META[type].label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className={`${isMinimized ? "h-[22px] w-[22px] text-[18px]" : "h-5 w-5 text-sm"} shrink-0 font-black`}
          title={isMinimized ? "Expand on board" : "Minimize"}
          onClick={() => {
            if (isMinimized) {
              const nextSize = lastMiddleSizeRef.current
              setSize(nextSize)
              onUpdatePosition({
                board_mode: "middle",
                width: nextSize.w,
                height: nextSize.h,
              })
              return
            }
            lastMiddleSizeRef.current = size
            onUpdatePosition({ board_mode: "minimized" })
          }}
        >
          <span className="font-black">{isMinimized ? "□" : "−"}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`${isMinimized ? "h-[22px] w-[22px] text-[18px]" : "h-5 w-5 text-sm"} shrink-0 font-black`}
          title="Full view"
          onClick={onOpenFullView}
        >
          <span className="font-black">↗</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`${isMinimized ? "h-[22px] w-[22px] text-[18px]" : "h-5 w-5 text-sm"} shrink-0 font-black text-rose-600 hover:bg-rose-100 hover:text-rose-700`}
          title="Archive"
          onClick={onArchive}
        >
          <span className="font-black">×</span>
        </Button>
      </div>

      {!isMinimized ? (
        <div className={`note-content relative z-10 flex h-full flex-1 flex-col gap-1 rounded-b-2xl p-2 pb-3 ${noteColors.body}`}>
          <textarea
            ref={textareaRef}
            value={note.body}
            onChange={(event) => {
              const value = event.target.value
              onUpdateContent(
                {
                  body: value,
                  body_rich: {
                    ...richBody,
                    html: plainTextToHtml(value),
                  },
                },
                { historyMode: "coalesced", saveMode: "debounced" }
              )
              openAtPickerFromCursor(value, event.target.selectionStart ?? value.length)
            }}
            onClick={(event) => {
              const input = event.target as HTMLTextAreaElement
              openAtPickerFromCursor(input.value, input.selectionStart ?? input.value.length)
            }}
            onKeyUp={(event) => {
              const input = event.currentTarget
              openAtPickerFromCursor(input.value, input.selectionStart ?? input.value.length)
            }}
            onKeyDown={(event) => {
              if (!isAtPickerOpen || atOptions.length === 0) return
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setAtActiveIndex((prev) => (prev + 1) % atOptions.length)
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setAtActiveIndex((prev) => (prev - 1 + atOptions.length) % atOptions.length)
                return
              }
              if (event.key === "Enter") {
                event.preventDefault()
                applyAtOption(atOptions[atActiveIndex] ?? atOptions[0])
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                closeAtPicker()
              }
            }}
            onBlur={() => window.setTimeout(() => closeAtPicker(), 120)}
            style={getRichBodyTextareaStyle(richBody)}
            className="min-h-[72px] flex-1 resize-none rounded-xl border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-black/10"
            placeholder="Type your notes here..."
          />

          {isAtPickerOpen ? (
            <div className="absolute bottom-20 left-2 right-2 z-30 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg">
              <div className="border-b border-[var(--border-subtle)] px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)]">
                Autolink with @
              </div>
              <div className="max-h-36 overflow-auto py-1">
                {atOptions.map((option, index) => (
                  <button
                    key={option.key}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyAtOption(option)
                    }}
                    className={`w-full px-2 py-1 text-left text-[11px] ${
                      index === atActiveIndex ? "bg-[var(--bg-surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                    }`}
                  >
                    <span className="font-semibold">{option.label}</span>
                    <span className="ml-1 text-[10px] text-[var(--text-muted)]">{option.hint}</span>
                  </button>
                ))}
                {atLoading ? (
                  <div className="px-2 py-1 text-[10px] text-[var(--text-muted)]">Loading suggestions...</div>
                ) : null}
                {!atLoading && atOptions.length === 0 ? (
                  <div className="px-2 py-1 text-[10px] text-[var(--text-muted)]">No matches</div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="relative mt-auto shrink-0">
            <div className="flex flex-wrap items-start gap-0.5 pr-5">
              {note.links?.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  className={`rounded-full border border-black/10 px-1.5 py-0.5 text-[9px] font-semibold shadow-sm ${
                    link.link_type === "room"
                      ? "bg-rose-200 text-rose-800"
                      : link.link_type === "guest"
                        ? "bg-purple-200 text-purple-800"
                        : link.link_type === "stock"
                          ? "bg-blue-200 text-blue-800"
                          : "bg-[var(--bg-muted)] text-[var(--text-primary)]"
                  }`}
                  onClick={() => void openLink(link)}
                >
                  {link.label}
                  <span
                    className="ml-1 opacity-60 hover:text-rose-700"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteLink(link.id)
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
                  className="rounded-full border border-black/10 bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-900 shadow-sm"
                >
                  {mentionLabel(mention)}
                  <span
                    className="ml-1 opacity-60 hover:text-rose-700"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteMention(mention.id)
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] leading-none text-[var(--text-muted)]">
            <span className="truncate">
              By {note.author?.display_name || "Admin"}
              {createdMeta ? ` ${createdMeta}` : ""}
            </span>
            {note.remind_at ? (
              <span className="truncate font-medium">{new Date(note.remind_at).toLocaleString()}</span>
            ) : null}
          </div>

          <div className="absolute bottom-3 right-2 z-30 shrink-0" data-no-drag>
            <LogbookLinkPicker onAddLink={onAddLink} onAddMention={onAddMention} align="right" />
          </div>

          <div
            className="absolute bottom-0 right-0 flex h-4 w-4 cursor-se-resize items-end justify-end p-1 opacity-50 hover:opacity-100"
            onMouseDown={handleResizeStart}
          >
            <div className="h-2 w-2 border-b-2 border-r-2 border-slate-500/50" />
          </div>
        </div>
      ) : null}
    </Card>
  )
}
