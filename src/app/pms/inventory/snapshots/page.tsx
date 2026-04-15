"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { SnapshotSummaryCards } from "@/components/inventory/snapshot-summary-cards";
import { SnapshotFilterBar } from "@/components/inventory/snapshot-filter-bar";
import { SnapshotTable } from "@/components/inventory/snapshot-table";
import { SnapshotDetailDrawer } from "@/components/inventory/snapshot-detail-drawer";
import { StockSnapshotResponse, StockSnapshotRow, StockSnapshotTxEntry, StockTrackingMode } from "@/lib/types";

function todayString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function DailySnapshotPage() {
  const { toast } = useToast();
  
  const [businessDate, setBusinessDate] = useState(todayString());
  const [categoryFilter, setCategoryFilter] = useState<"all" | "pos" | "amenity">("all");
  const [modeFilter, setModeFilter] = useState<"all" | StockTrackingMode>("all");
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [data, setData] = useState<StockSnapshotResponse | null>(null);

  const [selectedProduct, setSelectedProduct] = useState<StockSnapshotRow | null>(null);
  const [timeline, setTimeline] = useState<StockSnapshotTxEntry[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (categoryFilter !== "all") qs.append("category", categoryFilter);
      if (modeFilter !== "all") qs.append("tracking_mode", modeFilter);

      const res = await fetch(`/api/inventory/snapshots/${businessDate}?${qs.toString()}`);
      const apiData = await res.json();

      if (apiData.success) {
         // Support both `.rows` and `.snapshots` fields just in case
         apiData.rows = apiData.snapshots || apiData.rows || [];
         setData(apiData as StockSnapshotResponse);
      } else {
         throw new Error(apiData.error || "Failed to load stock snapshot");
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load stock snapshot",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [businessDate, categoryFilter, modeFilter, toast]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const recomputeSnapshot = useCallback(async () => {
    const defaultNote = `Admin manual recompute ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const note = typeof window !== "undefined"
      ? window.prompt(
          `Recompute stock snapshot for ${businessDate}?\n\nThis re-aggregates stock_transactions_v2 for this date and overwrites the stored snapshot.\n\nNote (required, min 1 char):`,
          defaultNote,
        )
      : defaultNote;

    if (note == null) return; // user cancelled
    const trimmed = note.trim();
    if (!trimmed) {
      toast({ title: "Note required", description: "Please provide a short reason.", variant: "destructive" });
      return;
    }

    setIsRecomputing(true);
    try {
      const res = await fetch(`/api/inventory/snapshots/${businessDate}/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      const apiData = await res.json();
      if (!res.ok || !apiData.success) {
        throw new Error(apiData.error || `Recompute failed (HTTP ${res.status})`);
      }
      toast({
        title: "Snapshot recomputed",
        description: `${apiData.products_computed ?? 0} product(s), ${apiData.variance_count ?? 0} with variance.`,
      });
      await fetchSnapshot();
    } catch (err) {
      toast({
        title: "Recompute failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsRecomputing(false);
    }
  }, [businessDate, fetchSnapshot, toast]);

  const loadTimeline = useCallback(async (productId: string) => {
    setIsLoadingTimeline(true);
    try {
      const res = await fetch(`/api/inventory/snapshots/${businessDate}/products/${productId}`);
      const apiData = await res.json();
      if (apiData.success && apiData.transactions) {
         setTimeline(apiData.transactions);
      } else {
         throw new Error(apiData.error || "Failed to load timeline");
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load transaction timeline",
        variant: "destructive",
      });
    } finally {
      setIsLoadingTimeline(false);
    }
  }, [businessDate, toast]);

  const handleRowClick = (row: StockSnapshotRow) => {
    setSelectedProduct(row);
    loadTimeline(row.product_id);
  };

  const handleCloseDrawer = () => {
    setSelectedProduct(null);
    setTimeline([]);
  };

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(row => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (modeFilter !== "all" && row.tracking_mode !== modeFilter) return false;
      return true;
    });
  }, [data, categoryFilter, modeFilter]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Inventory</p>
        <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Daily Stock Snapshot</h1>
      </div>

      <SnapshotSummaryCards summary={data?.summary || null} />

      <SnapshotFilterBar
        businessDate={businessDate}
        setBusinessDate={setBusinessDate}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        modeFilter={modeFilter}
        setModeFilter={setModeFilter}
        onRefresh={fetchSnapshot}
        onRecompute={recomputeSnapshot}
        isLoading={isLoading}
        isRecomputing={isRecomputing}
      />

      {isLoading && !data ? (
        <div className="card p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse flex-1 h-12 rounded-lg bg-[var(--bg-muted)]" />
          ))}
        </div>
      ) : (
        <SnapshotTable rows={filteredRows} onRowClick={handleRowClick} />
      )}

      <SnapshotDetailDrawer 
        product={selectedProduct}
        timeline={timeline}
        isLoadingTimeline={isLoadingTimeline}
        onClose={handleCloseDrawer}
      />
    </div>
  );
}
