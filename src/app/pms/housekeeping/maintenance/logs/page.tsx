"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { MaintenanceLog } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCwIcon, HistoryIcon, CalendarIcon, MessageSquareIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;
const thaiDateTimeFormatter = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

function formatThaiDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    const parts = thaiDateTimeFormatter.formatToParts(date);
    const day = parts.find((part) => part.type === "day")?.value ?? "00";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    return `${day}/${month}/${year} ${hour}:${minute}`;
}

export default function MaintenanceLogsPage() {
    const [logs, setLogs] = useState<MaintenanceLog[]>([]);
    const [rooms, setRooms] = useState<{ id: string, number: string }[]>([]);
    const [tasks, setTasks] = useState<{ id: string, name: string }[]>([]);

    const [filterRoom, setFilterRoom] = useState<string>("all");
    const [filterTask, setFilterTask] = useState<string>("all");
    const [dateFrom, setDateFrom] = useState<string>("");
    const [dateTo, setDateTo] = useState<string>("");
    const [page, setPage] = useState(1);

    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();

    const fetchTaskOptions = useCallback(async () => {
        try {
            const res = await fetch("/api/maintenance/tasks", { cache: "no-store" });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data?.error || "Failed to load tasks");
            const activeTasks = (data.tasks ?? [])
                .filter((task: any) => task?.is_active !== false)
                .map((task: any) => ({ id: String(task.id), name: String(task.name) }))
                .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
            setTasks(activeTasks);
        } catch (err) {
            console.error("Failed to fetch maintenance task options:", err);
        }
    }, []);

    const fetchLogs = useCallback(async () => {
        try {
            setIsLoading(true);
            const queryParams = new URLSearchParams();
            queryParams.append("limit", "500");
            if (filterRoom !== 'all') queryParams.append("room_id", filterRoom);
            if (filterTask !== 'all') queryParams.append("task_id", filterTask);

            const res = await fetch(`/api/maintenance/logs?${queryParams.toString()}`, { cache: "no-store" });
            const data = await res.json();

            if (res.ok && data.success) {
                setLogs(data.logs);
                const roomMap = new Map<string, string>();
                (data.logs ?? []).forEach((log: any) => {
                    if (log.room_id && log.room_number) roomMap.set(String(log.room_id), String(log.room_number));
                });
                setRooms(
                    Array.from(roomMap.entries())
                        .map(([id, number]) => ({ id, number }))
                        .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
                );
                setPage(1);
                return;
            }
            throw new Error(data?.error || "Failed to load logs");
        } catch (err) {
            console.error("Failed to fetch maintenance logs:", err);
            toast({ title: "Error", description: "Failed to fetch logs", variant: "destructive" });
        } finally { setIsLoading(false); }
    }, [filterRoom, filterTask, toast]);

    useEffect(() => { fetchTaskOptions(); }, [fetchTaskOptions]);
    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    useEffect(() => {
        if (filterTask === "all") return;
        if (!tasks.some((task) => task.id === filterTask)) setFilterTask("all");
    }, [filterTask, tasks]);

    // Client-side date filtering + pagination
    const { totalFiltered, totalPages, paginatedLogs } = useMemo(() => {
        let filtered = logs;
        if (dateFrom) {
            const from = new Date(dateFrom + "T00:00:00");
            filtered = filtered.filter(l => new Date(l.performed_at) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo + "T23:59:59");
            filtered = filtered.filter(l => new Date(l.performed_at) <= to);
        }
        const total = filtered.length;
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const start = (page - 1) * PAGE_SIZE;
        const paginated = filtered.slice(start, start + PAGE_SIZE);
        return { totalFiltered: total, totalPages: pages, paginatedLogs: paginated };
    }, [logs, dateFrom, dateTo, page]);

    const getStayCountColor = (count: number) => {
        if (count >= 100) return "bg-red-100 text-red-700 border-red-200";
        if (count >= 30) return "bg-amber-100 text-amber-700 border-amber-200";
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
    };

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-red-600">Maintenance</p>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Maintenance History</h1>
                <p className="text-sm text-slate-500 mt-0.5">Log of all completed maintenance tasks</p>
            </div>

            {/* Filter Panel */}
            <div className="bg-white border rounded-xl p-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">From Date</label>
                        <div className="relative">
                            <CalendarIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="pl-8 h-9 text-sm" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">To Date</label>
                        <div className="relative">
                            <CalendarIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="pl-8 h-9 text-sm" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Room</label>
                        <Select value={filterRoom} onValueChange={setFilterRoom}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="All Rooms" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Rooms</SelectItem>
                                {rooms.map(r => <SelectItem key={r.id} value={r.id}>Room {r.number}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Task</label>
                        <Select value={filterTask} onValueChange={setFilterTask}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="All Tasks" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Tasks</SelectItem>
                                {tasks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setDateFrom(""); setDateTo(""); setFilterRoom("all"); setFilterTask("all"); }}
                            className="h-9 text-xs text-slate-500"
                        >
                            Clear
                        </Button>
                    </div>
                </div>
            </div>

            {/* Summary Bar */}
            <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                    Showing {paginatedLogs.length} of {totalFiltered} records
                    {(dateFrom || dateTo || filterRoom !== "all" || filterTask !== "all") && " (filtered)"}
                </span>
                {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="h-7 w-7">
                            <ChevronLeftIcon className="w-4 h-4" />
                        </Button>
                        <span className="text-xs font-medium px-2">{page} / {totalPages}</span>
                        <Button variant="ghost" size="icon" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-7 w-7">
                            <ChevronRightIcon className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-[11px] text-slate-500 font-bold uppercase tracking-wider border-b">
                            <tr>
                                <th className="px-4 py-3">Date / Time</th>
                                <th className="px-4 py-3">Room</th>
                                <th className="px-4 py-3">Task</th>
                                <th className="px-4 py-3 text-center">Stay Count</th>
                                <th className="px-4 py-3">Completed by</th>
                                <th className="px-4 py-3">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedLogs.length > 0 ? paginatedLogs.map((log, idx) => (
                                <tr key={log.id} className={`hover:bg-slate-50/80 transition-colors ${idx % 2 === 1 ? "bg-slate-50/40" : ""}`}>
                                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 text-xs">
                                        {formatThaiDateTime(log.performed_at)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="font-bold text-slate-800">{log.room_number || '-'}</span>
                                    </td>
                                    <td className="px-4 py-3 font-medium text-slate-700">{log.task_name || '-'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`inline-flex items-center justify-center border px-2 py-0.5 rounded-full text-xs font-bold min-w-[3rem] ${getStayCountColor(log.stay_count_at_time ?? 0)}`}>
                                            {log.stay_count_at_time ?? '-'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{log.performed_by || 'System'}</td>
                                    <td className="px-4 py-3">
                                        {log.notes ? (
                                            <span className="flex items-start gap-1.5 text-xs text-slate-600">
                                                <MessageSquareIcon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                                                <span className="line-clamp-2">{log.notes}</span>
                                            </span>
                                        ) : (
                                            <span className="text-slate-300 text-xs">-</span>
                                        )}
                                    </td>
                                </tr>
                            )) : !isLoading && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-16 text-center">
                                        <HistoryIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                        <p className="text-slate-500 font-medium">No maintenance history found</p>
                                        <p className="text-xs text-slate-400 mt-1">Try adjusting your filters or date range.</p>
                                    </td>
                                </tr>
                            )}
                            {isLoading && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-16 text-center">
                                        <RefreshCwIcon className="w-6 h-6 animate-spin mx-auto text-slate-300" />
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bottom Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 pb-4">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 text-xs">
                        <ChevronLeftIcon className="w-4 h-4 mr-1" /> Prev
                    </Button>
                    <span className="text-xs font-medium text-slate-500 px-3">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-8 text-xs">
                        Next <ChevronRightIcon className="w-4 h-4 ml-1" />
                    </Button>
                </div>
            )}
        </div>
    );
}
