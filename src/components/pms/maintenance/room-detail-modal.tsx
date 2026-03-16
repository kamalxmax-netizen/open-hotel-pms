"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MaintenanceStatusBadge } from "./status-badge";
import { CheckIcon, CalendarIcon, MessageSquareIcon, PlusIcon, CheckCircle2 } from "lucide-react";

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
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader className="border-b pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-2xl flex items-center gap-3">
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

                <div className="py-4 space-y-6">
                    {/* Unresolved Notes Section (if any) */}
                    {notes && notes.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                            <h4 className="font-semibold text-amber-800 flex items-center gap-2">
                                <MessageSquareIcon className="w-4 h-4" />
                                Unresolved Notes
                            </h4>
                            <div className="space-y-2">
                                {notes.map(note => (
                                    <div key={note.id} className="bg-[var(--bg-surface)] p-3 rounded border border-amber-100 flex justify-between gap-4 items-start shadow-sm">
                                        <div>
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
                    <div className="space-y-4">
                        <h4 className="font-semibold text-lg border-b pb-2">Maintenance Tasks ({room.tasks?.length || 0})</h4>

                        {room.tasks?.map((task: any) => (
                            <div key={task.task_id} className={`border rounded-lg p-4 transition-colors ${task.status === 'OVERDUE' ? 'border-red-200 bg-red-50/30' : task.status === 'WARNING' ? 'border-amber-200 bg-amber-50/30' : 'bg-[var(--bg-body)]'}`}>

                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-3">
                                    <div>
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

                                    <div className="flex gap-2 w-full sm:w-auto">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setShowAddNote(p => ({ ...p, [task.task_id]: !p[task.task_id] }))}
                                            disabled={loadingTask !== null}
                                            className="min-h-[44px]"
                                        >
                                            <MessageSquareIcon className="w-4 h-4 mr-1" /> Note
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto min-h-[44px]"
                                            onClick={() => handleMarkDone(task.task_id)}
                                            disabled={loadingTask !== null}
                                        >
                                            {loadingTask === task.task_id ? "..." : <><CheckIcon className="w-4 h-4 mr-1" /> Mark as done</>}
                                        </Button>
                                    </div>
                                </div>

                                {task.sync_to_housekeeper && Array.isArray(task.checklist_items) && task.checklist_items.length > 0 && (
                                    <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
                                        <p className="text-xs font-semibold text-indigo-800">
                                            Housekeeper Checklist ({task.checklist_items.length})
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                            {task.checklist_items.map((item: string, idx: number) => (
                                                <span
                                                    key={`${task.task_id}-check-${idx}`}
                                                    className="rounded border border-indigo-200 bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-indigo-700"
                                                >
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Add Note / Completion Note inline form */}
                                {(showAddNote[task.task_id] || newNoteText[task.task_id]) && (
                                    <div className="mt-3 pt-3 border-t">
                                        <Textarea
                                            placeholder="Add optional details before marking as done, or save as an issue note"
                                            value={newNoteText[task.task_id] || ""}
                                            onChange={(e) => setNewNoteText(p => ({ ...p, [task.task_id]: e.target.value }))}
                                            className="text-sm min-h-[60px]"
                                            disabled={loadingTask !== null}
                                        />
                                        <div className="flex justify-end mt-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleAddNote(task.task_id)}
                                                disabled={loadingTask !== null || !newNoteText[task.task_id]?.trim()}
                                                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 min-h-[44px]"
                                            >
                                                {loadingTask === `note-${task.task_id}` ? "Saving..." : <><PlusIcon className="w-4 h-4 mr-1" /> Save as issue (Pending)</>}
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
            </DialogContent>
        </Dialog>
    );
}
