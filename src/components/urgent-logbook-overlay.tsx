"use client";

import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  COPY_BOARD_UPDATED_EVENT,
  type CopyBoardEntry,
  ensureCopyBoardFocusTracking,
  insertCopyBoardTextIntoFocusedField,
  loadCopyBoardEntries,
} from "@/lib/copy-board";
import type { LogbookNote } from "@/lib/types";

type UrgentOverlayNote = LogbookNote;
type OverlayCardId = string;

type AlarmSeverity = "red" | "yellow" | null;

type MutedAlarmRecord = {
  muted_at: string;
  expires_at: string;
  original_remind_at: string | null;
};

type DragState = {
  noteId: string;
  pointerOffsetX: number;
  pointerOffsetY: number;
};

const STORAGE_KEY = "urgent-logbook-muted-alarms-v1";
const BUTTON_SIZE = 40;
const BUTTON_GAP = 12;
const NOTE_CARD_WIDTH = 360;
const NOTE_CARD_HEIGHT = 200;
const COPY_BOARD_WIDTH = 260;
const COPY_BOARD_HEIGHT = 200;
const CARD_GAP = 12;
const VIEWPORT_MARGIN = 16;
const POLL_MS = 30_000;
const COPY_BOARD_CARD_ID = "__copy-board__";
const CONTROL_PANEL_BOTTOM = 64;

const NOTE_COLORS = {
  urgent: {
    card: "bg-rose-100 border-rose-400 dark:bg-[#1a1112] dark:border-rose-700/50",
    header: "bg-rose-200/90 dark:bg-rose-800/40",
    body: "bg-rose-50/90 dark:bg-rose-900/10",
  },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parseMutedAlarmMap(raw: string | null): Record<string, MutedAlarmRecord> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, MutedAlarmRecord>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function isMuteExpired(record: MutedAlarmRecord, now = Date.now()) {
  const expiresAtMs = new Date(record.expires_at).getTime();
  return Number.isNaN(expiresAtMs) || now >= expiresAtMs;
}

function pruneMutedAlarmMap(map: Record<string, MutedAlarmRecord>, now = Date.now()) {
  const next: Record<string, MutedAlarmRecord> = {};
  let changed = false;
  for (const [noteId, record] of Object.entries(map)) {
    if (isMuteExpired(record, now)) {
      changed = true;
      continue;
    }
    next[noteId] = record;
  }
  return { next, changed };
}

function loadMutedAlarmMap(): Record<string, MutedAlarmRecord> {
  if (typeof window === "undefined") return {};
  const { next, changed } = pruneMutedAlarmMap(parseMutedAlarmMap(window.localStorage.getItem(STORAGE_KEY)));
  if (changed) saveMutedAlarmMap(next);
  return next;
}

function saveMutedAlarmMap(next: Record<string, MutedAlarmRecord>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function getActiveMuteRecord(note: UrgentOverlayNote, mutedMap: Record<string, MutedAlarmRecord>, now = Date.now()) {
  const muted = mutedMap[note.id];
  if (!muted) return null;
  if (isMuteExpired(muted, now)) return null;
  if ((muted.original_remind_at ?? null) !== (note.remind_at ?? null)) return null;
  return muted;
}

function getAlarmSeverity(note: UrgentOverlayNote, mutedMap: Record<string, MutedAlarmRecord>, now = Date.now()): AlarmSeverity {
  if (!note.remind_at) return null;
  if (getActiveMuteRecord(note, mutedMap, now)) return null;
  const remindAtMs = new Date(note.remind_at).getTime();
  if (Number.isNaN(remindAtMs)) return null;
  const diffMin = (remindAtMs - now) / 60_000;
  if (diffMin <= 10) return "red";
  if (diffMin <= 30) return "yellow";
  return null;
}

function getHighestAlarmSeverity(notes: UrgentOverlayNote[], mutedMap: Record<string, MutedAlarmRecord>): AlarmSeverity {
  let severity: AlarmSeverity = null;
  for (const note of notes) {
    const current = getAlarmSeverity(note, mutedMap);
    if (current === "red") return "red";
    if (current === "yellow") severity = "yellow";
  }
  return severity;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  }).format(date);
}

function getCardDimensions(cardId: OverlayCardId) {
  if (cardId === COPY_BOARD_CARD_ID) {
    return { width: COPY_BOARD_WIDTH, height: COPY_BOARD_HEIGHT };
  }
  return { width: NOTE_CARD_WIDTH, height: NOTE_CARD_HEIGHT };
}

function getControlAnchorRect(anchorRect: DOMRect | null) {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;
  const fallbackWidth = 260;
  const fallbackHeight = 44;
  return {
    left: anchorRect?.left ?? viewportWidth - VIEWPORT_MARGIN - fallbackWidth,
    right: anchorRect?.right ?? viewportWidth - VIEWPORT_MARGIN,
    top: anchorRect?.top ?? viewportHeight - CONTROL_PANEL_BOTTOM - fallbackHeight,
    bottom: anchorRect?.bottom ?? viewportHeight - CONTROL_PANEL_BOTTOM,
    width: anchorRect?.width ?? fallbackWidth,
    height: anchorRect?.height ?? fallbackHeight,
  } as DOMRect;
}

function getDefaultPositions(cardIds: OverlayCardId[], anchorRect: DOMRect | null) {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;
  const controlRect = getControlAnchorRect(anchorRect);
  const copyX = clamp(
    controlRect.right - COPY_BOARD_WIDTH,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - COPY_BOARD_WIDTH - VIEWPORT_MARGIN)
  );
  const copyY = clamp(
    controlRect.bottom - COPY_BOARD_HEIGHT,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportHeight - COPY_BOARD_HEIGHT - VIEWPORT_MARGIN)
  );

  const positions: Record<OverlayCardId, { x: number; y: number }> = {
    [COPY_BOARD_CARD_ID]: { x: copyX, y: copyY },
  };

  const rowBottom = controlRect.bottom;
  let currentX = copyX - CARD_GAP;
  let currentRowBottom = rowBottom;

  for (const cardId of cardIds) {
    if (cardId === COPY_BOARD_CARD_ID) continue;
    const { width, height } = getCardDimensions(cardId);
    let nextX = currentX - width;
    if (nextX < VIEWPORT_MARGIN) {
      currentRowBottom -= NOTE_CARD_HEIGHT + CARD_GAP;
      nextX = copyX - width;
    }
    positions[cardId] = {
      x: nextX,
      y: clamp(
        currentRowBottom - height,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN)
      ),
    };
    currentX = nextX - CARD_GAP;
  }

  return positions;
}

function launcherClassName(severity: AlarmSeverity, hasNeighbor: boolean) {
  const base = `fixed bottom-5 ${hasNeighbor ? "right-[4.5rem]" : "right-5"} z-[10020] h-10 w-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95`;
  if (severity === "red") {
    return `${base} animate-pulse bg-rose-500 text-white hover:bg-rose-600 shadow-[0_0_24px_rgba(239,68,68,0.55)]`;
  }
  if (severity === "yellow") {
    return `${base} animate-pulse bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-[0_0_22px_rgba(245,158,11,0.5)]`;
  }
  return `${base} bg-sky-500 text-white hover:bg-sky-600`;
}

function overlayAlarmButtonClass(note: UrgentOverlayNote, mutedMap: Record<string, MutedAlarmRecord>) {
  const muted = Boolean(getActiveMuteRecord(note, mutedMap));
  if (muted) {
    return "rounded-md border border-slate-300 bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
  }
  return "rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60";
}

function archiveButtonClass() {
  return "rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50";
}

function getPulseShadowStyle(note: UrgentOverlayNote, mutedMap: Record<string, MutedAlarmRecord>): CSSProperties | null {
  const severity = getAlarmSeverity(note, mutedMap);
  if (severity === "red") {
    return {
      animationDuration: "1s",
      boxShadow: "0 0 0 5px rgba(239,68,68,0.50), 0 22px 44px rgba(239,68,68,0.54)",
    };
  }
  if (severity === "yellow") {
    return {
      animationDuration: "1.8s",
      boxShadow: "0 0 0 5px rgba(245,158,11,0.46), 0 20px 40px rgba(245,158,11,0.50)",
    };
  }
  return null;
}

function formatNoteStatus(status: LogbookNote["status"]) {
  if (status === "in_progress") return "In Progress";
  if (status === "resolved") return "Resolved";
  return "Open";
}

type UrgentLogbookNoteCardProps = {
  note: UrgentOverlayNote;
  position: { x: number; y: number };
  zIndex: number;
  mutedMap: Record<string, MutedAlarmRecord>;
  onBodyChange: (noteId: string, body: string) => void;
  onArchive: (noteId: string) => void;
  onToggleAlarm: (note: UrgentOverlayNote) => void;
  onPointerDown: (noteId: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onFocus: (noteId: string) => void;
};

function stopHeaderActionPointerEvent(event: ReactPointerEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

type CopyBoardCardProps = {
  entries: CopyBoardEntry[];
  position: { x: number; y: number };
  zIndex: number;
  onPaste: (entry: CopyBoardEntry) => void;
  onPointerDown: (cardId: OverlayCardId, event: ReactPointerEvent<HTMLDivElement>) => void;
  onFocus: (cardId: OverlayCardId) => void;
};

function CopyBoardCard({
  entries,
  position,
  zIndex,
  onPaste,
  onPointerDown,
  onFocus,
}: CopyBoardCardProps) {
  const slots = Array.from({ length: 5 }, (_, index) => entries[index] ?? null);

  return (
    <div
      className="pointer-events-auto fixed overflow-visible rounded-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: COPY_BOARD_WIDTH,
        height: COPY_BOARD_HEIGHT,
        zIndex,
      }}
      onMouseDown={() => onFocus(COPY_BOARD_CARD_ID)}
    >
      <div className="relative z-[1] overflow-hidden rounded-2xl border border-sky-300/70 bg-[var(--bg-surface)] shadow-xl dark:border-sky-700/40 dark:bg-[#0b1320]">
        <div
          className="relative z-[1] flex cursor-move items-center justify-between border-b border-sky-200/80 bg-sky-50/90 px-3 py-2 dark:border-sky-700/40 dark:bg-sky-900/30"
          onPointerDown={(event) => onPointerDown(COPY_BOARD_CARD_ID, event)}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[var(--text-primary)]">Copy Board</p>
          </div>
          <div className="rounded-md border border-sky-300 bg-sky-100 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-300">
            {entries.length}/5
          </div>
        </div>
        <div className="relative z-[1] grid h-[146px] grid-rows-5 gap-1 bg-[var(--bg-muted)]/70 px-2.5 py-2 dark:bg-slate-950/70">
          {slots.map((entry, index) => (
            <button
              key={entry?.id ?? `empty-${index}`}
              type="button"
              disabled={!entry}
              onClick={() => entry && onPaste(entry)}
              className={`flex w-full items-center gap-2 overflow-hidden rounded-xl border px-2 py-1 text-left transition ${
                entry
                  ? "border-sky-200 bg-[var(--bg-surface)] hover:border-sky-400 hover:bg-sky-50/70 dark:border-sky-800/60 dark:bg-slate-950/80 dark:hover:border-sky-500/70 dark:hover:bg-slate-900"
                  : "cursor-default border-[var(--border-default)] bg-[var(--bg-surface)]/60 opacity-60 dark:border-slate-800/80 dark:bg-slate-950/30"
              }`}
            >
              <span className={`inline-flex min-w-[42px] shrink-0 justify-center rounded-md px-2 py-1 text-[10px] font-bold ${
                index === 0
                  ? "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                  : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}>
                {index === 0 ? "Latest" : `${index + 1}`}
              </span>
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className={`block w-full truncate text-xs font-medium ${
                  entry ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                }`}>
                  {entry ? entry.text.replace(/\s+/g, " ").trim() : "Empty"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UrgentLogbookNoteCard({
  note,
  position,
  zIndex,
  mutedMap,
  onBodyChange,
  onArchive,
  onToggleAlarm,
  onPointerDown,
  onFocus,
}: UrgentLogbookNoteCardProps) {
  const colors = NOTE_COLORS.urgent;
  const muted = Boolean(getActiveMuteRecord(note, mutedMap));
  const canToggleAlarm = muted || Boolean(note.remind_at);
  const pulseShadowStyle = getPulseShadowStyle(note, mutedMap);

  return (
    <div
      className="pointer-events-auto fixed overflow-visible rounded-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: NOTE_CARD_WIDTH,
        minHeight: NOTE_CARD_HEIGHT,
        zIndex,
      }}
      onMouseDown={() => onFocus(note.id)}
    >
      {pulseShadowStyle ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-2xl animate-pulse"
          style={pulseShadowStyle}
        />
      ) : null}
      <div className={`relative z-[1] overflow-hidden rounded-2xl border ${colors.card} shadow-xl`}>
        <div
          className={`relative z-[1] flex cursor-move items-center justify-between border-b border-rose-300/70 px-3 py-2 ${colors.header}`}
          onPointerDown={(event) => onPointerDown(note.id, event)}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[var(--text-primary)]">{note.title || "Urgent Note"}</p>
            <p className="text-[10px] font-medium text-[var(--text-secondary)]">
              Urgent
              {note.remind_at ? ` · Alarm ${formatDateTime(note.remind_at)}` : " · No alarm"}
              {muted ? " · Muted" : ""}
            </p>
          </div>
          <div className="ml-3 flex items-center gap-1.5">
            <button
              type="button"
              className={overlayAlarmButtonClass(note, mutedMap)}
              disabled={!canToggleAlarm}
              onPointerDown={stopHeaderActionPointerEvent}
              onClick={() => onToggleAlarm(note)}
            >
              {muted ? "Alarm Off" : note.remind_at ? "Alarm On" : "No Alarm"}
            </button>
            <button
              type="button"
              className={archiveButtonClass()}
              onPointerDown={stopHeaderActionPointerEvent}
              onClick={() => onArchive(note.id)}
            >
              Delete
            </button>
          </div>
        </div>
        <div className={`relative z-[1] px-3 py-3 ${colors.body}`}>
          <textarea
            value={note.body ?? ""}
            onChange={(event) => onBodyChange(note.id, event.target.value)}
            className="min-h-[110px] w-full resize-none rounded-xl border border-rose-200/80 bg-white/90 px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-400 dark:border-rose-900/60 dark:bg-slate-950/60"
            placeholder="Urgent note..."
            spellCheck={false}
          />
          <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
            <span>{formatNoteStatus(note.status)}</span>
            <span>Updated {formatDateTime(note.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UrgentLogbookOverlay({ hasNeighbor = false }: { hasNeighbor?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<UrgentOverlayNote[]>([]);
  const [copyBoardEntries, setCopyBoardEntries] = useState<CopyBoardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutedMap, setMutedMap] = useState<Record<string, MutedAlarmRecord>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [zIndexes, setZIndexes] = useState<Record<string, number>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setMutedMap(loadMutedAlarmMap());
    setCopyBoardEntries(loadCopyBoardEntries());
    ensureCopyBoardFocusTracking();
  }, []);

  const visibleUrgentNotes = useMemo(
    () => notes.filter((note) => note.note_type === "urgent" && !note.archived_at),
    [notes]
  );
  const visibleCardIds = useMemo<OverlayCardId[]>(
    () => [COPY_BOARD_CARD_ID, ...visibleUrgentNotes.map((note) => note.id)],
    [visibleUrgentNotes]
  );

  const highestSeverity = useMemo(
    () => getHighestAlarmSeverity(visibleUrgentNotes, mutedMap),
    [visibleUrgentNotes, mutedMap]
  );

  const persistMutedMap = useCallback((updater: Record<string, MutedAlarmRecord> | ((prev: Record<string, MutedAlarmRecord>) => Record<string, MutedAlarmRecord>)) => {
    setMutedMap((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveMutedAlarmMap(next);
      return next;
    });
  }, []);

  const refreshCopyBoardEntries = useCallback(() => {
    setCopyBoardEntries(loadCopyBoardEntries());
  }, []);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/logbook/notes?type=urgent&archived=false&limit=100", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return;
      const incoming = Array.isArray(data.data) ? (data.data as UrgentOverlayNote[]) : [];
      setNotes(incoming.filter((note) => note.note_type === "urgent" && !note.archived_at));
    } finally {
      setLoading(false);
    }
  }, []);

  const reconcileMutedAlarms = useCallback(async (currentNotes: UrgentOverlayNote[], currentMutedMap: Record<string, MutedAlarmRecord>) => {
    const nextMutedMap = { ...currentMutedMap };
    let changed = false;

    for (const note of currentNotes) {
      const muted = currentMutedMap[note.id];
      if (!muted) continue;

      if ((muted.original_remind_at ?? null) !== (note.remind_at ?? null)) {
        delete nextMutedMap[note.id];
        changed = true;
        continue;
      }

      const expiresAtMs = new Date(muted.expires_at).getTime();
      if (Number.isNaN(expiresAtMs) || Date.now() < expiresAtMs) continue;

      if (note.remind_at && note.remind_at === muted.original_remind_at) {
        try {
          await fetch(`/api/logbook/notes/${note.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ remind_at: null }),
          });
        } catch {
          continue;
        }
      }

      delete nextMutedMap[note.id];
      changed = true;
    }

    if (changed) {
      saveMutedAlarmMap(nextMutedMap);
      setMutedMap(nextMutedMap);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void fetchNotes();
    const interval = window.setInterval(() => {
      void fetchNotes();
    }, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchNotes, mounted]);

  useEffect(() => {
    if (!mounted) return;
    void fetchNotes();
    refreshCopyBoardEntries();
  }, [fetchNotes, mounted, pathname, refreshCopyBoardEntries]);

  useEffect(() => {
    if (!mounted) return;

    const handleFocus = () => {
      void fetchNotes();
      refreshCopyBoardEntries();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchNotes();
        refreshCopyBoardEntries();
      }
    };

    const handleCopyBoardUpdated = () => {
      refreshCopyBoardEntries();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(COPY_BOARD_UPDATED_EVENT, handleCopyBoardUpdated as EventListener);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(COPY_BOARD_UPDATED_EVENT, handleCopyBoardUpdated as EventListener);
    };
  }, [fetchNotes, mounted, refreshCopyBoardEntries]);

  useEffect(() => {
    if (!mounted) return;
    void reconcileMutedAlarms(visibleUrgentNotes, mutedMap);
  }, [visibleUrgentNotes, mutedMap, mounted, reconcileMutedAlarms]);

  useEffect(() => {
    if (!open) return;
    const missingIds = visibleCardIds.filter((cardId) => !positions[cardId]);
    if (missingIds.length === 0) return;
    const anchorRect = panelRef.current?.getBoundingClientRect() ?? buttonRef.current?.getBoundingClientRect() ?? null;
    const defaultPositions = getDefaultPositions(visibleCardIds, anchorRect);
    setPositions((prev) => {
      const next = { ...prev };
      visibleCardIds.forEach((cardId) => {
        if (!next[cardId]) {
          next[cardId] = defaultPositions[cardId] ?? { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN };
        }
      });
      return next;
    });
    setZIndexes((prev) => {
      const next = { ...prev };
      visibleCardIds.forEach((cardId, index) => {
        if (!next[cardId]) next[cardId] = 10030 + index;
      });
      return next;
    });
  }, [open, positions, visibleCardIds]);

  const openOverlay = useCallback(() => {
    void fetchNotes();
    refreshCopyBoardEntries();
    setPositions({});
    setZIndexes({});
    setOpen(true);
  }, [fetchNotes, refreshCopyBoardEntries]);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setPositions({});
    setZIndexes({});
    setDragState(null);
  }, []);

  const toggleOverlay = useCallback(() => {
    if (open) {
      closeOverlay();
    } else {
      openOverlay();
    }
  }, [closeOverlay, open, openOverlay]);

  const openLogbookPage = useCallback(() => {
    router.push("/pms/logbook");
  }, [router]);

  const queueBodySave = useCallback((noteId: string, body: string) => {
    const existing = saveTimersRef.current.get(noteId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/logbook/notes/${noteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to save urgent note.");
        }
      } catch (error) {
        toast({
          title: "Save failed",
          description: error instanceof Error ? error.message : "Failed to save urgent note.",
          variant: "destructive",
        });
        void fetchNotes();
      } finally {
        saveTimersRef.current.delete(noteId);
      }
    }, 450);
    saveTimersRef.current.set(noteId, timer);
  }, [fetchNotes, toast]);

  useEffect(() => {
    return () => {
      for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
      saveTimersRef.current.clear();
    };
  }, []);

  const handleBodyChange = useCallback((noteId: string, body: string) => {
    setNotes((prev) => prev.map((note) => (note.id === noteId ? { ...note, body, updated_at: new Date().toISOString() } : note)));
    queueBodySave(noteId, body);
  }, [queueBodySave]);

  const handleArchive = useCallback(async (noteId: string) => {
    const previousNotes = notes;
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
    persistMutedMap((prev) => {
      const next = { ...prev };
      delete next[noteId];
      return next;
    });

    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/archive`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to archive urgent note.");
      }
    } catch (error) {
      setNotes(previousNotes);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to archive urgent note.",
        variant: "destructive",
      });
      void fetchNotes();
    }
  }, [fetchNotes, notes, persistMutedMap, toast]);

  const handleToggleAlarm = useCallback((note: UrgentOverlayNote) => {
    persistMutedMap((prev) => {
      const next = { ...prev };
      if (next[note.id]) {
        delete next[note.id];
        return next;
      }
      const mutedAt = new Date();
      next[note.id] = {
        muted_at: mutedAt.toISOString(),
        expires_at: new Date(mutedAt.getTime() + 60 * 60 * 1000).toISOString(),
        original_remind_at: note.remind_at ?? null,
      };
      return next;
    });
  }, [persistMutedMap]);

  const bringToFront = useCallback((noteId: OverlayCardId) => {
    setZIndexes((prev) => {
      const highest = Object.values(prev).reduce((max, value) => Math.max(max, value), 10030);
      return {
        ...prev,
        [noteId]: highest + 1,
      };
    });
  }, []);

  const handlePointerDown = useCallback((noteId: OverlayCardId, event: React.PointerEvent<HTMLDivElement>) => {
    const position = positions[noteId];
    if (!position) return;
    bringToFront(noteId);
    setDragState({
      noteId,
      pointerOffsetX: event.clientX - position.x,
      pointerOffsetY: event.clientY - position.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [bringToFront, positions]);

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (event: PointerEvent) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const { width, height } = getCardDimensions(dragState.noteId);
      const nextX = clamp(event.clientX - dragState.pointerOffsetX, 0, Math.max(0, viewportWidth - width));
      const nextY = clamp(event.clientY - dragState.pointerOffsetY, 0, Math.max(0, viewportHeight - height));
      setPositions((prev) => ({
        ...prev,
        [dragState.noteId]: { x: nextX, y: nextY },
      }));
    };

    const handleUp = () => setDragState(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragState]);

  const handlePasteEntry = useCallback((entry: CopyBoardEntry) => {
    const pasted = insertCopyBoardTextIntoFocusedField(entry.text);
    if (!pasted) {
      toast({
        title: "Select a field first",
        description: "Focus an input, textarea, or editable field before pasting.",
      });
      return;
    }
    toast({
      title: "Pasted",
      description: "Copy Board text inserted into the focused field.",
    });
  }, [toast]);

  if (!mounted) return null;

  return (
    <>
      {createPortal(
        <button
          ref={buttonRef}
          id="urgent-logbook-btn"
          type="button"
          onClick={toggleOverlay}
          title="Urgent Logbook"
          className={launcherClassName(highestSeverity, hasNeighbor)}
          aria-label="Urgent Logbook"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M5 3.5A1.5 1.5 0 003.5 5v10A1.5 1.5 0 005 16.5h10a1.5 1.5 0 001.5-1.5V7.414a1.5 1.5 0 00-.44-1.06l-2.414-2.414A1.5 1.5 0 0012.586 3.5H5zm2.25 4.25a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5zm0 3a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z" />
          </svg>
        </button>,
        document.body
      )}

      {open && createPortal(
        <div id="urgent-logbook-overlay" className="pointer-events-none fixed inset-0 z-[10019]">
          <div ref={panelRef} className="pointer-events-auto fixed bottom-16 right-4 z-[10021] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]/95 px-3 py-2 shadow-xl backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${highestSeverity === "red" ? "bg-rose-500" : highestSeverity === "yellow" ? "bg-amber-400" : "bg-sky-500"}`} />
              <span>Urgent Logbook</span>
              <span className="text-[var(--text-secondary)]">({visibleUrgentNotes.length})</span>
              {loading && <span className="text-[var(--text-muted)]">Refreshing…</span>}
              <button
                type="button"
                className="ml-2 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-950/50"
                onClick={openLogbookPage}
              >
                Open
              </button>
            </div>
          </div>

          <CopyBoardCard
            entries={copyBoardEntries}
            position={positions[COPY_BOARD_CARD_ID] ?? { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN }}
            zIndex={zIndexes[COPY_BOARD_CARD_ID] ?? 10030}
            onPaste={handlePasteEntry}
            onPointerDown={handlePointerDown}
            onFocus={bringToFront}
          />

          {visibleUrgentNotes.map((note) => (
            <UrgentLogbookNoteCard
              key={note.id}
              note={note}
              position={positions[note.id] ?? { x: VIEWPORT_MARGIN, y: VIEWPORT_MARGIN }}
              zIndex={zIndexes[note.id] ?? 10030}
              mutedMap={mutedMap}
              onBodyChange={handleBodyChange}
              onArchive={handleArchive}
              onToggleAlarm={handleToggleAlarm}
              onPointerDown={handlePointerDown}
              onFocus={bringToFront}
            />
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
