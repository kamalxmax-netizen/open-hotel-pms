export type ApiBoardRoomStatus = "available" | "reserved" | "dirty" | "cleaning" | "approved" | "closed" | "ooo" | "oos";
export type ApiBoardDiaryState = "available" | "due_in" | "inhouse" | "back_to_back" | "due_out";
export type ApiBoardHousekeepingStatus = "dirty" | "in_progress" | "paused" | "cleaned" | "approved";
export type ApiBoardAlertSeverity = "info" | "warning" | "critical";

export type ApiBoardRoom = {
  room_id: string;
  room_number: string;
  room_type: string;
  sellable: boolean;
  closure_reason?: string | null;
  status: ApiBoardRoomStatus;
  reservation_id?: string | null;
  reservation_status?: string | null;
  wing?: string | null;
  guest_name?: string | null;
  booking_code?: string | null;
  specials?: string | null;
  special_request?: string | null;
  booking_group_id?: string | null;
  parent_reservation_id?: string | null;
  linked_root_id?: string | null;
  linked_full_checkin?: string | null;
  linked_full_checkout?: string | null;
  linked_full_nights?: number | null;
  linked_combined_total?: number | null;
  linked_active_segment_id?: string | null;
  group_code?: string | null;
  group_name?: string | null;
  guest_checkin_date?: string | null;
  guest_checkout_date?: string | null;
  source?: string | null;
  due_in_guest_name?: string | null;
  due_in_booking_code?: string | null;
  due_in_checkin_date?: string | null;
  due_in_checkout_date?: string | null;
  due_in_source?: string | null;
  due_in_reservation_id?: string | null;
  diary_state?: ApiBoardDiaryState | null;
  room_move_from?: string | null;
  room_move_reason?: string | null;
  room_move_date?: string | null;
  guest_profile_id?: string | null;
  vip_tier?: string | null;
  stay_count?: number;
  night_count?: number;
  main_stay_count?: number;
  main_night_count?: number;
  accompanying_stay_count?: number;
  accompanying_night_count?: number;
  possible_return_count?: number;
  possible_return_profile_id?: string | null;
  possible_return_name?: string | null;
  hk_status?: ApiBoardHousekeepingStatus | null;
  hk_task_seq?: number | null;
  hk_assigned_maid?: string | null;
  hk_started_at?: string | null;
  hk_finished_at?: string | null;
  hk_approved_at?: string | null;
  hk_is_no_service?: boolean;
  hk_no_service_note?: string | null;
  transfer_pickup_at?: string | null;
  transfer_type_icon?: string | null;
  transfer_status?: string | null;
  transfer_id?: string | null;
  transfer_guest_note?: string | null;
  transfer_alert_enabled?: boolean | null;
  transfer_alert_lead_min?: number | null;
  alert_count?: number;
  first_alert_message?: string | null;
  alert_severity?: ApiBoardAlertSeverity | null;
  is_dayuse?: boolean;
};

export type ApiBoardData = {
  success?: boolean;
  date: string;
  counts: Partial<Record<ApiBoardRoomStatus, number>>;
  rooms: ApiBoardRoom[];
  _timing?: Record<string, number>;
};

export type LiveBoardSegmentState =
  | "inhouse"
  | "due_in"
  | "due_out"
  | "dirty"
  | "cleaning"
  | "closed"
  | "ooo"
  | "oos";

export type LiveBoardKpiItem = {
  key: "occupancy" | "arrivals" | "departures" | "housekeeping" | "revpar";
  label: string;
  value: string;
  sublabel: string;
  progress?: number;
};

export type LiveBoardTimelineSegment = {
  startHour: number;
  endHour: number;
  state: LiveBoardSegmentState;
  label: string;
  code?: string;
  reservationId?: string;
  flags: {
    vip: boolean;
    linked: boolean;
    alert: boolean;
  };
  meta: {
    source: "api" | "derived";
    guestName?: string;
    roomStatus?: ApiBoardRoomStatus;
    diaryState?: ApiBoardDiaryState | null;
    housekeepingStatus?: ApiBoardHousekeepingStatus | null;
    alertSeverity?: ApiBoardAlertSeverity | null;
    closureReason?: string | null;
  };
};

export type LiveBoardRoom = {
  roomId: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  wing: string | null;
  sellable: boolean;
  status: ApiBoardRoomStatus;
  diaryState: ApiBoardDiaryState | null;
  stayLabel: string;
  summaryRate: string;
  segments: LiveBoardTimelineSegment[];
  flags: {
    vip: boolean;
    linked: boolean;
    alert: boolean;
    housekeeping: boolean;
    blocked: boolean;
  };
  raw: ApiBoardRoom;
};

export type LiveBoardFloor = {
  floor: number;
  label: string;
  roomCount: number;
};

export type LiveBoardModel = {
  date: string;
  rooms: LiveBoardRoom[];
  kpis: LiveBoardKpiItem[];
  floors: LiveBoardFloor[];
  counts: Partial<Record<ApiBoardRoomStatus, number>>;
  sourceTiming?: Record<string, number>;
};

const DASH = "—";
const CHECKOUT_HOUR = 12;
const CHECKIN_HOUR = 14;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function countRooms(rooms: ApiBoardRoom[], predicate: (room: ApiBoardRoom) => boolean): number {
  return rooms.reduce((total, room) => total + (predicate(room) ? 1 : 0), 0);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function countNights(checkin: string | null | undefined, checkout: string | null | undefined): number | null {
  if (!hasText(checkin) || !hasText(checkout)) return null;
  const start = Date.parse(`${checkin}T00:00:00`);
  const end = Date.parse(`${checkout}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 86400000);
}

function guestShortName(name: string | null | undefined): string | null {
  if (!hasText(name)) return null;
  return name.trim().split(/\s+/)[0] ?? null;
}

export function deriveLiveBoardFloor(roomNumber: string): number {
  const match = roomNumber.trim().match(/^(\d)/);
  if (!match) return 0;
  const floor = Number(match[1]);
  return Number.isFinite(floor) ? floor : 0;
}

export function formatLiveBoardMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return DASH;
  return `฿${Math.round(value).toLocaleString("th-TH")}`;
}

function deriveFlags(room: ApiBoardRoom): LiveBoardRoom["flags"] {
  const linked = Boolean(room.linked_root_id || room.booking_group_id || room.parent_reservation_id);
  const alert = (room.alert_count ?? 0) > 0;
  const housekeeping = room.hk_status === "dirty" || room.hk_status === "in_progress" || room.hk_status === "paused";
  const blocked = room.status === "closed" || room.status === "ooo" || room.status === "oos";

  return {
    vip: hasText(room.vip_tier),
    linked,
    alert,
    housekeeping,
    blocked,
  };
}

function deriveStayLabel(room: ApiBoardRoom): string {
  if (room.status === "closed" || room.status === "ooo" || room.status === "oos") {
    return room.closure_reason?.trim() || "Blocked";
  }

  if (room.diary_state === "back_to_back") return "Back-to-back";
  if (room.diary_state === "due_out") return "Checkout";
  if (room.diary_state === "due_in") {
    const nights = countNights(room.due_in_checkin_date, room.due_in_checkout_date);
    return nights ? `Due in · ${nights}N` : "Due in";
  }
  if (room.diary_state === "inhouse") {
    const nights = room.linked_full_nights ?? countNights(room.guest_checkin_date, room.guest_checkout_date);
    const name = guestShortName(room.guest_name);
    if (nights && name) return `${nights}N · ${name}`;
    if (name) return `In-house · ${name}`;
    return "In-house";
  }

  if (room.hk_status === "dirty") return "Dirty";
  if (room.hk_status === "in_progress" || room.hk_status === "paused") return "Cleaning";
  if (room.hk_status === "cleaned" || room.hk_status === "approved") return "Ready";
  return "Available";
}

function makeSegment(
  room: ApiBoardRoom,
  state: LiveBoardSegmentState,
  startHour: number,
  endHour: number,
  label: string,
  options: {
    code?: string | null;
    reservationId?: string | null;
    guestName?: string | null;
  } = {}
): LiveBoardTimelineSegment {
  const roomFlags = deriveFlags(room);
  return {
    startHour,
    endHour,
    state,
    label,
    code: options.code ?? undefined,
    reservationId: options.reservationId ?? undefined,
    flags: {
      vip: roomFlags.vip,
      linked: roomFlags.linked,
      alert: roomFlags.alert,
    },
    meta: {
      source: "derived",
      guestName: options.guestName ?? undefined,
      roomStatus: room.status,
      diaryState: room.diary_state ?? null,
      housekeepingStatus: room.hk_status ?? null,
      alertSeverity: room.alert_severity ?? null,
      closureReason: room.closure_reason ?? null,
    },
  };
}

function housekeepingSegmentState(room: ApiBoardRoom): "dirty" | "cleaning" | null {
  if (room.hk_status === "dirty") return "dirty";
  if (room.hk_status === "in_progress" || room.hk_status === "paused") return "cleaning";
  return null;
}

function housekeepingLabel(room: ApiBoardRoom): string {
  if (room.hk_status === "in_progress") return room.hk_assigned_maid ? `Cleaning · ${room.hk_assigned_maid}` : "Cleaning";
  if (room.hk_status === "paused") return "Cleaning paused";
  if (room.hk_status === "dirty") return "To be cleaned";
  return "Turnover";
}

function deriveTimelineSegments(room: ApiBoardRoom): LiveBoardTimelineSegment[] {
  if (room.status === "closed" || room.status === "ooo" || room.status === "oos") {
    return [
      makeSegment(
        room,
        room.status,
        0,
        24,
        room.closure_reason?.trim() || (room.status === "closed" ? "Closed" : room.status.toUpperCase())
      ),
    ];
  }

  const hkState = housekeepingSegmentState(room);
  const currentGuestLabel = room.guest_name?.trim() || "Current guest";
  const dueInGuestLabel = room.due_in_guest_name?.trim() || "Arrival";

  switch (room.diary_state) {
    case "inhouse":
      return [makeSegment(room, "inhouse", 0, 24, currentGuestLabel, {
        code: room.booking_code,
        reservationId: room.reservation_id,
        guestName: room.guest_name,
      })];
    case "due_in":
      return [makeSegment(room, "due_in", CHECKIN_HOUR, 24, dueInGuestLabel, {
        code: room.due_in_booking_code,
        reservationId: room.due_in_reservation_id,
        guestName: room.due_in_guest_name,
      })];
    case "due_out":
      return [makeSegment(room, "due_out", 0, CHECKOUT_HOUR, currentGuestLabel, {
        code: room.booking_code,
        reservationId: room.reservation_id,
        guestName: room.guest_name,
      })];
    case "back_to_back": {
      const turnoverState = hkState ?? "dirty";
      return [
        makeSegment(room, "due_out", 0, CHECKOUT_HOUR, currentGuestLabel, {
          code: room.booking_code,
          reservationId: room.reservation_id,
          guestName: room.guest_name,
        }),
        makeSegment(room, turnoverState, CHECKOUT_HOUR, CHECKIN_HOUR, housekeepingLabel(room)),
        makeSegment(room, "due_in", CHECKIN_HOUR, 24, dueInGuestLabel, {
          code: room.due_in_booking_code,
          reservationId: room.due_in_reservation_id,
          guestName: room.due_in_guest_name,
        }),
      ];
    }
    default:
      if (hkState) {
        return [makeSegment(room, hkState, CHECKOUT_HOUR, CHECKIN_HOUR, housekeepingLabel(room))];
      }
      return [];
  }
}

function buildKpis(data: ApiBoardData): LiveBoardKpiItem[] {
  const sellableRooms = data.rooms.filter((room) => room.sellable);
  const sellableCount = sellableRooms.length;
  const occupiedCount = countRooms(
    sellableRooms,
    (room) => room.diary_state === "inhouse" || room.diary_state === "due_out" || room.diary_state === "back_to_back"
  );
  const arrivals = countRooms(sellableRooms, (room) => room.diary_state === "due_in" || room.diary_state === "back_to_back");
  const departures = countRooms(sellableRooms, (room) => room.diary_state === "due_out" || room.diary_state === "back_to_back");
  const housekeepingQueued = countRooms(
    sellableRooms,
    (room) => room.hk_status === "dirty" || room.hk_status === "in_progress" || room.hk_status === "paused"
  );
  const cleaningActive = countRooms(sellableRooms, (room) => room.hk_status === "in_progress" || room.hk_status === "paused");
  const occupancyPercent = sellableCount > 0 ? (occupiedCount / sellableCount) * 100 : 0;

  return [
    {
      key: "occupancy",
      label: "Occupancy",
      value: `${clampPercent(occupancyPercent)}%`,
      sublabel: `${occupiedCount} of ${sellableCount} sellable rooms`,
      progress: clampPercent(occupancyPercent),
    },
    {
      key: "arrivals",
      label: "Arrivals today",
      value: String(arrivals),
      sublabel: arrivals === 1 ? "1 room due in" : `${arrivals} rooms due in`,
    },
    {
      key: "departures",
      label: "Departures",
      value: String(departures),
      sublabel: departures === 1 ? "1 room due out" : `${departures} rooms due out`,
    },
    {
      key: "housekeeping",
      label: "Housekeeping",
      value: `${housekeepingQueued} queued`,
      sublabel: `${cleaningActive} active cleaning`,
    },
    {
      key: "revpar",
      label: "RevPAR",
      value: DASH,
      sublabel: "Revenue data pending",
    },
  ];
}

function buildFloors(rooms: LiveBoardRoom[]): LiveBoardFloor[] {
  const counts = new Map<number, number>();
  for (const room of rooms) {
    counts.set(room.floor, (counts.get(room.floor) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => right - left)
    .map(([floor, roomCount]) => ({
      floor,
      label: floor > 0 ? `Floor ${floor}` : "Other",
      roomCount,
    }));
}

export function adaptBoardDataToLiveBoard(data: ApiBoardData): LiveBoardModel {
  const rooms = data.rooms.map((room): LiveBoardRoom => {
    const flags = deriveFlags(room);
    return {
      roomId: room.room_id,
      roomNumber: room.room_number,
      roomType: room.room_type,
      floor: deriveLiveBoardFloor(room.room_number),
      wing: room.wing ?? null,
      sellable: room.sellable,
      status: room.status,
      diaryState: room.diary_state ?? null,
      stayLabel: deriveStayLabel(room),
      summaryRate: formatLiveBoardMoney(room.linked_combined_total),
      segments: deriveTimelineSegments(room),
      flags,
      raw: room,
    };
  });

  return {
    date: data.date,
    rooms,
    kpis: buildKpis(data),
    floors: buildFloors(rooms),
    counts: { ...data.counts },
    sourceTiming: data._timing ? { ...data._timing } : undefined,
  };
}
