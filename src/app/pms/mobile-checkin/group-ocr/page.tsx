"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Users, ChevronRight, AlertTriangle, RefreshCw } from "lucide-react";
import { mockGroupOcrSessions } from "@/lib/mock/group-ocr";

interface GroupSession {
  booking_group_id: string;
  group_code: string;
  group_name: string;
  total_rooms: number;
  scanned_count: number;
  rooms: {
    reservation_id: string;
    room_number: string;
    guest_name: string;
  }[];
}

export default function GroupSelectorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<GroupSession[]>([]);

  const fetchGroups = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkin/group-ocr-sessions");
      if (!res.ok) throw new Error("Endpoint not ready");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch groups");
      setGroups(json.groups || []);
    } catch (err) {
      console.warn("API failed, using mock:", err);
      const mock = mockGroupOcrSessions();
      setGroups(mock.groups);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-body)]">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight">Select Group</h1>
          </div>
        </div>
        <button 
          onClick={fetchGroups} 
          disabled={loading}
          className="p-3 -mr-3 rounded-full hover:bg-[var(--bg-surface-hover)] transition text-[var(--text-muted)] hover:text-brand-500 disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
             <span className="w-8 h-8 border-4 border-[var(--border-default)] border-t-violet-500 rounded-full animate-spin"></span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 bg-[var(--bg-surface)] rounded-full flex items-center justify-center text-[var(--text-muted)] mb-4">
              <Users className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">ไม่มี Group ที่มีห้อง Due-in วันนี้</h3>
            <p className="text-sm font-medium text-[var(--text-secondary)] mt-1">
              Groups scheduled for check-in today will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const progressPct = g.total_rooms > 0 ? (g.scanned_count / g.total_rooms) * 100 : 0;
              const isComplete = g.scanned_count >= g.total_rooms;

              return (
                <Link 
                  key={g.booking_group_id} 
                  href={`/pms/mobile-checkin/group-ocr/${g.booking_group_id}`}
                  className="block"
                >
                  <div className="bg-[var(--bg-surface)] rounded-2xl p-5 border border-[var(--border-default)] shadow-sm active:scale-[0.98] transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-[var(--bg-body)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            {g.group_code}
                          </span>
                          {isComplete && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                              Ready
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-lg text-[var(--text-primary)] leading-tight">
                          {g.group_name}
                        </h3>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[var(--text-muted)] mt-1" />
                    </div>

                    <div className="mb-4">
                      <div className="flex justify-between text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                        <span>Scanned OCR Progress</span>
                        <span className={isComplete ? "text-emerald-600" : ""}>{g.scanned_count} / {g.total_rooms}</span>
                      </div>
                      <div className="h-2 bg-[var(--bg-body)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                        <div 
                          className={`h-full ${isComplete ? "bg-emerald-500" : "bg-violet-500"} transition-all`} 
                          style={{ width: `${Math.min(100, progressPct)}%` }} 
                        />
                      </div>
                    </div>

                    <div className="bg-[var(--bg-body)] rounded-xl p-3 border border-[var(--border-subtle)]">
                      <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-subtle)] pb-2 mb-2">
                        Due-In Rooms
                      </p>
                      <div className="flex flex-wrap gap-2 max-h-20 overflow-hidden">
                        {g.rooms.map((r) => (
                          <div key={r.reservation_id} className="text-xs font-medium bg-[var(--bg-surface)] px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                            <span className="font-bold text-[var(--text-primary)]">{r.room_number}</span> {r.guest_name ? `· ${r.guest_name.split(' ')[0]}` : ''}
                          </div>
                        ))}
                        {g.rooms.length > 5 && (
                          <div className="text-xs font-medium text-[var(--text-muted)] px-2 py-1">
                            +{g.rooms.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
