"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { LogbookBoardCanvas } from "./_components/LogbookBoardCanvas"
import { LogbookFilterBar } from "./_components/LogbookFilterBar"
import { LogbookCreateButton } from "./_components/LogbookCreateButton"
import { LogbookMobileList } from "./_components/LogbookMobileList"
import { LogbookArchiveDrawer } from "./_components/LogbookArchiveDrawer"
import { LogbookFullViewModal } from "./_components/LogbookFullViewModal"
import { LogbookCreateModal } from "./_components/LogbookCreateModal"
import { Button } from "@/components/ui/button"
import { LogbookMention, LogbookNote, LogbookNoteLink } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

type NoteUpdateOptions = {
  historyMode?: "coalesced" | "immediate" | "none"
  saveMode?: "debounced" | "immediate"
}

type NoteSnapshot = {
  title: string
  body: string
  body_rich: LogbookNote["body_rich"]
  note_type: LogbookNote["note_type"]
  remind_at: string | null
  links: LogbookNoteLink[]
  mentions: LogbookMention[]
}

type NoteHistoryBucket = {
  undo: NoteSnapshot[]
  redo: NoteSnapshot[]
  pendingSnapshot: NoteSnapshot | null
}

function cloneSnapshot(note: LogbookNote): NoteSnapshot {
  return {
    title: note.title,
    body: note.body,
    body_rich: note.body_rich
      ? {
        html: note.body_rich.html,
        styles: { ...note.body_rich.styles },
      }
      : null,
    note_type: note.note_type,
    remind_at: note.remind_at,
    links: (note.links || []).map((link) => ({ ...link })),
    mentions: (note.mentions || []).map((mention) => ({
      ...mention,
      staff: mention.staff ? { ...mention.staff } : undefined,
    })),
  }
}

function sameLinkSemantic(
  left: Pick<LogbookNoteLink, "link_type" | "ref_id" | "ref_code">,
  right: Pick<LogbookNoteLink, "link_type" | "ref_id" | "ref_code">
) {
  return (
    left.link_type === right.link_type &&
    String(left.ref_id ?? "") === String(right.ref_id ?? "") &&
    String(left.ref_code ?? "") === String(right.ref_code ?? "")
  )
}

function sameMentionSemantic(
  left: Pick<LogbookMention, "mention_type" | "staff_id">,
  right: Pick<LogbookMention, "mention_type" | "staff_id">
) {
  return left.mention_type === right.mention_type && String(left.staff_id ?? "") === String(right.staff_id ?? "")
}

function isSameSnapshot(left: NoteSnapshot | undefined, right: NoteSnapshot | undefined) {
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function getMinimizedNoteWidth(note: LogbookNote) {
  const title = note.title.trim() || "Note title"
  const titleWidth = Math.min(200, Math.max(50, title.length * 16 + 12))
  return Math.min(560, titleWidth + 118)
}

type DateMode = "today" | "date" | "range"

function formatDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysBetween(a: Date, b: Date) {
  const ms = Math.abs(b.getTime() - a.getTime())
  return Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1
}

function mergeFetchedNotesPreservingDirty(
  current: LogbookNote[],
  incoming: LogbookNote[],
  protectedIds: Set<string>
): LogbookNote[] {
  if (protectedIds.size === 0) return incoming
  const currentById = new Map(current.map((note) => [note.id, note]))
  const incomingIds = new Set(incoming.map((note) => note.id))
  const merged = incoming.map((note) => (protectedIds.has(note.id) ? currentById.get(note.id) ?? note : note))
  for (const note of current) {
    if (protectedIds.has(note.id) && !incomingIds.has(note.id)) merged.push(note)
  }
  return merged
}

export default function LogbookPage() {
  const [notes, setNotes] = useState<LogbookNote[]>([])
  const [archivedNotes, setArchivedNotes] = useState<LogbookNote[]>([])
  const [filterTypes, setFilterTypes] = useState<Array<"all" | LogbookNote["note_type"]>>(["all"])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [archiveDrawerOpen, setArchiveDrawerOpen] = useState(false)
  const [fullViewNoteId, setFullViewNoteId] = useState<string | null>(null)
  const [archiveUndo, setArchiveUndo] = useState<{ note: LogbookNote } | null>(null)
  const [, setHistoryVersion] = useState(0)
  const { toast } = useToast()

  // ── L1 additive state ──
  const [dateMode, setDateMode] = useState<DateMode>("today")
  const [selectedDate, setSelectedDate] = useState<string>(formatDateStr(new Date()))
  const [rangeStart, setRangeStart] = useState<string>(formatDateStr(new Date()))
  const [rangeEnd, setRangeEnd] = useState<string>(formatDateStr(new Date()))
  const [showPast, setShowPast] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const positionAbortControllers = useRef<Map<string, AbortController>>(new Map())
  const positionDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const contentAbortControllers = useRef<Map<string, AbortController>>(new Map())
  const contentDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const historyBuckets = useRef<Map<string, NoteHistoryBucket>>(new Map())
  const historyFlushTimers = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const archiveUndoTimer = useRef<NodeJS.Timeout | null>(null)

  const fetchWithTimeout = useCallback(async (input: string, init?: RequestInit, timeoutMs = 12000) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(input, { ...(init || {}), signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const resetHorizontalScroll = useCallback(() => {
    if (typeof document === "undefined") return
    const shellBody = document.querySelector<HTMLElement>(".page-body")
    if (shellBody) shellBody.scrollLeft = 0
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0
    if (typeof window !== "undefined") window.scrollTo({ left: 0 })
  }, [])

  const replaceNote = useCallback((noteId: string, next: LogbookNote) => {
    setNotes((prev) => prev.map((note) => (note.id === noteId ? next : note)))
    setArchivedNotes((prev) => prev.map((note) => (note.id === noteId ? next : note)))
  }, [])

  const refreshSingleNote = useCallback(
    async (noteId: string) => {
      const res = await fetch(`/api/logbook/notes/${noteId}`, { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success && data.data) {
        replaceNote(noteId, data.data)
      }
    },
    [replaceNote]
  )

  const fetchNotes = useCallback(async () => {
    try {
      const url = new URL("/api/logbook/notes", window.location.origin)

      // ── L1: date / range / past params ──
      if (showPast) {
        url.searchParams.set("past", "1")
      } else if (dateMode === "today") {
        url.searchParams.set("date", formatDateStr(new Date()))
      } else if (dateMode === "date") {
        url.searchParams.set("date", selectedDate)
      } else if (dateMode === "range") {
        url.searchParams.set("range_start", rangeStart)
        url.searchParams.set("range_end", rangeEnd)
      }

      const res = await fetchWithTimeout(url.toString(), { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        setFetchError(data?.error || `Failed to load notes (${res.status})`)
        return
      }
      setFetchError(null)
      setNotes(Array.isArray(data.data) ? data.data : [])
    } catch (error) {
      console.error("Failed to fetch notes", error)
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Request timeout while loading notes. Please retry."
          : "Failed to load notes. Please try refresh."
      setFetchError(message)
    } finally {
      setIsLoading(false)
    }
  }, [fetchWithTimeout, dateMode, selectedDate, rangeStart, rangeEnd, showPast])

  const fetchArchivedNotes = useCallback(async () => {
    try {
      const url = new URL("/api/logbook/notes", window.location.origin)
      url.searchParams.set("archived", "true")
      const res = await fetchWithTimeout(url.toString(), { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) return
      setArchivedNotes(Array.isArray(data.data) ? data.data : [])
    } catch (error) {
      console.error("Failed to fetch archived notes", error)
    }
  }, [fetchWithTimeout])

  useEffect(() => {
    fetchNotes()
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      fetchNotes()
      if (archiveDrawerOpen) fetchArchivedNotes()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      fetchNotes()
      if (archiveDrawerOpen) fetchArchivedNotes()
    }, 30000)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearInterval(interval)
      for (const timer of positionDebounceTimers.current.values()) clearTimeout(timer)
      for (const controller of positionAbortControllers.current.values()) controller.abort()
      for (const timer of contentDebounceTimers.current.values()) clearTimeout(timer)
      for (const controller of contentAbortControllers.current.values()) controller.abort()
      for (const timer of historyFlushTimers.current.values()) clearTimeout(timer)
      if (archiveUndoTimer.current) clearTimeout(archiveUndoTimer.current)
      positionDebounceTimers.current.clear()
      positionAbortControllers.current.clear()
      contentDebounceTimers.current.clear()
      contentAbortControllers.current.clear()
      historyFlushTimers.current.clear()
    }
  }, [archiveDrawerOpen, fetchArchivedNotes, fetchNotes])

  useEffect(() => {
    if (!archiveDrawerOpen) return
    fetchArchivedNotes()
  }, [archiveDrawerOpen, fetchArchivedNotes])

  useEffect(() => {
    if (archiveDrawerOpen) return
    const frame = requestAnimationFrame(() => resetHorizontalScroll())
    return () => cancelAnimationFrame(frame)
  }, [archiveDrawerOpen, resetHorizontalScroll])

  const fullViewNote = useMemo(
    () => notes.find((note) => note.id === fullViewNoteId) ?? null,
    [fullViewNoteId, notes]
  )

  const visibleNotes = useMemo(() => {
    if (filterTypes.includes("all")) return notes
    const selectedTypes = new Set(filterTypes)
    return notes.filter((note) => selectedTypes.has(note.note_type))
  }, [filterTypes, notes])

  const toggleFilterType = useCallback((type: "all" | LogbookNote["note_type"]) => {
    setFilterTypes((prev) => {
      if (type === "all") return ["all"]
      const selected = prev.includes("all") ? [] : [...prev]
      if (selected.includes(type)) {
        const next = selected.filter((value) => value !== type)
        return next.length > 0 ? next : ["all"]
      }
      return [...selected, type]
    })
  }, [])

  const getHistoryBucket = useCallback((noteId: string) => {
    const bucket = historyBuckets.current.get(noteId)
    if (bucket) return bucket
    const nextBucket: NoteHistoryBucket = { undo: [], redo: [], pendingSnapshot: null }
    historyBuckets.current.set(noteId, nextBucket)
    return nextBucket
  }, [])

  const bumpHistoryVersion = useCallback(() => {
    setHistoryVersion((value) => value + 1)
  }, [])

  const flushPendingHistory = useCallback(
    (noteId: string) => {
      const bucket = getHistoryBucket(noteId)
      if (!bucket.pendingSnapshot) return
      const lastUndo = bucket.undo[bucket.undo.length - 1]
      if (!isSameSnapshot(lastUndo, bucket.pendingSnapshot)) {
        bucket.undo.push(bucket.pendingSnapshot)
        bucket.redo = []
      }
      bucket.pendingSnapshot = null
      const timer = historyFlushTimers.current.get(noteId)
      if (timer) {
        clearTimeout(timer)
        historyFlushTimers.current.delete(noteId)
      }
      bumpHistoryVersion()
    },
    [bumpHistoryVersion, getHistoryBucket]
  )

  const stageCoalescedHistory = useCallback(
    (noteId: string, note: LogbookNote) => {
      const bucket = getHistoryBucket(noteId)
      if (!bucket.pendingSnapshot) {
        bucket.pendingSnapshot = cloneSnapshot(note)
      }
      const existingTimer = historyFlushTimers.current.get(noteId)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => flushPendingHistory(noteId), 400)
      historyFlushTimers.current.set(noteId, timer)
    },
    [flushPendingHistory, getHistoryBucket]
  )

  const pushImmediateHistory = useCallback(
    (noteId: string, note: LogbookNote) => {
      flushPendingHistory(noteId)
      const bucket = getHistoryBucket(noteId)
      const snapshot = cloneSnapshot(note)
      const lastUndo = bucket.undo[bucket.undo.length - 1]
      if (!isSameSnapshot(lastUndo, snapshot)) {
        bucket.undo.push(snapshot)
      }
      bucket.redo = []
      bumpHistoryVersion()
    },
    [bumpHistoryVersion, flushPendingHistory, getHistoryBucket]
  )

  const getHistoryState = useCallback(
    (noteId: string) => {
      const bucket = getHistoryBucket(noteId)
      return {
        canUndo: bucket.undo.length > 0 || bucket.pendingSnapshot !== null,
        canRedo: bucket.redo.length > 0,
      }
    },
    [getHistoryBucket]
  )

  const persistContentUpdate = useCallback(
    (noteId: string, updates: Partial<LogbookNote>, immediate: boolean) => {
      const run = async () => {
        const controller = new AbortController()
        contentAbortControllers.current.set(noteId, controller)
        try {
          const res = await fetch(`/api/logbook/notes/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
            signal: controller.signal,
          })
          const data = await res.json().catch(() => null)
          if (!res.ok || !data?.success) {
            throw new Error(data?.error || "Failed to save note")
          }
          if (data.data) {
            replaceNote(noteId, data.data)
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return
          console.error("Failed to update note content", error)
        } finally {
          if (contentAbortControllers.current.get(noteId) === controller) {
            contentAbortControllers.current.delete(noteId)
          }
        }
      }

      const existingTimer = contentDebounceTimers.current.get(noteId)
      if (existingTimer) clearTimeout(existingTimer)
      const existingController = contentAbortControllers.current.get(noteId)
      if (existingController) existingController.abort()

      if (immediate) {
        void run()
        return
      }

      const timer = setTimeout(run, 400)
      contentDebounceTimers.current.set(noteId, timer)
    },
    [replaceNote]
  )

  const handleUpdateNotePosition = useCallback((id: string, updates: Partial<LogbookNote>) => {
    const normalizedUpdates: Partial<LogbookNote> = { ...updates }
    if (typeof normalizedUpdates.x === "number") normalizedUpdates.x = Math.round(normalizedUpdates.x)
    if (typeof normalizedUpdates.y === "number") normalizedUpdates.y = Math.round(normalizedUpdates.y)
    if (typeof normalizedUpdates.width === "number") normalizedUpdates.width = Math.round(normalizedUpdates.width)
    if (typeof normalizedUpdates.height === "number") normalizedUpdates.height = Math.round(normalizedUpdates.height)

    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...normalizedUpdates } : note)))

    const existingTimer = positionDebounceTimers.current.get(id)
    if (existingTimer) clearTimeout(existingTimer)
    const existingController = positionAbortControllers.current.get(id)
    if (existingController) existingController.abort()

    const timer = setTimeout(async () => {
      const controller = new AbortController()
      positionAbortControllers.current.set(id, controller)
      try {
        const res = await fetch(`/api/logbook/notes/${id}/position`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizedUpdates),
          signal: controller.signal,
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.success && data.data) {
          setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...data.data } : note)))
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Failed to save note position", error)
        }
      } finally {
        if (positionAbortControllers.current.get(id) === controller) {
          positionAbortControllers.current.delete(id)
        }
      }
    }, 800)

    positionDebounceTimers.current.set(id, timer)
  }, [])

  const handleUpdateNoteContent = useCallback(
    (id: string, updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => {
      const currentNote = notes.find((note) => note.id === id)
      if (!currentNote) return

      const historyMode = options?.historyMode ?? "coalesced"
      const saveMode = options?.saveMode ?? "debounced"

      if (historyMode === "immediate") {
        pushImmediateHistory(id, currentNote)
      } else if (historyMode === "coalesced") {
        stageCoalescedHistory(id, currentNote)
      }

      setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...updates } : note)))
      persistContentUpdate(id, updates, saveMode === "immediate")
    },
    [notes, persistContentUpdate, pushImmediateHistory, stageCoalescedHistory]
  )

  const syncSnapshotRelations = useCallback(
    async (noteId: string, currentNote: LogbookNote, snapshot: NoteSnapshot) => {
      const currentLinks = currentNote.links || []
      const desiredLinks = snapshot.links || []
      const currentMentions = currentNote.mentions || []
      const desiredMentions = snapshot.mentions || []

      await Promise.all(
        currentLinks
          .filter((link) => !desiredLinks.some((item) => sameLinkSemantic(item, link)))
          .map((link) => fetch(`/api/logbook/notes/${noteId}/links/${link.id}`, { method: "DELETE" }))
      )

      for (const link of desiredLinks.filter((item) => !currentLinks.some((link) => sameLinkSemantic(item, link)))) {
        await fetch(`/api/logbook/notes/${noteId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link_type: link.link_type,
            ref_id: link.ref_id,
            ref_code: link.ref_code,
            room_link_mode: link.room_link_mode,
            label: link.label,
          }),
        })
      }

      await Promise.all(
        currentMentions
          .filter((mention) => !desiredMentions.some((item) => sameMentionSemantic(item, mention)))
          .map((mention) => fetch(`/api/logbook/notes/${noteId}/mentions/${mention.id}`, { method: "DELETE" }))
      )

      for (const mention of desiredMentions.filter(
        (item) => !currentMentions.some((mention) => sameMentionSemantic(item, mention))
      )) {
        await fetch(`/api/logbook/notes/${noteId}/mentions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mention_type: mention.mention_type,
            staff_id: mention.staff_id,
          }),
        })
      }

      await refreshSingleNote(noteId)
    },
    [refreshSingleNote]
  )

  const applySnapshotToNote = useCallback(
    async (noteId: string, snapshot: NoteSnapshot) => {
      const currentNote = notes.find((note) => note.id === noteId)
      if (!currentNote) return

      setNotes((prev) =>
        prev.map((note) =>
          note.id === noteId
            ? {
              ...note,
              title: snapshot.title,
              body: snapshot.body,
              body_rich: snapshot.body_rich,
              note_type: snapshot.note_type,
              remind_at: snapshot.remind_at,
              links: snapshot.links.map((link) => ({ ...link })),
              mentions: snapshot.mentions.map((mention) => ({ ...mention })),
            }
            : note
        )
      )

      persistContentUpdate(
        noteId,
        {
          title: snapshot.title,
          body: snapshot.body,
          body_rich: snapshot.body_rich,
          note_type: snapshot.note_type,
          remind_at: snapshot.remind_at,
        },
        true
      )

      try {
        await syncSnapshotRelations(noteId, currentNote, snapshot)
      } catch (error) {
        console.error("Failed to sync snapshot relations", error)
      }
    },
    [notes, persistContentUpdate, syncSnapshotRelations]
  )

  const handleUndo = useCallback(
    async (noteId: string) => {
      flushPendingHistory(noteId)
      const currentNote = notes.find((note) => note.id === noteId)
      if (!currentNote) return
      const bucket = getHistoryBucket(noteId)
      const snapshot = bucket.undo.pop()
      if (!snapshot) return
      bucket.redo.push(cloneSnapshot(currentNote))
      bumpHistoryVersion()
      await applySnapshotToNote(noteId, snapshot)
    },
    [applySnapshotToNote, bumpHistoryVersion, flushPendingHistory, getHistoryBucket, notes]
  )

  const handleRedo = useCallback(
    async (noteId: string) => {
      flushPendingHistory(noteId)
      const currentNote = notes.find((note) => note.id === noteId)
      if (!currentNote) return
      const bucket = getHistoryBucket(noteId)
      const snapshot = bucket.redo.pop()
      if (!snapshot) return
      bucket.undo.push(cloneSnapshot(currentNote))
      bumpHistoryVersion()
      await applySnapshotToNote(noteId, snapshot)
    },
    [applySnapshotToNote, bumpHistoryVersion, flushPendingHistory, getHistoryBucket, notes]
  )

  const handleAddNote = async () => {
    const x = Math.round(window.innerWidth / 2 - 160)
    const y = Math.round(window.innerHeight / 2 - 110)

    try {
      const res = await fetchWithTimeout("/api/logbook/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New Note",
          body: "",
          note_type: "general",
          board_mode: "middle",
          x,
          y,
          width: 320,
          height: 220,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.success && data.data) {
        setFetchError(null)
        setNotes((prev) => [...prev, data.data])
      } else {
        toast({ title: "Error", description: data?.error || "Failed to create note", variant: "destructive" })
      }
    } catch (error) {
      console.error("Failed to add note", error)
      toast({ title: "Error", description: "Failed to create note", variant: "destructive" })
    }
  }

  // ── L1: close note (not archive — moves to Past) ──
  const handleCloseNote = async (noteId: string) => {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, closed_at: new Date().toISOString() } : n)))
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/close`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to close note")
      await fetchNotes()
    } catch (error) {
      console.error("Failed to close note", error)
      toast({ title: "Error", description: "Failed to close note", variant: "destructive" })
    }
  }

  // ── L1: range validation ──
  const handleRangeEndChange = (value: string) => {
    if (!value) { setRangeEnd(value); return }
    const start = new Date(rangeStart)
    const end = new Date(value)
    if (daysBetween(start, end) > 7) {
      toast({ title: "Range too wide", description: "Maximum 7 days allowed.", variant: "destructive" })
      return
    }
    setRangeEnd(value)
  }

  const handleAddMention = async (
    noteId: string,
    mentionData: Pick<LogbookMention, "mention_type" | "staff_id">
  ) => {
    const currentNote = notes.find((note) => note.id === noteId)
    if (currentNote) pushImmediateHistory(noteId, currentNote)

    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/mentions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mentionData),
      })
      const data = await res.json().catch(() => null)
      if (data?.success && data.data) {
        setNotes((prev) =>
          prev.map((note) => {
            if (note.id !== noteId) return note
            const currentMentions = note.mentions || []
            if (currentMentions.some((mention) => sameMentionSemantic(mention, data.data))) return note
            return { ...note, mentions: [...currentMentions, data.data] }
          })
        )
        await refreshSingleNote(noteId)
      } else if (data?.error && data.error !== "Mention already exists on this note.") {
        toast({ title: "Error", description: data.error, variant: "destructive" })
      }
    } catch (error) {
      console.error("Failed to add mention", error)
      toast({ title: "Error", description: "Failed to add mention", variant: "destructive" })
    }
  }

  const handleDeleteMention = async (noteId: string, mentionId: string) => {
    const currentNote = notes.find((note) => note.id === noteId)
    if (currentNote) pushImmediateHistory(noteId, currentNote)

    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId ? { ...note, mentions: (note.mentions || []).filter((mention) => mention.id !== mentionId) } : note
      )
    )

    try {
      await fetch(`/api/logbook/notes/${noteId}/mentions/${mentionId}`, { method: "DELETE" })
      await refreshSingleNote(noteId)
    } catch (error) {
      console.error("Failed to delete mention", error)
    }
  }

  const handleAddLink = async (
    noteId: string,
    linkData: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">
  ) => {
    const currentNote = notes.find((note) => note.id === noteId)
    if (currentNote) {
      pushImmediateHistory(noteId, currentNote)
      if ((currentNote.links || []).some((link) => sameLinkSemantic(link, linkData))) return
    }

    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkData),
      })
      const data = await res.json().catch(() => null)
      if (data?.success && data.data) {
        setNotes((prev) =>
          prev.map((note) => {
            if (note.id !== noteId) return note
            const currentLinks = note.links || []
            if (currentLinks.some((link) => link.id === data.data.id || sameLinkSemantic(link, data.data))) return note
            return { ...note, links: [...currentLinks, data.data] }
          })
        )
        await refreshSingleNote(noteId)
      } else {
        toast({ title: "Error", description: data?.error || "Failed to add link", variant: "destructive" })
      }
    } catch (error) {
      console.error("Failed to add link", error)
      toast({ title: "Error", description: "Failed to add link", variant: "destructive" })
    }
  }

  const handleDeleteLink = async (noteId: string, linkId: string) => {
    const currentNote = notes.find((note) => note.id === noteId)
    if (currentNote) pushImmediateHistory(noteId, currentNote)

    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId ? { ...note, links: (note.links || []).filter((link) => link.id !== linkId) } : note
      )
    )

    try {
      await fetch(`/api/logbook/notes/${noteId}/links/${linkId}`, { method: "DELETE" })
      await refreshSingleNote(noteId)
    } catch (error) {
      console.error("Failed to delete link", error)
    }
  }

  const handleArchiveNote = async (noteId: string) => {
    const currentNote = notes.find((note) => note.id === noteId)
    if (!currentNote) return

    if (archiveUndoTimer.current) clearTimeout(archiveUndoTimer.current)
    setNotes((prev) => prev.filter((note) => note.id !== noteId))
    if (fullViewNoteId === noteId) setFullViewNoteId(null)

    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/archive`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to archive note")
      }
      setArchiveUndo({ note: currentNote })
      archiveUndoTimer.current = setTimeout(() => {
        setArchiveUndo(null)
        archiveUndoTimer.current = null
      }, 5000)
      await fetchArchivedNotes()
    } catch (error) {
      console.error("Failed to archive note", error)
      setNotes((prev) => [...prev, currentNote])
      toast({ title: "Error", description: "Failed to archive note", variant: "destructive" })
    }
  }

  const handleUndoArchive = async () => {
    if (!archiveUndo) return
    const note = archiveUndo.note
    if (archiveUndoTimer.current) {
      clearTimeout(archiveUndoTimer.current)
      archiveUndoTimer.current = null
    }
    setArchiveUndo(null)

    try {
      const res = await fetch(`/api/logbook/notes/${note.id}/restore`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.error || "Failed to restore note")
      }
      setNotes((prev) => [...prev, data.data])
      setArchivedNotes((prev) => prev.filter((item) => item.id !== note.id))
    } catch (error) {
      console.error("Failed to undo archive", error)
      toast({ title: "Error", description: "Failed to restore note", variant: "destructive" })
    }
  }

  const handleRestoreArchived = async (noteId: string) => {
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/restore`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.error || "Failed to restore note")
      }
      setArchivedNotes((prev) => prev.filter((note) => note.id !== noteId))
      setNotes((prev) => [...prev, data.data])
    } catch (error) {
      console.error("Failed to restore archived note", error)
      toast({ title: "Error", description: "Failed to restore note", variant: "destructive" })
    }
  }

  const handleDeleteArchived = async (noteId: string) => {
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}`, { method: "DELETE" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Failed to delete archived note")
      }
      setArchivedNotes((prev) => prev.filter((note) => note.id !== noteId))
    } catch (error) {
      console.error("Failed to delete archived note", error)
      toast({ title: "Error", description: "Failed to delete archived note", variant: "destructive" })
    }
  }

  const handleBringToFront = async (id: string) => {
    const maxZ = notes.length > 0 ? Math.max(...notes.map((note) => note.z_index)) + 1 : 1
    setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, z_index: maxZ } : note)))

    try {
      await fetch(`/api/logbook/notes/${id}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bring_to_front: true }),
      })
    } catch (error) {
      console.error("Failed to bring to front", error)
    }
  }

  const handleRearrangeNotes = async () => {
    if (notes.length === 0) return

    const gap = 20
    const startX = 28
    const startY = 28
    const maxBoardHeight =
      typeof window !== "undefined" ? Math.max(700, window.innerHeight - 160) : 900

    const orderedNotes = [...notes].sort((left, right) => {
      const yDiff = left.y - right.y
      if (yDiff !== 0) return yDiff
      const xDiff = left.x - right.x
      if (xDiff !== 0) return xDiff
      return String(left.created_at).localeCompare(String(right.created_at))
    })

    let cursorX = startX
    let cursorY = startY
    let columnWidth = 0

    const arranged = orderedNotes.map((note) => {
      const width = note.board_mode === "minimized" ? getMinimizedNoteWidth(note) : note.width
      const height = note.board_mode === "minimized" ? 60 : note.height

      if (cursorY > startY && cursorY + height > maxBoardHeight) {
        cursorY = startY
        cursorX += columnWidth + gap
        columnWidth = 0
      }

      const next = { ...note, x: cursorX, y: cursorY }
      cursorY += height + gap
      columnWidth = Math.max(columnWidth, width)
      return next
    })

    const arrangedById = new Map(arranged.map((note) => [note.id, note]))
    setNotes((prev) => prev.map((note) => arrangedById.get(note.id) ?? note))

    const results = await Promise.allSettled(
      arranged.map((note) =>
        fetch(`/api/logbook/notes/${note.id}/position`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: note.x, y: note.y }),
        })
      )
    )

    const failed = results.filter((result) => result.status === "rejected").length
    if (failed > 0) {
      toast({
        title: "Partial Rearrange",
        description: `${failed} note position update${failed > 1 ? "s" : ""} failed.`,
        variant: "destructive",
      })
      return
    }

    toast({
      title: "Board Rearranged",
      description: "Active notes were snapped back into a clean layout.",
    })
  }

  return (
    <div className="logbook-shell flex h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden bg-[var(--logbook-canvas)]">
      <div className="z-50 flex w-full min-w-0 flex-none border-b border-[var(--logbook-header-border)] bg-[var(--logbook-header-bg)] px-6 py-4 shadow-[var(--logbook-card-shadow)]">
        <div className="flex w-full min-w-0 items-center gap-5 overflow-x-auto">
          {/* Title + Nav Capsule */}
          <div className="flex shrink-0 items-center gap-5">
            <h1 className="whitespace-nowrap text-2xl font-bold text-[var(--logbook-brand-heading)] tracking-[0]">Logbook</h1>
            <div className="flex items-center rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1">
              <span className="rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-card)] px-3 py-1 text-sm font-semibold text-[var(--logbook-brand-heading)] shadow-sm">Board</span>
              <Link href="/pms/logbook/calendar" className="rounded-[var(--logbook-pill-radius)] px-3 py-1 text-sm font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]">Calendar</Link>
            </div>
          </div>

          {/* Filters */}
          <div className="flex min-w-max flex-1 items-center gap-2">
            <LogbookFilterBar filterTypes={filterTypes} toggleFilterType={toggleFilterType} />

            {/* Active / Past toggle */}
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className={`h-8 shrink-0 rounded-[var(--logbook-pill-radius)] px-3 text-xs font-semibold transition ${
                showPast
                  ? "bg-[var(--logbook-gold)] text-black"
                  : "bg-[var(--logbook-canvas-alt)] text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]"
              }`}
            >
              {showPast ? "Past" : "Active"}
            </button>

            {/* Date mode selector */}
            <div className="flex h-8 shrink-0 items-center gap-1 rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1">
              <button type="button" onClick={() => setDateMode("today")} className={`h-6 rounded-[var(--logbook-pill-radius)] px-3 text-xs font-semibold ${dateMode === "today" ? "bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm" : "text-[var(--logbook-text-secondary)]"}`}>Today</button>
              <button type="button" onClick={() => setDateMode("date")} className={`h-6 rounded-[var(--logbook-pill-radius)] px-3 text-xs font-semibold ${dateMode === "date" ? "bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm" : "text-[var(--logbook-text-secondary)]"}`}>Date</button>
              <button type="button" onClick={() => setDateMode("range")} className={`h-6 rounded-[var(--logbook-pill-radius)] px-3 text-xs font-semibold ${dateMode === "range" ? "bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm" : "text-[var(--logbook-text-secondary)]"}`}>Range</button>
            </div>

            {/* Date inputs */}
            {dateMode === "date" && (
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="h-8 shrink-0 rounded-[var(--logbook-pill-radius)] border border-[var(--logbook-field-border)] bg-[var(--logbook-card)] px-3 text-xs font-semibold text-[var(--logbook-text-primary)]" />
            )}
            {dateMode === "range" && (
              <div className="flex shrink-0 items-center gap-1">
                <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="h-8 rounded-[var(--logbook-pill-radius)] border border-[var(--logbook-field-border)] bg-[var(--logbook-card)] px-3 text-xs font-semibold text-[var(--logbook-text-primary)]" />
                <span className="text-xs text-[var(--logbook-text-secondary)]">→</span>
                <input type="date" value={rangeEnd} onChange={(e) => handleRangeEndChange(e.target.value)} className="h-8 rounded-[var(--logbook-pill-radius)] border border-[var(--logbook-field-border)] bg-[var(--logbook-card)] px-3 text-xs font-semibold text-[var(--logbook-text-primary)]" />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" className="h-9 rounded-[var(--logbook-pill-radius)] border-[var(--logbook-field-border)] bg-[var(--logbook-canvas-alt)] px-4 text-xs font-semibold text-[var(--logbook-text-primary)] hover:bg-[var(--logbook-card)] sm:h-9 sm:text-sm" onClick={() => setArchiveDrawerOpen(true)}>
              Archive
            </Button>
            <Button variant="outline" className="h-9 rounded-[var(--logbook-pill-radius)] border-[var(--logbook-cta-fill)] px-4 text-xs font-semibold text-[var(--logbook-cta-outline-text)] hover:bg-[var(--logbook-canvas-alt)] sm:h-9 sm:text-sm" onClick={handleRearrangeNotes}>
              Rearrange
            </Button>
            <LogbookCreateButton onClick={() => setIsCreateModalOpen(true)} />
          </div>
        </div>
      </div>

      <div className="canvas-bg relative hidden w-full min-w-0 flex-1 overflow-auto bg-[var(--logbook-canvas)] sm:block">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-secondary)] shadow-sm">
              Loading logbook notes...
            </div>
          </div>
        ) : fetchError ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-w-md rounded-lg border border-rose-200 bg-[var(--bg-surface)] p-4 shadow-sm">
              <p className="text-sm font-semibold text-rose-700">Failed to load logbook notes</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{fetchError}</p>
              <button
                onClick={fetchNotes}
                className="mt-3 inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Retry
              </button>
            </div>
          </div>
        ) : visibleNotes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-w-md rounded-lg border bg-[var(--bg-surface)] p-5 text-center shadow-sm">
              <p className="text-sm font-semibold text-[var(--text-primary)]">No notes yet</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Start with your first post-it note. You can drag, resize, link, mention, archive, and restore.
              </p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-3 inline-flex rounded-md bg-[var(--logbook-cta-fill)] px-3 py-1.5 text-xs font-semibold text-[var(--logbook-cta-text)] hover:opacity-90"
              >
                + New Note
              </button>
            </div>
          </div>
        ) : (
          <LogbookBoardCanvas
            notes={visibleNotes}
            onUpdatePosition={handleUpdateNotePosition}
            onUpdateContent={handleUpdateNoteContent}
            onBringToFront={handleBringToFront}
            onArchive={handleArchiveNote}
            onOpenFullView={setFullViewNoteId}
            onUndo={handleUndo}
            onRedo={handleRedo}
            getHistoryState={getHistoryState}
            onAddLink={handleAddLink}
            onDeleteLink={handleDeleteLink}
            onAddMention={handleAddMention}
            onDeleteMention={handleDeleteMention}
          />
        )}
      </div>

      <div className="w-full min-w-0 flex-1 overflow-auto bg-[var(--logbook-canvas)] pb-20 sm:hidden">
        <LogbookMobileList
          notes={visibleNotes}
          onUpdateContent={handleUpdateNoteContent}
          onArchive={handleArchiveNote}
          onOpenFullView={setFullViewNoteId}
          onAddLink={handleAddLink}
          onDeleteLink={handleDeleteLink}
          onAddMention={handleAddMention}
          onDeleteMention={handleDeleteMention}
        />
      </div>

      <LogbookArchiveDrawer
        open={archiveDrawerOpen}
        notes={archivedNotes}
        onClose={() => {
          setArchiveDrawerOpen(false)
          resetHorizontalScroll()
        }}
        onRestore={handleRestoreArchived}
        onDelete={handleDeleteArchived}
      />

      <LogbookFullViewModal
        open={Boolean(fullViewNote)}
        note={fullViewNote}
        canUndo={fullViewNote ? getHistoryState(fullViewNote.id).canUndo : false}
        canRedo={fullViewNote ? getHistoryState(fullViewNote.id).canRedo : false}
        onOpenChange={(open) => {
          if (!open) setFullViewNoteId(null)
        }}
        onUpdateContent={handleUpdateNoteContent}
        onAddLink={handleAddLink}
        onDeleteLink={handleDeleteLink}
        onAddMention={handleAddMention}
        onDeleteMention={handleDeleteMention}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onArchive={handleArchiveNote}
      />

      {archiveUndo ? (
        <div className="fixed bottom-4 right-4 z-[95] w-[min(92vw,360px)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Note archived</p>
              <p className="truncate text-xs text-[var(--text-secondary)]">{archiveUndo.note.title || "Untitled note"}</p>
            </div>
            <Button size="sm" className="h-8 px-3 text-xs" onClick={handleUndoArchive}>
              Undo
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── L1: Create Modal (with start_at / end_at / preset) ── */}
      <LogbookCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => fetchNotes()}
      />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .canvas-bg {
              background-image: radial-gradient(color-mix(in srgb, var(--logbook-hairline) 70%, transparent) 1px, transparent 0);
              background-size: 24px 24px;
            }
          `,
        }}
      />
    </div>
  )
}
