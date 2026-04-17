"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { CalendarIcon, RefreshCwIcon, ListChecksIcon, PlayCircleIcon, CheckCircle2Icon, ClockIcon } from "lucide-react";
import { ExtraTaskAssignment, ExtraTaskTemplate } from "@/lib/types";
import { ExtraTaskCard } from "@/components/pms/housekeeping/extra-tasks/task-card";
import { TemplatePicker } from "@/components/pms/housekeeping/extra-tasks/template-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
    success?: boolean;
    error?: string;
} & T;

type AssignmentEditDraft = {
    id: string;
    assignment_date: string;
    task_name: string;
    assigned_maid: string;
    duration_min: number;
    priority: number;
    notes: string;
};

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
    try {
        return (await response.json()) as ApiResponse<T>;
    } catch {
        return {} as ApiResponse<T>;
    }
}

function ensureApiSuccess(
    response: Response,
    payload: ApiResponse,
    fallbackMessage: string
) {
    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || fallbackMessage);
    }
}

export default function ExtraTasksPage() {
    const POOL_MAID = "POOL";
    const [date, setDate] = useState<string>(() => {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().split("T")[0];
    });

    const [templates, setTemplates] = useState<ExtraTaskTemplate[]>([]);
    const [assignments, setAssignments] = useState<ExtraTaskAssignment[]>([]);
    const [maidLaneNames, setMaidLaneNames] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [draggingAssignmentId, setDraggingAssignmentId] = useState<string | null>(null);
    const [dropMaid, setDropMaid] = useState<string | null>(null);
    const [editingAssignment, setEditingAssignment] = useState<AssignmentEditDraft | null>(null);
    const [deletingAssignment, setDeletingAssignment] = useState<ExtraTaskAssignment | null>(null);
    const [assignmentActionBusy, setAssignmentActionBusy] = useState(false);
    const { toast } = useToast();

    const fetchData = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) setIsRefreshing(true);
            else setIsLoading(true);

            const [tempRes, assignRes] = await Promise.all([
                fetch("/api/housekeeping/extra-tasks/templates"),
                fetch(`/api/housekeeping/extra-tasks/assignments?date=${date}`)
            ]);

            const [tempData, assignData] = await Promise.all([
                readJsonSafe<{ templates?: ExtraTaskTemplate[] }>(tempRes),
                readJsonSafe<{ assignments?: ExtraTaskAssignment[] }>(assignRes),
            ]);

            ensureApiSuccess(tempRes, tempData, "Failed to load extra task templates.");
            ensureApiSuccess(assignRes, assignData, "Failed to load extra task assignments.");

            setTemplates(Array.isArray(tempData.templates) ? tempData.templates : []);
            setAssignments(Array.isArray(assignData.assignments) ? assignData.assignments : []);

            const lanesRes = await fetch("/api/staff/housekeeping-lanes", { cache: "no-store" });
            const lanesData = await readJsonSafe<{ data?: Array<{ display_name?: string }> }>(lanesRes);
            if (lanesRes.ok && lanesData.success !== false) {
                const names = (lanesData.data ?? [])
                    .map((row) => String(row.display_name ?? "").trim())
                    .filter((name) => name.length > 0);
                if (names.length > 0) setMaidLaneNames(names);
            }

        } catch (error) {
            console.error("Failed to fetch extra tasks data:", error);
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to load data.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [date, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        const handleVisibilityChange = () => { if (document.visibilityState === 'visible') fetchData(true); };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        interval = setInterval(() => { if (document.visibilityState === 'visible') fetchData(true); }, 30000);
        return () => { document.removeEventListener("visibilitychange", handleVisibilityChange); clearInterval(interval); };
    }, [fetchData]);

    const handleAssignTask = async (data: { template_id?: string; task_name: string; duration_min: number; assigned_maid: string }) => {
        try {
            const res = await fetch("/api/housekeeping/extra-tasks/assignments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignment_date: date, priority: 1, ...data })
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Request failed");
            toast({ title: "Success", description: data.assigned_maid === POOL_MAID ? "Task sent to Pool." : `Task assigned to ${data.assigned_maid}.` });
            fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
        }
    };

    const handleMoveAssignment = async (assignmentId: string, targetMaid: string) => {
        try {
            const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${assignmentId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assigned_maid: targetMaid }),
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Move failed");
            toast({ title: "Success", description: targetMaid === POOL_MAID ? "Task moved to Pool." : `Task moved to ${targetMaid}.` });
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
        }
    };

    const handleCreateTemplate = async (data: { name: string; duration_min: number; category: string }) => {
        try {
            const res = await fetch("/api/housekeeping/extra-tasks/templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Create template failed");
            toast({ title: "Success", description: `Template "${data.name}" created.` });
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const handleUpdateTemplate = async (id: string, data: { name: string; duration_min: number; category: string; is_active: boolean }) => {
        try {
            const res = await fetch(`/api/housekeeping/extra-tasks/templates/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Update template failed");
            toast({ title: "Success", description: `Template "${data.name}" updated.` });
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const handleDeleteTemplate = async (template: ExtraTaskTemplate) => {
        try {
            const res = await fetch(`/api/housekeeping/extra-tasks/templates/${template.id}`, { method: "DELETE" });
            const json = await readJsonSafe<{ deactivated?: boolean }>(res);
            ensureApiSuccess(res, json, "Delete template failed");
            toast({
                title: "Success",
                description: json.deactivated
                    ? `Template "${template.name}" is in use, so it was deactivated.`
                    : `Template "${template.name}" deleted.`,
            });
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const openEditAssignment = (assignment: ExtraTaskAssignment) => {
        setEditingAssignment({
            id: assignment.id,
            assignment_date: assignment.assignment_date,
            task_name: assignment.task_name,
            assigned_maid: assignment.assigned_maid || POOL_MAID,
            duration_min: assignment.duration_min || 30,
            priority: assignment.priority || 1,
            notes: assignment.notes ?? "",
        });
    };

    const handleUpdateAssignment = async () => {
        if (!editingAssignment) return;
        const taskName = editingAssignment.task_name.trim();
        if (!taskName || editingAssignment.duration_min <= 0 || editingAssignment.priority < 1) {
            toast({ title: "Missing info", description: "Task name, duration, and priority are required.", variant: "destructive" });
            return;
        }

        try {
            setAssignmentActionBusy(true);
            const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${editingAssignment.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    assignment_date: editingAssignment.assignment_date,
                    task_name: taskName,
                    assigned_maid: editingAssignment.assigned_maid,
                    duration_min: editingAssignment.duration_min,
                    priority: editingAssignment.priority,
                    notes: editingAssignment.notes.trim() || null,
                }),
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Update task failed");
            toast({ title: "Success", description: `Task "${taskName}" updated.` });
            setEditingAssignment(null);
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
        } finally {
            setAssignmentActionBusy(false);
        }
    };

    const handleDeleteAssignment = async () => {
        if (!deletingAssignment) return;
        try {
            setAssignmentActionBusy(true);
            const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${deletingAssignment.id}`, {
                method: "DELETE",
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Delete task failed");
            toast({ title: "Success", description: `Task "${deletingAssignment.task_name}" deleted.` });
            setDeletingAssignment(null);
            await fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
        } finally {
            setAssignmentActionBusy(false);
        }
    };

    const handleStatusChange = async (id: string, action: "start" | "pause" | "finish" | "cancel", notes?: string) => {
        try {
            let url = `/api/housekeeping/extra-tasks/assignments/${id}`;
            let method = "PUT";
            let body: any = {};
            if (action !== "cancel") { url += `/${action}`; method = "POST"; }
            else { body.status = "cancelled"; }
            if (notes) body.notes = notes;
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                ...(Object.keys(body).length > 0 && { body: JSON.stringify(body) })
            });
            const json = await readJsonSafe(res);
            ensureApiSuccess(res, json, "Request failed");
            toast({ title: "Success", description: "Task status updated." });
            fetchData(true);
        } catch (error: any) {
            toast({ title: "Failed", description: error.message, variant: "destructive" });
        }
    };

    // Summary stats
    const stats = useMemo(() => {
        const total = assignments.length;
        const inProgress = assignments.filter(a => a.status === "in_progress").length;
        const paused = assignments.filter(a => a.status === "paused").length;
        const done = assignments.filter(a => a.status === "done").length;
        const totalMinutes = assignments.reduce((sum, a) => sum + (a.duration_min || 0), 0);
        return { total, inProgress, paused, done, totalMinutes };
    }, [assignments]);

    // Group assignments by maid
    const groupedAssignments = useMemo(() => {
        const allowedLanes = new Set(maidLaneNames.map((name) => String(name ?? "").trim()).filter(Boolean));
        const groups = assignments.reduce((acc, curr) => {
            const rawMaid = String(curr.assigned_maid ?? "").trim();
            const groupKey = rawMaid === POOL_MAID || allowedLanes.has(rawMaid) ? rawMaid : POOL_MAID;
            if (!acc[groupKey]) acc[groupKey] = [];
            acc[groupKey].push(curr);
            return acc;
        }, {} as Record<string, ExtraTaskAssignment[]>);

        if (!groups[POOL_MAID]) groups[POOL_MAID] = [];

        const maidOrder = (maid: string) => {
            if (maid === POOL_MAID) return -1;
            const idx = maidLaneNames.indexOf(maid);
            return idx >= 0 ? idx : 1000;
        };

        return Object.entries(groups).sort((a, b) => {
            const rankA = maidOrder(a[0]);
            const rankB = maidOrder(b[0]);
            if (rankA !== rankB) return rankA - rankB;
            return a[0].localeCompare(b[0]);
        });
    }, [assignments, maidLaneNames]);

    const displayDateText = format(new Date(date + "T00:00:00"), "EEEE, d MMMM yyyy");

    const handleDrop = async (e: React.DragEvent, maidName: string) => {
        if (!draggingAssignmentId) return;
        e.preventDefault();
        const assignmentId = e.dataTransfer.getData("text/plain") || draggingAssignmentId;
        setDropMaid(null);
        setDraggingAssignmentId(null);
        if (!assignmentId) return;
        await handleMoveAssignment(assignmentId, maidName);
    };

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">Housekeeping</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Extra Task Board</h1>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">{displayDateText}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <CalendarIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-9 w-[160px] h-9" disabled={isLoading} />
                    </div>
                    <Button variant="outline" size="icon" onClick={() => fetchData(true)} disabled={isLoading || isRefreshing} className="h-9 w-9">
                        <RefreshCwIcon className={`h-4 w-4 ${isRefreshing ? "animate-spin text-sky-600" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Summary Tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryTile label="Total" value={stats.total} color="slate" icon={<ListChecksIcon className="w-4 h-4" />} />
                <SummaryTile label="In Progress" value={stats.inProgress + stats.paused} color="sky" icon={<PlayCircleIcon className="w-4 h-4" />} />
                <SummaryTile label="Done" value={stats.done} color="emerald" icon={<CheckCircle2Icon className="w-4 h-4" />} />
                <SummaryTile label="Est. Time" value={`${stats.totalMinutes}m`} color="amber" icon={<ClockIcon className="w-4 h-4" />} />
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--bg-muted)]" />)}
                </div>
            ) : (
                <>
                    {/* Template Picker (Collapsible) */}
                    <TemplatePicker
                        templates={templates}
                        maidNames={maidLaneNames}
                        onAssign={handleAssignTask}
                        onCreateTemplate={handleCreateTemplate}
                        onUpdateTemplate={handleUpdateTemplate}
                        onDeleteTemplate={handleDeleteTemplate}
                        disabled={isLoading || isRefreshing}
                    />

                    {/* Maid Lanes */}
                    <div className="space-y-4 mt-2">
                        {groupedAssignments.every(([, tasks]) => tasks.length === 0) ? (
                            <div className="text-center py-12 bg-[var(--bg-body)] rounded-xl border-2 border-dashed">
                                <ListChecksIcon className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-2" />
                                <p className="text-[var(--text-muted)] font-medium">No extra tasks for this date.</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1">Click the button above to create one.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {groupedAssignments.map(([maidName, tasks]) => {
                                    const isPool = maidName === POOL_MAID;
                                    const isDropTarget = dropMaid === maidName;
                                    const maidTasksDone = tasks.filter(t => t.status === "done").length;
                                    const maidTotalMin = tasks.reduce((s, t) => s + (t.duration_min || 0), 0);

                                    return (
                                        <div
                                            key={maidName}
                                            className={`rounded-xl border transition-all ${
                                                isPool ? "bg-[var(--bg-body)]/80 border-[var(--border-default)]" : "bg-[var(--bg-surface)] border-[var(--border-default)]"
                                            } ${isDropTarget ? "ring-2 ring-sky-400 bg-sky-50/40" : ""} ${
                                                isPool && groupedAssignments.length > 1 ? "md:col-span-2 xl:col-span-3" : ""
                                            }`}
                                            onDragOver={(e) => { if (!draggingAssignmentId) return; e.preventDefault(); setDropMaid(maidName); }}
                                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropMaid((prev) => (prev === maidName ? null : prev)); }}
                                            onDrop={(e) => handleDrop(e, maidName)}
                                        >
                                            {/* Lane Header */}
                                            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
                                                <div className="flex items-center gap-2.5">
                                                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                                        isPool ? "bg-[var(--bg-muted)] text-[var(--text-secondary)]" : "bg-sky-100 text-sky-700"
                                                    }`}>
                                                        {isPool ? "P" : maidName.charAt(0)}
                                                    </span>
                                                    <div>
                                                        <p className="font-semibold text-sm text-[var(--text-primary)]">{isPool ? "POOL" : maidName}</p>
                                                        {!isPool && (
                                                            <p className="text-[10px] text-[var(--text-muted)]">
                                                                {maidTasksDone}/{tasks.length} done &middot; {maidTotalMin}m est.
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Badge variant="secondary" className="text-[10px] font-bold bg-[var(--bg-surface-hover)] text-[var(--text-muted)]">
                                                    {tasks.length}
                                                </Badge>
                                            </div>

                                            {/* Lane Body */}
                                            <div className={`p-3 ${isPool ? "flex flex-wrap gap-3" : "space-y-3"}`}>
                                                {tasks.length === 0 ? (
                                                    <div className="rounded-lg border border-dashed bg-[var(--bg-body)]/50 px-4 py-6 text-xs text-[var(--text-muted)] text-center w-full">
                                                        {isPool ? "No unassigned tasks." : "Drag tasks here to assign."}
                                                    </div>
                                                ) : (
                                                    tasks.map(task => {
                                                        const draggable = task.status === "pending" && !isLoading && !isRefreshing;
                                                        return (
                                                            <div
                                                                key={task.id}
                                                                draggable={draggable}
                                                                onDragStart={(e) => {
                                                                    if (!draggable) { e.preventDefault(); return; }
                                                                    setDraggingAssignmentId(task.id);
                                                                    e.dataTransfer.setData("text/plain", task.id);
                                                                    e.dataTransfer.effectAllowed = "move";
                                                                }}
                                                                onDragEnd={() => { setDraggingAssignmentId(null); setDropMaid(null); }}
                                                                className={`${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isPool ? "w-72" : ""}`}
                                                            >
                                                                <ExtraTaskCard
                                                                    assignment={task}
                                                                    onStatusChange={handleStatusChange}
                                                                    onEdit={openEditAssignment}
                                                                    onDelete={setDeletingAssignment}
                                                                    disabled={isLoading || isRefreshing}
                                                                />
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}

            <Dialog open={!!editingAssignment} onOpenChange={(open) => !open && setEditingAssignment(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Extra Task</DialogTitle>
                        <DialogDescription>
                            Update the task details, lane, date, or note. Existing timer history is kept.
                        </DialogDescription>
                    </DialogHeader>
                    {editingAssignment && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1 sm:col-span-2">
                                    <Label className="text-xs">Task Name</Label>
                                    <Input
                                        value={editingAssignment.task_name}
                                        onChange={(e) => setEditingAssignment((prev) => prev ? { ...prev, task_name: e.target.value } : prev)}
                                        disabled={assignmentActionBusy}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Date</Label>
                                    <Input
                                        type="date"
                                        value={editingAssignment.assignment_date}
                                        onChange={(e) => setEditingAssignment((prev) => prev ? { ...prev, assignment_date: e.target.value } : prev)}
                                        disabled={assignmentActionBusy}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Assign to</Label>
                                    <Select
                                        value={editingAssignment.assigned_maid}
                                        onValueChange={(value) => setEditingAssignment((prev) => prev ? { ...prev, assigned_maid: value } : prev)}
                                        disabled={assignmentActionBusy}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select lane" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={POOL_MAID}>POOL (assign later)</SelectItem>
                                            {maidLaneNames.map((name) => (
                                                <SelectItem key={name} value={name}>{name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Duration (min)</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={editingAssignment.duration_min}
                                        onChange={(e) => setEditingAssignment((prev) => prev ? { ...prev, duration_min: Number(e.target.value) } : prev)}
                                        disabled={assignmentActionBusy}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Priority</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={editingAssignment.priority}
                                        onChange={(e) => setEditingAssignment((prev) => prev ? { ...prev, priority: Number(e.target.value) } : prev)}
                                        disabled={assignmentActionBusy}
                                    />
                                </div>
                                <div className="space-y-1 sm:col-span-2">
                                    <Label className="text-xs">Notes</Label>
                                    <Textarea
                                        value={editingAssignment.notes}
                                        onChange={(e) => setEditingAssignment((prev) => prev ? { ...prev, notes: e.target.value } : prev)}
                                        placeholder="Optional note"
                                        disabled={assignmentActionBusy}
                                        className="min-h-20"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setEditingAssignment(null)} disabled={assignmentActionBusy}>Cancel</Button>
                        <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={handleUpdateAssignment} disabled={assignmentActionBusy}>
                            {assignmentActionBusy ? "Saving..." : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!deletingAssignment} onOpenChange={(open) => !open && setDeletingAssignment(null)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Delete Extra Task</DialogTitle>
                        <DialogDescription>
                            Delete &ldquo;{deletingAssignment?.task_name}&rdquo; permanently from this board?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setDeletingAssignment(null)} disabled={assignmentActionBusy}>Cancel</Button>
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteAssignment} disabled={assignmentActionBusy}>
                            {assignmentActionBusy ? "Deleting..." : "Delete"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Summary tile component
function SummaryTile({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: React.ReactNode }) {
    const colorMap: Record<string, string> = {
        slate: "border-l-slate-400 text-[var(--text-secondary)]",
        sky: "border-l-sky-500 text-sky-700",
        emerald: "border-l-emerald-500 text-emerald-700",
        amber: "border-l-amber-400 text-amber-700",
    };
    const cls = colorMap[color] || colorMap.slate;

    return (
        <div className={`bg-[var(--bg-surface)] rounded-lg border border-l-4 ${cls} p-3 shadow-sm`}>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                {icon}
                <span className="uppercase tracking-wide">{label}</span>
            </div>
            <p className={`text-xl font-extrabold mt-1 ${cls.split(" ")[1]}`}>{value}</p>
        </div>
    );
}
