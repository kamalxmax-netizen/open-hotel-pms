import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CalendarIcon, RefreshCwIcon, PlayCircleIcon } from "lucide-react";
import { StockTrackingMode } from "@/lib/types";

interface SnapshotFilterBarProps {
  businessDate: string;
  setBusinessDate: (date: string) => void;
  categoryFilter: "all" | "pos" | "amenity";
  setCategoryFilter: (cat: "all" | "pos" | "amenity") => void;
  modeFilter: "all" | StockTrackingMode;
  setModeFilter: (mode: "all" | StockTrackingMode) => void;
  onRefresh: () => void;
  onRecompute?: () => void;
  isLoading: boolean;
  isRecomputing?: boolean;
}

export function SnapshotFilterBar({
  businessDate, setBusinessDate,
  categoryFilter, setCategoryFilter,
  modeFilter, setModeFilter,
  onRefresh, onRecompute, isLoading, isRecomputing
}: SnapshotFilterBarProps) {
  return (
    <div className="card p-4 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between dark:bg-[var(--bg-surface)]">
      <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
        <div className="relative w-full sm:w-44">
          <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <Input
            type="date"
            value={businessDate}
            onChange={e => setBusinessDate(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as any)}
            className="flex-1 sm:w-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand-ring)] outline-none"
          >
            <option value="all">All Categories</option>
            <option value="pos">POS</option>
            <option value="amenity">Amenity</option>
          </select>
          <select
            value={modeFilter}
            onChange={e => setModeFilter(e.target.value as any)}
            className="flex-1 sm:w-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--brand-ring)] outline-none"
          >
            <option value="all">All Modes</option>
            <option value="pos_main_only">POS Main Only</option>
            <option value="amenity_prepare">Amenity Prepare</option>
            <option value="amenity_direct">Amenity Direct</option>
          </select>
        </div>
      </div>
      <div className="w-full md:w-auto flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading || isRecomputing}>
          <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        {onRecompute && (
          <Button
            variant="default"
            size="sm"
            onClick={onRecompute}
            disabled={isLoading || isRecomputing}
            title="Recalculate this date's snapshot from stock_transactions_v2 (admin only)"
          >
            <PlayCircleIcon className={`w-4 h-4 mr-1 ${isRecomputing ? "animate-pulse" : ""}`} />
            {isRecomputing ? "Recomputing..." : "Recompute"}
          </Button>
        )}
      </div>
    </div>
  );
}
