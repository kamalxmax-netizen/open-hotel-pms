"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageSquareIcon } from "lucide-react";

type MaintenanceNoteItem = {
  id: string;
  note: string;
  created_at: string;
  task_id?: string;
};

interface MaintenanceNotesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber?: string | null;
  notes: MaintenanceNoteItem[];
  onResolveNote: (noteId: string) => Promise<void>;
}

export function MaintenanceNotesModal({
  isOpen,
  onOpenChange,
  roomNumber,
  notes,
  onResolveNote,
}: MaintenanceNotesModalProps) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleResolve = async (noteId: string) => {
    try {
      setResolvingId(noteId);
      await onResolveNote(noteId);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pending Maintenance Notes {roomNumber ? `- Room ${roomNumber}` : ""}</DialogTitle>
          <DialogDescription>List of unresolved issues</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {notes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
              No pending notes
            </div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-lg border bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-800 flex items-start gap-2">
                      <MessageSquareIcon className="h-4 w-4 mt-0.5 text-amber-500" />
                      <span>{note.note}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {format(new Date(note.created_at), "dd/MM/yyyy HH:mm")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-emerald-700 border-emerald-200 hover:bg-emerald-50 min-h-[44px]"
                    onClick={() => handleResolve(note.id)}
                    disabled={resolvingId !== null}
                  >
                    {resolvingId === note.id ? "Saving..." : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Resolve
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
