"use client";

import type { DynamicPreviewRow } from "@/lib/rates/dynamic-types";

type SuggestionRowProps = {
  row: DynamicPreviewRow;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
};

export default function SuggestionRow({ row, selected, onSelect, onApprove, onReject }: SuggestionRowProps) {
  return (
    <tr className="border-t hover:bg-black/5 dark:hover:bg-white/5 transition">
      <td className="text-center py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </td>
      <td className="py-3 px-4 whitespace-nowrap">{row.stay_date}</td>
      <td className="py-3 px-4 font-medium">{row.room_type_name}</td>
      <td className="py-3 px-4 text-[var(--text-secondary)]">{row.applied_rule_group_name}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="text-[var(--text-muted)] line-through">฿{row.base_price}</span>
          <span>&rarr;</span>
          <span className={`font-bold ${row.direction === "up" ? "text-emerald-600" : row.direction === "down" ? "text-rose-600" : ""}`}>
            ฿{row.suggested_price}
          </span>
        </div>
        <div className={`text-xs ${row.direction === "up" ? "text-emerald-500" : row.direction === "down" ? "text-rose-500" : "text-[var(--text-muted)]"}`}>
          {row.direction === "up" ? "+" : ""}{Math.round(row.delta_pct * 10000) / 100}%
        </div>
      </td>
      <td className="py-3 px-4 text-center space-x-1">
        {row.clamped_to_floor && <span className="badge badge-amber text-xs" title="Clamped to Min Rate Floor">Floor</span>}
        {row.clamped_to_max && <span className="badge badge-amber text-xs" title="Clamped to Max Multiplier">Max</span>}
        {row.direction_override && <span className="badge badge-sky text-xs" title="Auto-apply blocked due to price down">Auto Blocked</span>}
      </td>
      <td className="py-3 px-4 text-right space-x-2">
        <button className="btn btn-secondary text-xs px-2 py-1" onClick={onReject}>
          Reject
        </button>
        <button className="btn btn-primary text-xs px-2 py-1" onClick={onApprove}>
          Approve
        </button>
      </td>
    </tr>
  );
}
