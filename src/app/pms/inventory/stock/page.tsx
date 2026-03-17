"use client";

import { useState, useEffect, useCallback } from "react";
import {
    PackageIcon, RefreshCwIcon, PlusIcon,
    MinusIcon, AlertTriangleIcon, CheckCircle2Icon, XCircleIcon,
    TruckIcon
} from "lucide-react";
import { MainStock, FloorStock } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

/* ── Helpers ── */

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
    success?: boolean;
    error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
    try { return (await response.json()) as ApiResponse<T>; }
    catch { return {} as ApiResponse<T>; }
}

type StockTab = "main" | "floor_1" | "floor_2" | "floor_3";

interface MainStockRow extends MainStock {
    category?: string | null;
    unit?: string | null;
    is_low_stock?: boolean;
    show_on_inventory_dashboard?: boolean;
}

interface FloorStockRow extends FloorStock {
    unit?: string | null;
    category?: string | null;
}

function sortByProductNameZA<T extends { product_name?: string | null }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
        (b.product_name ?? "").localeCompare(a.product_name ?? "", undefined, { sensitivity: "base" })
    );
}

/* ── Component ── */

export default function StockLevelsPage() {
    const { toast } = useToast();

    const [activeTab, setActiveTab] = useState<StockTab>("main");
    const [mainStock, setMainStock] = useState<MainStockRow[]>([]);
    const [floorStocks, setFloorStocks] = useState<Record<number, FloorStockRow[]>>({});
    const [isLoading, setIsLoading] = useState(true);

    // Transfer modal
    const [transferOpen, setTransferOpen] = useState(false);
    const [transferProduct, setTransferProduct] = useState<string>("");
    const [transferFloor, setTransferFloor] = useState<number>(1);
    const [transferQty, setTransferQty] = useState<number>(0);
    const [transferNote, setTransferNote] = useState("");
    const [isTransferring, setIsTransferring] = useState(false);

    // Receive modal
    const [receiveOpen, setReceiveOpen] = useState(false);
    const [receiveProduct, setReceiveProduct] = useState<string>("");
    const [receiveQty, setReceiveQty] = useState<number>(0);
    const [receiveNote, setReceiveNote] = useState("");
    const [isReceiving, setIsReceiving] = useState(false);

    // Adjust modal
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustProduct, setAdjustProduct] = useState<string>("");
    const [adjustNewQuantity, setAdjustNewQuantity] = useState<number>(0);
    const [adjustNote, setAdjustNote] = useState("");
    const [adjustLocation, setAdjustLocation] = useState<"main" | number>("main");
    const [isAdjusting, setIsAdjusting] = useState(false);
    const [dashboardToggleProductId, setDashboardToggleProductId] = useState<string | null>(null);

    // ── Fetch ──
    const fetchStock = useCallback(async () => {
        try {
            setIsLoading(true);
            const [mainResult, floorResult] = await Promise.allSettled([
                fetch("/api/stock/main", { cache: "no-store" }),
                fetch("/api/stock/floors", { cache: "no-store" }),
            ]);

            let mainErrorMessage: string | null = null;
            let floorErrorMessage: string | null = null;

            if (mainResult.status === "fulfilled") {
                const mainRes = mainResult.value;
                const mainData = await readJsonSafe<{ stocks?: MainStockRow[] }>(mainRes);
                if (mainRes.ok && mainData.success !== false) {
                    const mainRows = Array.isArray(mainData.stocks) ? mainData.stocks : [];
                    setMainStock(sortByProductNameZA(mainRows));
                } else {
                    mainErrorMessage = mainData.error || "Failed to load main stock";
                }
            } else {
                mainErrorMessage = "Failed to load main stock";
            }

            if (floorResult.status === "fulfilled") {
                const floorRes = floorResult.value;
                const floorData = await readJsonSafe<{ floors?: Record<string, FloorStockRow[]> }>(floorRes);
                if (floorRes.ok && floorData.success !== false) {
                    const floorMap: Record<number, FloorStockRow[]> = {};
                    Object.entries(floorData.floors ?? {}).forEach(([key, rows]) => {
                        const floorNumber = Number(key);
                        if (!Number.isInteger(floorNumber)) return;
                        const floorRows = Array.isArray(rows) ? rows : [];
                        floorMap[floorNumber] = sortByProductNameZA(floorRows);
                    });
                    setFloorStocks(floorMap);
                } else {
                    floorErrorMessage = floorData.error || "Failed to load floor stocks";
                }
            } else {
                floorErrorMessage = "Failed to load floor stocks";
            }

            if (mainErrorMessage || floorErrorMessage) {
                throw new Error([mainErrorMessage, floorErrorMessage].filter(Boolean).join(" | "));
            }
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load stock data",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchStock(); }, [fetchStock]);

    // ── Transfer Main → Floor ──
    const handleTransfer = async () => {
        if (!transferProduct || transferQty <= 0) return;
        try {
            setIsTransferring(true);
            const res = await fetch("/api/stock/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    product_id: transferProduct,
                    floor_number: transferFloor,
                    quantity: transferQty,
                    note: transferNote || undefined,
                }),
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Transfer failed");
            }
            toast({ title: "Transfer Complete", description: `Transferred ${transferQty} units to Floor ${transferFloor}` });
            setTransferOpen(false);
            setTransferProduct("");
            setTransferQty(0);
            setTransferNote("");
            await fetchStock();
        } catch (err) {
            toast({
                title: "Transfer Failed",
                description: err instanceof Error ? err.message : "Transfer failed",
                variant: "destructive",
            });
        } finally {
            setIsTransferring(false);
        }
    };

    // ── Receive stock ──
    const handleReceive = async () => {
        if (!receiveProduct || receiveQty <= 0) return;
        try {
            setIsReceiving(true);
            const res = await fetch(`/api/stock/main/${receiveProduct}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "receive",
                    quantity: receiveQty,
                    note: receiveNote || undefined,
                }),
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Receive failed");
            }
            const beforeQty = Number((data as { before_quantity?: number }).before_quantity ?? 0);
            const afterQty = Number((data as { after_quantity?: number }).after_quantity ?? beforeQty + receiveQty);
            toast({
                title: "Stock Added",
                description: `Added +${receiveQty} units (${beforeQty} -> ${afterQty})`,
            });
            setReceiveOpen(false);
            setReceiveProduct("");
            setReceiveQty(0);
            setReceiveNote("");
            await fetchStock();
        } catch (err) {
            toast({
                title: "Add Stock Failed",
                description: err instanceof Error ? err.message : "Add stock failed",
                variant: "destructive",
            });
        } finally {
            setIsReceiving(false);
        }
    };

    // ── Adjust stock ──
    const handleAdjust = async () => {
        if (!adjustProduct || adjustNewQuantity < 0) return;
        try {
            setIsAdjusting(true);
            let res: Response;
            if (adjustLocation === "main") {
                res = await fetch(`/api/stock/main/${adjustProduct}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "adjust",
                        new_quantity: adjustNewQuantity,
                        note: adjustNote || "Manual adjustment",
                    }),
                });
            } else {
                res = await fetch(`/api/stock/floors/${adjustLocation}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        product_id: adjustProduct,
                        action: "adjust",
                        new_quantity: adjustNewQuantity,
                        note: adjustNote || "Manual adjustment",
                    }),
                });
            }
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Adjustment failed");
            }
            toast({
                title: "Stock Adjusted",
                description: `New quantity set to ${adjustNewQuantity} units`,
            });
            setAdjustOpen(false);
            setAdjustProduct("");
            setAdjustNewQuantity(0);
            setAdjustNote("");
            await fetchStock();
        } catch (err) {
            toast({
                title: "Adjustment Failed",
                description: err instanceof Error ? err.message : "Adjustment failed",
                variant: "destructive",
            });
        } finally {
            setIsAdjusting(false);
        }
    };

    // ── Dashboard visibility toggle ──
    const handleDashboardToggle = async (
        productId: string,
        nextValue: boolean,
        productName: string
    ) => {
        try {
            setDashboardToggleProductId(productId);
            const res = await fetch("/api/stock/dashboard-visibility", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({
                    product_id: productId,
                    show_on_inventory_dashboard: nextValue,
                }),
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to update dashboard visibility");
            }

            toast({
                title: "Dashboard Display Updated",
                description: `${productName} ${nextValue ? "shown" : "hidden"} on dashboard floor detail`,
            });

            // Re-sync from server so checkbox state is guaranteed to match DB.
            await fetchStock();
        } catch (err) {
            toast({
                title: "Update Failed",
                description: err instanceof Error ? err.message : "Failed to update dashboard visibility",
                variant: "destructive",
            });
        } finally {
            setDashboardToggleProductId(null);
        }
    };

    // ── Status helpers ──
    function stockStatus(qty: number, reorderLevel?: number) {
        if (qty === 0) return { label: "OUT", color: "text-red-600 bg-red-50 dark:bg-red-500/20 dark:text-red-400", icon: XCircleIcon };
        if (reorderLevel && qty <= reorderLevel) return { label: "LOW", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/20 dark:text-amber-400", icon: AlertTriangleIcon };
        return { label: "OK", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/20 dark:text-emerald-400", icon: CheckCircle2Icon };
    }

    // ── Get current floor data ──
    const currentFloorNumber = activeTab === "main" ? null : parseInt(activeTab.split("_")[1]);
    const currentFloorItems = currentFloorNumber ? (floorStocks[currentFloorNumber] ?? []) : [];

    // ── Summary ──
    const lowCount = mainStock.filter(i => i.is_low_stock || i.quantity <= i.reorder_level).length;
    const outCount = mainStock.filter(i => i.quantity === 0).length;

    const tabs: { key: StockTab; label: string }[] = [
        { key: "main", label: "Main Stock" },
        { key: "floor_1", label: "Floor 1" },
        { key: "floor_2", label: "Floor 2" },
        { key: "floor_3", label: "Floor 3" },
    ];

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Inventory</p>
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Stock Levels</h1>
                    <div className="flex gap-2">
                        {activeTab === "main" && (
                            <>
                                <Button variant="outline" size="sm" onClick={() => { setReceiveOpen(true); setReceiveProduct(mainStock[0]?.product_id ?? ""); }}>
                                    <PlusIcon className="w-4 h-4 mr-1" />
                                    Add Stock
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => { setTransferOpen(true); setTransferProduct(mainStock[0]?.product_id ?? ""); }}>
                                    <TruckIcon className="w-4 h-4 mr-1" />
                                    Transfer
                                </Button>
                            </>
                        )}
                        <Button variant="outline" size="sm" onClick={() => {
                            setAdjustOpen(true);
                            setAdjustLocation(activeTab === "main" ? "main" : (currentFloorNumber ?? 1));
                            const items = activeTab === "main" ? mainStock : currentFloorItems;
                            setAdjustProduct(items[0]?.product_id ?? "");
                            setAdjustNewQuantity(items[0]?.quantity ?? 0);
                        }}>
                            <MinusIcon className="w-4 h-4 mr-1" />
                            Adjust
                        </Button>
                        <Button variant="outline" size="sm" onClick={fetchStock} disabled={isLoading}>
                            <RefreshCwIcon className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Summary Tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="card border-l-4 border-l-slate-400 p-4 dark:bg-[var(--bg-surface)]">
                    <p className="text-xs text-[var(--text-secondary)] font-medium">Total Products</p>
                    <p className="text-2xl font-extrabold text-[var(--text-primary)]">{mainStock.length}</p>
                </div>
                <div className="card border-l-4 border-l-emerald-500 p-4 dark:bg-[var(--bg-surface)]">
                    <p className="text-xs text-[var(--text-secondary)] font-medium">In Stock</p>
                    <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">{mainStock.filter(i => i.quantity > i.reorder_level).length}</p>
                </div>
                <div className="card border-l-4 border-l-amber-400 p-4 dark:bg-[var(--bg-surface)]">
                    <p className="text-xs text-[var(--text-secondary)] font-medium">Low Stock</p>
                    <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{lowCount}</p>
                </div>
                <div className="card border-l-4 border-l-red-500 p-4 dark:bg-[var(--bg-surface)]">
                    <p className="text-xs text-[var(--text-secondary)] font-medium">Out of Stock</p>
                    <p className="text-2xl font-extrabold text-red-600 dark:text-red-400">{outCount}</p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 mb-4 bg-[var(--bg-muted)] rounded-lg p-1">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-colors ${
                            activeTab === tab.key
                                ? "bg-[var(--bg-surface)] text-brand-700 dark:text-brand-400 shadow-sm"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-table-cell)]"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Stock Table */}
            <div className="card overflow-hidden dark:border-white/10">
                {isLoading ? (
                    <div className="p-4 space-y-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="animate-pulse rounded-lg bg-[var(--bg-muted)] h-12" />
                        ))}
                    </div>
                ) : activeTab === "main" ? (
                    /* Main Stock Table */
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-[var(--border-subtle)]">
                                <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Product</th>
                                <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Category</th>
                                <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Quantity</th>
                                <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Reorder At</th>
                                <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Status</th>
                                <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">
                                    Show on Dashboard
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)] dark:divide-white/10">
                            {mainStock.map(item => {
                                const status = stockStatus(item.quantity, item.reorder_level);
                                const StatusIcon = status.icon;
                                return (
                                    <tr key={item.product_id} className="hover:bg-[var(--bg-body)] transition-colors">
                                        <td className="px-4 py-3">
                                            <p className="text-sm font-semibold text-[var(--text-primary)]">{item.product_name ?? "—"}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{item.unit ?? ""}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge variant="secondary" className="text-[10px] bg-slate-100 dark:bg-slate-500/20 dark:text-slate-300">
                                                {item.category ?? "—"}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={`text-lg font-extrabold ${item.quantity === 0 ? "text-red-600 dark:text-red-400" : item.quantity <= item.reorder_level ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-primary)]"}`}>
                                                {item.quantity}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm text-[var(--text-secondary)]">{item.reorder_level}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${status.color}`}>
                                                <StatusIcon className="w-3 h-3" />
                                                {status.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 rounded border-[var(--border-input)]"
                                                    checked={Boolean(item.show_on_inventory_dashboard ?? true)}
                                                    disabled={dashboardToggleProductId === item.product_id}
                                                    onChange={(e) =>
                                                        void handleDashboardToggle(
                                                            item.product_id,
                                                            e.target.checked,
                                                            item.product_name ?? "Product"
                                                        )
                                                    }
                                                />
                                                {dashboardToggleProductId === item.product_id ? "Saving..." : ""}
                                            </label>
                                        </td>
                                    </tr>
                                );
                            })}
                            {mainStock.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-[var(--text-muted)]">
                                        <PackageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">No stock data available</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                ) : (
                    /* Floor Stock Table */
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-[var(--border-subtle)]">
                                <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Product</th>
                                <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Quantity</th>
                                <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)] dark:divide-white/10">
                            {currentFloorItems.map(item => {
                                const status = stockStatus(item.quantity);
                                const StatusIcon = status.icon;
                                return (
                                    <tr key={item.product_id} className="hover:bg-[var(--bg-body)] transition-colors">
                                        <td className="px-4 py-3">
                                            <p className="text-sm font-semibold text-[var(--text-primary)]">{item.product_name ?? "—"}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{item.unit ?? ""}</p>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={`text-lg font-extrabold ${item.quantity === 0 ? "text-red-600 dark:text-red-400" : "text-[var(--text-primary)]"}`}>
                                                {item.quantity}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${status.color}`}>
                                                <StatusIcon className="w-3 h-3" />
                                                {status.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {currentFloorItems.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="text-center py-12 text-[var(--text-muted)]">
                                        <PackageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">No stock data for Floor {currentFloorNumber}</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* ── Transfer Dialog ── */}
            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Transfer Main → Floor</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</label>
                            <select
                                value={transferProduct}
                                onChange={(e) => setTransferProduct(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                            >
                                {mainStock.filter(i => i.quantity > 0).map(item => (
                                    <option key={item.product_id} value={item.product_id}>
                                        {item.product_name} (Available: {item.quantity})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Target Floor</label>
                            <select
                                value={transferFloor}
                                onChange={(e) => setTransferFloor(Number(e.target.value))}
                                className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                            >
                                <option value={1}>Floor 1</option>
                                <option value={2}>Floor 2</option>
                                <option value={3}>Floor 3</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Quantity</label>
                            <Input
                                type="number"
                                min={1}
                                value={transferQty || ""}
                                onChange={(e) => setTransferQty(parseInt(e.target.value) || 0)}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Note (optional)</label>
                            <Input
                                value={transferNote}
                                onChange={(e) => setTransferNote(e.target.value)}
                                placeholder="Daily replenishment"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleTransfer}
                            disabled={isTransferring || transferQty <= 0 || !transferProduct}
                            className="bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {isTransferring ? <RefreshCwIcon className="w-4 h-4 animate-spin" /> : "Transfer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Receive Dialog ── */}
            <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Stock (Main)</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</label>
                            <select
                                value={receiveProduct}
                                onChange={(e) => setReceiveProduct(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                            >
                                {mainStock.map(item => (
                                    <option key={item.product_id} value={item.product_id}>
                                        {item.product_name} (Current: {item.quantity})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Quantity to Add (+)</label>
                            <Input
                                type="number"
                                min={1}
                                value={receiveQty || ""}
                                onChange={(e) => setReceiveQty(parseInt(e.target.value) || 0)}
                                className="mt-1"
                            />
                            <p className="text-xs text-[var(--text-muted)] mt-1">This will increase current main stock (current + add).</p>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Note (optional)</label>
                            <Input
                                value={receiveNote}
                                onChange={(e) => setReceiveNote(e.target.value)}
                                placeholder="Monthly restock"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReceiveOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleReceive}
                            disabled={isReceiving || receiveQty <= 0 || !receiveProduct}
                            className="bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {isReceiving ? <RefreshCwIcon className="w-4 h-4 animate-spin" /> : "Add Stock"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Adjust Dialog ── */}
            <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manual Adjustment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Location</label>
                            <select
                                value={typeof adjustLocation === "number" ? adjustLocation : "main"}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    const nextLocation = v === "main" ? "main" : parseInt(v);
                                    setAdjustLocation(nextLocation);
                                    const nextItems =
                                        nextLocation === "main"
                                            ? mainStock
                                            : (floorStocks[nextLocation] ?? []);
                                    setAdjustProduct(nextItems[0]?.product_id ?? "");
                                    setAdjustNewQuantity(nextItems[0]?.quantity ?? 0);
                                }}
                                className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                            >
                                <option value="main">Main Stock</option>
                                <option value="1">Floor 1</option>
                                <option value="2">Floor 2</option>
                                <option value="3">Floor 3</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</label>
                            <select
                                value={adjustProduct}
                                onChange={(e) => {
                                    const nextProductId = e.target.value;
                                    setAdjustProduct(nextProductId);
                                    const items =
                                        adjustLocation === "main"
                                            ? mainStock
                                            : (floorStocks[typeof adjustLocation === "number" ? adjustLocation : 1] ?? []);
                                    const selected = items.find((item) => item.product_id === nextProductId);
                                    setAdjustNewQuantity(selected?.quantity ?? 0);
                                }}
                                className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                            >
                                {(adjustLocation === "main" ? mainStock : (floorStocks[typeof adjustLocation === "number" ? adjustLocation : 1] ?? [])).map(item => (
                                    <option key={item.product_id} value={item.product_id}>
                                        {item.product_name} (Current: {item.quantity})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">New Quantity (absolute)</label>
                            <Input
                                type="number"
                                min={0}
                                value={adjustNewQuantity || ""}
                                onChange={(e) => setAdjustNewQuantity(parseInt(e.target.value) || 0)}
                                placeholder="e.g. 25"
                                className="mt-1"
                            />
                            <p className="text-xs text-[var(--text-muted)] mt-1">This sets final stock quantity directly.</p>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Reason / Note</label>
                            <Input
                                value={adjustNote}
                                onChange={(e) => setAdjustNote(e.target.value)}
                                placeholder="Manual correction"
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleAdjust}
                            disabled={isAdjusting || adjustNewQuantity < 0 || !adjustProduct}
                            className="bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {isAdjusting ? <RefreshCwIcon className="w-4 h-4 animate-spin" /> : "Apply Adjustment"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
