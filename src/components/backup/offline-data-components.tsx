"use client";

type SnapshotData = {
  generated_at: string;
  business_date?: string;
  date_range: { from: string; to: string };
  rooms: Array<any>;
  reservations: Array<any>;
  hk_status: Array<any>;
  arrivals?: Array<any>;
  in_house?: Array<any>;
  departures?: Array<any>;
  room_status?: Array<any>;
};

interface OfflineSectionProps {
  data: SnapshotData;
}

const moneyFormatter = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function getBusinessDate(data: SnapshotData): string {
  return String(data.business_date ?? data.generated_at.split("T")[0]);
}

function getArrivals(data: SnapshotData) {
  return Array.isArray(data.arrivals)
    ? data.arrivals
    : data.reservations.filter(
        (reservation) => reservation.status !== "no_show" && reservation.checkin_date === getBusinessDate(data)
      );
}

function getInHouse(data: SnapshotData) {
  return Array.isArray(data.in_house)
    ? data.in_house
    : data.reservations.filter(
        (reservation) =>
          reservation.status !== "no_show" &&
          reservation.checkin_date < getBusinessDate(data) &&
          reservation.checkout_date > getBusinessDate(data)
      );
}

function getDepartures(data: SnapshotData) {
  return Array.isArray(data.departures)
    ? data.departures
    : data.reservations.filter(
        (reservation) => reservation.status !== "no_show" && reservation.checkout_date === getBusinessDate(data)
      );
}

function formatMoney(value: unknown) {
  return `฿${moneyFormatter.format(Number(value ?? 0) || 0)}`;
}

function shouldHideRoomCard(room: any, hkStatus?: string | null) {
  if (room?.is_sellable === false) return true;
  const reason = String(room?.closure_reason ?? "").toLowerCase();
  const housekeeping = String(hkStatus ?? room?.housekeeping_status ?? "").toLowerCase();
  const roomType = String(room?.room_type ?? "").toLowerCase();
  return /block|reno|renovat|ปรับปรุง|ซ่อม/.test(reason) || housekeeping === "closed" || /closed room|close room/.test(roomType);
}

export function OfflineArrivals({ data }: OfflineSectionProps) {
  const arrivals = getArrivals(data);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Today's Arrivals ({arrivals.length})</h3>
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Guest</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {arrivals.map((reservation) => (
              <tr key={reservation.id}>
                <td className="font-bold">{reservation.room_number || "???"}</td>
                <td>{reservation.guest_name || "—"}</td>
                <td>{reservation.checkin_date}</td>
                <td>{reservation.checkout_date}</td>
                <td className="font-mono">{reservation.guest_phone || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OfflineInHouse({ data }: OfflineSectionProps) {
  const inHouse = getInHouse(data);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">In-House Guests ({inHouse.length})</h3>
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Guest</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {inHouse.map((reservation) => (
              <tr key={reservation.id}>
                <td className="font-bold">{reservation.room_number || "???"}</td>
                <td>{reservation.guest_name || "—"}</td>
                <td>{reservation.checkin_date}</td>
                <td>{reservation.checkout_date}</td>
                <td className="font-mono">{reservation.guest_phone || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OfflineDepartures({ data }: OfflineSectionProps) {
  const departures = getDepartures(data);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Today's Departures ({departures.length})</h3>
      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Guest</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {departures.map((reservation) => (
              <tr key={reservation.id}>
                <td className="font-bold">{reservation.room_number || "???"}</td>
                <td>{reservation.guest_name || "—"}</td>
                <td>{reservation.checkin_date}</td>
                <td>{reservation.checkout_date}</td>
                <td>{reservation.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OfflineRoomStatus({ data }: OfflineSectionProps) {
  const roomStatusRows = Array.isArray(data.room_status) ? data.room_status : [];
  const reservations = Array.isArray(data.reservations) ? data.reservations : [];
  const sourceRooms = roomStatusRows.length > 0 ? roomStatusRows : data.rooms;
  const visibleRooms = sourceRooms.filter((room: any) => {
    const hk = data.hk_status.find((row) => row.room_id === room.room_id || row.room_id === room.id);
    const hkStatus = room.housekeeping_status ?? hk?.status ?? null;
    return !shouldHideRoomCard(room, hkStatus);
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">Room Status Grid</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {visibleRooms.map((room: any) => {
          const hk = data.hk_status.find((row) => row.room_id === room.room_id || row.room_id === room.id);
          const matchedReservation = reservations.find(
            (reservation) =>
              reservation.room_number === room.room_number &&
              reservation.status !== "no_show" &&
              reservation.checkin_date <= getBusinessDate(data) &&
              reservation.checkout_date >= getBusinessDate(data)
          );
          const occupancy =
            room.occupancy_status ??
            (reservations.some(
              (reservation) => reservation.room_number === room.room_number && reservation.status !== "no_show"
            )
              ? "in_house"
              : "vacant");
          const isOccupied = occupancy !== "vacant";
          const guestName = room.guest_name ?? matchedReservation?.guest_name ?? null;
          const bookingCode = room.booking_code ?? matchedReservation?.booking_code ?? null;
          const totalPrice = Number(room.total_price ?? matchedReservation?.total_price ?? 0);
          const outstandingBalance = Number(room.outstanding_balance ?? matchedReservation?.outstanding_balance ?? 0);

          return (
            <div
              key={room.room_id ?? room.id}
              className="card flex flex-col gap-1 border-l-4 p-3"
              style={{ borderLeftColor: isOccupied ? "#f59e0b" : "#10b981" }}
            >
              <div className="flex items-start justify-between">
                <span className="text-lg font-bold">{room.room_number}</span>
                <span
                  className={`rounded px-1.5 text-[10px] font-bold ${
                    isOccupied ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {isOccupied ? occupancy.replace("_", " ").toUpperCase() : "VAC"}
                </span>
              </div>
              <div className="text-[10px] uppercase text-[var(--text-muted)]">{room.room_type}</div>
              {isOccupied ? (
                <>
                  <div className="mt-2 truncate text-xs font-semibold text-[var(--text-primary)]">{guestName || "Guest name unavailable"}</div>
                  <div className="text-[10px] text-[var(--text-secondary)]">{bookingCode || "No booking code"}</div>
                  <div className="mt-2 space-y-1 rounded-md bg-[var(--bg-surface-hover)]/60 p-2 text-[10px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text-muted)]">Total</span>
                      <span className="font-semibold text-[var(--text-primary)]">{formatMoney(totalPrice)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text-muted)]">Outstanding</span>
                      <span className={`font-semibold ${outstandingBalance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {formatMoney(outstandingBalance)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-[10px] text-[var(--text-muted)]">Available room</div>
              )}
              <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    hk?.status === "dirty"
                      ? "bg-rose-500"
                      : hk?.status === "cleaned" || hk?.status === "approved"
                        ? "bg-emerald-500"
                        : "bg-sky-500"
                  }`}
                />
                {(room.housekeeping_status || hk?.status || "unknown").toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
