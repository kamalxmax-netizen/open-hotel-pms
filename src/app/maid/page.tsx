"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Moon, RotateCw, Sun } from "lucide-react";
import RoomCard from "@/components/maid/room-card";
import ExtraTaskCard from "@/components/maid/extra-task-card";
import ChecklistModal from "@/components/maid/checklist-modal";
import NoServiceModal from "@/components/maid/no-service-modal";
import EmptyState from "@/components/maid/empty-state";
import LfReportSheet from "@/components/maid/lf-report-sheet";
import type {
  ChecklistItem,
  ExtraTaskAssignment,
  MaidRoom,
  MaintenanceChecklistSubmission,
} from "@/lib/types";

interface MaidData {
  success: boolean;
  date: string;
  maid_name: string;
  summary: Record<string, number>;
  rooms: MaidRoom[];
}

type TabType = "all" | "dirty" | "in_progress" | "done";
type NetworkQuality = "good" | "poor" | "unknown";

const CHECKLIST_CLOSE_MS = 320;
const THEME_STORAGE_KEY = "maidAppDarkMode";

async function readJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function ensureApiSuccess(response: Response, fallbackMessage: string): Promise<any> {
  const json = await readJsonSafe(response);
  if (!response.ok || (json && json.success === false)) {
    throw new Error(json?.error || fallbackMessage);
  }
  return json;
}

function getThailandDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function getNavigatorConnection():
  | {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  }
  | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: any;
    mozConnection?: any;
    webkitConnection?: any;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

function assessNetworkQuality(
  connection:
    | {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
      }
    | null
): { quality: NetworkQuality; hint: string | null } {
  if (!connection) return { quality: "unknown", hint: null };

  const effectiveType = String(connection.effectiveType ?? "").toLowerCase();
  const downlink = Number(connection.downlink ?? NaN);
  const rtt = Number(connection.rtt ?? NaN);
  const saveData = Boolean(connection.saveData);

  const isPoor =
    saveData ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g" ||
    (!Number.isNaN(downlink) && downlink > 0 && downlink < 0.8) ||
    (!Number.isNaN(rtt) && rtt > 850);

  if (!isPoor) return { quality: "good", hint: null };

  const parts: string[] = [];
  if (effectiveType) parts.push(`type ${effectiveType}`);
  if (!Number.isNaN(downlink) && downlink > 0) parts.push(`downlink ${downlink.toFixed(1)} Mbps`);
  if (!Number.isNaN(rtt) && rtt > 0) parts.push(`latency ${Math.round(rtt)} ms`);
  if (saveData) parts.push("data-saver on");

  return {
    quality: "poor",
    hint: parts.length > 0 ? parts.join(" · ") : "slow or unstable network",
  };
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-black transition-all ${
        active
          ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-950"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

function getRoomSortWeight(room: MaidRoom): number {
  if (room.status === "in_progress") return 0;
  if (room.status === "paused") return 1;
  if (room.status === "dirty") return 2;
  if (room.status === "cleaned" || room.status === "approved") return 3;
  return 2;
}

export default function MaidPage() {
  const fallbackMaids = ["Jan", "Tan", "Others"];
  const [maidName, setMaidName] = useState<string>("Jan");
  const [maidLaneNames, setMaidLaneNames] = useState<string[]>(fallbackMaids);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [data, setData] = useState<MaidData | null>(null);
  const [extraTasks, setExtraTasks] = useState<ExtraTaskAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("unknown");
  const [networkHint, setNetworkHint] = useState<string | null>(null);
  const [lastFetchError, setLastFetchError] = useState<string | null>(null);
  const [selectedChecklistRoom, setSelectedChecklistRoom] = useState<MaidRoom | null>(null);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [activeNsRoom, setActiveNsRoom] = useState<MaidRoom | null>(null);
  const [pendingNsFinishNote, setPendingNsFinishNote] = useState("");
  const [isReportSheetOpen, setIsReportSheetOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [timeStr, setTimeStr] = useState("");
  const checklistCloseTimerRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const clearChecklistCloseTimer = () => {
    if (checklistCloseTimerRef.current !== null) {
      window.clearTimeout(checklistCloseTimerRef.current);
      checklistCloseTimerRef.current = null;
    }
  };

  const closeChecklist = useCallback((clearNote = false) => {
    setIsChecklistOpen(false);
    clearChecklistCloseTimer();
    checklistCloseTimerRef.current = window.setTimeout(() => {
      setSelectedChecklistRoom(null);
      if (clearNote) {
        setPendingNsFinishNote("");
      }
      checklistCloseTimerRef.current = null;
    }, CHECKLIST_CLOSE_MS);
  }, []);

  const patchRoomById = useCallback((roomId: string, updater: (room: MaidRoom) => MaidRoom) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rooms: prev.rooms.map((room) => (room.room_id === roomId ? updater(room) : room)),
      };
    });
  }, []);

  const patchRoomByTaskId = useCallback((taskId: string, updater: (room: MaidRoom) => MaidRoom) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rooms: prev.rooms.map((room) => (room.task_id === taskId ? updater(room) : room)),
      };
    });
  }, []);

  const patchExtraTask = useCallback(
    (assignmentId: string, updater: (task: ExtraTaskAssignment) => ExtraTaskAssignment) => {
      setExtraTasks((prev) => prev.map((task) => (task.id === assignmentId ? updater(task) : task)));
    },
    []
  );

  const fetchData = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
      setIsLoading(false);
      setLastFetchError("Offline");
      return;
    }
    try {
      const date = getThailandDateString();
      const [roomsRes, extraRes] = await Promise.all([
        fetch(
          `/api/housekeeping/maid-rooms?maid_name=${encodeURIComponent(maidName)}&date=${encodeURIComponent(date)}`,
          { cache: "no-store" }
        ),
        fetch(
          `/api/housekeeping/extra-tasks/assignments?date=${encodeURIComponent(date)}&maid_name=${encodeURIComponent(maidName)}`,
          { cache: "no-store" }
        ),
      ]);

      const [roomsJson, extraJson] = await Promise.all([roomsRes.json(), extraRes.json()]);
      if (roomsJson.success) {
        setData(roomsJson);
      }
      if (extraJson.success) {
        setExtraTasks(extraJson.assignments ?? []);
      }
      setLastFetchError(null);
    } catch (e) {
      console.error("Failed to fetch maid data", e);
      setLastFetchError("เชื่อมต่อไม่ได้");
    } finally {
      setIsLoading(false);
    }
  }, [maidName]);

  const refreshNow = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
      setLastFetchError("Offline");
      return;
    }

    const run = (async () => {
      setIsRefreshing(true);
      try {
        await fetchData();
      } finally {
        setIsRefreshing(false);
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = run;
    return run;
  }, [fetchData]);

  useEffect(() => {
    setIsMounted(true);
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved !== null) {
      setIsDarkMode(saved === "true");
    }
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, String(isDarkMode));
  }, [isDarkMode, isMounted]);

  useEffect(() => {
    const syncNetworkState = () => {
      const offline = typeof navigator !== "undefined" ? !navigator.onLine : false;
      setIsOffline(offline);
      const connection = getNavigatorConnection();
      const assessed = assessNetworkQuality(connection);
      setNetworkQuality(assessed.quality);
      setNetworkHint(assessed.hint);
    };

    syncNetworkState();

    const connection = getNavigatorConnection();
    window.addEventListener("online", syncNetworkState);
    window.addEventListener("offline", syncNetworkState);
    connection?.addEventListener?.("change", syncNetworkState);

    return () => {
      window.removeEventListener("online", syncNetworkState);
      window.removeEventListener("offline", syncNetworkState);
      connection?.removeEventListener?.("change", syncNetworkState);
    };
  }, []);

  useEffect(() => {
    const tickClock = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }));
    };
    tickClock();
    const timer = window.setInterval(tickClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMaidLanes() {
      try {
        const res = await fetch("/api/staff/housekeeping-lanes", { cache: "no-store" });
        const json = await readJsonSafe(res);
        if (!res.ok || json?.success === false) return;
        const names = Array.isArray(json?.data)
          ? json.data
              .map((row: { display_name?: string }) => String(row.display_name ?? "").trim())
              .filter((name: string) => name.length > 0)
          : [];
        if (!cancelled && names.length > 0) {
          setMaidLaneNames(names);
          setMaidName((prev) => (names.includes(prev) ? prev : names[0]));
        }
      } catch {
        // keep fallback
      }
    }

    void loadMaidLanes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setIsLoading(true);
    void fetchData();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchData();
      }
    }, 30000);

    return () => window.clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    return () => clearChecklistCloseTimer();
  }, []);

  const handleStart = async (
    roomId: string,
    taskId: string | null,
    isNoService = false,
    manageLoading = true
  ) => {
    if (manageLoading) setIsActionLoading(true);
    try {
      let currentTaskId = taskId;

      if (!currentTaskId) {
        const stayDate = data?.date ?? getThailandDateString();
        const pushRes = await fetch("/api/housekeeping/tasks/push-dirty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            stay_date: stayDate,
            trigger_source: "manual",
            requested_by: maidName,
          }),
        });
        const pushJson = await ensureApiSuccess(pushRes, "Failed to push dirty");
        currentTaskId = pushJson.task_id;
      }

      if (!currentTaskId) throw new Error("task_id is still null after push-dirty");

      const startRes = await fetch(`/api/housekeeping/tasks/${currentTaskId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maid_name: maidName,
          is_no_service: isNoService,
        }),
      });
      await ensureApiSuccess(startRes, "Cannot start task");

      const startedAt = new Date().toISOString();
      patchRoomById(roomId, (room) => ({
        ...room,
        task_id: currentTaskId,
        status: "in_progress",
        is_no_service: room.task_id ? room.is_no_service : isNoService,
        accumulated_ms: room.task_id ? room.accumulated_ms : 0,
        started_at: startedAt,
        finished_at: null,
        approved_at: null,
      }));

      return currentTaskId;
    } catch (error: any) {
      alert("Error: " + error.message);
      return null;
    } finally {
      if (manageLoading) {
        setIsActionLoading(false);
        void refreshNow();
      }
    }
  };

  const handlePause = async (taskId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${taskId}/pause`, { method: "POST" });
      const json = await ensureApiSuccess(res, "Cannot pause task");
      patchRoomByTaskId(taskId, (room) => ({
        ...room,
        status: "paused",
        accumulated_ms: Number(json?.accumulated_ms ?? room.accumulated_ms ?? 0),
        started_at: null,
      }));
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot pause task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleResume = async (taskId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${taskId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maid_name: maidName }),
      });
      await ensureApiSuccess(res, "Cannot resume task");
      patchRoomByTaskId(taskId, (room) => ({
        ...room,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }));
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot resume task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleFinishSubmit = async (
    checklist: ChecklistItem[],
    maintenanceChecklist: MaintenanceChecklistSubmission[],
    collectedLoanIds?: string[],
    returnedStock?: Array<{ product_id: string; quantity: number }>
  ) => {
    if (!selectedChecklistRoom || !selectedChecklistRoom.task_id) return;

    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${selectedChecklistRoom.task_id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maid_name: maidName,
          note: selectedChecklistRoom.is_no_service
            ? pendingNsFinishNote || selectedChecklistRoom.no_service_note || "ดำเนินการห้องงดทำแล้ว"
            : undefined,
          checklist,
          maintenance_assignment_ids: (selectedChecklistRoom.maintenance_assignments ?? []).map(
            (assignment) => assignment.assignment_id
          ),
          maintenance_checklist: maintenanceChecklist,
          collected_loan_trace_ids: collectedLoanIds,
          returned_stock: returnedStock ?? [],
        }),
      });
      const json = await ensureApiSuccess(res, "Cannot finish task");
      const warnings = [
        typeof json?.amenity_deliveries?.error === "string" ? json.amenity_deliveries.error : null,
        typeof json?.stock_return?.error === "string" ? json.stock_return.error : null,
      ].filter(Boolean) as string[];

      closeChecklist(true);
      if (warnings.length > 0) {
        alert(`จบงานแล้ว แต่มีบางอย่างต้องเช็กต่อ\n\n${warnings.join("\n")}`);
      }
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot finish task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleNoServiceSubmit = async (note: string) => {
    if (!activeNsRoom) return;

    setIsActionLoading(true);
    try {
      const finalTaskId = await handleStart(activeNsRoom.room_id, activeNsRoom.task_id, true, false);
      if (!finalTaskId) {
        throw new Error("Cannot complete No Service because start failed.");
      }

      const normalizedNote = note.trim();
      setPendingNsFinishNote(normalizedNote);
      setSelectedChecklistRoom({
        ...activeNsRoom,
        task_id: finalTaskId,
        is_no_service: true,
        no_service_note: activeNsRoom.no_service_note ?? (normalizedNote || null),
      });
      setIsChecklistOpen(true);
      setActiveNsRoom(null);
    } catch (error: any) {
      alert("Error: " + error.message);
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleExtraTaskStart = async (assignmentId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${assignmentId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await ensureApiSuccess(res, "Cannot start extra task");
      patchExtraTask(assignmentId, (task) => ({
        ...task,
        status: "in_progress",
        started_at: new Date().toISOString(),
        finished_at: null,
      }));
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot start extra task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleExtraTaskPause = async (assignmentId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${assignmentId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await ensureApiSuccess(res, "Cannot pause extra task");
      patchExtraTask(assignmentId, (task) => ({
        ...task,
        status: "paused",
        accumulated_ms: Number(json?.accumulated_ms ?? task.accumulated_ms ?? 0),
        started_at: null,
      }));
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot pause extra task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const handleExtraTaskResume = async (assignmentId: string) => {
    await handleExtraTaskStart(assignmentId);
  };

  const openChecklistForRoom = async (selectedRoom: MaidRoom) => {
    try {
      const date = data?.date ?? getThailandDateString();
      const res = await fetch(
        `/api/housekeeping/maid-rooms?maid_name=${encodeURIComponent(maidName)}&date=${encodeURIComponent(date)}`,
        { cache: "no-store" }
      );
      const json = await ensureApiSuccess(res, "Cannot load latest room data");
      if (json?.success) {
        setData(json);
        const freshRoom =
          (Array.isArray(json.rooms)
            ? (json.rooms as MaidRoom[]).find((room) => room.room_id === selectedRoom.room_id)
            : null) ?? selectedRoom;
        setSelectedChecklistRoom(freshRoom);
      } else {
        setSelectedChecklistRoom(selectedRoom);
      }
    } catch {
      setSelectedChecklistRoom(selectedRoom);
    } finally {
      setIsChecklistOpen(true);
    }
  };

  const handleExtraTaskFinish = async (assignmentId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/extra-tasks/assignments/${assignmentId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await ensureApiSuccess(res, "Cannot finish extra task");
      patchExtraTask(assignmentId, (task) => ({
        ...task,
        status: "done",
        started_at: null,
        finished_at: new Date().toISOString(),
      }));
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot finish extra task"));
    } finally {
      setIsActionLoading(false);
      void refreshNow();
    }
  };

  const rooms = data?.rooms ?? [];
  const filteredRooms = rooms
    .filter((room) => {
      if (activeTab === "all") return true;
      if (activeTab === "dirty") return room.status === "dirty" || room.is_no_service;
      if (activeTab === "in_progress") return room.status === "in_progress" || room.status === "paused";
      return room.status === "cleaned" || room.status === "approved";
    })
    .sort((a, b) => {
      const weightDiff = getRoomSortWeight(a) - getRoomSortWeight(b);
      if (weightDiff !== 0) return weightDiff;
      const priorityDiff = Number(a.priority ?? 999) - Number(b.priority ?? 999);
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.room_number ?? "").localeCompare(String(b.room_number ?? ""), undefined, {
        numeric: true,
      });
    });

  const filteredExtraTasks = extraTasks
    .filter((task) => {
      if (activeTab === "all") return true;
      if (activeTab === "dirty") return task.status === "pending";
      if (activeTab === "in_progress") return task.status === "in_progress" || task.status === "paused";
      return task.status === "done";
    })
    .sort((a, b) => {
      const pa = Number(a.priority ?? 9999);
      const pb = Number(b.priority ?? 9999);
      if (pa !== pb) return pa - pb;
      return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""), undefined, {
        numeric: true,
      });
    });

  const hasVisibleItems = filteredRooms.length > 0 || filteredExtraTasks.length > 0;
  const networkStatusText = isOffline ? "OFFLINE" : networkQuality === "poor" ? "WEAK INTERNET" : "ONLINE";
  const selectedDisplayName = maidName || data?.maid_name || "Maid";
  const selectedLaneName = maidLaneNames.includes(selectedDisplayName)
    ? selectedDisplayName
    : data?.maid_name || selectedDisplayName;

  if (!isMounted) return null;

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="relative min-h-screen overflow-hidden pb-24 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.14),transparent_28%),linear-gradient(180deg,#d9e3ee_0%,#ced9e6_38%,#e6edf4_100%)] dark:hidden" />
        <div className="absolute inset-0 dark:hidden [background-image:linear-gradient(rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:26px_26px] opacity-30" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent)] dark:hidden" />

        <div className="relative min-h-screen dark:bg-slate-950">
        <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-slate-950/90 dark:shadow-none">
          <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 dark:border-white/10 dark:bg-white/5">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    isOffline ? "bg-rose-500" : networkQuality === "poor" ? "bg-amber-400" : "bg-emerald-500"
                  }`}
                />
                <span className="text-xs font-black text-slate-700 dark:text-slate-300">{networkStatusText}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsDarkMode((prev) => !prev)}
                className="rounded-full bg-slate-200 p-2 text-slate-700 transition-colors hover:bg-slate-300 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                aria-label="สลับธีม"
              >
                {isDarkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-indigo-600" />}
              </button>

              <button
                type="button"
                onClick={() => void refreshNow()}
                disabled={isRefreshing || isActionLoading}
                className="rounded-full bg-slate-200 p-2 text-slate-700 transition-colors hover:bg-slate-300 disabled:opacity-50 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
                aria-label="รีเฟรช"
              >
                <RotateCw size={18} className={isRefreshing ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="text-right">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {selectedLaneName}
              </p>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-sm font-black text-slate-800 dark:text-slate-100">
                <Clock3 size={14} className="text-slate-500 dark:text-slate-400" />
                {timeStr}
              </div>
            </div>
          </div>

          <div className="mx-auto mt-4 flex w-full max-w-screen-2xl justify-end">
            <div className="w-full lg:max-w-[320px]">
              <select
                value={maidName}
                onChange={(e) => setMaidName(e.target.value)}
                aria-label="เลือกแม่บ้าน"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-black text-slate-900 outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:border-white/20"
              >
                {maidLaneNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(lastFetchError || (networkQuality === "poor" && !isOffline)) && (
            <div className="mx-auto mt-4 flex w-full max-w-screen-2xl flex-wrap gap-2">
              {lastFetchError && (
                <div className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-black text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {lastFetchError}
                </div>
              )}
              {!isOffline && networkQuality === "poor" && (
                <div className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  Weak internet{networkHint ? ` · ${networkHint}` : ""}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mx-auto max-w-screen-2xl px-4 py-4">
          <div className="mb-6 flex gap-2 overflow-x-auto">
            <TabButton active={activeTab === "all"} onClick={() => setActiveTab("all")}>
              ทั้งหมด
            </TabButton>
            <TabButton active={activeTab === "dirty"} onClick={() => setActiveTab("dirty")}>
              รอทำ
            </TabButton>
            <TabButton active={activeTab === "in_progress"} onClick={() => setActiveTab("in_progress")}>
              กำลังทำ
            </TabButton>
            <TabButton active={activeTab === "done"} onClick={() => setActiveTab("done")}>
              เสร็จแล้ว
            </TabButton>
          </div>

          {isLoading && !data ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
            </div>
          ) : !hasVisibleItems ? (
            <EmptyState message="ไม่มีรายการในหมวดนี้" />
          ) : (
            <div className="space-y-8">
              {filteredExtraTasks.length > 0 && (
                <section>
                  <h3 className="mb-4 text-xl font-black text-indigo-500 dark:text-indigo-400">งานพิเศษ / งานเสริม</h3>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {filteredExtraTasks.map((task) => (
                      <ExtraTaskCard
                        key={`extra-${task.id}`}
                        task={task}
                        onStart={handleExtraTaskStart}
                        onPause={handleExtraTaskPause}
                        onResume={handleExtraTaskResume}
                        onFinish={handleExtraTaskFinish}
                        isActionLoading={isActionLoading}
                      />
                    ))}
                  </div>
                </section>
              )}

              {filteredExtraTasks.length > 0 && filteredRooms.length > 0 && (
                <hr className="mx-auto w-1/2 border-t-2 border-slate-200 dark:border-white/5" />
              )}

              {filteredRooms.length > 0 && (
                <section>
                  <h3 className="mb-4 text-xl font-black text-slate-500 dark:text-slate-400">รายการห้องในกะ</h3>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {filteredRooms.map((room) => (
                      <RoomCard
                        key={room.room_id}
                        room={room}
                        onStart={handleStart}
                        onPause={handlePause}
                        onResume={handleResume}
                        onFinishClick={(selectedRoom) => {
                          void openChecklistForRoom(selectedRoom);
                        }}
                        onNoServiceClick={(selectedRoom) => setActiveNsRoom(selectedRoom)}
                        isActionLoading={isActionLoading}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <ChecklistModal
          isOpen={isChecklistOpen && !!selectedChecklistRoom}
          roomNumber={selectedChecklistRoom?.room_number || ""}
          items={selectedChecklistRoom?.checklist_items || []}
          maintenanceAssignments={selectedChecklistRoom?.maintenance_assignments || []}
          loanCollections={selectedChecklistRoom?.loan_collections || []}
          hkTraces={selectedChecklistRoom?.hk_traces || []}
          returnableStock={selectedChecklistRoom?.returnable_stock || []}
          canReturnStock={Boolean(selectedChecklistRoom?.can_return_stock)}
          roomNote={
            selectedChecklistRoom?.is_no_service
              ? selectedChecklistRoom?.no_service_note ?? pendingNsFinishNote ?? null
              : null
          }
          onClose={() => closeChecklist(true)}
          onSubmit={handleFinishSubmit}
          isSubmitting={isActionLoading}
        />

        <NoServiceModal
          isOpen={!!activeNsRoom}
          roomNumber={activeNsRoom?.room_number || ""}
          onClose={() => setActiveNsRoom(null)}
          onSubmit={handleNoServiceSubmit}
          isSubmitting={isActionLoading}
        />

        <LfReportSheet
          isOpen={isReportSheetOpen}
          onClose={() => setIsReportSheetOpen(false)}
          onSuccess={() => {
            // no-op for now
          }}
        />

        <button
          type="button"
          onClick={() => setIsReportSheetOpen(true)}
          className="fixed bottom-6 left-6 z-40 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-amber-500 text-white shadow-[0_10px_25px_rgba(245,158,11,0.5)] transition-all active:scale-95 hover:bg-amber-600"
        >
          <span className="text-2xl font-black">ลืม</span>
        </button>
        </div>
      </div>
    </div>
  );
}
