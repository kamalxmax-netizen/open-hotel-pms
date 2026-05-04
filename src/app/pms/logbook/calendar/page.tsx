"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LogbookCalendarMonth } from "../_components/LogbookCalendarMonth";
import { LogbookCalendarWeek } from "../_components/LogbookCalendarWeek";
import { LogbookFrapButton } from "../_components/LogbookFrapButton";
import { LogbookCreateModal } from "../_components/LogbookCreateModal";
import { LogbookShiftDrawer } from "../_components/LogbookShiftDrawer";
import { LogbookNoteCard } from "../_components/LogbookNoteCard";
import { LogbookFullViewModal } from "../_components/LogbookFullViewModal";
import { LogbookNote, LogbookNoteLink, LogbookMention } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "month" | "week";

export default function LogbookCalendarPage() {
  const { toast } = useToast();

  const [notes, setNotes] = useState<LogbookNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInitialDate, setCreateInitialDate] = useState<Date | undefined>(undefined);

  // ── Post-it overlay state (D9: one overlay at a time) ──
  const [overlayNote, setOverlayNote] = useState<LogbookNote | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [fullViewNoteId, setFullViewNoteId] = useState<string | null>(null);

  const [isShiftDrawerOpen, setIsShiftDrawerOpen] = useState(false);

  const fetchNotes = useCallback(async (start: Date, end: Date) => {
    setIsLoading(true);
    try {
      const url = new URL("/api/logbook/notes", window.location.origin);
      const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
      url.searchParams.set("range_start", startStr);
      url.searchParams.set("range_end", endStr);
      url.searchParams.set("range_mode", "calendar");
      url.searchParams.set("limit", "200");

      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setNotes(Array.isArray(data.data) ? data.data : []);
      } else {
        toast({ title: "Error", description: data?.error || "Failed to load notes", variant: "destructive" });
      }
    } catch (error) {
      console.error(error);
      toast({ title: "Error", description: "Failed to load notes", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const refetchCurrentRange = useCallback(() => {
    const start = new Date(currentDate);
    start.setMonth(start.getMonth() - 1);
    const end = new Date(currentDate);
    end.setMonth(end.getMonth() + 2);
    fetchNotes(start, end);
  }, [currentDate, fetchNotes]);

  useEffect(() => {
    refetchCurrentRange();
  }, [refetchCurrentRange, viewMode]);

  // ── D9: Click outside overlay closes it ──
  useEffect(() => {
    if (!overlayNote) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setOverlayNote(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [overlayNote]);

  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === "month") next.setMonth(next.getMonth() - 1);
    else next.setDate(next.getDate() - 7);
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === "month") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 7);
    setCurrentDate(next);
  };

  const handleDayClick = (date: Date) => {
    const d = new Date(date);
    d.setHours(9, 0, 0, 0);
    setCreateInitialDate(d);
    setIsCreateOpen(true);
  };

  // ── D9: clicking bar opens one Post-it overlay ──
  const handleBarClick = (note: LogbookNote) => {
    setOverlayNote(note);
  };

  const syncSingleNote = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.data) return;
      const nextNote = data.data as LogbookNote;
      setNotes(prev => prev.map(n => n.id === noteId ? nextNote : n));
      setOverlayNote(prev => prev?.id === noteId ? nextNote : prev);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleCloseNote = async (noteId: string) => {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, closed_at: new Date().toISOString() } : n));
    setOverlayNote(null);
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/close`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to close note");
      refetchCurrentRange();
    } catch (error) {
      toast({ title: "Error", description: "Failed to close note", variant: "destructive" });
    }
  };

  const handleArchiveNote = async (noteId: string) => {
    const archivedAt = new Date().toISOString();
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, archived_at: archivedAt } : n));
    setOverlayNote(null);
    try {
      const res = await fetch(`/api/logbook/notes/${noteId}/archive`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to archive note");
      refetchCurrentRange();
    } catch (error) {
      toast({ title: "Error", description: "Failed to archive note", variant: "destructive" });
      refetchCurrentRange();
    }
  };

  const handleUpdateOverlayField = async (updates: Partial<LogbookNote>) => {
    if (!overlayNote) return;
    setOverlayNote(prev => prev ? { ...prev, ...updates } : null);
    setNotes(prev => prev.map(n => n.id === overlayNote.id ? { ...n, ...updates } : n));
    try {
      await fetch(`/api/logbook/notes/${overlayNote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddLink = async (linkData: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => {
    if (!overlayNote) return;
    try {
      const res = await fetch(`/api/logbook/notes/${overlayNote.id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linkData),
      });
      if (res.ok) await syncSingleNote(overlayNote.id);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!overlayNote) return;
    try {
      const res = await fetch(`/api/logbook/notes/${overlayNote.id}/links/${linkId}`, { method: "DELETE" });
      if (res.ok) await syncSingleNote(overlayNote.id);
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddMention = async (mentionData: Pick<LogbookMention, "mention_type" | "staff_id">) => {
    if (!overlayNote) return;
    try {
      const res = await fetch(`/api/logbook/notes/${overlayNote.id}/mentions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mentionData),
      });
      if (res.ok) await syncSingleNote(overlayNote.id);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteMention = async (mentionId: string) => {
    if (!overlayNote) return;
    try {
      const res = await fetch(`/api/logbook/notes/${overlayNote.id}/mentions/${mentionId}`, { method: "DELETE" });
      if (res.ok) await syncSingleNote(overlayNote.id);
    } catch (error) {
      console.error(error);
    }
  };

  const fullViewNote = useMemo(() => notes.find(n => n.id === fullViewNoteId) || null, [notes, fullViewNoteId]);

  return (
    <div className="logbook-shell flex min-h-[100dvh] w-full flex-col bg-[var(--logbook-canvas)]">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 flex w-full min-w-0 flex-none border-b border-[var(--logbook-header-border)] bg-[var(--logbook-header-bg)] px-6 py-4 shadow-[var(--logbook-card-shadow)]">
        <div className="flex w-full min-w-0 items-center justify-between gap-5 overflow-x-auto">
          <div className="flex shrink-0 items-center gap-5">
            <h1 className="whitespace-nowrap text-2xl font-bold text-[var(--logbook-brand-heading)] tracking-[0]">Logbook</h1>
            {/* Nav capsule: Board / Calendar — no Shift Log in primary */}
            <div className="flex items-center rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1">
              <Link href="/pms/logbook" className="rounded-[var(--logbook-pill-radius)] px-3 py-1 text-sm font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]">Board</Link>
              <span className="rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-card)] px-3 py-1 text-sm font-semibold text-[var(--logbook-brand-heading)] shadow-sm">Calendar</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex h-9 items-center rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-canvas-alt)] p-1">
              <button
                onClick={() => setViewMode("month")}
                className={`h-7 rounded-[var(--logbook-pill-radius)] px-4 text-xs font-semibold ${viewMode === "month" ? "bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm" : "text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]"}`}
              >Month</button>
              <button
                onClick={() => setViewMode("week")}
                className={`h-7 rounded-[var(--logbook-pill-radius)] px-4 text-xs font-semibold ${viewMode === "week" ? "bg-[var(--logbook-card)] text-[var(--logbook-brand-heading)] shadow-sm" : "text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-brand-heading)]"}`}
              >Week</button>
            </div>

            {/* Shift Log Drawer Trigger */}
            <button
              onClick={() => setIsShiftDrawerOpen(true)}
              className="flex h-9 items-center gap-2 rounded-[var(--logbook-pill-radius)] border border-[var(--logbook-field-border)] bg-[var(--logbook-canvas-alt)] px-4 text-sm font-semibold text-[var(--logbook-text-primary)] hover:bg-[var(--logbook-card)]"
            >
              <span className="text-lg">☰</span> Shift Log
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full flex-1 px-6 py-6">
        {isLoading && notes.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-[var(--logbook-text-secondary)]">Loading calendar...</div>
        ) : (
          viewMode === "month" ? (
            <LogbookCalendarMonth
              currentDate={currentDate}
              notes={notes}
              onDayClick={handleDayClick}
              onBarClick={handleBarClick}
              onPrevMonth={handlePrev}
              onNextMonth={handleNext}
            />
          ) : (
            <LogbookCalendarWeek
              currentDate={currentDate}
              notes={notes}
              onDayClick={handleDayClick}
              onBarClick={handleBarClick}
              onPrevWeek={handlePrev}
              onNextWeek={handleNext}
            />
          )
        )}
      </div>

      {/* ── D9: Post-it Overlay (one at a time, click outside closes) ── */}
      {overlayNote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            ref={overlayRef}
            className="relative z-10 max-h-[82vh] w-[min(92vw,640px)] overflow-auto rounded-2xl p-2"
            data-no-drag
          >
            <div
              className="relative"
              style={{
                width: Math.min(640, Math.max(overlayNote.width, 520)),
                height: Math.max(overlayNote.height, 360),
              }}
            >
              <LogbookNoteCard
                note={{
                  ...overlayNote,
                  x: 0,
                  y: 0,
                  width: Math.min(640, Math.max(overlayNote.width, 520)),
                  height: Math.max(overlayNote.height, 360),
                  board_mode: "middle",
                }}
                onUpdatePosition={(updates) => {
                  setOverlayNote(prev => {
                    if (!prev) return prev;
                    const next: LogbookNote = { ...prev };
                    if (updates.width) next.width = updates.width;
                    if (updates.height) next.height = updates.height;
                    if (updates.board_mode) next.board_mode = updates.board_mode;
                    return next;
                  });
                }}
                onUpdateContent={handleUpdateOverlayField}
                onFocus={() => {}}
                onArchive={() => handleArchiveNote(overlayNote.id)}
                onOpenFullView={() => setFullViewNoteId(overlayNote.id)}
                onUndo={() => {}}
                onRedo={() => {}}
                canUndo={false}
                canRedo={false}
                onAddLink={handleAddLink}
                onDeleteLink={handleDeleteLink}
                onAddMention={handleAddMention}
                onDeleteMention={handleDeleteMention}
              />
            </div>
          </div>
        </div>
      )}

      {fullViewNote && (
        <LogbookFullViewModal
          open={true}
          note={fullViewNote}
          onOpenChange={(open) => { if (!open) setFullViewNoteId(null); }}
          onUpdateContent={(id, updates) => {
            setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
            fetch(`/api/logbook/notes/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updates),
            });
          }}
          onArchive={(id) => {
            handleCloseNote(id);
            setFullViewNoteId(null);
          }}
          onUndo={() => {}}
          onRedo={() => {}}
          canUndo={false}
          canRedo={false}
          onAddLink={async (id, linkData) => {
            const res = await fetch(`/api/logbook/notes/${id}/links`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(linkData),
            });
            if (res.ok) refetchCurrentRange();
          }}
          onDeleteLink={async (id, linkId) => {
            const res = await fetch(`/api/logbook/notes/${id}/links/${linkId}`, { method: "DELETE" });
            if (res.ok) refetchCurrentRange();
          }}
          onAddMention={async (id, mentionData) => {
            const res = await fetch(`/api/logbook/notes/${id}/mentions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mentionData),
            });
            if (res.ok) refetchCurrentRange();
          }}
          onDeleteMention={async (id, mentionId) => {
            const res = await fetch(`/api/logbook/notes/${id}/mentions/${mentionId}`, { method: "DELETE" });
            if (res.ok) refetchCurrentRange();
          }}
        />
      )}

      <LogbookFrapButton onClick={() => { setCreateInitialDate(undefined); setIsCreateOpen(true); }} />

      <LogbookCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={refetchCurrentRange}
        initialStartAt={createInitialDate}
      />

      <LogbookShiftDrawer
        isOpen={isShiftDrawerOpen}
        onClose={() => setIsShiftDrawerOpen(false)}
        initialDate={currentDate}
      />
    </div>
  );
}
