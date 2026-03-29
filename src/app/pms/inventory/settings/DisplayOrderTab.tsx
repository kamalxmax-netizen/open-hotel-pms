"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GripVerticalIcon, PackageIcon, SaveIcon, RefreshCwIcon, BanIcon } from "lucide-react";
import { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
    success?: boolean;
    error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(response: Response): Promise<ApiResponse<T>> {
    try { return (await response.json()) as ApiResponse<T>; }
    catch { return {} as ApiResponse<T>; }
}

export function DisplayOrderTab() {
    const { toast } = useToast();
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    
    // Drag and drop state
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [dragOverItemIndex, setDragOverItemIndex] = useState<number | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    // Filter state
    const [categoryFilter, setCategoryFilter] = useState<"all" | "amenity" | "pos" | "both">("all");

    const fetchProducts = useCallback(async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            params.set("is_active", "true"); // Only active products
            if (categoryFilter !== "all") params.set("category", categoryFilter);
            
            const res = await fetch(`/api/products?${params.toString()}`);
            const data = await readJsonSafe<{ products?: Product[] }>(res);
            
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load products");
            }

            const loadedProducts = Array.isArray(data.products) ? data.products : [];
            // Sort by existing display_order else fallback to Name
            loadedProducts.sort((a, b) => {
                const orderA = a.display_order ?? 9999;
                const orderB = b.display_order ?? 9999;
                if (orderA !== orderB) return orderA - orderB;
                return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
            });

            setProducts(loadedProducts);
            setIsDirty(false);
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load products",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [categoryFilter, toast]);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    /* -- Native HTML5 Drag and Drop -- */
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = "move";
        // Ghost image styling logic can be handled natively by browser
        const target = e.currentTarget as HTMLElement;
        setTimeout(() => {
            target.classList.add("opacity-50", "bg-slate-50", "dark:bg-slate-800");
        }, 0);
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        const target = e.currentTarget as HTMLElement;
        target.classList.remove("opacity-50", "bg-slate-50", "dark:bg-slate-800");
        setDraggedItemIndex(null);
        setDragOverItemIndex(null);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverItemIndex(index);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null) return;
        
        let newProducts = [...products];
        const draggedItemContent = newProducts.splice(draggedItemIndex, 1)[0];
        newProducts.splice(index, 0, draggedItemContent);
        
        setProducts(newProducts);
        setDraggedItemIndex(null);
        setDragOverItemIndex(null);
        setIsDirty(true);
    };

    const handleSaveOrder = async () => {
        try {
            setIsSaving(true);
            const items = products.map((p, idx) => ({ id: p.id, display_order: idx + 1 }));
            
            const res = await fetch("/api/products/reorder", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items }),
            });
            const data = await readJsonSafe(res);

            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to save product order");
            }
            toast({ title: "Order Saved", description: "Product display order updated successfully." });
            setIsDirty(false);
        } catch (err) {
            toast({
                title: "Save Failed",
                description: err instanceof Error ? err.message : "Failed to save order",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4 max-w-2xl">
            <div className="flex justify-between items-center mb-4">
                <div className="flex gap-2 items-center">
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value as any)}
                        className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-sm bg-white dark:bg-[#1a1c23]"
                    >
                        <option value="all">All Categories</option>
                        <option value="amenity">Amenity Only</option>
                        <option value="pos">POS Only</option>
                    </select>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchProducts} disabled={isLoading || isSaving}>
                        <BanIcon className="w-4 h-4 mr-1" />
                        Cancel
                    </Button>
                    <Button 
                        size="sm" 
                        onClick={handleSaveOrder} 
                        disabled={!isDirty || isSaving}
                        className={isDirty ? "bg-brand-600 hover:bg-brand-700 text-white shadow-sm" : "bg-slate-200 text-slate-500"}
                    >
                        {isSaving ? <RefreshCwIcon className="w-4 h-4 mr-1 animate-spin" /> : <SaveIcon className="w-4 h-4 mr-1" />}
                        Save Order
                    </Button>
                </div>
            </div>

            {isDirty && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-3 text-sm text-amber-800 dark:text-amber-400 mb-4 flex items-center gap-2">
                    <AlertTriangleIcon className="w-4 h-4" />
                    <strong>Unsaved Changes.</strong> Make sure to save your new order before leaving.
                </div>
            )}

            <div className="card border border-[var(--border-subtle)] bg-[var(--bg-body)] rounded-xl overflow-hidden p-2">
                {isLoading ? (
                    <div className="space-y-2 p-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="animate-pulse rounded-lg bg-[var(--bg-muted)] h-12" />
                        ))}
                    </div>
                ) : products.length === 0 ? (
                    <div className="text-center py-12 text-[var(--text-muted)]">
                        <PackageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No items found to reorder.</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {products.map((product, index) => (
                            <div
                                key={product.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDrop={(e) => handleDrop(e, index)}
                                className={`group flex items-center gap-3 p-3 rounded-lg border bg-white dark:bg-[#1f2128] cursor-grab active:cursor-grabbing transition-all ${
                                    dragOverItemIndex === index 
                                    ? "border-brand-500 shadow-[0_-2px_0_var(--brand-500)] z-10 -translate-y-0.5" 
                                    : "border-transparent hover:border-[var(--border-subtle)]"
                                }`}
                            >
                                <div className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500 px-1">
                                    <GripVerticalIcon className="w-5 h-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{product.name}</p>
                                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5 font-medium uppercase tracking-wider">{product.category}</p>
                                </div>
                                <div className="text-xs font-mono text-slate-400 dark:text-slate-500 w-8 text-right">
                                    #{index + 1}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// Just need AlertTriangleIcon here
function AlertTriangleIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    )
}
