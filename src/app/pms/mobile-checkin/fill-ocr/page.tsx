"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Upload, Users, UserCheck } from "lucide-react";

interface RoomItem {
  reservation_id: string;
  room_number: string | null;
  guest_name: string;
  source: string;
  status: string;
  is_inhouse: boolean;
}

export default function FillOcrRoomSelect() {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRooms = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkin/due-today?include_inhouse=1");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load rooms.");
      }

      const dueIn = (json.data.rooms ?? []).map((r: any) => ({
        ...r,
        is_inhouse: false,
      }));
      const inHouse = (json.data.inhouse ?? []).map((r: any) => ({
        ...r,
        is_inhouse: true,
      }));

      setRooms([...dueIn, ...inHouse]);
    } catch (err: any) {
      setError(err.message || "Failed to load rooms.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const dueInRooms = rooms.filter((r) => !r.is_inhouse);
  const inHouseRooms = rooms.filter((r) => r.is_inhouse);

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)]">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link
            href="/pms/mobile-checkin"
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Fill OCR</h1>
            <p className="text-xs font-semibold text-[var(--text-muted)]">
              Upload passport photo &rarr; auto-fill guest info
            </p>
          </div>
        </div>
        <button
          onClick={fetchRooms}
          disabled={loading}
          className="p-3 -mr-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
            <span className="w-8 h-8 border-4 border-[var(--border-default)] border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="py-16 text-center text-[var(--text-muted)]">
            <Upload className="w-12 h-12 mx-auto opacity-30 mb-4" />
            <p className="font-bold">No rooms available</p>
            <p className="text-sm mt-1">No due-in or in-house rooms for this business date.</p>
          </div>
        ) : (
          <>
            {/* Due-In Rooms */}
            {dueInRooms.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Due In ({dueInRooms.length})
                </h3>
                <div className="space-y-2">
                  {dueInRooms.map((room) => (
                    <Link
                      key={room.reservation_id}
                      href={`/pms/mobile-checkin/fill-ocr/${room.reservation_id}`}
                      className="block bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-4 hover:bg-[var(--bg-surface-hover)] active:scale-[0.99] transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-lg font-black text-[var(--text-primary)]">
                            {room.room_number ? `Room ${room.room_number}` : "Unassigned"}
                          </span>
                          <p className="text-sm font-medium text-[var(--text-secondary)] mt-0.5 truncate">
                            {room.guest_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                            Due In
                          </span>
                          <Upload className="w-4 h-4 text-[var(--text-muted)]" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* In-House Rooms */}
            {inHouseRooms.length > 0 && (
              <section>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3 flex items-center gap-2">
                  <UserCheck className="w-4 h-4" />
                  In House ({inHouseRooms.length})
                </h3>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-3">
                  Check-in แล้ว — เพิ่มได้แค่ Accompanying Guest
                </p>
                <div className="space-y-2">
                  {inHouseRooms.map((room) => (
                    <Link
                      key={room.reservation_id}
                      href={`/pms/mobile-checkin/fill-ocr/${room.reservation_id}?inhouse=1`}
                      className="block bg-[var(--bg-surface)] border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-4 hover:bg-[var(--bg-surface-hover)] active:scale-[0.99] transition"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-lg font-black text-[var(--text-primary)]">
                            {room.room_number ? `Room ${room.room_number}` : "Unassigned"}
                          </span>
                          <p className="text-sm font-medium text-[var(--text-secondary)] mt-0.5 truncate">
                            {room.guest_name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
                            In House
                          </span>
                          <Upload className="w-4 h-4 text-[var(--text-muted)]" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
