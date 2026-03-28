"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, AlertCircle } from "lucide-react";

interface Room {
  reservation_id: string;
  room_number: string;
  guest_name: string;
  source: string;
  nights: number;
  total_price: number;
  status: string;
}

export default function SelectRoom() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [forceDraft, setForceDraft] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRooms = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkin/due-today");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load due-in list.");
      }
      setRooms(json.data.rooms || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load due-in list.";
      setError(message);
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setScanId(params.get("scan_id"));
    setForceDraft(params.get("force_draft") === "true");
  }, []);

  // Sort by room number, treating them as numbers when possible.
  const sortedRooms = [...rooms]
    .filter((r) => r.status === "confirmed" || r.status === "draft_checkin")
    .sort((a, b) => {
      const numA = parseInt(a.room_number) || 0;
      const numB = parseInt(b.room_number) || 0;
      return numA - numB;
    });

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link 
            href="/pms/mobile-checkin/method"
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-xl font-bold tracking-tight">Select Room</h1>
        </div>
        <button 
          onClick={fetchRooms} 
          disabled={loading}
          className="p-3 -mr-3 rounded-full hover:bg-[var(--bg-surface-hover)] transition text-[var(--text-muted)] hover:text-brand-500 disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="px-6 py-3 bg-[var(--bg-muted)] border-b border-[var(--border-default)]">
        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
          DUE-IN TODAY ({sortedRooms.length})
        </p>
      </div>

      <main className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-4 text-sm font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl m-4">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-12">
             <span className="w-8 h-8 border-4 border-[var(--border-default)] border-t-brand-500 rounded-full animate-spin"></span>
          </div>
        ) : sortedRooms.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-muted)] font-medium">
            No rooms arriving today.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-default)]">
            {sortedRooms.map((room) => {
              const isDraft = room.status === "draft_checkin";
              const nextParams = new URLSearchParams();
              if (scanId) nextParams.set("scan_id", scanId);
              if (forceDraft || isDraft) nextParams.set("draft", "true");
              if (forceDraft) nextParams.set("force_draft", "true");
              const qs = nextParams.toString();
              
              return (
                <Link 
                  key={room.reservation_id}
                  href={`/pms/mobile-checkin/guest-info/${room.reservation_id}${qs ? `?${qs}` : ""}`}
                  className="block p-4 active:bg-[var(--bg-surface-hover)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">
                        Room {room.room_number}
                        {isDraft && (
                          <span className="ml-2 inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-500 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider align-middle">
                            <AlertCircle className="w-3 h-3" /> Draft
                          </span>
                        )}
                      </h2>
                      <p className="text-sm font-semibold capitalize text-[var(--text-muted)]">
                        {room.source.replace("_", " ")} · ฿{room.total_price.toLocaleString()}
                      </p>
                    </div>
                    
                    <div className="text-right">
                      <p className="font-bold text-[var(--text-primary)] max-w-[140px] truncate">
                        {room.guest_name}
                      </p>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {room.nights} {room.nights > 1 ? "nights" : "night"}
                      </p>
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
