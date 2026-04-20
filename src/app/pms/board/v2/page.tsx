"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  BarChart3,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Home,
  KeyRound,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import PmsCommandTopbar from "@/components/pms-command-topbar";
import {
  adaptBoardDataToLiveBoard,
  type ApiBoardData,
  type LiveBoardKpiItem,
  type LiveBoardModel,
  type LiveBoardRoom,
  type LiveBoardSegmentState,
  type LiveBoardTimelineSegment,
} from "@/lib/live-board-adapter";
import styles from "./live-board-v2.module.css";

type BoardFilter = "all" | "vip" | "alerts";
type DateViewOffset = -1 | 0 | 1;

type SidebarItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  count?: string;
};

type SidebarSection = {
  label: string;
  items: SidebarItem[];
};

type SelectedSegment = {
  roomNumber: string;
  segment: LiveBoardTimelineSegment;
} | null;

const stateCopy: Record<LiveBoardSegmentState, string> = {
  inhouse: "In-house",
  due_in: "Due in",
  due_out: "Due out",
  dirty: "Dirty",
  cleaning: "Cleaning",
  closed: "Closed",
  ooo: "OOO",
  oos: "OOS",
};

const filterCopy: Record<BoardFilter, string> = {
  all: "All floors",
  vip: "VIP",
  alerts: "Alerts",
};

const segmentClassByState: Record<LiveBoardSegmentState, string> = {
  inhouse: styles.segmentInhouse,
  due_in: styles.segmentDueIn,
  due_out: styles.segmentDueOut,
  dirty: styles.segmentDirty,
  cleaning: styles.segmentCleaning,
  closed: styles.segmentClosed,
  ooo: styles.segmentOoo,
  oos: styles.segmentOos,
};

const dateOptions: { label: string; offset: DateViewOffset }[] = [
  { label: "Yesterday", offset: -1 },
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
];

function shiftDateString(baseDate: string, offsetDays: number): string {
  const [y, m, d] = baseDate.split("-").map((part) => Number(part));
  if (!y || !m || !d) return baseDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

function formatBoardDate(date: string | null): string {
  if (!date) return "Loading business date";
  const parsed = new Date(`${date}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatBangkokTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function readBangkokHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour + minute / 60;
}

function formatHour(hour: number) {
  const fullHour = Math.floor(hour);
  const minutes = Math.round((hour - fullHour) * 60);
  return `${String(fullHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function segmentKey(roomNumber: string, segment: LiveBoardTimelineSegment): string {
  return [
    roomNumber,
    segment.state,
    segment.startHour,
    segment.endHour,
    segment.code ?? "",
    segment.label,
    segment.reservationId ?? "",
  ].join("|");
}

function roomMatchesFilter(room: LiveBoardRoom, filter: BoardFilter) {
  if (filter === "all") return true;
  if (filter === "vip") return room.flags.vip;
  return room.flags.alert || room.flags.housekeeping;
}

function roomMatchesSearch(room: LiveBoardRoom, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const raw = room.raw;
  const haystack = [
    room.roomNumber,
    room.roomType,
    room.wing,
    room.stayLabel,
    room.summaryRate,
    raw.guest_name,
    raw.booking_code,
    raw.due_in_guest_name,
    raw.due_in_booking_code,
    raw.source,
    raw.group_code,
    raw.group_name,
    ...room.segments.flatMap((segment) => [segment.label, segment.code]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function buildSidebarSections(model: LiveBoardModel | null): SidebarSection[] {
  const rooms = model?.rooms ?? [];
  const arrivals = rooms.filter((room) => room.diaryState === "due_in" || room.diaryState === "back_to_back").length;
  const departures = rooms.filter((room) => room.diaryState === "due_out" || room.diaryState === "back_to_back").length;
  const inHouse = rooms.filter((room) => room.diaryState === "inhouse").length;
  const housekeeping = rooms.filter((room) => room.flags.housekeeping).length;

  return [
    {
      label: "Operations",
      items: [
        { label: "Live Board v2", icon: Home, active: true, count: rooms.length ? String(rooms.length) : undefined },
        { label: "Room Planner", icon: CalendarDays },
        { label: "Arrivals", icon: ChevronRight, count: arrivals ? String(arrivals) : undefined },
        { label: "Departures", icon: ChevronLeft, count: departures ? String(departures) : undefined },
        { label: "In-House", icon: KeyRound, count: inHouse ? String(inHouse) : undefined },
      ],
    },
    {
      label: "Service",
      items: [
        { label: "Housekeeping", icon: Package, count: housekeeping ? String(housekeeping) : undefined },
        { label: "Maintenance", icon: Wrench },
        { label: "Transportation", icon: Car },
      ],
    },
    {
      label: "People",
      items: [
        { label: "Guests", icon: Users },
        { label: "Groups", icon: Users },
      ],
    },
    {
      label: "Revenue",
      items: [
        { label: "Rates & ARI", icon: BarChart3 },
        { label: "Reports", icon: FileText },
        { label: "Payments", icon: CreditCard },
      ],
    },
    {
      label: "System",
      items: [{ label: "Settings", icon: Settings }],
    },
  ];
}

function SidebarV2({ model }: { model: LiveBoardModel | null }) {
  const sections = buildSidebarSections(model);

  return (
    <aside className="relative flex min-h-screen w-60 flex-col overflow-hidden bg-[#173f36] text-white dark:bg-[#0b2823]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(135deg,rgba(255,255,255,0.8)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="relative z-10 flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#c28b3d] font-serif text-lg font-bold text-[#173f36] shadow">
          P
        </div>
        <div>
          <div className="font-serif text-base font-semibold leading-tight">OpenHotel</div>
          <div className="mt-1 text-[10px] font-semibold uppercase text-[#d9aa63]">Live PMS</div>
        </div>
      </div>

      <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase text-white/45">{section.label}</div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={!item.active}
                    className={`flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition ${
                      item.active
                        ? "border-[#d9aa63] bg-[#c28b3d]/15 text-white"
                        : "cursor-default border-transparent text-white/55"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${item.active ? "text-[#d9aa63]" : ""}`} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          item.active ? "bg-[#d9aa63] text-[#173f36]" : "bg-white/10 text-white/70"
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative z-10 flex items-center gap-3 border-t border-white/10 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#b7795d] text-xs font-semibold text-white">
          NA
        </div>
        <div className="min-w-0 text-xs leading-snug">
          <div className="font-semibold">Read-only</div>
          <div className="truncate text-white/55">Live board v2 preview</div>
        </div>
      </div>
    </aside>
  );
}

function ControlBar({
  activeFilter,
  boardDate,
  baseBusinessDate,
  dateOffset,
  loading,
  onDateOffsetChange,
  onFilterChange,
  onRefresh,
}: {
  activeFilter: BoardFilter;
  boardDate: string | null;
  baseBusinessDate: string | null;
  dateOffset: DateViewOffset;
  loading: boolean;
  onDateOffsetChange: (offset: DateViewOffset) => void;
  onFilterChange: (filter: BoardFilter) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
        <button
          type="button"
          disabled={!baseBusinessDate || loading}
          onClick={() => onDateOffsetChange(-1)}
          className="flex items-center px-3 text-[#2b2721] transition disabled:opacity-40 dark:text-[#f8f1e5]"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-[260px] border-x border-[#e4ded0] px-4 py-2 text-center dark:border-white/10">
          <div className="font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{formatBoardDate(boardDate)}</div>
          <div className="mt-0.5 text-[11px] text-[#857e6e] dark:text-white/45">Business date · read-only live data</div>
        </div>
        <button
          type="button"
          disabled={!baseBusinessDate || loading}
          onClick={() => onDateOffsetChange(1)}
          className="flex items-center px-3 text-[#2b2721] transition disabled:opacity-40 dark:text-[#f8f1e5]"
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="inline-flex overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
        {dateOptions.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={!baseBusinessDate && option.offset !== 0}
            onClick={() => onDateOffsetChange(option.offset)}
            aria-pressed={dateOffset === option.offset}
            className={`px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${
              dateOffset === option.offset
                ? "bg-[#1f4a3f] text-white"
                : "text-[#2b2721] hover:bg-[#fbf7ef] dark:text-[#f8f1e5] dark:hover:bg-white/10"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="inline-flex overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
        {["Grid", "Diary", "Planner"].map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={mode !== "Diary"}
            aria-pressed={mode === "Diary"}
            className={`px-4 py-2 text-sm font-medium transition ${
              mode === "Diary"
                ? "bg-[#1f4a3f] text-white"
                : "cursor-default text-[#857e6e] dark:text-white/35"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-[#857e6e] dark:text-white/50">Filter:</span>
        {(Object.keys(filterCopy) as BoardFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => onFilterChange(filter)}
            aria-pressed={activeFilter === filter}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              activeFilter === filter
                ? "border-[#1f4a3f] bg-[#1f4a3f] text-white"
                : "border-[#e4ded0] bg-white text-[#2b2721] hover:border-[#1f4a3f] dark:border-white/10 dark:bg-[#10231f] dark:text-[#f8f1e5]"
            }`}
          >
            {filterCopy[filter]}
          </button>
        ))}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="ml-1 inline-flex items-center gap-2 rounded-lg border border-[#e4ded0] bg-white px-3 py-2 text-xs font-semibold text-[#2b2721] shadow-sm transition hover:border-[#1f4a3f] disabled:opacity-50 dark:border-white/10 dark:bg-[#10231f] dark:text-[#f8f1e5]"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          type="button"
          disabled
          className="inline-flex cursor-default items-center gap-2 rounded-lg bg-[#b9883a] px-3 py-2 text-xs font-semibold text-[#173f36] opacity-70 shadow-sm"
          title="Read-only preview"
        >
          <Plus className="h-3.5 w-3.5" />
          New Booking
        </button>
      </div>
    </section>
  );
}

type KpiDisplayItem = {
  key: string;
  label: string;
  value: string;
  sublabel: string;
  progress?: number;
};

function KpiStrip({ kpis, loading }: { kpis: LiveBoardKpiItem[]; loading: boolean }) {
  const items: KpiDisplayItem[] = loading && kpis.length === 0
    ? Array.from({ length: 5 }, (_, index) => ({
        key: `loading-${index}`,
        label: "Loading",
        value: "--",
        sublabel: "Fetching board data",
      }))
    : kpis;

  return (
    <section className="grid grid-cols-5 gap-3">
      {items.map((item) => (
        <div
          key={item.key}
          className="rounded-lg border border-[#e4ded0] bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-[#10231f]"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#857e6e] dark:text-white/45">
            <span>{item.label}</span>
          </div>
          <div className="mt-1 font-serif text-2xl font-semibold leading-tight text-[#2b2721] dark:text-[#f8f1e5]">{item.value}</div>
          <div className="mt-1 text-xs text-[#857e6e] dark:text-white/45">{item.sublabel}</div>
          {typeof item.progress === "number" && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#eae3d6] dark:bg-white/10">
              <div className="h-full rounded-full bg-[#b9883a]" style={{ width: `${item.progress}%` }} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function HourScale() {
  return (
    <div className={`grid h-[25px] ${styles.hourGrid}`}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className={`border-l border-[#e4ded0] pl-1 pt-1 font-mono text-[10px] text-[#857e6e] dark:border-white/10 dark:text-white/35 ${
            hour >= 8 && hour < 20 ? "bg-[#fbf7ef] dark:bg-white/[0.03]" : ""
          } ${hour === 12 || hour === 14 ? "bg-[#f5ecd9] dark:bg-[#4b3318]" : ""}`}
        >
          {String(hour).padStart(2, "0")}
        </div>
      ))}
    </div>
  );
}

function SegmentBar({
  roomNumber,
  segment,
  selected,
  onSelect,
}: {
  roomNumber: string;
  segment: LiveBoardTimelineSegment;
  selected: boolean;
  onSelect: () => void;
}) {
  const width = ((segment.endHour - segment.startHour) / 24) * 100;
  const left = (segment.startHour / 24) * 100;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`${styles.segment} ${segmentClassByState[segment.state]} ${selected ? styles.segmentSelected : ""}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${stateCopy[segment.state]} · ${segment.code ? `${segment.code} · ` : ""}${segment.label}`}
      aria-label={`Room ${roomNumber}: ${stateCopy[segment.state]} ${segment.label}`}
      aria-pressed={selected}
    >
      {segment.flags.vip && <span className={styles.flag}>VIP</span>}
      {segment.flags.linked && <span className={styles.flag}>LINK</span>}
      {segment.flags.alert && <span className={`${styles.flag} ${styles.flagAlert}`}>ALERT</span>}
      <span className="min-w-0 flex-1 truncate">
        {segment.code && <span className="font-mono text-[10px] opacity-70">{segment.code} </span>}
        {segment.label}
      </span>
    </button>
  );
}

function RoomRow({
  room,
  currentHour,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  room: LiveBoardRoom;
  currentHour: number | null;
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: LiveBoardTimelineSegment) => void;
}) {
  const isSelectedRoom = selectedRoomNumber === room.roomNumber;
  const currentMarkerLeft = currentHour === null ? null : `${(currentHour / 24) * 100}%`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectRoom(room.roomNumber)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectRoom(room.roomNumber);
        }
      }}
      className={`grid min-h-[55px] w-full grid-cols-[200px_1fr_120px] border-t border-[#e4ded0] bg-white text-left transition hover:bg-[#fbf7ef]/70 dark:border-white/10 dark:bg-[#10231f] dark:hover:bg-white/[0.04] ${
        isSelectedRoom ? "bg-[#f5ecd9] dark:bg-[#17372f]" : ""
      }`}
      aria-pressed={isSelectedRoom}
    >
      <div className="flex items-center gap-3 px-5 py-2">
        <div className="min-w-[42px] font-serif text-lg font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{room.roomNumber}</div>
        <div>
          <span className="rounded bg-[#eae3d6] px-2 py-1 text-[10px] font-semibold uppercase text-[#857e6e] dark:bg-white/10 dark:text-white/55">
            {room.roomType}
          </span>
          <div className="mt-1 text-[10px] uppercase text-[#857e6e] dark:text-white/35">
            {room.wing ? `${room.wing} wing` : "Main wing"}
          </div>
        </div>
      </div>
      <div className={`${styles.timeline} relative h-full border-x border-[#e4ded0] dark:border-white/10`}>
        <div className="absolute bottom-0 top-0 w-px bg-[#e4ded0] dark:bg-white/10" style={{ left: "50%" }} />
        {currentMarkerLeft && (
          <div className={`${styles.now} absolute bottom-0 top-0 z-20 w-0.5 bg-[#c04a3b]`} style={{ left: currentMarkerLeft }} />
        )}
        {room.segments.map((segment, index) => {
          const selected = selectedSegment
            ? segmentKey(selectedSegment.roomNumber, selectedSegment.segment) === segmentKey(room.roomNumber, segment)
            : false;
          return (
            <SegmentBar
              key={`${room.roomNumber}-${segment.state}-${segment.startHour}-${segment.endHour}-${index}`}
              roomNumber={room.roomNumber}
              segment={segment}
              selected={selected}
              onSelect={() => onSelectSegment(room.roomNumber, segment)}
            />
          );
        })}
      </div>
      <div className="flex flex-col items-end justify-center px-5 text-right">
        <div className="font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{room.summaryRate}</div>
        <div className="mt-0.5 text-[11px] text-[#857e6e] dark:text-white/45">{room.stayLabel}</div>
      </div>
    </div>
  );
}

function FloorSection({
  floorLabel,
  floorRooms,
  currentHour,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  floorLabel: string;
  floorRooms: LiveBoardRoom[];
  currentHour: number | null;
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: LiveBoardTimelineSegment) => void;
}) {
  const inHouse = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "inhouse")).length;
  const dueIn = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "due_in")).length;
  const dueOut = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "due_out")).length;

  return (
    <>
      <div className="flex items-center gap-3 border-t border-[#e4ded0] bg-[#fbf7ef] px-5 py-2.5 dark:border-white/10 dark:bg-[#0b1d19]">
        <h3 className="m-0 font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{floorLabel}</h3>
        <span className="text-xs text-[#857e6e] dark:text-white/45">{floorRooms.length} rooms shown</span>
        <div className="ml-auto flex gap-4 text-xs text-[#857e6e] dark:text-white/45">
          <span>
            <b className="text-[#2b2721] dark:text-[#f8f1e5]">{inHouse}</b> in-house
          </span>
          <span>
            <b className="text-[#2b2721] dark:text-[#f8f1e5]">{dueIn}</b> due in
          </span>
          <span>
            <b className="text-[#2b2721] dark:text-[#f8f1e5]">{dueOut}</b> due out
          </span>
        </div>
      </div>
      {floorRooms.map((room) => (
        <RoomRow
          key={room.roomId}
          room={room}
          currentHour={currentHour}
          selectedRoomNumber={selectedRoomNumber}
          selectedSegment={selectedSegment}
          onSelectRoom={onSelectRoom}
          onSelectSegment={onSelectSegment}
        />
      ))}
    </>
  );
}

function DiaryBoard({
  model,
  visibleRooms,
  currentHour,
  loading,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  model: LiveBoardModel | null;
  visibleRooms: LiveBoardRoom[];
  currentHour: number | null;
  loading: boolean;
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: LiveBoardTimelineSegment) => void;
}) {
  const floors = model?.floors ?? [];

  return (
    <section className="overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
      <div className="grid grid-cols-[200px_1fr_120px] items-center border-b border-[#e4ded0] bg-[#fbf7ef] px-0 dark:border-white/10 dark:bg-[#0b1d19]">
        <div className="px-5 py-3 font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">
          Room <span className="font-sans text-xs font-normal text-[#b9883a]">ห้อง</span>
        </div>
        <HourScale />
        <div className="px-5 py-3 text-right font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Revenue · Guest</div>
      </div>
      {loading && !model && (
        <div className="border-t border-[#e4ded0] px-5 py-12 text-center text-sm text-[#857e6e] dark:border-white/10 dark:text-white/45">
          Loading live board data...
        </div>
      )}
      {!loading && model && floors.map((floor) => {
        const floorRooms = visibleRooms.filter((room) => room.floor === floor.floor);
        if (floorRooms.length === 0) return null;
        return (
          <FloorSection
            key={floor.floor}
            floorLabel={floor.label}
            floorRooms={floorRooms}
            currentHour={currentHour}
            selectedRoomNumber={selectedRoomNumber}
            selectedSegment={selectedSegment}
            onSelectRoom={onSelectRoom}
            onSelectSegment={onSelectSegment}
          />
        );
      })}
      {!loading && model && visibleRooms.length === 0 && (
        <div className="border-t border-[#e4ded0] px-5 py-12 text-center text-sm text-[#857e6e] dark:border-white/10 dark:text-white/45">
          No rooms match this filter or search.
        </div>
      )}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-[#857e6e] dark:text-white/45">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{value ?? "—"}</div>
    </div>
  );
}

function InspectorPanel({
  selected,
  selectedRoom,
  onClose,
}: {
  selected: SelectedSegment;
  selectedRoom: LiveBoardRoom | null;
  onClose: () => void;
}) {
  if (!selectedRoom) {
    return (
      <aside className="h-fit rounded-lg border border-dashed border-[#d8cfbe] bg-white/55 p-5 text-sm text-[#857e6e] dark:border-white/10 dark:bg-[#10231f]/55 dark:text-white/45">
        <div className="font-serif text-lg font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Room inspector</div>
        <p className="mt-2 leading-6">Select a room or timeline block to preview live room data.</p>
      </aside>
    );
  }

  const segment = selected?.segment ?? selectedRoom.segments[0] ?? null;
  const raw = selectedRoom.raw;
  const flags = [
    selectedRoom.flags.vip ? `VIP${raw.vip_tier ? ` · ${raw.vip_tier}` : ""}` : null,
    selectedRoom.flags.linked ? "Linked stay" : null,
    selectedRoom.flags.alert ? "Needs follow-up" : null,
    selectedRoom.flags.housekeeping ? "Housekeeping" : null,
    selectedRoom.flags.blocked ? "Blocked" : null,
  ].filter((flag): flag is string => Boolean(flag));

  return (
    <aside className="h-fit rounded-lg border border-[#e4ded0] bg-white p-5 shadow-sm transition dark:border-white/10 dark:bg-[#10231f]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase text-[#857e6e] dark:text-white/45">
            Room {selectedRoom.roomNumber} · {selectedRoom.roomType}
          </div>
          <h2 className="mt-1 font-serif text-xl font-semibold text-[#2b2721] dark:text-[#f8f1e5]">
            {segment?.label ?? selectedRoom.stayLabel}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#e4ded0] px-2 py-1 text-xs font-semibold text-[#857e6e] transition hover:border-[#1f4a3f] hover:text-[#1f4a3f] dark:border-white/10 dark:text-white/50 dark:hover:border-white/30 dark:hover:text-white"
        >
          Close
        </button>
      </div>

      {flags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {flags.map((flag) => (
            <span key={flag} className="rounded-full bg-[#f5ecd9] px-3 py-1 text-xs font-semibold text-[#8a5a20] dark:bg-[#4b3318] dark:text-[#e6b76e]">
              {flag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <DetailRow label="Status" value={segment ? stateCopy[segment.state] : selectedRoom.status} />
        <DetailRow label="Time" value={segment ? `${formatHour(segment.startHour)}-${formatHour(segment.endHour)}` : "Room row"} />
        <DetailRow label="Wing" value={selectedRoom.wing ?? "Main"} />
        <DetailRow label="Code" value={segment?.code ?? raw.booking_code ?? raw.due_in_booking_code ?? "—"} />
        <DetailRow label="Guest" value={raw.guest_name ?? raw.due_in_guest_name ?? "—"} />
        <DetailRow label="Source" value={raw.source ?? raw.due_in_source ?? "—"} />
        <DetailRow label="HK" value={raw.hk_status ?? "—"} />
        <DetailRow label="Alert" value={raw.first_alert_message ?? (raw.alert_count ? `${raw.alert_count} alert(s)` : "—")} />
      </div>

      <div className="mt-5 space-y-2">
        {["Open booking", "Assign maid", "Message guest"].map((action) => (
          <button
            key={action}
            type="button"
            disabled
            className="w-full cursor-default rounded-lg border border-[#e4ded0] bg-[#fbf7ef] px-3 py-2 text-left text-sm font-semibold text-[#857e6e] opacity-75 dark:border-white/10 dark:bg-[#0b1d19] dark:text-white/45"
          >
            {action} · read-only
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function LiveBoardV2Page() {
  const [model, setModel] = useState<LiveBoardModel | null>(null);
  const [baseBusinessDate, setBaseBusinessDate] = useState<string | null>(null);
  const [dateOffset, setDateOffset] = useState<DateViewOffset>(0);
  const [activeFilter, setActiveFilter] = useState<BoardFilter>("all");
  const [searchValue, setSearchValue] = useState("");
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegment>(null);
  const [currentHour, setCurrentHour] = useState<number | null>(null);
  const [currentTimeLabel, setCurrentTimeLabel] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const requestedBoardDate = dateOffset === 0 ? null : baseBusinessDate ? shiftDateString(baseBusinessDate, dateOffset) : null;
  const boardDate = model?.date ?? requestedBoardDate ?? baseBusinessDate;

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentHour(readBangkokHour(now));
      setCurrentTimeLabel(formatBangkokTime(now));
    };
    updateClock();
    const timer = window.setInterval(updateClock, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadBoard() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (requestedBoardDate) params.set("date", requestedBoardDate);
        const url = params.toString() ? `/api/board?${params.toString()}` : "/api/board";
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error ?? "Failed to load board.");
        }
        const apiData = payload as ApiBoardData;
        const nextModel = adaptBoardDataToLiveBoard(apiData);
        if (!alive) return;
        setModel(nextModel);
        if (dateOffset === 0) {
          setBaseBusinessDate(apiData.date);
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load board.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadBoard();
    return () => {
      alive = false;
    };
  }, [dateOffset, refreshTick, requestedBoardDate]);

  const visibleRooms = useMemo(() => {
    return (model?.rooms ?? []).filter((room) => roomMatchesFilter(room, activeFilter) && roomMatchesSearch(room, searchValue));
  }, [activeFilter, model, searchValue]);

  const selectedRoom = useMemo(() => {
    if (!model || !selectedRoomNumber) return null;
    return model.rooms.find((room) => room.roomNumber === selectedRoomNumber) ?? null;
  }, [model, selectedRoomNumber]);

  useEffect(() => {
    if (!selectedRoomNumber) return;
    if (visibleRooms.some((room) => room.roomNumber === selectedRoomNumber)) return;
    setSelectedRoomNumber(null);
    setSelectedSegment(null);
  }, [selectedRoomNumber, visibleRooms]);

  function handleSelectRoom(roomNumber: string) {
    setSelectedRoomNumber(roomNumber);
    setSelectedSegment(null);
  }

  function handleSelectSegment(roomNumber: string, segment: LiveBoardTimelineSegment) {
    setSelectedRoomNumber(roomNumber);
    setSelectedSegment({ roomNumber, segment });
  }

  function handleDateOffsetChange(offset: DateViewOffset) {
    setDateOffset(offset);
    setSelectedRoomNumber(null);
    setSelectedSegment(null);
  }

  function handleFilterChange(filter: BoardFilter) {
    setActiveFilter(filter);
    setSelectedRoomNumber(null);
    setSelectedSegment(null);
  }

  return (
    <div className="min-h-screen overflow-auto bg-[#fbf7ef] text-[#2b2721] dark:bg-[#071412]">
      <div className="grid min-h-screen min-w-[1440px] grid-cols-[240px_1fr]">
        <SidebarV2 model={model} />
        <main className="flex min-w-0 flex-col">
          <PmsCommandTopbar
            title="Live Board"
            thaiTitle="บอร์ดห้องพัก · Real data read-only"
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            hasUnreadAlerts={(model?.rooms ?? []).some((room) => room.flags.alert)}
            avatarLabel="NA"
          />
          <div className="flex-1 space-y-5 px-7 py-6">
            <ControlBar
              activeFilter={activeFilter}
              boardDate={boardDate}
              baseBusinessDate={baseBusinessDate}
              dateOffset={dateOffset}
              loading={loading}
              onDateOffsetChange={handleDateOffsetChange}
              onFilterChange={handleFilterChange}
              onRefresh={() => setRefreshTick((tick) => tick + 1)}
            />

            {error && (
              <div className="rounded-lg border border-[#e7b4aa] bg-[#fff3ef] px-4 py-3 text-sm font-medium text-[#9d3d31] dark:border-[#c04a3b]/40 dark:bg-[#2a1411] dark:text-[#f0a095]">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-[#857e6e] dark:text-white/45">
              <span>{model ? `${visibleRooms.length} of ${model.rooms.length} rooms visible` : "Waiting for board data"}</span>
              <span>{currentTimeLabel ? `Bangkok ${currentTimeLabel}` : "Bangkok time loading"}</span>
            </div>

            <KpiStrip kpis={model?.kpis ?? []} loading={loading} />

            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
              <DiaryBoard
                model={model}
                visibleRooms={visibleRooms}
                currentHour={currentHour}
                loading={loading}
                selectedRoomNumber={selectedRoomNumber}
                selectedSegment={selectedSegment}
                onSelectRoom={handleSelectRoom}
                onSelectSegment={handleSelectSegment}
              />
              <InspectorPanel selected={selectedSegment} selectedRoom={selectedRoom} onClose={() => setSelectedSegment(null)} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
