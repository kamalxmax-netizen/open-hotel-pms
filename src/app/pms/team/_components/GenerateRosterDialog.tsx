"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RotateOption = {
  staff_id: string;
  nickname: string;
  night_rotation_order: number;
};

type GenerateRosterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  month: number;
  defaultNightStartOrder: number | null;
  rotateOptions: RotateOption[];
  loading: boolean;
  errorMessage: string | null;
  onConfirm: (payload: {
    year: number;
    month: number;
    nightStartPersonOrder: number;
  }) => void;
};

const YEAR_OPTIONS = [2025, 2026, 2027, 2028, 2029, 2030];
const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export default function GenerateRosterDialog({
  open,
  onOpenChange,
  year,
  month,
  defaultNightStartOrder,
  rotateOptions,
  loading,
  errorMessage,
  onConfirm,
}: GenerateRosterDialogProps) {
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [selectedOrder, setSelectedOrder] = useState<number>(defaultNightStartOrder ?? 1);

  const sortedRotateOptions = useMemo(
    () =>
      [...rotateOptions].sort(
        (a, b) => a.night_rotation_order - b.night_rotation_order || a.nickname.localeCompare(b.nickname, "th")
      ),
    [rotateOptions]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedYear(year);
    setSelectedMonth(month);
    if (defaultNightStartOrder) {
      setSelectedOrder(defaultNightStartOrder);
      return;
    }
    const first = sortedRotateOptions[0];
    setSelectedOrder(first?.night_rotation_order ?? 1);
  }, [open, year, month, defaultNightStartOrder, sortedRotateOptions]);

  const canSubmit = sortedRotateOptions.length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate FO Monthly Roster</DialogTitle>
          <DialogDescription>
            Build generated shifts for the selected month. Existing generated rows in that month will be replaced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {errorMessage ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 font-medium text-[var(--text-table-cell)]">Year</div>
              <select
                className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                value={selectedYear}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                disabled={loading}
              >
                {YEAR_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1 font-medium text-[var(--text-table-cell)]">Month</div>
              <select
                className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(Number(event.target.value))}
                disabled={loading}
              >
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-sm">
            <div className="mb-1 font-medium text-[var(--text-table-cell)]">Night Start Person</div>
            <select
              className="w-full rounded-md border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
              value={selectedOrder}
              onChange={(event) => setSelectedOrder(Number(event.target.value))}
              disabled={loading || sortedRotateOptions.length === 0}
            >
              {sortedRotateOptions.map((option) => (
                <option key={option.staff_id} value={option.night_rotation_order}>
                  {option.nickname} (order {option.night_rotation_order})
                </option>
              ))}
            </select>
            {sortedRotateOptions.length === 0 ? (
              <p className="mt-1 text-xs text-amber-700">
                No rotate staff in roster_config. Set rotate entries first.
              </p>
            ) : null}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onConfirm({
                year: selectedYear,
                month: selectedMonth,
                nightStartPersonOrder: selectedOrder,
              })
            }
            disabled={!canSubmit}
          >
            {loading ? "Generating..." : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

