"use client";

import { useMemo, useState } from "react";
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
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import PmsCommandTopbar from "@/components/pms-command-topbar";
import styles from "./live-board-mockup.module.css";

type SegmentState = "inhouse" | "due_in" | "due_out" | "dirty" | "cleaning" | "closed" | "ooo";
type MockFilter = "all" | "vip" | "alerts";

type TimelineSegment = {
  startHour: number;
  endHour: number;
  state: SegmentState;
  label: string;
  code?: string;
  vip?: boolean;
  linked?: boolean;
  alert?: boolean;
};

type MockRoom = {
  floor: number;
  roomNumber: string;
  roomType: string;
  wing: "Garden" | "Pool";
  stayLabel: string;
  summaryRate: string;
  segments: TimelineSegment[];
};

type KpiItem = {
  label: string;
  value: string;
  sublabel: string;
  delta?: string;
  progress?: number;
};

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
  segment: TimelineSegment;
} | null;

const currentHour = 14 + 22 / 60;
const currentMarkerLeft = `${(currentHour / 24) * 100}%`;

const stateCopy: Record<SegmentState, string> = {
  inhouse: "In-house",
  due_in: "Due in",
  due_out: "Due out",
  dirty: "Dirty",
  cleaning: "Cleaning",
  closed: "Closed",
  ooo: "OOO",
};

const filterCopy: Record<MockFilter, string> = {
  all: "All floors",
  vip: "VIP",
  alerts: "Alerts",
};

const segmentClassByState: Record<SegmentState, string> = {
  inhouse: styles.segmentInhouse,
  due_in: styles.segmentDueIn,
  due_out: styles.segmentDueOut,
  dirty: styles.segmentDirty,
  cleaning: styles.segmentCleaning,
  closed: styles.segmentClosed,
  ooo: styles.segmentOoo,
};

const kpis: KpiItem[] = [
  { label: "Occupancy", value: "84%", sublabel: "32 of 38 rooms", delta: "+6%", progress: 84 },
  { label: "Arrivals today", value: "4 / 7", sublabel: "3 pending · next at 14:30" },
  { label: "Departures", value: "2 / 5", sublabel: "3 remaining by noon" },
  { label: "Housekeeping", value: "9 queued", sublabel: "3 in progress · 2 paused" },
  { label: "RevPAR", value: "฿2,083", sublabel: "ADR ฿2,480", delta: "+4.2%" },
];

const sidebarSections: SidebarSection[] = [
  {
    label: "Operations",
    items: [
      { label: "Live Board", icon: Home, active: true, count: "12" },
      { label: "Room Planner", icon: CalendarDays },
      { label: "Arrivals", icon: ChevronRight, count: "7" },
      { label: "Departures", icon: ChevronLeft, count: "5" },
      { label: "In-House", icon: KeyRound },
    ],
  },
  {
    label: "Service",
    items: [
      { label: "Housekeeping", icon: Package, count: "18" },
      { label: "Maintenance", icon: Wrench },
      { label: "Transportation", icon: Car },
      { label: "Lost & Found", icon: Package },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Guests", icon: Users },
      { label: "Groups", icon: Users },
      { label: "Team", icon: Users },
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

const rooms: MockRoom[] = [
  {
    floor: 3,
    roomNumber: "301",
    roomType: "DLX",
    wing: "Garden",
    stayLabel: "3N · Martine",
    summaryRate: "฿8,400",
    segments: [
      { startHour: 0, endHour: 11, state: "inhouse", code: "BK-3981", label: "Martine Dubois", vip: true },
      { startHour: 11, endHour: 14, state: "dirty", label: "Strip + turnover" },
      { startHour: 14, endHour: 24, state: "due_in", code: "BK-4012", label: "Emma Richardson" },
    ],
  },
  {
    floor: 3,
    roomNumber: "302",
    roomType: "DLX",
    wing: "Garden",
    stayLabel: "2N · Sarawut",
    summaryRate: "฿5,400",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3988", label: "Sarawut K." }],
  },
  {
    floor: 3,
    roomNumber: "303",
    roomType: "STD",
    wing: "Garden",
    stayLabel: "4N · Chen",
    summaryRate: "฿7,200",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3970", label: "Chen family", linked: true }],
  },
  {
    floor: 3,
    roomNumber: "304",
    roomType: "STD",
    wing: "Garden",
    stayLabel: "4N · Chen",
    summaryRate: "฿7,200",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3970", label: "Chen family", linked: true }],
  },
  {
    floor: 3,
    roomNumber: "305",
    roomType: "JR",
    wing: "Garden",
    stayLabel: "3N · Ella",
    summaryRate: "฿10,800",
    segments: [
      { startHour: 0, endHour: 8, state: "cleaning", label: "Maid in progress" },
      { startHour: 8, endHour: 14, state: "dirty", label: "Awaiting inspection", alert: true },
      { startHour: 14, endHour: 24, state: "due_in", code: "BK-4018", label: "Ella Hartley", vip: true },
    ],
  },
  {
    floor: 3,
    roomNumber: "306",
    roomType: "JR",
    wing: "Garden",
    stayLabel: "Checkout 12:00",
    summaryRate: "฿3,600",
    segments: [{ startHour: 0, endHour: 12, state: "due_out", code: "BK-3955", label: "Wanchai S." }],
  },
  {
    floor: 3,
    roomNumber: "307",
    roomType: "STD",
    wing: "Pool",
    stayLabel: "Turnover",
    summaryRate: "฿1,800",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3962", label: "Walk-in checked out" },
      { startHour: 11, endHour: 15, state: "dirty", label: "To be cleaned" },
      { startHour: 15, endHour: 24, state: "due_in", code: "BK-4020", label: "Magnus & Liv Holm" },
    ],
  },
  {
    floor: 3,
    roomNumber: "308",
    roomType: "STD",
    wing: "Pool",
    stayLabel: "Turnover",
    summaryRate: "฿1,800",
    segments: [
      { startHour: 0, endHour: 10, state: "due_out", code: "BK-3950", label: "T. Boonyarit" },
      { startHour: 10, endHour: 15.5, state: "cleaning", label: "Maid · 14m in" },
      { startHour: 15.5, endHour: 24, state: "due_in", code: "BK-4005", label: "Priya Ravindran" },
    ],
  },
  { floor: 3, roomNumber: "309", roomType: "DLX", wing: "Pool", stayLabel: "Available", summaryRate: "—", segments: [] },
  {
    floor: 3,
    roomNumber: "310",
    roomType: "DLX",
    wing: "Pool",
    stayLabel: "5N · Akira",
    summaryRate: "฿14,000",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3920", label: "Akira Tanaka", vip: true }],
  },
  {
    floor: 2,
    roomNumber: "201",
    roomType: "STD",
    wing: "Pool",
    stayLabel: "OTA · 2N",
    summaryRate: "฿3,400",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3977", label: "Booking.com guest" }],
  },
  {
    floor: 2,
    roomNumber: "203",
    roomType: "DLX",
    wing: "Pool",
    stayLabel: "Checkout 12:00",
    summaryRate: "฿2,700",
    segments: [
      { startHour: 0, endHour: 12, state: "due_out", code: "BK-3948", label: "Marcus O'Brien" },
      { startHour: 15, endHour: 24, state: "due_in", code: "BK-4001", label: "Remi Fontaine" },
    ],
  },
  {
    floor: 2,
    roomNumber: "206",
    roomType: "STD",
    wing: "Garden",
    stayLabel: "Turnover",
    summaryRate: "฿1,700",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3960", label: "Checked out" },
      { startHour: 11, endHour: 14, state: "dirty", label: "To be cleaned" },
      { startHour: 14, endHour: 24, state: "due_in", code: "BK-4011", label: "Magnus & Liv Holm" },
    ],
  },
  {
    floor: 2,
    roomNumber: "209",
    roomType: "DLX",
    wing: "Garden",
    stayLabel: "Back-to-back",
    summaryRate: "฿5,400",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3941", label: "Adeyemi O." },
      { startHour: 11, endHour: 14, state: "cleaning", label: "Maid · 28m" },
      { startHour: 14, endHour: 24, state: "due_in", code: "BK-4014", label: "Nadia Khoury", alert: true },
    ],
  },
  {
    floor: 2,
    roomNumber: "210",
    roomType: "DLX",
    wing: "Garden",
    stayLabel: "4N · Sophie",
    summaryRate: "฿10,800",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3911", label: "Sophie Laurent", vip: true }],
  },
  {
    floor: 2,
    roomNumber: "212",
    roomType: "STD",
    wing: "Garden",
    stayLabel: "HVAC",
    summaryRate: "—",
    segments: [{ startHour: 0, endHour: 24, state: "ooo", label: "HVAC repair · Prasit" }],
  },
  {
    floor: 2,
    roomNumber: "213",
    roomType: "FAM",
    wing: "Pool",
    stayLabel: "3N · Ratanakul",
    summaryRate: "฿11,400",
    segments: [{ startHour: 0, endHour: 24, state: "inhouse", code: "BK-3930", label: "Ratanakul family" }],
  },
  {
    floor: 1,
    roomNumber: "103",
    roomType: "DLX",
    wing: "Pool",
    stayLabel: "Turnover",
    summaryRate: "฿2,700",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3945", label: "Checked out" },
      { startHour: 11, endHour: 15, state: "dirty", label: "Awaiting cleaning" },
      { startHour: 15, endHour: 24, state: "due_in", code: "BK-4017", label: "Kawisara P." },
    ],
  },
  { floor: 1, roomNumber: "104", roomType: "DLX", wing: "Pool", stayLabel: "Available", summaryRate: "—", segments: [] },
  {
    floor: 1,
    roomNumber: "106",
    roomType: "STD",
    wing: "Pool",
    stayLabel: "Turnover",
    summaryRate: "฿1,700",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3935", label: "Checked out" },
      { startHour: 11, endHour: 16.5, state: "cleaning", label: "Maid · 6m in" },
      { startHour: 16.5, endHour: 24, state: "due_in", code: "BK-4022", label: "Remi Fontaine" },
    ],
  },
  {
    floor: 1,
    roomNumber: "107",
    roomType: "JR",
    wing: "Pool",
    stayLabel: "Back-to-back",
    summaryRate: "฿3,600",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3939", label: "Natalia K. departing" },
      { startHour: 11, endHour: 14, state: "cleaning", label: "Maid in progress" },
      { startHour: 14, endHour: 24, state: "due_in", code: "BK-4010", label: "Danny & family", alert: true },
    ],
  },
  {
    floor: 1,
    roomNumber: "110",
    roomType: "STD",
    wing: "Garden",
    stayLabel: "Checkout 12:00",
    summaryRate: "฿1,700",
    segments: [{ startHour: 0, endHour: 12, state: "due_out", code: "BK-3958", label: "Tawan P." }],
  },
  {
    floor: 1,
    roomNumber: "112",
    roomType: "DLX",
    wing: "Garden",
    stayLabel: "Turnover",
    summaryRate: "฿2,700",
    segments: [
      { startHour: 0, endHour: 11, state: "due_out", code: "BK-3944", label: "Checked out" },
      { startHour: 11, endHour: 18, state: "dirty", label: "To be cleaned" },
      { startHour: 18, endHour: 24, state: "due_in", code: "BK-4025", label: "Nadia Khoury" },
    ],
  },
];

function SidebarMockup() {
  return (
    <aside className="relative flex min-h-screen w-60 flex-col overflow-hidden bg-[#173f36] text-white dark:bg-[#0b2823]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M20 0L40 20L20 40L0 20Z' fill='none' stroke='white' stroke-width='0.5'/></svg>\")",
        }}
      />
      <div className="relative z-10 flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#c28b3d] font-serif text-lg font-bold text-[#173f36] shadow">
          P
        </div>
        <div>
          <div className="font-serif text-base font-semibold leading-tight">OpenHotel</div>
          <div className="mt-1 text-[10px] font-semibold uppercase text-[#d9aa63]">Property Mgmt</div>
        </div>
      </div>

      <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
        {sidebarSections.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase text-white/45">{section.label}</div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition ${
                      item.active
                        ? "border-[#d9aa63] bg-[#c28b3d]/15 text-white"
                        : "border-transparent text-white/75 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${item.active ? "text-[#d9aa63]" : ""}`} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          item.active ? "bg-[#d9aa63] text-[#173f36]" : "bg-white/10 text-white/80"
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
          <div className="font-semibold">Natcha A.</div>
          <div className="truncate text-white/55">Front desk · Shift 1</div>
        </div>
      </div>
    </aside>
  );
}

function roomMatchesFilter(room: MockRoom, filter: MockFilter) {
  if (filter === "all") return true;
  if (filter === "vip") return room.segments.some((segment) => segment.vip);
  return room.segments.some((segment) => segment.alert || segment.state === "dirty" || segment.state === "cleaning");
}

function formatHour(hour: number) {
  const fullHour = Math.floor(hour);
  const minutes = Math.round((hour - fullHour) * 60);
  return `${String(fullHour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function ControlBar({
  activeFilter,
  onFilterChange,
}: {
  activeFilter: MockFilter;
  onFilterChange: (filter: MockFilter) => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
        <button type="button" className="flex items-center px-3 text-[#2b2721] dark:text-[#f8f1e5]" aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="border-x border-[#e4ded0] px-4 py-2 text-center dark:border-white/10">
          <div className="font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Thursday, 14 Nov 2024</div>
          <div className="mt-0.5 text-[11px] text-[#857e6e] dark:text-white/45">วันพฤหัสบดี · 14:22 Bangkok</div>
        </div>
        <button type="button" className="flex items-center px-3 text-[#2b2721] dark:text-[#f8f1e5]" aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="inline-flex overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
        {["Grid", "Diary", "Planner"].map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={mode === "Diary"}
            className={`px-4 py-2 text-sm font-medium transition ${
              mode === "Diary"
                ? "bg-[#1f4a3f] text-white"
                : "text-[#2b2721] hover:bg-[#fbf7ef] dark:text-[#f8f1e5] dark:hover:bg-white/10"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-[#857e6e] dark:text-white/50">Filter:</span>
        {(Object.keys(filterCopy) as MockFilter[]).map((filter) => (
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
          className="ml-1 inline-flex items-center gap-2 rounded-lg bg-[#b9883a] px-3 py-2 text-xs font-semibold text-[#173f36] shadow-sm transition hover:bg-[#c99a4f]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Booking
        </button>
      </div>
    </section>
  );
}

function KpiStrip() {
  return (
    <section className="grid grid-cols-5 gap-3">
      {kpis.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-[#e4ded0] bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-[#10231f]"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[#857e6e] dark:text-white/45">
            <span>{item.label}</span>
            {item.delta && <span className="ml-auto text-[#3c7a4a] dark:text-[#7fc58a]">{item.delta}</span>}
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
          } ${hour === 11 || hour === 14 ? "bg-[#f5ecd9] dark:bg-[#4b3318]" : ""}`}
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
  segment: TimelineSegment;
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
      {segment.vip && <span className={styles.flag}>VIP</span>}
      {segment.linked && <span className={styles.flag}>LINK</span>}
      {segment.alert && <span className={`${styles.flag} ${styles.flagAlert}`}>ALERT</span>}
      <span className="min-w-0 flex-1 truncate">
        {segment.code && <span className="font-mono text-[10px] opacity-70">{segment.code} </span>}
        {segment.label}
      </span>
    </button>
  );
}

function RoomRow({
  room,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  room: MockRoom;
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: TimelineSegment) => void;
}) {
  const isSelectedRoom = selectedRoomNumber === room.roomNumber;

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
          <div className="mt-1 text-[10px] uppercase text-[#857e6e] dark:text-white/35">{room.wing} wing</div>
        </div>
      </div>
      <div className={`${styles.timeline} relative h-full border-x border-[#e4ded0] dark:border-white/10`}>
        <div className="absolute bottom-0 top-0 w-px bg-[#e4ded0] dark:bg-white/10" style={{ left: "50%" }} />
        <div className={`${styles.now} absolute bottom-0 top-0 z-20 w-0.5 bg-[#c04a3b]`} style={{ left: currentMarkerLeft }} />
        {room.segments.map((segment, index) => (
          <SegmentBar
            key={`${room.roomNumber}-${segment.state}-${segment.startHour}-${index}`}
            roomNumber={room.roomNumber}
            segment={segment}
            selected={
              selectedSegment?.roomNumber === room.roomNumber &&
              selectedSegment.segment.startHour === segment.startHour &&
              selectedSegment.segment.endHour === segment.endHour &&
              selectedSegment.segment.state === segment.state
            }
            onSelect={() => onSelectSegment(room.roomNumber, segment)}
          />
        ))}
      </div>
      <div className="flex flex-col items-end justify-center px-5 text-right">
        <div className="font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{room.summaryRate}</div>
        <div className="mt-0.5 text-[11px] text-[#857e6e] dark:text-white/45">{room.stayLabel}</div>
      </div>
    </div>
  );
}

function FloorSection({
  floor,
  floorRooms,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  floor: number;
  floorRooms: MockRoom[];
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: TimelineSegment) => void;
}) {
  const inhouse = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "inhouse")).length;
  const dueIn = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "due_in")).length;
  const dueOut = floorRooms.filter((room) => room.segments.some((segment) => segment.state === "due_out")).length;

  return (
    <>
      <div className="flex items-center gap-3 border-t border-[#e4ded0] bg-[#fbf7ef] px-5 py-2.5 dark:border-white/10 dark:bg-[#0b1d19]">
        <h3 className="m-0 font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Floor {floor}</h3>
        <span className="text-xs text-[#857e6e] dark:text-white/45">{floorRooms.length} rooms shown</span>
        <div className="ml-auto flex gap-4 text-xs text-[#857e6e] dark:text-white/45">
          <span>
            <b className="text-[#2b2721] dark:text-[#f8f1e5]">{inhouse}</b> in-house
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
          key={room.roomNumber}
          room={room}
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
  visibleRooms,
  selectedRoomNumber,
  selectedSegment,
  onSelectRoom,
  onSelectSegment,
}: {
  visibleRooms: MockRoom[];
  selectedRoomNumber: string | null;
  selectedSegment: SelectedSegment;
  onSelectRoom: (roomNumber: string) => void;
  onSelectSegment: (roomNumber: string, segment: TimelineSegment) => void;
}) {
  const floors = [...new Set(visibleRooms.map((room) => room.floor))].sort((a, b) => b - a);

  return (
    <section className="overflow-hidden rounded-lg border border-[#e4ded0] bg-white shadow-sm dark:border-white/10 dark:bg-[#10231f]">
      <div className="grid grid-cols-[200px_1fr_120px] items-center border-b border-[#e4ded0] bg-[#fbf7ef] px-0 dark:border-white/10 dark:bg-[#0b1d19]">
        <div className="px-5 py-3 font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">
          Room <span className="font-sans text-xs font-normal text-[#b9883a]">ห้อง</span>
        </div>
        <HourScale />
        <div className="px-5 py-3 text-right font-serif text-sm font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Nightly · Guest</div>
      </div>
      {floors.map((floor) => (
        <FloorSection
          key={floor}
          floor={floor}
          floorRooms={visibleRooms.filter((room) => room.floor === floor)}
          selectedRoomNumber={selectedRoomNumber}
          selectedSegment={selectedSegment}
          onSelectRoom={onSelectRoom}
          onSelectSegment={onSelectSegment}
        />
      ))}
      {floors.length === 0 && (
        <div className="border-t border-[#e4ded0] px-5 py-12 text-center text-sm text-[#857e6e] dark:border-white/10 dark:text-white/45">
          No rooms match this mock filter.
        </div>
      )}
    </section>
  );
}

function InspectorPanel({
  selected,
  selectedRoom,
  onClose,
}: {
  selected: SelectedSegment;
  selectedRoom: MockRoom | null;
  onClose: () => void;
}) {
  if (!selected || !selectedRoom) {
    return (
      <aside className="h-fit rounded-lg border border-dashed border-[#d8cfbe] bg-white/55 p-5 text-sm text-[#857e6e] dark:border-white/10 dark:bg-[#10231f]/55 dark:text-white/45">
        <div className="font-serif text-lg font-semibold text-[#2b2721] dark:text-[#f8f1e5]">Room inspector</div>
        <p className="mt-2 leading-6">Select a room block to preview guest, task, and handoff details.</p>
      </aside>
    );
  }

  const { segment } = selected;
  const flags = [
    segment.vip ? "VIP" : null,
    segment.linked ? "Linked stay" : null,
    segment.alert ? "Needs follow-up" : null,
  ].filter((flag): flag is string => Boolean(flag));

  return (
    <aside className="h-fit rounded-lg border border-[#e4ded0] bg-white p-5 shadow-sm transition dark:border-white/10 dark:bg-[#10231f]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase text-[#857e6e] dark:text-white/45">
            Room {selectedRoom.roomNumber} · {selectedRoom.roomType}
          </div>
          <h2 className="mt-1 font-serif text-xl font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{segment.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#e4ded0] px-2 py-1 text-xs font-semibold text-[#857e6e] transition hover:border-[#1f4a3f] hover:text-[#1f4a3f] dark:border-white/10 dark:text-white/50 dark:hover:border-white/30 dark:hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase text-[#857e6e] dark:text-white/45">Status</div>
          <div className="mt-1 font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{stateCopy[segment.state]}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-[#857e6e] dark:text-white/45">Time</div>
          <div className="mt-1 font-semibold text-[#2b2721] dark:text-[#f8f1e5]">
            {formatHour(segment.startHour)}-{formatHour(segment.endHour)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-[#857e6e] dark:text-white/45">Wing</div>
          <div className="mt-1 font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{selectedRoom.wing}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-[#857e6e] dark:text-white/45">Code</div>
          <div className="mt-1 font-mono text-xs font-semibold text-[#2b2721] dark:text-[#f8f1e5]">{segment.code ?? "TASK"}</div>
        </div>
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

      <div className="mt-5 space-y-2">
        {["Open booking", "Assign maid", "Message guest"].map((action) => (
          <button
            key={action}
            type="button"
            className="w-full rounded-lg border border-[#e4ded0] bg-[#fbf7ef] px-3 py-2 text-left text-sm font-semibold text-[#2b2721] transition hover:border-[#1f4a3f] dark:border-white/10 dark:bg-[#0b1d19] dark:text-[#f8f1e5] dark:hover:border-white/30"
          >
            {action}
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function LiveBoardV2MockupPage() {
  const [activeFilter, setActiveFilter] = useState<MockFilter>("all");
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegment>(null);

  const visibleRooms = useMemo(() => rooms.filter((room) => roomMatchesFilter(room, activeFilter)), [activeFilter]);
  const selectedRoom = selectedRoomNumber ? rooms.find((room) => room.roomNumber === selectedRoomNumber) ?? null : null;

  function handleFilterChange(filter: MockFilter) {
    setActiveFilter(filter);
    setSelectedRoomNumber(null);
    setSelectedSegment(null);
  }

  function handleSelectRoom(roomNumber: string) {
    setSelectedRoomNumber(roomNumber);
    setSelectedSegment(null);
  }

  function handleSelectSegment(roomNumber: string, segment: TimelineSegment) {
    setSelectedRoomNumber(roomNumber);
    setSelectedSegment({ roomNumber, segment });
  }

  return (
    <div className="min-h-screen overflow-auto bg-[#fbf7ef] text-[#2b2721] dark:bg-[#071412]">
      <div className="grid min-h-screen min-w-[1440px] grid-cols-[240px_1fr]">
        <SidebarMockup />
        <main className="flex min-w-0 flex-col">
          <PmsCommandTopbar
            title="Live Board"
            thaiTitle="บอร์ดห้องพัก · Diary view"
            searchReadOnly
            hasUnreadAlerts
            avatarLabel="NA"
          />
          <div className="flex-1 space-y-5 px-7 py-6">
            <ControlBar activeFilter={activeFilter} onFilterChange={handleFilterChange} />
            <KpiStrip />
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
              <DiaryBoard
                visibleRooms={visibleRooms}
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
