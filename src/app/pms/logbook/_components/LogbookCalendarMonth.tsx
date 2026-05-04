"use client";

import React, { useMemo, useState } from "react";
import { LogbookNote } from "@/lib/types";

interface LogbookCalendarMonthProps {
  currentDate: Date;
  notes: LogbookNote[];
  onDayClick: (date: Date) => void;
  onBarClick: (note: LogbookNote) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function getCalendarGrid(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset === -1) startOffset = 6;
  const gridStart = new Date(year, month, 1 - startOffset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

function normalizeDate(d: Date | string) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function LogbookCalendarMonth({
  currentDate,
  notes,
  onDayClick,
  onBarClick,
  onPrevMonth,
  onNextMonth,
}: LogbookCalendarMonthProps) {
  const days = useMemo(() => getCalendarGrid(currentDate), [currentDate]);
  const [expandedWeeks, setExpandedWeeks] = useState<Record<number, boolean>>({});

  const weeks = useMemo(() => {
    const res = [];
    for (let i = 0; i < 42; i += 7) {
      res.push(days.slice(i, i + 7));
    }
    return res;
  }, [days]);

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const todayKey = normalizeDate(new Date()).getTime();

  const toggleWeek = (weekIdx: number) => {
    setExpandedWeeks((prev) => ({ ...prev, [weekIdx]: !prev[weekIdx] }));
  };

  return (
    <div className="flex flex-col bg-[var(--logbook-card)] rounded-xl border border-[var(--logbook-card-border)] overflow-hidden shadow-[var(--logbook-card-shadow)] select-none">
      <div className="flex items-center justify-between p-4 border-b border-[var(--logbook-hairline)]">
        <div className="flex items-center gap-2">
          <button onClick={onPrevMonth} className="px-2 py-1 hover:bg-[var(--logbook-canvas-alt)] rounded">&lt;</button>
          <h2 className="font-bold text-[var(--logbook-brand-heading)] w-32 text-center">{monthName}</h2>
          <button onClick={onNextMonth} className="px-2 py-1 hover:bg-[var(--logbook-canvas-alt)] rounded">&gt;</button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-[var(--logbook-hairline)] bg-[var(--logbook-canvas-alt)]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-[var(--logbook-text-secondary)]">{d}</div>
        ))}
      </div>

      <div className="flex flex-col bg-[var(--logbook-hairline)] gap-px">
        {weeks.map((weekDays, weekIdx) => {
          const weekStart = weekDays[0];
          const weekEnd = new Date(weekDays[6]);
          weekEnd.setHours(23, 59, 59, 999);

          // 1. Find overlapping notes
          const overlappingNotes = notes.filter((n) => {
            const nStart = normalizeDate(n.start_at || n.created_at);
            const nEnd = n.end_at ? normalizeDate(n.end_at) : nStart;
            return nStart <= weekEnd && nEnd >= weekStart;
          });

          // 2. Sort notes
          overlappingNotes.sort((a, b) => {
            const aPrio = PRIORITY_WEIGHT[a.priority] || 0;
            const bPrio = PRIORITY_WEIGHT[b.priority] || 0;
            if (aPrio !== bPrio) return bPrio - aPrio;
            const aStart = normalizeDate(a.start_at || a.created_at).getTime();
            const bStart = normalizeDate(b.start_at || b.created_at).getTime();
            if (aStart !== bStart) return aStart - bStart;
            const aLen = (a.end_at ? normalizeDate(a.end_at).getTime() : aStart) - aStart;
            const bLen = (b.end_at ? normalizeDate(b.end_at).getTime() : bStart) - bStart;
            return bLen - aLen;
          });

          // 3. Pack into lanes
          const segments: Array<{ note: LogbookNote; lane: number; startCol: number; span: number; isStart: boolean; isEnd: boolean }> = [];
          const laneEnds: number[] = [];

          overlappingNotes.forEach((note) => {
            const nStart = normalizeDate(note.start_at || note.created_at);
            const nEnd = note.end_at ? normalizeDate(note.end_at) : nStart;
            const sStart = nStart < weekStart ? weekStart : nStart;
            const sEnd = nEnd > weekEnd ? weekEnd : nEnd;

            const startCol = Math.round((sStart.getTime() - weekStart.getTime()) / 86400000);
            const span = Math.round((sEnd.getTime() - sStart.getTime()) / 86400000) + 1;

            let lane = 0;
            while (lane < laneEnds.length && laneEnds[lane] >= sStart.getTime()) {
              lane++;
            }
            laneEnds[lane] = sEnd.getTime();

            segments.push({
              note,
              lane,
              startCol,
              span,
              isStart: nStart.getTime() >= weekStart.getTime(),
              isEnd: nEnd.getTime() <= weekEnd.getTime(),
            });
          });

          const isExpanded = expandedWeeks[weekIdx];
          const maxVisibleLanes = isExpanded ? Math.max(3, laneEnds.length) : 3;
          const rowHeight = Math.max(120, 30 + maxVisibleLanes * 24 + 20);

          // Calculate hidden notes per day for "+N more"
          const hiddenPerCol = [0, 0, 0, 0, 0, 0, 0];
          if (!isExpanded) {
            segments.forEach((seg) => {
              if (seg.lane >= 3) {
                for (let i = 0; i < seg.span; i++) {
                  if (seg.startCol + i < 7) hiddenPerCol[seg.startCol + i]++;
                }
              }
            });
          }

          return (
            <div key={weekIdx} className="relative grid grid-cols-7 gap-px bg-[var(--logbook-hairline)]" style={{ height: rowHeight }}>
              {/* Day Cells Background */}
              {weekDays.map((day, colIdx) => {
                const isToday = day.getTime() === todayKey;
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                return (
                  <div
                    key={colIdx}
                    onClick={() => onDayClick(day)}
                    className={`relative p-1.5 cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                      isCurrentMonth ? "bg-[var(--logbook-card)]" : "bg-[var(--logbook-canvas-alt)] opacity-70"
                    } ${isToday ? "ring-2 ring-[var(--logbook-row-now)] ring-inset" : ""}`}
                  >
                    <div className={`text-right text-xs font-semibold mb-1 relative z-20 ${isToday ? "text-[var(--logbook-now-line)]" : "text-[var(--logbook-text-secondary)]"}`}>
                      {day.getDate()}
                    </div>
                    {/* +N more button */}
                    {!isExpanded && hiddenPerCol[colIdx] > 0 && (
                      <div 
                        className="absolute bottom-1 left-1 right-1 text-[10px] font-semibold text-[var(--logbook-text-secondary)] text-center hover:bg-[var(--logbook-canvas-alt)] rounded py-0.5 z-20 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); toggleWeek(weekIdx); }}
                      >
                        +{hiddenPerCol[colIdx]} more ▾
                      </div>
                    )}
                  </div>
                );
              })}

              {isExpanded && laneEnds.length > 3 && (
                <button
                  type="button"
                  className="absolute bottom-1 right-2 z-30 rounded-full bg-[var(--logbook-card)] px-3 py-1 text-[10px] font-bold text-[var(--logbook-brand-heading)] shadow-sm ring-1 ring-[var(--logbook-hairline)] hover:bg-[var(--logbook-canvas-alt)]"
                  onClick={(e) => { e.stopPropagation(); toggleWeek(weekIdx); }}
                >
                  Less ▴
                </button>
              )}

              {/* Absolute Segments Overlay */}
              <div className="absolute inset-0 pointer-events-none mt-7">
                {segments.map((seg, i) => {
                  if (!isExpanded && seg.lane >= 3) return null;
                  
                  // Adjust for 1px gap between columns
                  const leftPercent = (seg.startCol / 7) * 100;
                  const widthPercent = (seg.span / 7) * 100;
                  
                  return (
                    <div
                      key={`seg-${i}`}
                      className="absolute px-1 pointer-events-auto"
                      style={{
                        top: seg.lane * 24,
                        left: `calc(${leftPercent}%)`,
                        width: `calc(${widthPercent}%)`,
                        height: 20,
                      }}
                    >
                      <div
                        onClick={(e) => { e.stopPropagation(); onBarClick(seg.note); }}
                        className={`w-full h-full flex items-center px-2 overflow-hidden shadow-sm cursor-pointer hover:opacity-90 transition-opacity ${
                          seg.isStart ? "rounded-l-md" : "rounded-l-none border-l-2 border-dashed border-white/30"
                        } ${
                          seg.isEnd ? "rounded-r-md" : "rounded-r-none border-r-2 border-dashed border-white/30"
                        }`}
                        style={{ backgroundColor: `var(--logbook-bar-${seg.note.note_type})`, color: "white" }}
                      >
                        {seg.isStart && <div className="w-1 h-full bg-black/20 mr-1.5 shrink-0" />}
                        <span className="text-[10px] font-medium truncate leading-none">{seg.note.title || "Untitled"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
