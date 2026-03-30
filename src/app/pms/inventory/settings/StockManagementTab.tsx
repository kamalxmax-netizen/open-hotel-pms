"use client";

import { useState, useEffect, useCallback } from "react";
import {
    PackageIcon, RefreshCwIcon, PlusIcon, EditIcon,
    MinusIcon, AlertTriangleIcon, CheckCircle2Icon, XCircleIcon,
} from "lucide-react";
import { MainStock, FloorStock } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
    success?: boolean;
    error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
    try { return (await response.json()) as ApiResponse<T>; }
    catch { return {} as ApiResponse<T>; }
}

interface MainStockRow extends MainStock {
    category?: string | null;
    unit?: string | null;
    is_low_stock?: boolean;
    display_order?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
    amenity: "Amenity",
    pos: "POS",
    both: "Both",
};

const CATEGORY_BADGE_CLASS: Record<string, string> = {
    amenity: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400",
    pos: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    both: "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-400",
};

function sortByDisplayOrder<T extends { product_name?: string | null; display_order?: number }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        const orderA = a.display_order ?? 9999;
        const orderB = b.display_order ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.product_name ?? "").localeCompare(b.product_name ?? "", undefined, { sensitivity: "base" });
    });
}

function stockStatus(qty: number, reorderLevel?: number) {
    if (qty === 0) return { label: "OUT", color: "text-red-600 bg-red-50 dark:bg-red-500/20 dark:text-red-400", icon: XCircleIcon };
    if (reorderLevel && qty <= reorderLevel) return { label: "LOW", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/20 dark:text-amber-400", icon: AlertTriangleIcon };
    return { label: "OK", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/20 dark:text-emerald-400", icon: CheckCircle2Icon };
}

export function StockManagementTab() {
    const { toast } = useToast();

    const [mainStock, setMainStock] = useState<MainStockRow[]>([]);
    const [floorStocks, setFloorStocks] = useState<Record<number, FloorStock[]>>({});
    const [isLoading, setIsLoading] = useState(true);

    const [receiveOpen, setReceiveOpen] = useState(false);
    const [receiveProduct, setReceiveProduct] = useState<string>("");
    const [receiveQty, setReceiveQty] = useState<number>(0);
    const [receiveNote, setReceiveNote] = useState("");
    const [isReceiving, setIsReceiving] = useState(false);

    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustLocation, setAdjustLocation] = useState<"main" | number>("main");
    const [adjustProduct, setAdjustProduct] = useState<string>("");
    const [adjustNewQuantity, setAdjustNewQuantity] = useState<number>(0);
    const [adjustNote, setAdjustNote] = useState("");
    const [isAdjusting, setIsAdjusting] = useState(false);

    const fetchStock = useCallback(async () => {
        try {
            setIsLoading(true);
            const [mainRes, floorRes] = await Promise.all([
                fetch("/api/stock/main", { cache: "no-store" }),
                fetch("/api/stock/floors", { cache: "no-store" })
            ]);
            
            const mainData = await readJsonSafe<{ stocks?: MainStockRow[] }>(mainRes);
            const floorData = await readJsonSafe<{ floors?: Record<string, FloorStock[]> }>(floorRes);

            if (!mainRes.ok || mainData.success === false) {
                throw new Error(mainData.error || "Failed to load main stock");
            }

            const mainRows = Array.isArray(mainData.stocks) ? mainData.stocks : [];
            setMainStock(sortByDisplayOrder(mainRows));

            if (floorRes.ok && floorData.success !== false) {
                const floorMap: Record<number, FloorStock[]> = {};
                Object.entries(floorData.floors ?? {}).forEach(([key, rows]) => {
                    const floorNumber = Number(key);
                    if (!Number.isInteger(floorNumber)) return;
                    floorMap[floorNumber] = Array.isArray(rows) ? rows : [];
                });
                setFloorStocks(floorMap);
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

    const handleReceive = async () => {
        if (!receiveProduct || receiveQty <= 0) return;
        if (receiveNote.trim().length < 2) {
            toast({ title: "Validation Error", description: "Reason must be at least 2 characters.", variant: "destructive" });
            return;
        }
        try {
            setIsReceiving(true);
            const res = await fetch(`/api/stock/main/${receiveProduct}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "receive",
                    quantity: receiveQty,
                    note: receiveNote.trim(),
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

    const handleAdjust = async () => {
        if (!adjustProduct || adjustNewQuantity < 0) return;
        if (adjustNote.trim().length < 2) {
            toast({ title: "Validation Error", description: "Reason must be at least 2 characters.", variant: "destructive" });
            return;
        }
        try {
            setIsAdjusting(true);
            let url = `/api/stock/main/${adjustProduct}`;
            let payload: any = { action: "adjust", new_quantity: adjustNewQuantity, note: adjustNote.trim() };
            
            if (adjustLocation !== "main") {
                url = `/api/stock/floors/${adjustLocation}`;
                payload = { product_id: adjustProduct, action: "adjust", new_quantity: adjustNewQuantity, note: adjustNote.trim() };
            }

            const res = await fetch(url, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
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

    const lowCount = mainStock.filter(i => i.is_low_stock || i.quantity <= i.reorder_level).length;
    const outCount = mainStock.filter(i => i.quantity === 0).length;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setReceiveOpen(true); setReceiveProduct(mainStock[0]?.product_id ?? ""); }}>
                        <PlusIcon className="w-4 h-4 mr-1" />
                        Add Stock (Receive/Buy)
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                        setAdjustOpen(true);
                        setAdjustLocation("main");
                        setAdjustProduct(mainStock[0]?.product_id ?? "");
                        setAdjustNewQuantity(mainStock[0]?.quantity ?? 0);
                    }}>
                        <MinusIcon className="w-4 h-4 mr-1" />
                        Manual Adjust
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchStock} disabled={isLoading}>
                        <RefreshCwIcon className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="card p-4 border-l-4 border-l-slate-400">
                    <p className="text-xs text-[var(--text-secondary)]">Total Products</p>
                    <p className="text-2xl font-extrabold">{mainStock.length}</p>
                </div>
                <div className="card p-4 border-l-4 border-l-emerald-500">
                    <p className="text-xs text-[var(--text-secondary)]">OK Stock</p>
                    <p className="text-2xl font-extrabold text-emerald-600">{mainStock.filter(i => i.quantity > i.reorder_level).length}</p>
                </div>
                <div className="card p-4 border-l-4 border-l-amber-500">
                    <p className="text-xs text-[var(--text-secondary)]">Low Stock</p>
                    <p className="text-2xl font-extrabold text-amber-600">{lowCount}</p>
                </div>
                <div className="card p-4 border-l-4 border-l-red-500">
                    <p className="text-xs text-[var(--text-secondary)]">Out of Stock</p>
                    <p className="text-2xl font-extrabold text-red-600">{outCount}</p>
                </div>
            </div>

            <div className="card overflow-hidden border border-[var(--border-subtle)]">
                <div className="p-4 bg-[var(--bg-muted)] border-b border-[var(--border-subtle)]">
                    <h3 className="text-lg font-bold">Main Stock</h3>
                </div>
                {isLoading ? (
                    <div className="p-4 space-y-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="animate-pulse rounded-lg bg-[var(--bg-muted)] h-12" />
                        ))}
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-[var(--bg-body)]">
                            <tr className="border-b border-[var(--border-subtle)]">
                                <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Product</th>
                                <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Category</th>
                                <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Quantity</th>
                                <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Status</th>
                                <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)] bg-white dark:bg-[#1a1c23]">
                            {mainStock.map(item => {
                                const status = stockStatus(item.quantity, item.reorder_level);
                                const StatusIcon = status.icon;
                                return (
                                    <tr key={item.product_id} className="hover:bg-[var(--bg-body)] transition-colors">
                                        <td className="px-4 py-3">
                                            <p className="text-sm font-semibold">{item.product_name ?? "—"}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{item.unit ?? ""}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge
                                                variant="secondary"
                                                className={`text-[10px] ${
                                                    CATEGORY_BADGE_CLASS[String(item.category ?? "").toLowerCase()] ??
                                                    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300"
                                                }`}
                                            >
                                                {CATEGORY_LABELS[String(item.category ?? "").toLowerCase()] ??
                                                    (item.category || "—")}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={`text-lg font-extrabold ${item.quantity === 0 ? "text-red-600" : item.quantity <= item.reorder_level ? "text-amber-600" : ""}`}>
                                                {item.quantity}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${status.color}`}>
                                                <StatusIcon className="w-3 h-3" />
                                                {status.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => { setReceiveOpen(true); setReceiveProduct(item.product_id); }}>
                                                    <PlusIcon className="w-4 h-4 text-emerald-600" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => { setAdjustOpen(true); setAdjustLocation("main"); setAdjustProduct(item.product_id); setAdjustNewQuantity(item.quantity); }}>
                                                    <EditIcon className="w-4 h-4 text-slate-500" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {mainStock.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center py-12 text-[var(--text-muted)]">
                                        <PackageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">No stock data available</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Floor Stocks */}
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Floor Stocks (Read-only)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map(floor => (
                        <div key={floor} className="card border border-[var(--border-subtle)] overflow-hidden">
                            <div className="bg-[var(--bg-muted)] px-4 py-3 border-b border-[var(--border-subtle)] flex justify-between items-center">
                                <h4 className="font-semibold text-sm">Floor {floor}</h4>
                                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => {
                                    setAdjustOpen(true);
                                    setAdjustLocation(floor);
                                    const items = floorStocks[floor] ?? [];
                                    setAdjustProduct(items[0]?.product_id ?? "");
                                    setAdjustNewQuantity(items[0]?.quantity ?? 0);
                                }}>
                                    <EditIcon className="w-3 h-3 mr-1" /> Adjust
                                </Button>
                            </div>
                            <div className="p-0">
                                <table className="w-full text-xs">
                                    <tbody className="divide-y divide-[var(--border-subtle)] bg-white dark:bg-[#1a1c23]">
                                        {(floorStocks[floor] ?? []).map(item => (
                                            <tr key={item.product_id} className="hover:bg-[var(--bg-body)]">
                                                <td className="px-3 py-2 font-medium">{item.product_name}</td>
                                                <td className={`px-3 py-2 text-right font-bold ${item.quantity === 0 ? "text-red-500" : ""}`}>
                                                    {item.quantity}
                                                </td>
                                            </tr>
                                        ))}
                                        {(!floorStocks[floor] || floorStocks[floor].length === 0) && (
                                            <tr>
                                                <td colSpan={2} className="px-3 py-4 text-center text-[var(--text-muted)]">No active stock</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

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
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Reason / Reference <span className="text-red-500">*</span></label>
                            <Input
                                value={receiveNote}
                                onChange={(e) => setReceiveNote(e.target.value)}
                                placeholder="e.g. Received from supplier invoices"
                                className={`mt-1 ${receiveNote.trim().length > 0 && receiveNote.trim().length < 2 ? "border-red-500" : ""}`}
                            />
                            <p className="text-[10px] text-[var(--text-muted)] mt-1">Minimum 2 characters required.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReceiveOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleReceive}
                            disabled={isReceiving || receiveQty <= 0 || !receiveProduct || receiveNote.trim().length < 2}
                            className="bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {isReceiving ? <RefreshCwIcon className="w-4 h-4 animate-spin" /> : "Add Stock"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manual Adjustment</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Product</label>
                            <select
                                value={adjustProduct}
                                onChange={(e) => {
                                    const nextProductId = e.target.value;
                                    setAdjustProduct(nextProductId);
                                    const selected = mainStock.find((item) => item.product_id === nextProductId);
                                    setAdjustNewQuantity(selected?.quantity ?? 0);
                                }}
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
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">New Quantity (absolute)</label>
                            <Input
                                type="number"
                                min={0}
                                value={adjustNewQuantity || ""}
                                onChange={(e) => setAdjustNewQuantity(parseInt(e.target.value) || 0)}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Reason / Note <span className="text-red-500">*</span></label>
                            <Input
                                value={adjustNote}
                                onChange={(e) => setAdjustNote(e.target.value)}
                                placeholder="e.g. Audit variance, Damage"
                                className={`mt-1 ${adjustNote.trim().length > 0 && adjustNote.trim().length < 2 ? "border-red-500" : ""}`}
                            />
                            <p className="text-[10px] text-[var(--text-muted)] mt-1">Minimum 2 characters required.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleAdjust}
                            disabled={isAdjusting || adjustNewQuantity < 0 || !adjustProduct || adjustNote.trim().length < 2}
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
