"use client";

import React, { useState, useEffect } from "react";
import { LogbookDatePresetPicker } from "./LogbookDatePresetPicker";
import { LogbookRichToolbar } from "./LogbookRichToolbar";
import { LogbookLinkPicker } from "./LogbookLinkPicker";
import { getRichBodyTextareaStyle, plainTextToHtml } from "./logbook-rich";
import { LogbookRichBody, LogbookNoteLink, LogbookMention } from "@/lib/types";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialStartAt?: Date;
};

const NOTE_TYPES = ["general", "task", "urgent", "stock", "vip"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type NoteType = typeof NOTE_TYPES[number];
type Priority = typeof PRIORITIES[number];

export function LogbookCreateModal({ isOpen, onClose, onSuccess, initialStartAt }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [richBody, setRichBody] = useState<LogbookRichBody>({
    html: "",
    styles: { bold: false, size: "m", color: "#000000" },
  });
  const [noteType, setNoteType] = useState<NoteType>("general");
  const [priority, setPriority] = useState<Priority>("normal");
  const [remindAt, setRemindAt] = useState<string | null>(null);
  
  const [startAt, setStartAt] = useState<Date>(new Date());
  const [endAt, setEndAt] = useState<Date | null>(null);
  const [preset, setPreset] = useState<string>("24h");
  
  const [links, setLinks] = useState<Omit<LogbookNoteLink, "id" | "note_id" | "created_at">[]>([]);
  const [mentions, setMentions] = useState<Pick<LogbookMention, "mention_type" | "staff_id">[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStartAt(initialStartAt || new Date());
      setTitle("");
      setBody("");
      setRichBody({ html: "", styles: { bold: false, size: "m", color: "#000000" } });
      setNoteType("general");
      setPriority("normal");
      setRemindAt(null);
      setEndAt(null);
      setPreset("24h");
      setLinks([]);
      setMentions([]);
      setIsSubmitting(false);
    }
  }, [isOpen, initialStartAt]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert("Title is required");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        body_rich: richBody,
        note_type: noteType,
        priority: priority,
        remind_at: remindAt,
        start_at: startAt.toISOString(),
        end_at: endAt?.toISOString() || null,
        preset: preset,
        links: links,
        mentions: mentions,
      };

      const res = await fetch("/api/logbook/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to create note");
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error(error);
      alert("Failed to create note. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBody(val);
    setRichBody(prev => ({ ...prev, html: plainTextToHtml(val) }));
  };

  return (
    <div className="fixed inset-0 z-[10000] isolate flex items-center justify-center bg-[var(--logbook-overlay-bg)] p-4 backdrop-blur-sm">
      <div className="relative z-[10001] flex w-full max-w-2xl flex-col overflow-visible rounded-2xl border-[var(--logbook-card-border)] bg-[var(--logbook-card)] shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
          <h2 className="text-lg font-bold text-[var(--logbook-brand-heading)]">New Note</h2>
          <button 
            type="button" 
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--logbook-text-secondary)] hover:bg-[var(--logbook-canvas-alt)] hover:text-[var(--logbook-text-primary)]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-x-visible overflow-y-auto p-5">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--logbook-text-secondary)]">Title*</label>
            <input 
              autoFocus
              type="text" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--logbook-field-border)] bg-transparent px-3 py-2 text-sm text-[var(--logbook-text-primary)] outline-none focus:border-[var(--logbook-brand-heading)] focus:ring-1 focus:ring-[var(--logbook-brand-heading)]"
              placeholder="e.g. VIP Guest Arrival"
            />
          </div>

          {/* Body */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--logbook-text-secondary)]">Body</label>
            <div className="rounded-lg border border-[var(--logbook-field-border)] overflow-hidden">
              <LogbookRichToolbar 
                richBody={richBody}
                remindAt={remindAt}
                canUndo={false}
                canRedo={false}
                onChangeRichBody={setRichBody}
                onChangeRemindAt={setRemindAt}
                onUndo={() => {}}
                onRedo={() => {}}
                variant="full"
              />
              <textarea 
                value={body}
                onChange={handleBodyChange}
                style={getRichBodyTextareaStyle(richBody)}
                className="w-full min-h-[120px] resize-none border-none bg-transparent px-3 py-2 text-sm text-[var(--logbook-text-primary)] outline-none"
                placeholder="Type your notes here..."
              />
            </div>
          </div>

          {/* Type & Priority row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--logbook-text-secondary)]">Type</label>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNoteType(t)}
                    className="rounded-[var(--logbook-pill-radius)] border px-3 py-1 text-xs font-semibold capitalize transition active:scale-95"
                    style={{
                      backgroundColor: noteType === t ? `var(--logbook-bar-${t})` : "transparent",
                      borderColor: `var(--logbook-bar-${t})`,
                      color: noteType === t ? "#ffffff" : `var(--logbook-bar-${t})`,
                    }}
                  >
                    {t} {noteType === t && <span className="ml-1 text-[8px]">●</span>}
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--logbook-text-secondary)]">Priority</label>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`rounded-[var(--logbook-pill-radius)] px-3 py-1 text-xs font-semibold capitalize transition active:scale-95 ${
                      priority === p
                        ? "bg-[var(--logbook-cta-fill)] text-[var(--logbook-cta-text)] shadow-sm"
                        : "bg-transparent border border-[var(--logbook-field-border)] text-[var(--logbook-text-secondary)] hover:bg-[var(--logbook-canvas-alt)]"
                    }`}
                  >
                    {p} {priority === p && <span className="ml-1 text-[8px]">●</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Active Until */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--logbook-text-secondary)]">Active until</label>
            <LogbookDatePresetPicker 
              startAt={startAt}
              value={endAt}
              onChange={(d, p) => { setEndAt(d); if (p) setPreset(p); }}
            />
          </div>

          {/* Links / Mentions (Compact View) */}
          <div className="relative border-t border-[var(--logbook-hairline)] pt-2">
            <div className="relative flex items-center justify-between">
              <label className="block text-xs font-semibold text-[var(--logbook-text-secondary)]">Links / Mentions</label>
              <LogbookLinkPicker 
                onAddLink={(l) => setLinks(prev => [...prev, l])}
                onAddMention={(m) => setMentions(prev => [...prev, m])}
                align="right"
              />
            </div>
            
            {(links.length > 0 || mentions.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {links.map((link, idx) => (
                  <div key={`link-${idx}`} className="flex items-center rounded-full bg-[var(--logbook-canvas-alt)] px-2 py-1 text-[10px] font-medium text-[var(--logbook-text-primary)]">
                    {link.label || link.ref_code || link.link_type}
                    <button type="button" onClick={() => setLinks(prev => prev.filter((_, i) => i !== idx))} className="ml-1.5 text-[var(--text-muted)] hover:text-rose-500">×</button>
                  </div>
                ))}
                {mentions.map((mention, idx) => (
                  <div key={`mention-${idx}`} className="flex items-center rounded-full bg-[var(--logbook-canvas-alt)] px-2 py-1 text-[10px] font-medium text-[var(--logbook-text-primary)]">
                    @{mention.mention_type === "staff" ? `Staff ${mention.staff_id?.slice(0,4)}` : mention.mention_type.replace("group_", "")}
                    <button type="button" onClick={() => setMentions(prev => prev.filter((_, i) => i !== idx))} className="ml-1.5 text-[var(--text-muted)] hover:text-rose-500">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--logbook-hairline)] bg-[var(--logbook-canvas-alt)] px-5 py-4">
          <button 
            type="button" 
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-[var(--logbook-pill-radius)] bg-transparent px-5 py-2 text-sm font-semibold text-[var(--logbook-text-secondary)] transition hover:bg-black/5 active:scale-95 disabled:opacity-50 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim()}
            className="rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-cta-fill)] px-5 py-2 text-sm font-semibold text-[var(--logbook-cta-text)] shadow-sm transition hover:bg-[var(--logbook-cta-fill)]/90 active:scale-95 disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create Note"}
          </button>
        </div>

      </div>
    </div>
  );
}
