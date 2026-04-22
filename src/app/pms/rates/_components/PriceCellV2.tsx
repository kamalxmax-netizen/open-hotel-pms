"use client";

import { useState, useRef, useEffect } from "react";

export function PriceCellV2({
  price,
  onSave,
  weekend,
  isToday,
  occTierClass
}: {
  price: number | null;
  onSave: (newPrice: number, oldPrice: number | null, resetInput: () => void) => Promise<void>;
  weekend: boolean;
  isToday: boolean;
  occTierClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(price ?? ""));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  
  // Sync val when price prop changes from outside
  useEffect(() => {
    if (!editing) setVal(String(price ?? ""));
  }, [price, editing]);

  async function commit() {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0 || num === price) { 
      setEditing(false); 
      setVal(String(price ?? "")); 
      return; 
    }
    setSaving(true);
    // Pass a callback to reset input if cancelled
    await onSave(num, price, () => {
      setVal(String(price ?? ""));
    });
    setSaving(false);
    setEditing(false);
  }

  // Determine base background
  let bgClass = "bg-[var(--bg-surface)]";
  if (occTierClass) {
    bgClass = occTierClass;
  } else if (isToday) {
    bgClass = "bg-brand-50 dark:bg-brand-900/40";
  } else if (weekend) {
    bgClass = "bg-rose-50/60 dark:bg-rose-950/20";
  }

  const baseClass = `h-full w-full flex items-center justify-center text-xs font-semibold transition cursor-pointer ${bgClass}
    ${price === null ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}
    hover:opacity-80`;

  if (saving) return <div className={baseClass}><span className="animate-spin text-brand-500">↻</span></div>;

  if (editing) {
    return (
      <div className={`h-full w-full flex items-center justify-center ${bgClass}`}>
        <input
          ref={inputRef}
          className="w-full text-center text-xs font-bold border-0 outline-none bg-transparent text-brand-700 dark:text-brand-400"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { 
            if (e.key === "Enter") commit(); 
            if (e.key === "Escape") {
              setEditing(false);
              setVal(String(price ?? ""));
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={baseClass} onClick={() => { setEditing(true); setVal(String(price ?? "")); }}>
      {price === null ? <span className="text-[10px] text-[var(--text-muted)]">+ Set</span> : `฿${price.toLocaleString("th-TH")}`}
    </div>
  );
}
