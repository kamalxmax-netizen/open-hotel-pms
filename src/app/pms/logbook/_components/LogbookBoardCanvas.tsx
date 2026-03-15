"use client"

import { LogbookMention, LogbookNote, LogbookNoteLink } from "@/lib/types"
import { LogbookNoteCard } from "./LogbookNoteCard"

type NoteUpdateOptions = {
    historyMode?: "coalesced" | "immediate" | "none"
    saveMode?: "debounced" | "immediate"
}

interface CanvasProps {
    notes: LogbookNote[]
    onUpdatePosition: (id: string, updates: Partial<LogbookNote>) => void
    onUpdateContent: (id: string, updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => void
    onBringToFront: (id: string) => void
    onArchive: (id: string) => void
    onOpenFullView: (id: string) => void
    onUndo: (id: string) => void
    onRedo: (id: string) => void
    getHistoryState: (id: string) => { canUndo: boolean; canRedo: boolean }
    onAddLink: (noteId: string, linkData: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => void
    onDeleteLink: (noteId: string, linkId: string) => void
    onAddMention: (noteId: string, mentionData: Pick<LogbookMention, "mention_type" | "staff_id">) => void
    onDeleteMention: (noteId: string, mentionId: string) => void
}

export function LogbookBoardCanvas({
    notes,
    onUpdatePosition,
    onUpdateContent,
    onBringToFront,
    onArchive,
    onOpenFullView,
    onUndo,
    onRedo,
    getHistoryState,
    onAddLink,
    onDeleteLink,
    onAddMention,
    onDeleteMention
}: CanvasProps) {
    return (
        <div className="relative w-[3000px] h-[3000px]">
            {notes.map(note => (
                <LogbookNoteCard
                    key={note.id}
                    note={note}
                    onUpdatePosition={(updates: Partial<LogbookNote>) => onUpdatePosition(note.id, updates)}
                    onUpdateContent={(updates: Partial<LogbookNote>, options?: NoteUpdateOptions) => onUpdateContent(note.id, updates, options)}
                    onFocus={() => onBringToFront(note.id)}
                    onArchive={() => onArchive(note.id)}
                    onOpenFullView={() => onOpenFullView(note.id)}
                    onUndo={() => onUndo(note.id)}
                    onRedo={() => onRedo(note.id)}
                    canUndo={getHistoryState(note.id).canUndo}
                    canRedo={getHistoryState(note.id).canRedo}
                    onAddLink={(link: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => onAddLink(note.id, link)}
                    onDeleteLink={(linkId: string) => onDeleteLink(note.id, linkId)}
                    onAddMention={(mention: Pick<LogbookMention, "mention_type" | "staff_id">) => onAddMention(note.id, mention)}
                    onDeleteMention={(mentionId: string) => onDeleteMention(note.id, mentionId)}
                />
            ))}
        </div>
    )
}
