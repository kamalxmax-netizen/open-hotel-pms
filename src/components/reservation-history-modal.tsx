"use client";

import { useEffect, useState } from "react";
import PmsModal from "./pms-modal";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { humanizeAction, humanizeKey, SOURCE_BADGE } from "@/lib/audit-utils";

type ReservationHistoryRow = {
  id: string;
  actor_name: string | null;
  action: string;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  source: keyof typeof SOURCE_BADGE;
  note: string | null;
  business_date?: string;
  created_at: string;
};

type ReservationHistoryApiResponse = {
  success: boolean;
  history?: ReservationHistoryRow[];
  error?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRoomIdField(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "room_id" || normalized.endsWith("_room_id");
}

function collectRoomIds(rows: ReservationHistoryRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const snapshots = [row.before_json, row.after_json];
    for (const snapshot of snapshots) {
      if (!snapshot || typeof snapshot !== "object") continue;
      for (const [key, value] of Object.entries(snapshot)) {
        if (!isRoomIdField(key)) continue;
        if (typeof value === "string" && UUID_RE.test(value)) {
          ids.add(value);
        }
      }
    }
  }
  return Array.from(ids);
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatDisplayValueForKey(
  key: string,
  value: unknown,
  roomNumberById: Record<string, string>
): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" && isRoomIdField(key) && UUID_RE.test(value)) {
    const roomNumber = roomNumberById[value];
    if (roomNumber) {
      return `Room ${roomNumber}`;
    }
  }
  return formatDisplayValue(value);
}

function formatDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  roomNumberById: Record<string, string>
) {
  const b = before ?? {};
  const a = after ?? {};
  const changes: { key: string; oldVal: string; newVal: string }[] = [];

  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of allKeys) {
    const bVal = b[key];
    const aVal = a[key];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changes.push({
        key: humanizeKey(key),
        oldVal: formatDisplayValueForKey(key, bVal, roomNumberById),
        newVal: formatDisplayValueForKey(key, aVal, roomNumberById),
      });
    }
  }
  return changes;
}

function formatTime(isoString: string) {
  const d = new Date(isoString);
  const dateStr = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
  const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
  return { dateStr, timeStr };
}

interface ReservationHistoryModalProps {
  reservationId: string;
  onClose: () => void;
}

export function ReservationHistoryModal({ reservationId, onClose }: ReservationHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ReservationHistoryRow[]>([]);
  const [roomNumberById, setRoomNumberById] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const loadHistory = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/audit/entity/reservation/${encodeURIComponent(reservationId)}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ReservationHistoryApiResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || `Failed to load history (${response.status})`);
        }
        const rows = Array.isArray(payload.history) ? payload.history : [];
        setHistory(rows);

        const roomIds = collectRoomIds(rows);
        if (roomIds.length === 0) {
          setRoomNumberById({});
          return;
        }

        const supabase = createBrowserSupabaseClient();
        const { data: roomRows, error: roomError } = await supabase
          .from("rooms")
          .select("id, room_number")
          .in("id", roomIds);

        if (roomError) {
          console.error("reservation history room lookup failed", roomError);
          setRoomNumberById({});
          return;
        }

        const nextMap: Record<string, string> = {};
        for (const row of roomRows ?? []) {
          const id = String((row as any).id ?? "");
          const roomNumber = String((row as any).room_number ?? "").trim();
          if (id && roomNumber) {
            nextMap[id] = roomNumber;
          }
        }
        setRoomNumberById(nextMap);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setHistory([]);
        setRoomNumberById({});
        setError(err instanceof Error ? err.message : "Failed to load reservation history.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    return () => controller.abort();
  }, [reservationId]);

  return (
    <PmsModal title="Reservation History" size="xl" onClose={onClose}>
      <div className="p-4 bg-[var(--bg-body)] min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-[var(--text-muted)] animate-pulse">Loading timeline...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-rose-600 text-sm">{error}</div>
        ) : history.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[var(--text-muted)] italic">No history records found.</div>
        ) : (
          <div className="relative border-l-2 border-[var(--border-default)] ml-4 pl-6 pb-4 space-y-8">
            {history.map((record) => {
              const { dateStr, timeStr } = formatTime(record.created_at);
              const sourceKey = record.source as keyof typeof SOURCE_BADGE;
              const sourceBadge = SOURCE_BADGE[sourceKey] || SOURCE_BADGE.manual;
              const diffs = formatDiff(record.before_json, record.after_json, roomNumberById);

              return (
                <div key={record.id} className="relative">
                  <div className="absolute -left-[33px] top-1.5 w-4 h-4 rounded-full bg-[var(--bg-surface)] border-2 border-brand-500 shadow-sm"></div>

                  <div className="card p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-[var(--text-primary)]" title={humanizeAction(record.action)}>
                            {humanizeAction(record.action)}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${sourceBadge.lightClass} ${sourceBadge.darkClass}`}
                          >
                            {sourceBadge.label}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)]">
                          By <span className="font-semibold">{record.actor_name || "System"}</span> on {dateStr} at {timeStr}
                        </p>
                      </div>
                    </div>

                    {record.note && (
                      <div
                        className="mb-3 p-2 rounded bg-amber-50 border border-amber-100 dark:bg-amber-900/10 dark:border-amber-900/30 text-sm text-[var(--text-secondary)]"
                        title={record.note}
                      >
                        <span className="font-semibold text-amber-700 dark:text-amber-500 mr-2">Note:</span>
                        {record.note}
                      </div>
                    )}

                    {diffs.length > 0 && (
                      <div className="bg-[var(--bg-muted)] border border-[var(--border-subtle)] rounded-md p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Changes</p>
                        <div className="space-y-1.5">
                          {diffs.map((change, i) => (
                            <div key={`${record.id}-diff-${i}`} className="flex flex-col sm:flex-row sm:items-center text-xs">
                              <span className="font-semibold text-[var(--text-secondary)] w-32 flex-shrink-0">{change.key}</span>
                              <div className="flex items-center flex-1 font-mono min-w-0">
                                <span
                                  className="bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 px-1 rounded line-through opacity-80 max-w-[250px] sm:max-w-[320px] truncate"
                                  title={change.oldVal}
                                >
                                  {change.oldVal}
                                </span>
                                <svg className="w-3 h-3 mx-1.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                                <span
                                  className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 px-1 rounded font-bold max-w-[250px] sm:max-w-[320px] truncate"
                                  title={change.newVal}
                                >
                                  {change.newVal}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PmsModal>
  );
}
