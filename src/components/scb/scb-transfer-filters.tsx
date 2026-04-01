"use client";

type ScbTransferFiltersValue = {
  from: string;
  to: string;
  amountMin: string;
  amountMax: string;
  channel: "all" | "booking_folio" | "mobile_checkin" | "pos";
};

function todayInBangkok(offsetDays = 0): string {
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  base.setDate(base.getDate() + offsetDays);
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type Props = {
  value: ScbTransferFiltersValue;
  onChange: (next: Partial<ScbTransferFiltersValue>) => void;
  onClear: () => void;
};

export function ScbTransferFilters({ value, onChange, onClear }: Props) {
  const applyPreset = (kind: "today" | "yesterday" | "7d" | "30d") => {
    if (kind === "today") {
      const date = todayInBangkok(0);
      onChange({ from: date, to: date });
      return;
    }
    if (kind === "yesterday") {
      const date = todayInBangkok(-1);
      onChange({ from: date, to: date });
      return;
    }
    if (kind === "7d") {
      onChange({ from: todayInBangkok(-6), to: todayInBangkok(0) });
      return;
    }
    onChange({ from: todayInBangkok(-29), to: todayInBangkok(0) });
  };

  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset("today")}>Today</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset("yesterday")}>Yesterday</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset("7d")}>7D</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset("30d")}>30D</button>
      </div>
      <div className="grid gap-3 md:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">From</span>
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ from: e.target.value })}
            className="form-input h-10"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">To</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ to: e.target.value })}
            className="form-input h-10"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Min</span>
          <input
            type="number"
            min="0"
            value={value.amountMin}
            onChange={(e) => onChange({ amountMin: e.target.value })}
            className="form-input h-10"
            placeholder="0"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Max</span>
          <input
            type="number"
            min="0"
            value={value.amountMax}
            onChange={(e) => onChange({ amountMax: e.target.value })}
            className="form-input h-10"
            placeholder="0"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">Channel</span>
          <select
            value={value.channel}
            onChange={(e) => onChange({ channel: e.target.value as ScbTransferFiltersValue["channel"] })}
            className="form-select h-10"
          >
            <option value="all">All</option>
            <option value="booking_folio">Booking</option>
            <option value="mobile_checkin">Mobile</option>
            <option value="pos">POS</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="btn btn-ghost w-full" onClick={onClear}>Clear filters</button>
        </div>
      </div>
    </div>
  );
}

export type { ScbTransferFiltersValue };
