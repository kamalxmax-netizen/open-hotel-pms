"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MaintenanceHeatmapView } from "@/components/pms/maintenance/heatmap-view";
import { MaintenanceRoomCard } from "@/components/pms/maintenance/room-card";
import { MaintenanceRoomDetailModal } from "@/components/pms/maintenance/room-detail-modal";
import { MaintenanceNotesModal } from "@/components/pms/maintenance/notes-modal";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { RefreshCwIcon, LayoutGridIcon, Columns3Icon, AlertTriangleIcon, AlertCircleIcon, CheckCircleIcon, BellIcon } from "lucide-react";

export default function MaintenanceDashboard() {
    const [viewMode, setViewMode] = useState<"floor" | "heatmap">("heatmap");
    const [groupBy, setGroupBy] = useState<"floor" | "type">("floor");
    const [filterTask, setFilterTask] = useState<string>("all");
    const [showRenovation, setShowRenovation] = useState(false);

    const [rooms, setRooms] = useState<any[]>([]);
    const [summary, setSummary] = useState({ overdue: 0, warning: 0, ok: 0 });
    const [tasks, setTasks] = useState<{ id: string, name: string }[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { toast } = useToast();

    // Modal State
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [notesModalOpen, setNotesModalOpen] = useState(false);
    const [notes, setNotes] = useState<any[]>([]);
    const [allNotes, setAllNotes] = useState<any[]>([]);

    const fetchStatus = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) setIsRefreshing(true);
            else setIsLoading(true);

            const params = new URLSearchParams();
            if (showRenovation) params.set("include_renovation", "1");
            const endpoint = `/api/maintenance/status${params.toString() ? `?${params.toString()}` : ""}`;
            const res = await fetch(endpoint, { cache: "no-store" });
            const data = await res.json();

            if (res.ok && data.success) {
                setRooms(data.rooms);
                setSummary(data.summary);
                const taskMap = new Map();
                data.rooms.forEach((r: any) => { r.tasks.forEach((t: any) => taskMap.set(t.task_id, t.task_name)); });
                setTasks(Array.from(taskMap.entries()).map(([id, name]) => ({ id, name })));
                return;
            }
            throw new Error(data?.error || "Failed to fetch data");
        } catch (err) {
            console.error("Failed to fetch maintenance status:", err);
            toast({ title: "Error", description: "Failed to fetch status", variant: "destructive" });
        } finally { setIsLoading(false); setIsRefreshing(false); }
    }, [showRenovation, toast]);

    // Fetch all unresolved notes globally
    const fetchAllNotes = useCallback(async () => {
        try {
            const res = await fetch("/api/maintenance/notes?resolved=false", { cache: "no-store" });
            const data = await res.json();
            if (data.success) setAllNotes(data.notes || []);
        } catch { /* silent */ }
    }, []);

    useEffect(() => { fetchStatus(); fetchAllNotes(); }, [fetchStatus, fetchAllNotes]);

    useEffect(() => {
        if (filterTask === "all") return;
        if (!tasks.some((task) => task.id === filterTask)) setFilterTask("all");
    }, [filterTask, tasks]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        const handleVisibility = () => { if (document.visibilityState === 'visible') { fetchStatus(true); fetchAllNotes(); } };
        document.addEventListener("visibilitychange", handleVisibility);
        interval = setInterval(() => { if (document.visibilityState === 'visible') { fetchStatus(true); fetchAllNotes(); } }, 60000);
        return () => { document.removeEventListener("visibilitychange", handleVisibility); clearInterval(interval); };
    }, [fetchStatus, fetchAllNotes]);

    // Fetch room-specific notes when selected
    useEffect(() => {
        if (selectedRoomId) {
            fetch(`/api/maintenance/notes?room_id=${selectedRoomId}&resolved=false`, { cache: "no-store" })
                .then(res => res.json())
                .then(data => { if (data.success) setNotes(data.notes); })
                .catch(console.error);
        } else { setNotes([]); }
    }, [selectedRoomId]);

    const handleMarkDone = async (taskId: string, note?: string) => {
        try {
            if (note) {
                await fetch("/api/maintenance/notes", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ room_id: selectedRoomId, task_id: taskId, note })
                });
            }
            const res = await fetch("/api/maintenance/logs", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: selectedRoomId, task_id: taskId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            const nowIso = data?.log?.performed_at ?? new Date().toISOString();
            setRooms((prev) => prev.map((room) => {
                if (room.room_id !== selectedRoomId) return room;
                return { ...room, tasks: room.tasks.map((task: any) =>
                    task.task_id === taskId
                        ? { ...task, last_done_at: nowIso, last_done_at_stay: Number(task.total_stays ?? 0), stays_since_last: 0, status: "OK" }
                        : task
                ) };
            }));
            const completedAssignmentCount = Number(data?.completed_assignment_count ?? 0);
            toast({
                title: "Success",
                description:
                    completedAssignmentCount > 0
                        ? `Task marked as done • Auto-closed ${completedAssignmentCount} pending assignment(s)`
                        : "Task marked as done",
            });
            await fetchStatus(true);
            await fetchAllNotes();
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
            throw err;
        }
    };

    const handleAddNote = async (taskId: string, noteText: string) => {
        try {
            const res = await fetch("/api/maintenance/notes", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: selectedRoomId, task_id: taskId, note: noteText })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast({ title: "Success", description: "Note saved" });
            const notesRes = await fetch(`/api/maintenance/notes?room_id=${selectedRoomId}&resolved=false`, { cache: "no-store" });
            const notesData = await notesRes.json();
            if (notesData.success) setNotes(notesData.notes);
            await fetchAllNotes();
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
            throw err;
        }
    };

    const handleResolveNote = async (noteId: string) => {
        try {
            const res = await fetch(`/api/maintenance/notes/${noteId}/resolve`, { method: "POST" });
            if (!res.ok) throw new Error("Request failed");
            toast({ title: "Success", description: "Note resolved" });
            setNotes(notes.filter(n => n.id !== noteId));
            setAllNotes(allNotes.filter(n => n.id !== noteId));
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
            throw err;
        }
    };

    const filteredRooms = useMemo(() => {
        if (filterTask === 'all') return rooms;
        return rooms.map(room => ({
            ...room,
            tasks: room.tasks.filter((t: any) => t.task_id === filterTask)
        })).filter(room => room.tasks.length > 0);
    }, [rooms, filterTask]);

    const selectedRoomData = rooms.find(r => r.room_id === selectedRoomId);

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-red-600">Maintenance</p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Maintenance Hub</h1>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">Track room maintenance status and tasks</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Global Notes Bell */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => { setSelectedRoomId(null); setNotesModalOpen(true); }}
                        className="h-9 w-9 relative"
                    >
                        <BellIcon className="h-4 w-4" />
                        {allNotes.length > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                                {allNotes.length}
                            </span>
                        )}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => fetchStatus(true)} disabled={isLoading || isRefreshing} className="h-9 w-9">
                        <RefreshCwIcon className={`h-4 w-4 ${isRefreshing ? "animate-spin text-red-600" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Summary Tiles */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--bg-surface)] rounded-lg border border-l-4 border-l-red-500 p-3 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                        <AlertCircleIcon className="w-4 h-4 text-red-500" />
                        <span className="uppercase tracking-wide">Overdue</span>
                    </div>
                    <p className="text-2xl font-extrabold text-red-600 mt-1">{summary.overdue}</p>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-lg border border-l-4 border-l-amber-400 p-3 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                        <AlertTriangleIcon className="w-4 h-4 text-amber-500" />
                        <span className="uppercase tracking-wide">Warning</span>
                    </div>
                    <p className="text-2xl font-extrabold text-amber-600 mt-1">{summary.warning}</p>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-lg border border-l-4 border-l-emerald-500 p-3 shadow-sm">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] font-medium">
                        <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                        <span className="uppercase tracking-wide">OK</span>
                    </div>
                    <p className="text-2xl font-extrabold text-emerald-600 mt-1">{summary.ok}</p>
                </div>
            </div>

            {/* Toolbar Row */}
            <div className="flex flex-wrap items-center gap-3 border-b pb-3">
                <Select value={filterTask} onValueChange={setFilterTask}>
                    <SelectTrigger className="w-[200px] h-9 text-sm">
                        <SelectValue placeholder="All Tasks" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Tasks</SelectItem>
                        {tasks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                </Select>

                <ToggleGroup type="single" value={viewMode} onValueChange={(v: string) => v && setViewMode(v as "floor" | "heatmap")}>
                    <ToggleGroupItem value="heatmap" aria-label="Heatmap View" className="h-9 px-3 text-xs">
                        <LayoutGridIcon className="w-3.5 h-3.5 mr-1.5" /> Heatmap
                    </ToggleGroupItem>
                    <ToggleGroupItem value="floor" aria-label="Floor View" className="h-9 px-3 text-xs">
                        <Columns3Icon className="w-3.5 h-3.5 mr-1.5" /> Floor
                    </ToggleGroupItem>
                </ToggleGroup>

                {viewMode === 'heatmap' && (
                    <Select value={groupBy} onValueChange={(v: string) => setGroupBy(v as "floor" | "type")}>
                        <SelectTrigger className="w-[130px] h-9 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="floor">Group: Floor</SelectItem>
                            <SelectItem value="type">Group: Type</SelectItem>
                        </SelectContent>
                    </Select>
                )}

                <div className="flex-1" />

                <Button
                    variant={showRenovation ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setShowRenovation((prev) => !prev)}
                    disabled={isLoading || isRefreshing}
                    className="h-9 text-xs"
                >
                    {showRenovation ? "Hide Renovation" : "Show Renovation"}
                </Button>
            </div>

            {/* Main Content */}
            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-[var(--bg-muted)]" />)}
                </div>
            ) : (
                <div className="pb-8">
                    {viewMode === "heatmap" ? (
                        <MaintenanceHeatmapView rooms={filteredRooms} groupBy={groupBy} onClickRoom={setSelectedRoomId} />
                    ) : (
                        <div className="space-y-6">
                            {Array.from(new Set(filteredRooms.map(r => r.floor_number))).sort((a, b) => (a || 0) - (b || 0)).map(floor => {
                                const fRooms = filteredRooms.filter(r => r.floor_number === floor);
                                const floorOverdue = fRooms.filter(r => r.tasks.some((t: any) => t.status === "OVERDUE")).length;
                                return (
                                    <div key={floor || 'unknown'}>
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className="w-7 h-7 rounded bg-[var(--bg-muted)] flex items-center justify-center text-xs font-bold text-[var(--text-secondary)]">
                                                {floor || "?"}
                                            </span>
                                            <h3 className="font-bold text-[var(--text-secondary)]">Floor {floor || 'Other'}</h3>
                                            <span className="text-xs text-[var(--text-muted)]">{fRooms.length} rooms</span>
                                            {floorOverdue > 0 && (
                                                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{floorOverdue} overdue</span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                            {fRooms.map(room => (
                                                <MaintenanceRoomCard key={room.room_id} room={room} onClick={setSelectedRoomId} />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <MaintenanceRoomDetailModal
                room={selectedRoomData || null}
                isOpen={!!selectedRoomId}
                onOpenChange={(op) => !op && setSelectedRoomId(null)}
                onMarkDone={handleMarkDone}
                notes={notes}
                onResolveNote={handleResolveNote}
                onAddNote={handleAddNote}
            />

            <MaintenanceNotesModal
                isOpen={notesModalOpen}
                onOpenChange={setNotesModalOpen}
                roomNumber={null}
                notes={allNotes}
                onResolveNote={handleResolveNote}
            />
        </div>
    );
}
