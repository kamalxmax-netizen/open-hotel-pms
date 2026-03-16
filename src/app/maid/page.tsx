"use client";

import { useState, useEffect, useCallback } from "react";
import RoomCard from "@/components/maid/room-card";
import ExtraTaskCard from "@/components/maid/extra-task-card";
import ChecklistModal from "@/components/maid/checklist-modal";
import NoServiceModal from "@/components/maid/no-service-modal";
import EmptyState from "@/components/maid/empty-state";
import type { ChecklistItem, ExtraTaskAssignment, MaidRoom, MaintenanceChecklistSubmission } from "@/lib/types";

interface MaidData {
  success: boolean;
  date: string;
  maid_name: string;
  summary: Record<string, number>;
  rooms: MaidRoom[];
}

type TabType = "all" | "dirty" | "in_progress" | "done";
type NetworkQuality = "good" | "poor" | "unknown";

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

  // Modals state
  const [activeChecklistRoom, setActiveChecklistRoom] = useState<MaidRoom | null>(null);
  const [activeNsRoom, setActiveNsRoom] = useState<MaidRoom | null>(null);
  const [pendingNsFinishNote, setPendingNsFinishNote] = useState("");

  const normalizeName = (value: string | null | undefined) =>
    (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  const isMaidMatch = (candidate: string | null | undefined, selected: string) => {
    const c = normalizeName(candidate);
    const s = normalizeName(selected);
    if (!c || !s) return false;
    if (c === s) return true;
    const compactC = c.replace(/[^a-z0-9ก-๙]/g, "");
    const compactS = s.replace(/[^a-z0-9ก-๙]/g, "");
    if (compactC && compactC === compactS) return true;
    return c.includes(s) || s.includes(c);
  };

  const fetchData = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
      setIsLoading(false);
      setLastFetchError("Offline: unable to refresh data.");
      return;
    }
    try {
      const date = getThailandDateString();
      const [roomsRes, extraRes] = await Promise.all([
        fetch(
          `/api/housekeeping/maid-rooms?maid_name=${encodeURIComponent(maidName)}&date=${encodeURIComponent(date)}`,
          { cache: "no-store" }
        ),
        fetch(`/api/housekeeping/extra-tasks/assignments?date=${encodeURIComponent(date)}`, { cache: "no-store" }),
      ]);

      const [roomsJson, extraJson] = await Promise.all([roomsRes.json(), extraRes.json()]);
      if (roomsJson.success) {
        setData(roomsJson);
      }
      if (extraJson.success) {
        const filteredExtraTasks = (extraJson.assignments ?? []).filter((task: ExtraTaskAssignment) =>
          isMaidMatch(task.assigned_maid, maidName)
        );
        setExtraTasks(filteredExtraTasks);
      }
      setLastFetchError(null);
    } catch (e) {
      console.error("Failed to fetch maid data", e);
      setLastFetchError("Unable to reach server. Please check your internet connection.");
    } finally {
      setIsLoading(false);
    }
  }, [maidName]);

  const refreshNow = useCallback(async (opts?: { double?: boolean }) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
      setLastFetchError("Offline: unable to refresh data.");
      return;
    }
    setIsRefreshing(true);
    try {
      await fetchData();
      if (opts?.double) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await fetchData();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchData]);

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

  // Initial load & Polling
  useEffect(() => {
    setIsLoading(true);
    fetchData();

    const interval = setInterval(() => {
      // Only poll if document is visible
      if (document.visibilityState === "visible") {
        fetchData();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Actions
  const handleStart = async (
    roomId: string,
    taskId: string | null,
    isNoService = false,
    manageLoading = true
  ) => {
    if (manageLoading) setIsActionLoading(true);
    try {
      let currentTaskId = taskId;

      // 1. If no task_id, push-dirty first
      if (!currentTaskId) {
        const stayDate = data?.date ?? getThailandDateString();
        const pushRes = await fetch("/api/housekeeping/tasks/push-dirty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            stay_date: stayDate,
            trigger_source: "manual",
            requested_by: maidName
          })
        });
        const pushJson = await ensureApiSuccess(pushRes, "Failed to push dirty");
        currentTaskId = pushJson.task_id;
      }

      if (!currentTaskId) throw new Error("task_id is still null after push-dirty");

      // 2. Start task
      const startRes = await fetch(`/api/housekeeping/tasks/${currentTaskId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maid_name: maidName,
          is_no_service: isNoService
        })
      });
      await ensureApiSuccess(startRes, "Cannot start task");

      return currentTaskId;
    } catch (error: any) {
      alert("Error: " + error.message);
      return null;
    } finally {
      if (manageLoading) {
        setIsActionLoading(false);
        await refreshNow();
      }
    }
  };

  const handlePause = async (taskId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${taskId}/pause`, { method: "POST" });
      await ensureApiSuccess(res, "Cannot pause task");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot pause task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow();
    }
  };

  const handleResume = async (taskId: string) => {
    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${taskId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maid_name: maidName })
      });
      await ensureApiSuccess(res, "Cannot resume task");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot resume task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow();
    }
  };

  const handleFinishSubmit = async (
    checklist: ChecklistItem[],
    maintenanceChecklist: MaintenanceChecklistSubmission[],
    collectedLoanIds?: string[]
  ) => {
    if (!activeChecklistRoom || !activeChecklistRoom.task_id) return;

    setIsActionLoading(true);
    try {
      const res = await fetch(`/api/housekeeping/tasks/${activeChecklistRoom.task_id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maid_name: maidName,
          note: activeChecklistRoom.is_no_service
            ? (pendingNsFinishNote || activeChecklistRoom.no_service_note || "No Service support completed")
            : undefined,
          checklist,
          maintenance_assignment_ids: (activeChecklistRoom.maintenance_assignments ?? []).map(
            (assignment) => assignment.assignment_id
          ),
          maintenance_checklist: maintenanceChecklist,
          collected_loan_trace_ids: collectedLoanIds,
        })
      });
      await ensureApiSuccess(res, "Cannot finish task");
      setActiveChecklistRoom(null);
      setPendingNsFinishNote("");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot finish task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow({ double: true });
    }
  };

  const handleNoServiceSubmit = async (note: string) => {
    if (!activeNsRoom) return;

    setIsActionLoading(true);
    try {
      // Start task with no-service flag, then continue via checklist flow.
      const finalTaskId = await handleStart(activeNsRoom.room_id, activeNsRoom.task_id, true, false);
      if (!finalTaskId) {
        throw new Error("Cannot complete No Service because start failed.");
      }

      const normalizedNote = note.trim();
      setPendingNsFinishNote(normalizedNote);
      setActiveChecklistRoom({
        ...activeNsRoom,
        task_id: finalTaskId,
        is_no_service: true,
        no_service_note: activeNsRoom.no_service_note ?? (normalizedNote || null),
      });
      setActiveNsRoom(null);
    } catch (error: any) {
      alert("Error: " + error.message);
    } finally {
      setIsActionLoading(false);
      await refreshNow();
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
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot start extra task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow();
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
      await ensureApiSuccess(res, "Cannot pause extra task");
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot pause extra task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow();
    }
  };

  const handleExtraTaskResume = async (assignmentId: string) => {
    await handleExtraTaskStart(assignmentId);
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
    } catch (error: any) {
      alert("Error: " + (error?.message || "Cannot finish extra task"));
    } finally {
      setIsActionLoading(false);
      await refreshNow();
    }
  };

  // Filter Data
  const filteredRooms = (data?.rooms || []).filter(r => {
    if (activeTab === "all") return true;
    if (activeTab === "dirty") return r.status === "dirty";
    if (activeTab === "in_progress") return r.status === "in_progress" || r.status === "paused";
    if (activeTab === "done") return r.status === "cleaned" || r.status === "approved";
    return true;
  });
  const filteredExtraTasks = (extraTasks || []).filter((task) => {
    if (activeTab === "all") return true;
    if (activeTab === "dirty") return task.status === "pending";
    if (activeTab === "in_progress") return task.status === "in_progress" || task.status === "paused";
    if (activeTab === "done") return task.status === "done";
    return true;
  });
  const hkCollectRoomCount = (data?.rooms || []).filter((room) => {
    const loanCount = room.loan_collections?.length ?? 0;
    if (loanCount <= 0) return false;
    return room.status === "dirty" || room.status === "in_progress" || room.status === "paused";
  }).length;
  const hasVisibleItems = filteredRooms.length > 0 || filteredExtraTasks.length > 0;

  return (
    <div className="pb-24">
      {/* Maid Selector (Temporary for testing without auth) */}
      <div className="px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase flex items-center gap-2 flex-1">
            Select Maid
            <select
              value={maidName}
              onChange={e => setMaidName(e.target.value)}
              className="ml-auto bg-[var(--bg-surface-hover)] text-[var(--text-primary)] text-sm rounded-md px-2 py-1 font-semibold outline-none"
            >
              {maidLaneNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refreshNow()}
            disabled={isRefreshing || isActionLoading}
            className="rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {isOffline && (
        <div className="mx-4 mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <p className="font-bold">Offline mode</p>
          <p className="mt-0.5">No internet connection. New updates may not appear until online.</p>
        </div>
      )}

      {!isOffline && networkQuality === "poor" && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-bold">Weak internet signal</p>
          <p className="mt-0.5">
            Updates may be delayed{networkHint ? ` (${networkHint})` : ""}.
          </p>
        </div>
      )}

      {!isOffline && lastFetchError && (
        <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {lastFetchError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex overflow-x-auto hide-scrollbar px-4 py-3 gap-2 bg-[var(--bg-body)] sticky top-14 z-30 shadow-sm border-b border-[var(--border-default)]">
        <TabButton active={activeTab === "all"} onClick={() => setActiveTab("all")}>
          All
          {hkCollectRoomCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500 text-white">
              📦 {hkCollectRoomCount}
            </span>
          )}
        </TabButton>
        <TabButton active={activeTab === "dirty"} onClick={() => setActiveTab("dirty")}>
          To Clean
          {data && data.summary.dirty > 0 && <Badge count={data.summary.dirty} alert />}
        </TabButton>
        <TabButton active={activeTab === "in_progress"} onClick={() => setActiveTab("in_progress")}>
          In Progress
          {data && (data.summary.in_progress + data.summary.paused) > 0 && (
            <Badge count={data.summary.in_progress + data.summary.paused} />
          )}
        </TabButton>
        <TabButton active={activeTab === "done"} onClick={() => setActiveTab("done")}>
          Done
        </TabButton>
      </div>

      {/* List */}
      <div className="p-4 space-y-4">
        {isLoading && !data ? (
          <div className="flex justify-center p-8">
            <span className="w-8 h-8 rounded-full border-4 border-[var(--border-default)] border-t-brand-600 animate-spin"></span>
          </div>
        ) : !hasVisibleItems ? (
          <EmptyState message={`No rooms in '${activeTab}' category.`} />
        ) : (
          <>
            {filteredRooms.map(room => (
              <RoomCard
                key={room.room_id}
                room={room}
                onStart={handleStart}
                onPause={handlePause}
                onResume={handleResume}
                onFinishClick={(r) => setActiveChecklistRoom(r)}
                onNoServiceClick={(r) => setActiveNsRoom(r)}
                isActionLoading={isActionLoading}
              />
            ))}
            {filteredExtraTasks
              .sort((a, b) => {
                const pa = Number(a.priority ?? 9999);
                const pb = Number(b.priority ?? 9999);
                if (pa !== pb) return pa - pb;
                return String(a.task_name ?? "").localeCompare(String(b.task_name ?? ""), undefined, {
                  numeric: true,
                });
              })
              .map((task) => (
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
          </>
        )}
      </div>

      {/* Modals */}
      <ChecklistModal
        isOpen={!!activeChecklistRoom}
        roomNumber={activeChecklistRoom?.room_number || ""}
        items={activeChecklistRoom?.checklist_items || []}
        maintenanceAssignments={activeChecklistRoom?.maintenance_assignments || []}
        loanCollections={activeChecklistRoom?.loan_collections || []}
        hkTraces={activeChecklistRoom?.hk_traces || []}
        roomNote={
          activeChecklistRoom?.is_no_service
            ? (activeChecklistRoom?.no_service_note ?? pendingNsFinishNote ?? null)
            : null
        }
        onClose={() => {
          setActiveChecklistRoom(null);
          setPendingNsFinishNote("");
        }}
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
    </div>
  );
}

// Helpers
function TabButton({ children, active, onClick }: { children: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-bold flex items-center gap-2 transition-colors ${active
        ? "bg-slate-800 text-white shadow-sm"
        : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-surface-hover)]"
        }`}
    >
      {children}
    </button>
  );
}

function Badge({ count, alert }: { count: number, alert?: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] ${alert ? "bg-rose-500 text-white" : "bg-sky-500 text-white"}`}>
      {count}
    </span>
  );
}
