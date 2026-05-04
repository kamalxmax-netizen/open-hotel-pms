"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

interface ShiftEntry {
  hour_slot: number;
  body: string;
  updated_at: string;
}

interface LogbookShiftLogProps {
  initialDate: Date;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null> | React.LegacyRef<HTMLDivElement>;
}

export function LogbookShiftLog({ initialDate, scrollContainerRef }: LogbookShiftLogProps) {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);
  const [entries, setEntries] = useState<Record<number, ShiftEntry>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"Saved" | "Saving..." | "Unsaved changes">("Saved");

  const dirtyRows = useRef<Set<string>>(new Set());
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  
  const [nowHour, setNowHour] = useState(new Date().getHours());
  const [nowMinute, setNowMinute] = useState(new Date().getMinutes());

  const isToday = currentDate.toDateString() === new Date().toDateString();
  const currentDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;

  const fetchEntries = useCallback(async (date: Date) => {
    setIsLoading(true);
    try {
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const res = await fetch(`/api/shift-log/${dateStr}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        const fetchedEntries = data.data.entries || [];
        const newMap: Record<number, ShiftEntry> = {};
        fetchedEntries.forEach((e: ShiftEntry) => {
          newMap[e.hour_slot] = e;
        });
        
        setEntries(prev => {
          const finalMap: Record<number, ShiftEntry> = { ...newMap };
          for (let i = 0; i < 24; i++) {
             const key = `${dateStr}:${i}`;
             if (dirtyRows.current.has(key) && prev[i]) {
               finalMap[i] = prev[i];
             }
          }
          return finalMap;
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries(currentDate);
    const interval = setInterval(() => {
      setNowHour(new Date().getHours());
      setNowMinute(new Date().getMinutes());
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDate, fetchEntries]);

  const saveRow = async (dateStr: string, hour: number, text: string) => {
    setSaveStatus("Saving...");
    try {
      const res = await fetch(`/api/shift-log/${dateStr}/${hour}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        dirtyRows.current.delete(`${dateStr}:${hour}`);
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus("Saved"), 2000);
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      console.error(error);
      setSaveStatus("Unsaved changes");
      toast({ title: "Error", description: "Failed to save shift log", variant: "destructive" });
    }
  };

  const handleTextChange = (dateStr: string, hour: number, text: string) => {
    setSaveStatus("Unsaved changes");
    const key = `${dateStr}:${hour}`;
    dirtyRows.current.add(key);
    
    // Only update local UI entries if they are still on the same date view!
    if (dateStr === currentDateStr) {
      setEntries(prev => ({ ...prev, [hour]: { ...prev[hour], hour_slot: hour, body: text, updated_at: "" } }));
    }
    
    if (debounceTimers.current[key]) {
      clearTimeout(debounceTimers.current[key]);
    }
    debounceTimers.current[key] = setTimeout(() => {
      saveRow(dateStr, hour, text);
    }, 3000);
  };

  const handleBlur = (dateStr: string, hour: number, text: string) => {
    const key = `${dateStr}:${hour}`;
    if (dirtyRows.current.has(key)) {
      if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
      saveRow(dateStr, hour, text);
    }
  };

  const scrollToSegment = (startHour: number) => {
    const el = document.getElementById(`shift-row-${startHour}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col bg-[var(--logbook-card)] rounded-xl border border-[var(--logbook-card-border)] overflow-hidden shadow-[var(--logbook-card-shadow)] h-full max-h-[800px]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--logbook-hairline)]">
        <div className="flex items-center gap-4">
          <input 
            type="date" 
            value={`${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`}
            onChange={(e) => {
              if (e.target.value) setCurrentDate(new Date(e.target.value));
            }}
            className="bg-[var(--logbook-canvas-alt)] border border-[var(--logbook-field-border)] rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--logbook-text-primary)]"
          />
          <div className="flex bg-[var(--logbook-canvas-alt)] p-1 rounded-full items-center">
            <button onClick={() => scrollToSegment(0)} className="px-3 py-1 rounded-full text-xs font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-text-primary)]">AM</button>
            <button onClick={() => scrollToSegment(8)} className="px-3 py-1 rounded-full text-xs font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-text-primary)]">PM</button>
            <button onClick={() => scrollToSegment(16)} className="px-3 py-1 rounded-full text-xs font-semibold text-[var(--logbook-text-secondary)] hover:text-[var(--logbook-text-primary)]">Night</button>
          </div>
        </div>
        <div className="text-sm font-medium text-[var(--logbook-text-secondary)]">
          {saveStatus}
        </div>
      </div>

      {/* Grid */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div ref={scrollContainerRef as any} className="flex-1 overflow-y-auto relative">
        {Array.from({ length: 24 }).map((_, hour) => {
          const isNowHour = isToday && hour === nowHour;
          const entry = entries[hour];
          
          return (
            <div 
              key={hour} 
              id={`shift-row-${hour}`}
              className={`flex border-b border-[var(--logbook-hairline)] min-h-[60px] relative ${isNowHour ? "bg-[var(--logbook-row-now)]" : "bg-[var(--logbook-card)]"}`}
            >
              {/* NOW line */}
              {isNowHour && (
                <div 
                  className="absolute left-0 right-0 h-px bg-[var(--logbook-now-line)] z-10 pointer-events-none" 
                  style={{ top: `${(nowMinute / 60) * 100}%` }} 
                />
              )}
              
              <div className="w-[80px] shrink-0 border-r border-[var(--logbook-hairline)] p-3 text-sm font-semibold text-[var(--logbook-text-secondary)] flex items-start justify-end">
                {String(hour).padStart(2, "0")}:00
              </div>
              
              <div className="flex-1 p-0 relative">
                <textarea
                  className="w-full bg-transparent resize-none p-3 text-sm text-[var(--logbook-text-primary)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--logbook-brand-heading)] overflow-hidden"
                  placeholder="Normal Situation"
                  rows={1}
                  value={entry?.body || ""}
                  onChange={(e) => { handleTextChange(currentDateStr, hour, e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                  onBlur={(e) => handleBlur(currentDateStr, hour, e.target.value)}
                  style={{ minHeight: "2.5rem" }}
                  ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
