"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MaintenanceStatusBadge } from "./status-badge";
import { CheckIcon, CalendarIcon, MessageSquareIcon, PlusIcon, CheckCircle2, ClipboardCheckIcon } from "lucide-react";

interface RoomDetailModalProps {
    room: any | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onMarkDone: (taskId: string, notes?: string) => Promise<void>;
    // For notes Phase 9 requires separate fetch or passed down.
    // To keep it clean, we pass unresolved notes related to this room.
    notes: any[];
    onResolveNote: (noteId: string) => Promise<void>;
    onAddNote: (taskId: string, note: string) => Promise<void>;
}

export function MaintenanceRoomDetailModal({
    room,
    isOpen,
    onOpenChange,
    onMarkDone,
    notes,
    onResolveNote,
    onAddNote
}: RoomDetailModalProps) {
    const [loadingTask, setLoadingTask] = useState<string | null>(null);
    const [loadingNote, setLoadingNote] = useState<string | null>(null);

    // State for new note input per task
    const [newNoteText, setNewNoteText] = useState<Record<string, string>>({});
    const [showAddNote, setShowAddNote] = useState<Record<string, boolean>>({});

    if (!room) return null;

    const handleMarkDone = async (taskId: string) => {
        try {
            setLoadingTask(taskId);
            await onMarkDone(taskId, newNoteText[taskId]);
            setNewNoteText(prev => ({ ...prev, [taskId]: "" }));
            setShowAddNote(prev => ({ ...prev, [taskId]: false }));
        } finally {
            setLoadingTask(null);
        }
    };

    const handleAddNote = async (taskId: string) => {
        if (!newNoteText[taskId]?.trim()) return;
        try {
            setLoadingTask(`note-${taskId}`);
            await onAddNote(taskId, newNoteText[taskId]);
            setNewNoteText(prev => ({ ...prev, [taskId]: "" }));
            setShowAddNote(prev => ({ ...prev, [taskId]: false }));
        } finally {
            setLoadingTask(null);
        }
    };

    const handleResolveNote = async (noteId: string) => {
        try {
            setLoadingNote(noteId);
            await onResolveNote(noteId);
        } finally {
            setLoadingNote(null);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="!w-[min(92vw,760px)] !max-w-none max-h-[86vh] overflow-hidden p-0 flex flex-col">
                <DialogHeader className="border-b border-[var(--border-default)] px-5 py-4 bg-[var(--bg-surface)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <DialogTitle className="text-2xl flex items-center gap-3 tracking-tight">
                                Room {room.room_number}
                                <span className="text-sm font-normal text-muted-foreground bg-[var(--bg-surface-hover)] px-2 py-1 rounded">
                                    {room.room_type_code}
                                </span>
                            </DialogTitle>
                            <DialogDescription>Maintenance tasks and current status</DialogDescription>
                        </div>

                        {/* Find worst status logic directly here for header */}
                        {(() => {
                            let worstStatus: any = 'OK';
                            if (room.tasks?.some((t: any) => t.status === 'OVERDUE')) worstStatus = 'OVERDUE';
                            else if (room.tasks?.some((t: any) => t.status === 'WARNING')) worstStatus = 'WARNING';
                            return <MaintenanceStatusBadge status={worstStatus} className="text-lg py-1 px-3" />;
                        })()}
                    </div>
                </DialogHeader>

                <div className="px-5 py-4 space-y-4 overflow-y-auto">
                    {/* Unresolved Notes Section (if any) */}
                    {notes && notes.length > 0 && (
                        <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-4 space-y-3">
                            <h4 className="font-semibold text-amber-600 flex items-center gap-2">
                                <MessageSquareIcon className="w-4 h-4" />
                                Unresolved Notes
                            </h4>
                            <div className="space-y-2">
                                {notes.map(note => (
                                    <div key={note.id} className="bg-[var(--bg-surface)] p-3 rounded-lg border border-amber-400/20 flex justify-between gap-4 items-start shadow-sm">
                                        <div className="min-w-0">
                                            <p className="text-sm text-[var(--text-secondary)]">{note.note}</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Reported at: {format(new Date(note.created_at), "dd/MM/yyyy HH:mm")}
                                            </p>
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleResolveNote(note.id)}
                                            disabled={loadingNote !== null}
                                            className="shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200 min-h-[44px]"
                                        >
                                            {loadingNote === note.id ? "Saving..." : <><CheckCircle2 className="w-4 h-4 mr-1" /> Resolved</>}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tasks List */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-2">
                            <h4 className="font-semibold text-lg">Maintenance Tasks</h4>
                            <span className="rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                                {room.tasks?.length || 0} tasks
                            </span>
                        </div>

                        {room.tasks?.map((task: any) => (
                            <div
                                key={task.task_id}
                                className={`relative overflow-hidden border rounded-xl p-3 transition-colors ${
                                    task.status === 'OVERDUE'
                                        ? 'border-red-400/30 bg-red-500/10'
                                        : task.status === 'WARNING'
                                            ? 'border-amber-400/30 bg-amber-500/10'
                                            : 'bg-[var(--bg-body)] border-[var(--border-default)]'
                                }`}
                            >
                                <span
                                    className={`absolute inset-y-0 left-0 w-1 ${
                                        task.status === 'OVERDUE'
                                            ? 'bg-red-500'
                                            : task.status === 'WARNING'
                                                ? 'bg-amber-500'
                                                : 'bg-emerald-500/70'
                                    }`}
                                />

                                <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-3 pl-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h5 className="font-semibold text-base">{task.task_name}</h5>
                                            <MaintenanceStatusBadge status={task.status} />
                                        </div>

                                        <div className="flex flex-wrap text-sm text-muted-foreground gap-x-4 gap-y-1 mt-2">
                                            <span className="flex items-center gap-1">
                                                <CalendarIcon className="w-3.5 h-3.5" /> Last done:
                                                <strong className="text-[var(--text-secondary)]">
                                                    {task.last_done_at ? format(new Date(task.last_done_at), "dd/MM/yyyy") : 'Never'}
                                                </strong>
                                            </span>
                                            <span>
                                                Stays: <strong className={task.status !== 'OK' ? 'text-red-600' : 'text-[var(--text-secondary)]'}>{task.stays_since_last} / {task.threshold_count}</strong>
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex gap-2 w-full sm:w-auto sm:shrink-0">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowAddNote(p => ({ ...p, [task.task_id]: !p[task.task_id] }))}
                                            disabled={loadingTask !== null}
                                            className="min-h-[44px] whitespace-nowrap"
                                        >
                                            <MessageSquareIcon className="w-4 h-4 mr-1" /> Note
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto min-h-[44px] whitespace-nowrap"
                                            onClick={() => handleMarkDone(task.task_id)}
                                            disabled={loadingTask !== null}
                                        >
                                            {loadingTask === task.task_id ? "..." : <><CheckIcon className="w-4 h-4 mr-1" /> Mark done</>}
                                        </Button>
                                    </div>
                                </div>

                                {task.sync_to_housekeeper && Array.isArray(task.checklist_items) && task.checklist_items.length > 0 && (
                                    <div className="mb-3 ml-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2">
                                        <p className="text-xs font-semibold text-sky-600 flex items-center gap-1.5">
                                            <ClipboardCheckIcon className="h-3.5 w-3.5" />
                                            Housekeeper Checklist ({task.checklist_items.length})
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                            {task.checklist_items.map((item: string, idx: number) => (
                                                <span
                                                    key={`${task.task_id}-check-${idx}`}
                                                    className="rounded border border-sky-400/20 bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-sky-600"
                                                >
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Add Note / Completion Note inline form */}
                                {(showAddNote[task.task_id] || newNoteText[task.task_id]) && (
                                    <div className="ml-2 mt-3 pt-3 border-t border-[var(--border-default)]">
                                        <Textarea
                                            placeholder="Add optional details before marking as done, or save as an issue note"
                                            value={newNoteText[task.task_id] || ""}
                                            onChange={(e) => setNewNoteText(p => ({ ...p, [task.task_id]: e.target.value }))}
                                            className="text-sm min-h-[76px]"
                                            disabled={loadingTask !== null}
                                        />
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
                                            <p className="text-xs text-muted-foreground">
                                                Save issue note keeps the task pending. Mark as done attaches this text as completion detail.
                                            </p>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleAddNote(task.task_id)}
                                                disabled={loadingTask !== null || !newNoteText[task.task_id]?.trim()}
                                                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 min-h-[44px] shrink-0 whitespace-nowrap"
                                            >
                                                {loadingTask === `note-${task.task_id}` ? "Saving..." : <><PlusIcon className="w-4 h-4 mr-1" /> Save issue</>}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {room.tasks?.length === 0 && (
                            <p className="text-center text-muted-foreground py-6">No maintenance tasks for this room type</p>
                        )}
                    </div>
                </div>

                <DialogFooter className="border-t border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-3 sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                        Use notes for issues; use Mark as done only when the room work is complete.
                    </p>
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-[44px]">
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
