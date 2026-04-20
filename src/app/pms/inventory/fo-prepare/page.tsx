"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type FoSuggestion = {
  floor_number: number;
  product_id: string;
  product_name: string;
  unit: string;
  room_count: number;
  suggested_qty: number;
};

type FoDirtyCarryoverRoom = {
  room_id: string;
  room_number: string;
  floor_number: number;
  room_type_code: string;
  task_date: string;
  task_status: "dirty" | "in_progress" | "paused";
};

type FoBatch = {
  id: string;
  business_date: string;
  status: "prepared" | "returned" | "cancelled";
  return_status?: "pending" | "reconciled" | "legacy";
  prepared_at: string;
  prepared_by: string | null;
  prepare_note: string | null;
  insufficient_warning: boolean;
  returned_at: string | null;
  returned_by: string | null;
  return_note: string | null;
  return_override_note: string | null;
};

type FoBatchItem = {
  id: string;
  floor_number: number;
  product_id: string;
  product_name: string;
  unit: string;
  suggested_qty: number;
  requested_qty: number;
  prepared_qty: number;
  shortage_qty: number;
  used_qty: number;
  remaining_qty: number;
  returned_qty: number;
  return_note: string | null;
  floor_current_qty: number;
  suggested_remaining: number;
  returnable_max: number;
};

type FoCanReturn = {
  all_rooms_finished: boolean;
  total_rooms: number;
  finished_rooms: number;
  pending_rooms: string[];
};

type FoBatchDetail = {
  batch: FoBatch;
  items: FoBatchItem[];
};

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
  success?: boolean;
  error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return {} as ApiResponse<T>;
  }
}

function todayBangkok(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year ?? "2026"}-${month ?? "01"}-${day ?? "01"}`;
}

function mergeFoSuggestions(rows: FoSuggestion[]): FoSuggestion[] {
  const byKey = new Map<string, FoSuggestion>();
  for (const row of rows) {
    const key = `${row.floor_number}:${row.product_id}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...row });
      continue;
    }
    current.room_count += row.room_count;
    current.suggested_qty += row.suggested_qty;
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
    return a.product_name.localeCompare(b.product_name, undefined, { sensitivity: "base" });
  });
}

type TabKey = "prepare" | "return";
type ReturnFeedback = { kind: "info" | "success" | "error"; message: string } | null;
type PrepareFeedback = { kind: "info" | "success" | "error"; message: string } | null;

export default function FoPreparePage() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("prepare");
  const [businessDate, setBusinessDate] = useState<string>(todayBangkok());
  const [preparedBy, setPreparedBy] = useState<string>("FO");
  const [prepareNote, setPrepareNote] = useState<string>("");
  const [returnedBy, setReturnedBy] = useState<string>("FO");
  const [returnNote, setReturnNote] = useState<string>("");
  const [forceReturn, setForceReturn] = useState<boolean>(false);
  const [overrideNote, setOverrideNote] = useState<string>("");

  const [targetRoomsCount, setTargetRoomsCount] = useState<number>(0);
  const [suggestions, setSuggestions] = useState<FoSuggestion[]>([]);
  const [dirtyCarryoverRooms, setDirtyCarryoverRooms] = useState<FoDirtyCarryoverRoom[]>([]);
  const [dirtyCarryoverSuggestions, setDirtyCarryoverSuggestions] = useState<FoSuggestion[]>([]);
  const [includeDirtyCarryover, setIncludeDirtyCarryover] = useState<boolean>(false);
  const [existingBatch, setExistingBatch] = useState<FoBatch | null>(null);
  const [returnTargetBatch, setReturnTargetBatch] = useState<FoBatch | null>(null);
  const [batchDetail, setBatchDetail] = useState<FoBatchDetail | null>(null);
  const [canReturn, setCanReturn] = useState<FoCanReturn | null>(null);

  const [prepareQtyMap, setPrepareQtyMap] = useState<Record<string, number>>({});
  const [returnQtyMap, setReturnQtyMap] = useState<Record<string, number>>({});
  const [damagedQtyMap, setDamagedQtyMap] = useState<Record<string, number>>({});
  const [lineNoteMap, setLineNoteMap] = useState<Record<string, string>>({});

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPreparing, setIsPreparing] = useState<boolean>(false);
  const [isReturning, setIsReturning] = useState<boolean>(false);
  const [prepareFeedback, setPrepareFeedback] = useState<PrepareFeedback>(null);
  const [returnFeedback, setReturnFeedback] = useState<ReturnFeedback>(null);

  const prepareKey = (row: FoSuggestion) => `${row.floor_number}:${row.product_id}`;

  const loadPrepareData = useCallback(
    async (date: string) => {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/stock/fo-prepare?date=${encodeURIComponent(date)}`);
        const data = await readJsonSafe<{
          business_date?: string;
          target_rooms_count?: number;
          suggestions?: FoSuggestion[];
          dirty_carryover_rooms?: FoDirtyCarryoverRoom[];
          dirty_carryover_suggestions?: FoSuggestion[];
          existing_batch?: FoBatch | null;
          return_target_batch?: FoBatch | null;
          batch_detail?: FoBatchDetail | null;
          can_return?: FoCanReturn | null;
        }>(res);

        if (!res.ok || data.success === false) {
          throw new Error(data.error || "Failed to load FO prepare data");
        }

        const resolvedDate = String(data.business_date ?? date);
        setBusinessDate(resolvedDate);
        setTargetRoomsCount(Number(data.target_rooms_count ?? 0));
        const nextSuggestions = (data.suggestions ?? []) as FoSuggestion[];
        setSuggestions(nextSuggestions);
        setDirtyCarryoverRooms((data.dirty_carryover_rooms ?? []) as FoDirtyCarryoverRoom[]);
        setDirtyCarryoverSuggestions((data.dirty_carryover_suggestions ?? []) as FoSuggestion[]);
        setIncludeDirtyCarryover(false);

        const nextPrepareQtyMap: Record<string, number> = {};
        for (const row of nextSuggestions) {
          nextPrepareQtyMap[prepareKey(row)] = row.suggested_qty;
        }
        setPrepareQtyMap(nextPrepareQtyMap);

        const nextBatch = (data.existing_batch as FoBatch | null) ?? null;
        setExistingBatch(nextBatch);
        setReturnTargetBatch((data.return_target_batch as FoBatch | null) ?? null);

        if (data.batch_detail) {
          setBatchDetail(data.batch_detail as FoBatchDetail);
          setCanReturn((data.can_return as FoCanReturn) ?? null);
          const nextReturnQtyMap: Record<string, number> = {};
          const nextDamagedQtyMap: Record<string, number> = {};
          const nextLineNotes: Record<string, string> = {};
          for (const row of (data.batch_detail as FoBatchDetail).items ?? []) {
            nextReturnQtyMap[row.id] = row.returned_qty > 0 ? row.returned_qty : row.returnable_max;
            nextDamagedQtyMap[row.id] = 0;
            nextLineNotes[row.id] = row.return_note ?? "";
          }
          setReturnQtyMap(nextReturnQtyMap);
          setDamagedQtyMap(nextDamagedQtyMap);
          setLineNoteMap(nextLineNotes);
        } else {
          setBatchDetail(null);
          setCanReturn(null);
          setReturnQtyMap({});
          setDamagedQtyMap({});
          setLineNoteMap({});
        }
        setPrepareFeedback(null);
        setReturnFeedback(null);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadPrepareData(businessDate).catch((err) => {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load data",
        variant: "destructive",
      });
    });
  }, [businessDate, loadPrepareData, toast]);

  const effectiveSuggestions = useMemo(
    () =>
      includeDirtyCarryover
        ? mergeFoSuggestions([...suggestions, ...dirtyCarryoverSuggestions])
        : suggestions,
    [dirtyCarryoverSuggestions, includeDirtyCarryover, suggestions]
  );

  const effectiveTargetRoomsCount = targetRoomsCount + (includeDirtyCarryover ? dirtyCarryoverRooms.length : 0);

  const totalSuggestedQty = useMemo(
    () => effectiveSuggestions.reduce((sum, row) => sum + Math.max(Number(row.suggested_qty ?? 0), 0), 0),
    [effectiveSuggestions]
  );

  const totalPrepareQty = useMemo(
    () =>
      effectiveSuggestions.reduce((sum, row) => {
        const key = prepareKey(row);
        return sum + Math.max(Number(prepareQtyMap[key] ?? 0), 0);
      }, 0),
    [effectiveSuggestions, prepareQtyMap]
  );

  const canPrepareNow = !existingBatch;

  const handleDirtyCarryoverToggle = (checked: boolean) => {
    setIncludeDirtyCarryover(checked);
    setPrepareQtyMap((prev) => {
      const nextMap = { ...prev };
      const nextRows = checked
        ? mergeFoSuggestions([...suggestions, ...dirtyCarryoverSuggestions])
        : suggestions;
      const validKeys = new Set(nextRows.map((row) => prepareKey(row)));
      for (const row of nextRows) {
        nextMap[prepareKey(row)] = row.suggested_qty;
      }
      for (const key of Object.keys(nextMap)) {
        if (!validKeys.has(key)) delete nextMap[key];
      }
      return nextMap;
    });
  };

  const handlePrepareSubmit = async () => {
    if (!canPrepareNow) {
      toast({
        title: "Batch already exists",
        description: "This business date already has a prepare batch.",
        variant: "destructive",
      });
      return;
    }

    const items = effectiveSuggestions
      .map((row) => {
        const key = prepareKey(row);
        return {
          floor_number: row.floor_number,
          product_id: row.product_id,
          suggested_qty: row.suggested_qty,
          prepare_qty: Math.max(Number(prepareQtyMap[key] ?? 0), 0),
        };
      })
      .filter((row) => row.prepare_qty > 0);

    if (items.length === 0) {
      toast({
        title: "Nothing to prepare",
        description: "Set at least one prepare quantity greater than 0.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsPreparing(true);
      const res = await fetch("/api/stock/fo-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_date: businessDate,
          prepared_by: preparedBy || undefined,
          note: prepareNote || undefined,
          items,
        }),
      });
      const data = await readJsonSafe<{
        result?: { has_shortage?: boolean; total_shortage?: number };
        batch_detail?: FoBatchDetail;
        shortages?: Array<{
          product_name?: string;
          requested_qty?: number;
          available_qty?: number;
        }>;
      }>(res);

      if (!res.ok || data.success === false) {
        const shortages = Array.isArray(data.shortages) ? data.shortages : [];
        const allOutOfStock = shortages.length > 0 && shortages.every((row) => Number(row.available_qty ?? 0) <= 0);
        const shortageSummary = shortages
          .map((row) => {
            const productName = String(row.product_name ?? "Unknown product");
            const availableQty = Number(row.available_qty ?? 0);
            const requestedQty = Number(row.requested_qty ?? 0);
            return `${productName} (need ${requestedQty}, have ${availableQty})`;
          })
          .join(", ");
        const message =
          allOutOfStock
            ? `Main stock is out: ${shortageSummary || "selected products"}. Refill stock before adding to floor stock.`
            : data.error || "Prepare failed";

        setPrepareFeedback({
          kind: "error",
          message,
        });
        toast({
          title: allOutOfStock ? "Main stock is out" : "Prepare failed",
          description: message,
          variant: "destructive",
        });
        return;
      }

      const shortage = Number((data.result as any)?.total_shortage ?? 0);
      if (shortage > 0) {
        setPrepareFeedback({
          kind: "error",
          message: `Main stock is short by ${shortage}. Please refill stock before continuing.`,
        });
        toast({
          title: "Prepared with shortage",
          description: `Main stock not enough for some items (shortage ${shortage}).`,
          variant: "destructive",
        });
      } else {
        setPrepareFeedback({
          kind: "success",
          message: "Daily prepare batch has been added to floor stock.",
        });
        toast({
          title: "Prepared",
          description: "Daily prepare batch has been added to floor stock.",
        });
      }

      await loadPrepareData(businessDate);
      setActiveTab("return");
    } catch (err) {
      setPrepareFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Prepare failed",
      });
      toast({
        title: "Prepare failed",
        description: err instanceof Error ? err.message : "Prepare failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparing(false);
    }
  };

  const handleReturnSubmit = async () => {
    if (!batchDetail) {
      setReturnFeedback({
        kind: "error",
        message: "No return batch loaded. Please refresh and try again.",
      });
      return;
    }
    if (batchDetail.batch.status !== "prepared") {
      setReturnFeedback({
        kind: "info",
        message: "This batch is already closed and cannot be returned again.",
      });
      toast({
        title: "Batch already closed",
        description: "This batch has already been returned.",
      });
      return;
    }

    const items = batchDetail.items
      .filter((row) => row.prepared_qty > 0)
      .map((row) => ({
        item_id: row.id,
        return_qty: Math.max(Number(returnQtyMap[row.id] ?? 0), 0),
        damaged_qty: Math.max(Number(damagedQtyMap[row.id] ?? 0), 0),
        note: (lineNoteMap[row.id] ?? "").trim() || undefined,
        product_name: row.product_name,
        floor_number: row.floor_number,
        suggested_remaining: row.suggested_remaining,
      }));

    if (items.length === 0) {
      setReturnFeedback({
        kind: "info",
        message: "No prepared items in this batch. System will close this batch as returned.",
      });
    }

    for (const item of items) {
      const row = batchDetail.items.find((it) => it.id === item.item_id);
      if (!row) continue;
      const accountedQty = item.return_qty + item.damaged_qty;
      if (accountedQty < row.suggested_remaining) {
        setReturnFeedback({
          kind: "error",
          message: `${item.product_name} floor ${item.floor_number}: return + damaged qty must clear all floor stock.`,
        });
        toast({
          title: "Invalid return qty",
          description: `${item.product_name} floor ${item.floor_number}: return + damaged qty must clear all floor stock.`,
          variant: "destructive",
        });
        return;
      }
      if (item.damaged_qty > 0 && !item.note) {
        setReturnFeedback({
          kind: "error",
          message: `${item.product_name} floor ${item.floor_number}: note required when damaged qty is entered.`,
        });
        toast({
          title: "Damage note required",
          description: `${item.product_name} floor ${item.floor_number}: add note for damaged qty.`,
          variant: "destructive",
        });
        return;
      }
      if (accountedQty > row.suggested_remaining && !item.note) {
        setReturnFeedback({
          kind: "error",
          message: `${item.product_name} floor ${item.floor_number}: note required when return/damage exceeds system floor stock.`,
        });
        toast({
          title: "Note required",
          description: `${item.product_name} floor ${item.floor_number}: add note when return/damage exceeds system floor stock.`,
          variant: "destructive",
        });
        return;
      }
    }

    if (items.length > 0 && canReturn && !canReturn.all_rooms_finished && !forceReturn) {
      setReturnFeedback({
        kind: "error",
        message: `Rooms still pending (${canReturn.finished_rooms}/${canReturn.total_rooms}). Enable Force return now to continue.`,
      });
      toast({
        title: "Rooms still pending",
        description: "Not all target rooms are finished. Enable force return to continue.",
        variant: "destructive",
      });
      return;
    }

    if (items.length > 0 && forceReturn && !overrideNote.trim()) {
      setReturnFeedback({
        kind: "error",
        message: "Override note is required when Force return now is enabled.",
      });
      toast({
        title: "Override note required",
        description: "Please enter override note for force return.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsReturning(true);
      setReturnFeedback({ kind: "info", message: "Submitting return transaction..." });
      const res = await fetch(`/api/stock/fo-prepare/${batchDetail.batch.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returned_by: returnedBy || undefined,
          note: returnNote || undefined,
          force: forceReturn,
          override_note: overrideNote || undefined,
          items: items.map((item) => ({
            item_id: item.item_id,
            return_qty: item.return_qty,
            damaged_qty: item.damaged_qty,
            note: item.note,
          })),
        }),
      });
      const data = await readJsonSafe<{
        batch_detail?: FoBatchDetail;
      }>(res);

      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Return failed");
      }

      const isEmptyBatchClose = items.length === 0;
      toast({
        title: isEmptyBatchClose ? "Batch closed" : "Returned",
        description: isEmptyBatchClose
          ? "No prepared items found. Batch is closed successfully."
          : items.some((item) => item.damaged_qty > 0)
            ? "Remaining stock returned; damaged stock written off."
            : "Remaining floor stock has been returned to main stock.",
      });
      setReturnFeedback({
        kind: "success",
        message: isEmptyBatchClose
          ? "Batch closed successfully (no prepared items)."
          : "Return completed. Remaining stock moved back to main stock.",
      });

      setForceReturn(false);
      setOverrideNote("");
      setReturnNote("");
      if (data.batch_detail) {
        setBatchDetail(data.batch_detail as FoBatchDetail);
      }
      await loadPrepareData(businessDate);
    } catch (err) {
      setReturnFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Return failed",
      });
      toast({
        title: "Return failed",
        description: err instanceof Error ? err.message : "Return failed",
        variant: "destructive",
      });
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Inventory</p>
          <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">FO Daily Prepare</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Morning prepare by room sale (Amenity products), then end-of-day return to main stock.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Business Date</label>
            <Input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="mt-1 h-9 w-[180px]"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadPrepareData(businessDate)}
            disabled={isLoading}
            className="h-9"
          >
            <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] font-medium">Target Rooms</p>
          <p className="text-2xl font-extrabold text-[var(--text-primary)]">{effectiveTargetRoomsCount}</p>
          {includeDirtyCarryover && dirtyCarryoverRooms.length > 0 && (
            <p className="mt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              includes {dirtyCarryoverRooms.length} dirty carryover
            </p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] font-medium">Suggested Qty</p>
          <p className="text-2xl font-extrabold text-[var(--text-primary)]">{totalSuggestedQty}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] font-medium">Prepare Qty</p>
          <p className="text-2xl font-extrabold text-[var(--text-primary)]">{totalPrepareQty}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[var(--text-secondary)] font-medium">Batch Status</p>
          <p className="text-xl font-extrabold text-[var(--text-primary)]">
            {existingBatch ? existingBatch.status.toUpperCase() : "NOT PREPARED"}
          </p>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-[var(--bg-muted)] p-1 w-fit">
        <button
          onClick={() => setActiveTab("prepare")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === "prepare" ? "bg-[var(--bg-surface)] text-brand-700 dark:text-brand-400 shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]"
          }`}
        >
          Morning Prepare
        </button>
        <button
          onClick={() => setActiveTab("return")}
          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
            activeTab === "return" ? "bg-[var(--bg-surface)] text-brand-700 dark:text-brand-400 shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]"
          }`}
        >
          End-of-day Return
        </button>
      </div>

      {activeTab === "prepare" ? (
        <div className="space-y-4">
          {existingBatch && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-3 text-sm text-amber-800 dark:text-amber-400">
              <p className="font-semibold">
                Daily prepare batch already created ({existingBatch.status}) for {existingBatch.business_date}.
              </p>
              <p className="text-xs mt-1">
                To adjust after prepare, use End-of-day return (with note) or manual stock adjustment.
              </p>
            </div>
          )}
          {prepareFeedback && (
            <div
              className={`rounded-xl border p-3 text-sm ${
                prepareFeedback.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                  : prepareFeedback.kind === "info"
                    ? "border-sky-200 bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400"
                    : "border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
              }`}
            >
              {prepareFeedback.message}
            </div>
          )}

          {!isLoading && dirtyCarryoverRooms.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold">
                    Dirty rooms carried over from previous day: {dirtyCarryoverRooms.length} room(s).
                  </p>
                  <p className="mt-1 text-xs">
                    Rooms: {dirtyCarryoverRooms.map((room) => room.room_number).slice(0, 14).join(", ")}
                    {dirtyCarryoverRooms.length > 14 ? " ..." : ""}
                  </p>
                  <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={includeDirtyCarryover}
                      disabled={!canPrepareNow || dirtyCarryoverSuggestions.length === 0}
                      onChange={(event) => handleDirtyCarryoverToggle(event.target.checked)}
                      className="h-4 w-4 rounded border-[var(--border-input)]"
                    />
                    Add Water / Coffee for these dirty rooms to FO Prepare
                  </label>
                  {dirtyCarryoverSuggestions.length === 0 && (
                    <p className="mt-2 text-xs">
                      No Water/Coffee checklist item found for these room types, so nothing can be added automatically.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="card p-4">
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Prepared By</label>
              <Input
                value={preparedBy}
                onChange={(e) => setPreparedBy(e.target.value)}
                placeholder="FO name"
                className="mt-1 h-9"
                disabled={!canPrepareNow}
              />
            </div>
            <div className="card p-4">
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Prepare Note</label>
              <Input
                value={prepareNote}
                onChange={(e) => setPrepareNote(e.target.value)}
                placeholder="Optional note"
                className="mt-1 h-9"
                disabled={!canPrepareNow}
              />
            </div>
          </div>

          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div key={idx} className="h-11 rounded-md bg-[var(--bg-muted)] animate-pulse" />
                ))}
              </div>
            ) : effectiveSuggestions.length === 0 ? (
              <div className="p-10 text-center text-[var(--text-secondary)] text-sm">
                No daily-prepare suggestions found for this date.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-body)]/80">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Floor</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Rooms</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Suggested</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Prepare Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {effectiveSuggestions.map((row) => {
                      const key = prepareKey(row);
                      return (
                        <tr key={key}>
                          <td className="px-4 py-2.5 font-medium text-[var(--text-table-cell)]">Floor {row.floor_number}</td>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-[var(--text-primary)]">{row.product_name}</p>
                            <p className="text-[11px] text-[var(--text-secondary)]">{row.unit}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{row.room_count}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[var(--text-table-cell)]">{row.suggested_qty}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Input
                              type="number"
                              min={0}
                              value={String(prepareQtyMap[key] ?? 0)}
                              disabled={!canPrepareNow}
                              onChange={(e) =>
                                setPrepareQtyMap((prev) => ({
                                  ...prev,
                                  [key]: Math.max(Number(e.target.value || 0), 0),
                                }))
                              }
                              className="h-8 w-24 ml-auto text-right"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handlePrepareSubmit}
              disabled={!canPrepareNow || isPreparing || isLoading || effectiveSuggestions.length === 0}
              className="bg-brand-600 hover:bg-brand-700 text-white"
            >
              <SaveIcon className="w-4 h-4 mr-1.5" />
              {isPreparing ? "Preparing..." : "Add to Floor Stock"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!batchDetail ? (
            <div className="card p-10 text-center text-[var(--text-secondary)] text-sm">
              No pending return batch found for this date.
            </div>
          ) : (
            <>
              {returnTargetBatch && returnTargetBatch.business_date !== businessDate && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-3 text-sm text-amber-800 dark:text-amber-400">
                  <p className="font-semibold">
                    Pending return from {returnTargetBatch.business_date} is shown first.
                  </p>
                  <p className="text-xs mt-1">
                    Return this older batch before processing newer return batches.
                  </p>
                </div>
              )}
              {returnFeedback && (
                <div
                  className={`rounded-xl border p-3 text-sm ${
                    returnFeedback.kind === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                      : returnFeedback.kind === "info"
                        ? "border-sky-200 bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400"
                        : "border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
                  }`}
                >
                  {returnFeedback.message}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="card p-4">
                  <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Returned By</label>
                  <Input
                    value={returnedBy}
                    onChange={(e) => setReturnedBy(e.target.value)}
                    className="mt-1 h-9"
                    disabled={batchDetail?.batch.status !== "prepared"}
                  />
                </div>
                <div className="card p-4">
                  <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Return Note</label>
                  <Input
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    className="mt-1 h-9"
                    placeholder="Optional summary note"
                    disabled={batchDetail?.batch.status !== "prepared"}
                  />
                </div>
              </div>

              {canReturn && !canReturn.all_rooms_finished && batchDetail?.batch.status === "prepared" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-3 text-amber-800 dark:text-amber-400">
                  <div className="flex items-start gap-2">
                    <AlertTriangleIcon className="w-4 h-4 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-semibold">
                        Not all rooms are finished ({canReturn.finished_rooms}/{canReturn.total_rooms}).
                      </p>
                      <p className="text-xs mt-1">
                        Pending rooms: {canReturn.pending_rooms.slice(0, 12).join(", ")}
                        {canReturn.pending_rooms.length > 12 ? " ..." : ""}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={forceReturn}
                        onChange={(e) => setForceReturn(e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border-input)]"
                      />
                      Force return now
                    </label>
                    {forceReturn && (
                      <Input
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                        placeholder="Override reason (required)"
                        className="h-9"
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="card overflow-hidden">
                {!batchDetail ? (
                  <div className="p-10 text-center text-[var(--text-secondary)] text-sm">Loading batch details...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-body)]/80">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Floor</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Prepared</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Used</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">System Remaining</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Floor Current</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Return Qty</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Damaged</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] uppercase">Line Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {batchDetail.items.map((row) => (
                          <tr key={row.id}>
                            <td className="px-4 py-2.5 font-medium text-[var(--text-table-cell)]">Floor {row.floor_number}</td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-[var(--text-primary)]">{row.product_name}</p>
                              <p className="text-[11px] text-[var(--text-secondary)]">{row.unit}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-table-cell)]">{row.prepared_qty}</td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-table-cell)]">{row.used_qty}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[var(--text-primary)]">
                              {row.suggested_remaining}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-table-cell)]">{row.floor_current_qty}</td>
                            <td className="px-4 py-2.5 text-right">
                              <Input
                                type="number"
                                min={0}
                                value={String(returnQtyMap[row.id] ?? row.returnable_max)}
                                disabled={batchDetail.batch.status !== "prepared"}
                                onChange={(e) =>
                                  setReturnQtyMap((prev) => ({
                                    ...prev,
                                    [row.id]: Math.max(Number(e.target.value || 0), 0),
                                  }))
                                }
                                className="h-8 w-24 ml-auto text-right"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Input
                                type="number"
                                min={0}
                                value={String(damagedQtyMap[row.id] ?? 0)}
                                disabled={batchDetail.batch.status !== "prepared"}
                                onChange={(e) =>
                                  setDamagedQtyMap((prev) => ({
                                    ...prev,
                                    [row.id]: Math.max(Number(e.target.value || 0), 0),
                                  }))
                                }
                                className="h-8 w-24 ml-auto text-right"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <Input
                                value={lineNoteMap[row.id] ?? ""}
                                onChange={(e) =>
                                  setLineNoteMap((prev) => ({
                                    ...prev,
                                    [row.id]: e.target.value,
                                  }))
                                }
                                placeholder={
                                  Number(returnQtyMap[row.id] ?? row.returnable_max) + Number(damagedQtyMap[row.id] ?? 0) > row.suggested_remaining
                                    ? "Required when qty exceeds system"
                                    : "Optional"
                                }
                                disabled={batchDetail.batch.status !== "prepared"}
                                className="h-8 min-w-[180px]"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleReturnSubmit}
                  disabled={isReturning || !batchDetail || batchDetail.batch.status !== "prepared"}
                  className="bg-brand-600 hover:bg-brand-700 text-white"
                >
                  <SaveIcon className="w-4 h-4 mr-1.5" />
                  {isReturning ? "Returning..." : "Return Remaining Stock"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
