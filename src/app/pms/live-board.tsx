"use client";

import { useEffect, useMemo, useState } from "react";
import { getBoardLanes, type BoardLane, type BoardRoomItem, type BoardRoomStatus } from "@/lib/board-layout";
import { formatDateDisplay } from "@/lib/date-display";

const statusLegend: Array<{ label: string; status: BoardRoomStatus }> = [
  { label: "Available", status: "available" },
  { label: "Reserved", status: "reserved" },
  { label: "Dirty", status: "dirty" },
  { label: "Cleaning", status: "cleaning" },
  { label: "Approved", status: "approved" },
  { label: "Closed / Not For Sale", status: "closed" }
];

const MAX_COLS = 12;

const statusStyle: Record<
  BoardRoomStatus,
  { chip: string; card: string; border: string; label: string; text: string }
> = {
  available: {
    chip: "bg-state-available/15 text-emerald-700",
    card: "from-emerald-50 to-white",
    border: "border-emerald-200",
    label: "Available",
    text: "text-emerald-700"
  },
  reserved: {
    chip: "bg-state-reserved/20 text-amber-700",
    card: "from-amber-50 to-white",
    border: "border-amber-200",
    label: "Reserved",
    text: "text-amber-700"
  },
  dirty: {
    chip: "bg-state-dirty/15 text-rose-700",
    card: "from-rose-50 to-white",
    border: "border-rose-200",
    label: "Dirty",
    text: "text-rose-700"
  },
  cleaning: {
    chip: "bg-state-cleaning/15 text-blue-700",
    card: "from-blue-50 to-white",
    border: "border-blue-200",
    label: "Cleaning",
    text: "text-blue-700"
  },
  approved: {
    chip: "bg-state-approved/15 text-green-700",
    card: "from-green-50 to-white",
    border: "border-green-200",
    label: "Approved",
    text: "text-green-700"
  },
  closed: {
    chip: "bg-state-closed/20 text-[var(--text-secondary)]",
    card: "from-rose-100 to-rose-50",
    border: "border-rose-300",
    label: "Closed",
    text: "text-rose-700"
  }
};

type LiveBoardRoom = {
  room_number: string;
  room_type: string;
  sellable: boolean;
  closure_reason: string | null;
  status: BoardRoomStatus;
};

type LiveBoardResponse = {
  success: true;
  date: string;
  counts: Record<BoardRoomStatus, number>;
  rooms: LiveBoardRoom[];
};

type ReservationDetailNight = {
  stay_date: string;
  nightly_price: number;
};

type ReservationDetail = {
  id: string;
  booking_code: string;
  guest_name: string;
  phone?: string | null;
  source: string;
  status: string;
  checkin_date: string;
  checkout_date: string;
  checkin_time?: string | null;
  note?: string | null;
  total_price: number;
  total_nights: number;
  room_number: string;
  nights: ReservationDetailNight[];
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function LegendDot({ status }: { status: BoardRoomStatus }) {
  const colorClass =
    status === "available"
      ? "bg-state-available"
      : status === "reserved"
        ? "bg-state-reserved"
        : status === "dirty"
          ? "bg-state-dirty"
          : status === "cleaning"
            ? "bg-state-cleaning"
            : status === "approved"
              ? "bg-state-approved"
              : "bg-state-closed";
  return <span className={`mr-2 inline-block size-2.5 rounded-full ${colorClass}`} />;
}

function RoomCard({
  room,
  liveRoom,
  isSelected,
  onClick
}: {
  room: BoardRoomItem;
  liveRoom?: LiveBoardRoom;
  isSelected: boolean;
  onClick: () => void;
}) {
  const status: BoardRoomStatus = liveRoom?.status ?? (room.sellable ? "available" : "closed");
  const roomType = liveRoom?.room_type ?? room.roomType;
  const sellable = liveRoom?.sellable ?? room.sellable;
  const note = liveRoom?.closure_reason ?? room.note;
  const style = statusStyle[status];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-[102px] w-full rounded-xl border bg-gradient-to-br p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${style.border} ${style.card} ${isSelected ? "ring-2 ring-brand-400" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className={`text-[28px] font-extrabold leading-none tracking-tight ${style.text}`}>{room.roomNumber}</h3>
        <span className={`badge ${style.chip}`}>{style.label}</span>
      </div>
      <p className="mt-1.5 truncate text-[11px] font-semibold text-[var(--text-secondary)]">{roomType}</p>
      {!sellable && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="rounded-md bg-rose-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Not For Sale
          </span>
          {note ? <span className="truncate text-[10px] text-[var(--text-secondary)]">{note}</span> : null}
        </div>
      )}
    </button>
  );
}

function LaneBoard({
  lane,
  liveByRoom,
  selectedRoomNumber,
  onRoomClick
}: {
  lane: BoardLane;
  liveByRoom: Map<string, LiveBoardRoom>;
  selectedRoomNumber: string | null;
  onRoomClick: (roomNumber: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-table-cell)]">{lane.floorLabel}</p>
        <p className="text-xs text-[var(--text-secondary)]">{lane.laneLabel}</p>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${MAX_COLS}, minmax(82px, 1fr))` }}>
        {lane.rooms.map((room) => (
          <RoomCard
            key={`${lane.id}-${room.roomNumber}`}
            room={room}
            liveRoom={liveByRoom.get(room.roomNumber)}
            isSelected={selectedRoomNumber === room.roomNumber}
            onClick={() => onRoomClick(room.roomNumber)}
          />
        ))}
      </div>

      {lane.showCorridorBelow ? (
        <div className="rounded-lg border border-slate-400/60 bg-[var(--bg-muted)] py-4 text-center text-xs font-semibold uppercase tracking-wider text-[var(--text-table-cell)]">
          Corridor
        </div>
      ) : null}
    </div>
  );
}

function FloorGap() {
  return (
    <div className="my-5 border-t-2 border-red-500/70 pt-4">
      <div className="rounded-md border border-slate-400/60 bg-[var(--bg-muted)] py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-table-cell)]">
        Floor Separation
      </div>
    </div>
  );
}

export default function LiveBoard({ refreshToken }: { refreshToken: number }) {
  const [selectedDate, setSelectedDate] = useState<string>(todayYmd());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [payload, setPayload] = useState<LiveBoardResponse | null>(null);
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string>("");
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const isModalOpen = selectedRoomNumber !== null;

  const lanes = getBoardLanes();
  const floor2 = lanes.filter((lane) => lane.floorLabel === "Floor 2");
  const floor3 = lanes.filter((lane) => lane.floorLabel === "Floor 3");
  const floor1 = lanes.filter((lane) => lane.floorLabel === "Floor 1");
  const roomsFromLayout = lanes.flatMap((lane) => lane.rooms);

  const liveByRoom = useMemo(() => {
    const map = new Map<string, LiveBoardRoom>();
    (payload?.rooms ?? []).forEach((item) => map.set(item.room_number, item));
    return map;
  }, [payload]);

  const counts = payload?.counts ?? {
    available: roomsFromLayout.filter((room) => room.sellable).length,
    reserved: 0,
    dirty: 0,
    cleaning: 0,
    approved: 0,
    closed: roomsFromLayout.filter((room) => !room.sellable).length
  };

  async function loadBoard(date: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ date }).toString();
      const response = await fetch(`/api/board?${query}`, { method: "GET", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as LiveBoardResponse | { error?: string } | null;

      if (!response.ok || !data || !("success" in data)) {
        const message =
          data && "error" in data && typeof data.error === "string" ? data.error : "Cannot load board data.";
        setError(message);
        return;
      }
      setPayload(data);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoomClick(roomNumber: string) {
    setSelectedRoomNumber(roomNumber);
    setDetailLoading(true);
    setDetailError("");
    setDetail(null);

    try {
      const query = new URLSearchParams({ room_number: roomNumber, date: selectedDate }).toString();
      const response = await fetch(`/api/bookings?${query}`, { method: "GET", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | { reservation?: ReservationDetail; error?: string }
        | null;

      if (!response.ok || !data || !data.reservation) {
        const message =
          response.status === 404
            ? `No active booking for room ${roomNumber} on ${selectedDate}.`
            : data?.error || "Cannot load reservation detail.";
        setDetailError(message);
        return;
      }

      setDetail(data.reservation);
    } catch (requestError) {
      setDetailError((requestError as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetailModal() {
    setSelectedRoomNumber(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
  }

  useEffect(() => {
    void loadBoard(selectedDate);
  }, [selectedDate, refreshToken]);

  useEffect(() => {
    closeDetailModal();
  }, [selectedDate]);

  useEffect(() => {
    if (!isModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDetailModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isModalOpen]);

  return (
    <section className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Main Board</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Room Plan (Sheet-style Card Board)</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Live board from database. Select a stay date to see booking/housekeeping status on each room card.
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Tip: click a room card to load guest detail for the selected date.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Board Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
            />
            <button
              type="button"
              onClick={() => void loadBoard(selectedDate)}
              disabled={loading}
              className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-medium text-[var(--text-table-cell)] transition hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <div>Total rooms on board: {roomsFromLayout.length}</div>
          <div>Sellable: {counts.available + counts.reserved + counts.dirty + counts.cleaning + counts.approved}</div>
          <div>Closed: {counts.closed}</div>
          <div>Date: {payload?.date ?? selectedDate}</div>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-table-cell)]">Status Legend</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {statusLegend.map((item) => (
            <span key={item.label} className="badge bg-[var(--bg-muted)] text-[var(--text-table-cell)]">
              <LegendDot status={item.status} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Building Plan Board</h2>
          <p className="text-xs text-[var(--text-secondary)]">Floor order: 2 → 3 → 1</p>
        </div>

        <div className="min-w-[1200px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface-hover)]/60 p-4">
          <div className="space-y-4">
            {floor2.map((lane) => (
              <LaneBoard
                key={lane.id}
                lane={lane}
                liveByRoom={liveByRoom}
                selectedRoomNumber={selectedRoomNumber}
                onRoomClick={handleRoomClick}
              />
            ))}

            <FloorGap />

            {floor3.map((lane) => (
              <LaneBoard
                key={lane.id}
                lane={lane}
                liveByRoom={liveByRoom}
                selectedRoomNumber={selectedRoomNumber}
                onRoomClick={handleRoomClick}
              />
            ))}

            <FloorGap />

            {floor1.map((lane) => (
              <LaneBoard
                key={lane.id}
                lane={lane}
                liveByRoom={liveByRoom}
                selectedRoomNumber={selectedRoomNumber}
                onRoomClick={handleRoomClick}
              />
            ))}
          </div>
        </div>
      </div>

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-overlay-bg)] p-4"
          onClick={closeDetailModal}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Reservation Detail</h2>
              <div className="flex items-center gap-2">
                <p className="text-xs text-[var(--text-secondary)]">Room {selectedRoomNumber}</p>
                <button
                  type="button"
                  onClick={closeDetailModal}
                  className="rounded-lg border border-[var(--border-input)] px-2.5 py-1 text-xs font-semibold text-[var(--text-table-cell)] transition hover:bg-[var(--bg-surface-hover)]"
                >
                  Close
                </button>
              </div>
            </div>

            {detailLoading ? <p className="text-sm text-[var(--text-secondary)]">Loading reservation detail...</p> : null}
            {!detailLoading && detailError ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</p>
            ) : null}
            {!detailLoading && !detailError && !detail ? (
              <p className="text-sm text-[var(--text-secondary)]">No detail for this room/date.</p>
            ) : null}

            {!detailLoading && detail ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-sm text-[var(--text-table-cell)]">
                  <div><span className="font-semibold">Booking Code:</span> {detail.booking_code}</div>
                  <div><span className="font-semibold">Guest Name:</span> {detail.guest_name}</div>
                  <div><span className="font-semibold">Phone:</span> {detail.phone || "-"}</div>
                  <div><span className="font-semibold">Source:</span> {detail.source.toUpperCase()}</div>
                  <div><span className="font-semibold">Status:</span> {detail.status}</div>
                </div>
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-sm text-[var(--text-table-cell)]">
                  <div><span className="font-semibold">Room:</span> {detail.room_number}</div>
                  <div><span className="font-semibold">Check-in:</span> {formatDateDisplay(detail.checkin_date)}</div>
                  <div><span className="font-semibold">Check-out:</span> {formatDateDisplay(detail.checkout_date)}</div>
                  <div><span className="font-semibold">Nights:</span> {detail.total_nights}</div>
                  <div><span className="font-semibold">Total Price:</span> {Number(detail.total_price).toLocaleString()}</div>
                  <div><span className="font-semibold">Note:</span> {detail.note || "-"}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
