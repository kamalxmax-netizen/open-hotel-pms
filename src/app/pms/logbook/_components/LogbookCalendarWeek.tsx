"use client";

import React, { useMemo } from "react";
import { LogbookNote } from "@/lib/types";
import { formatLogbookDate, formatLogbookWeekdayDate } from "./logbook-date-format";

interface LogbookCalendarWeekProps {
  currentDate: Date;
  notes: LogbookNote[];
  onDayClick: (date: Date) => void;
  onBarClick: (note: LogbookNote) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function getWeekGrid(date: Date) {
  const start = new Date(date);
  let startOffset = start.getDay() - 1;
  if (startOffset === -1) startOffset = 6;
  start.setDate(start.getDate() - startOffset);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

function normalizeDate(d: Date | string) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function LogbookCalendarWeek({
  currentDate,
  notes,
  onDayClick,
  onBarClick,
  onPrevWeek,
  onNextWeek,
}: LogbookCalendarWeekProps) {
  const days = useMemo(() => getWeekGrid(currentDate), [currentDate]);

  const weekName = `Week of ${formatLogbookDate(days[0])}`;
  const todayKey = normalizeDate(new Date()).getTime();

  const weekStart = days[0];
  const weekEnd = new Date(days[6]);
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

  const rowHeight = Math.max(400, 40 + laneEnds.length * 32 + 20);

  return (
    <div className="flex flex-col bg-[var(--logbook-card)] rounded-xl border border-[var(--logbook-card-border)] overflow-hidden shadow-[var(--logbook-card-shadow)] select-none">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--logbook-hairline)]">
        <div className="flex items-center gap-2">
          <button onClick={onPrevWeek} className="px-2 py-1 hover:bg-[var(--logbook-canvas-alt)] rounded">&lt;</button>
          <h2 className="font-bold text-[var(--logbook-brand-heading)] w-40 text-center">{weekName}</h2>
          <button onClick={onNextWeek} className="px-2 py-1 hover:bg-[var(--logbook-canvas-alt)] rounded">&gt;</button>
        </div>
      </div>

      {/* Grid Header */}
      <div className="grid grid-cols-7 border-b border-[var(--logbook-hairline)] bg-[var(--logbook-canvas-alt)]">
        {days.map(d => {
          const isToday = d.getTime() === todayKey;
          return (
            <div key={d.toISOString()} className={`py-2 text-center text-xs font-semibold ${isToday ? "text-[var(--logbook-now-line)]" : "text-[var(--logbook-text-secondary)]"}`}>
              {formatLogbookWeekdayDate(d)}
            </div>
          );
        })}
      </div>
      
      {/* Grid Body */}
      <div className="relative grid grid-cols-7 bg-[var(--logbook-hairline)] gap-px" style={{ height: rowHeight }}>
        {/* Red NOW line for today */}
        {days.map((d, idx) => {
          if (d.getTime() === todayKey) {
            return (
              <div key="now-line" className="absolute top-0 bottom-0 w-px bg-[var(--logbook-now-line)] z-10 pointer-events-none" style={{ left: `calc(${idx * (100 / 7)}% + ${(100 / 7) / 2}%)` }} />
            );
          }
          return null;
        })}

        {/* Day Cells Background */}
        {days.map((day, colIdx) => (
          <div 
            key={colIdx} 
            onClick={() => onDayClick(day)}
            className="p-2 cursor-pointer bg-[var(--logbook-card)] hover:bg-black/5 dark:hover:bg-white/5 relative z-0"
          />
        ))}

        {/* Absolute Segments Overlay */}
        <div className="absolute inset-0 pointer-events-none mt-4">
          {segments.map((seg, i) => {
            const leftPercent = (seg.startCol / 7) * 100;
            const widthPercent = (seg.span / 7) * 100;
            
            return (
              <div
                key={`seg-${i}`}
                className="absolute px-1.5 pointer-events-auto"
                style={{
                  top: seg.lane * 32,
                  left: `calc(${leftPercent}%)`,
                  width: `calc(${widthPercent}%)`,
                  height: 28,
                }}
              >
                <div
                  onClick={(e) => { e.stopPropagation(); onBarClick(seg.note); }}
                  className={`w-full h-full flex items-center px-3 overflow-hidden shadow-sm cursor-pointer hover:opacity-90 transition-opacity ${
                    seg.isStart ? "rounded-l-md" : "rounded-l-none border-l-2 border-dashed border-white/30"
                  } ${
                    seg.isEnd ? "rounded-r-md" : "rounded-r-none border-r-2 border-dashed border-white/30"
                  }`}
                  style={{ backgroundColor: `var(--logbook-bar-${seg.note.note_type})`, color: "white" }}
                >
                  {seg.isStart && <div className="w-1.5 h-full bg-black/20 mr-2 shrink-0" />}
                  <span className="text-xs font-medium truncate leading-none">{seg.note.title || "Untitled"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
