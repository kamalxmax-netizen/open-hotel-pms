"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
    PlusIcon, EditIcon, Trash2Icon,
    PackageIcon, RefreshCwIcon, EyeIcon, EyeOffIcon,
} from "lucide-react";
import { Product } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/* ── Helpers ── */

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

type ProductCategory = "amenity" | "pos" | "both";
type FulfillmentMode = "standard" | "daily_prepare";

const CATEGORY_LABELS: Record<ProductCategory, string> = {
    amenity: "Amenity",
    pos: "POS",
    both: "Both",
};

const CATEGORY_BADGE_CLASS: Record<ProductCategory, string> = {
    amenity: "bg-sky-100 text-sky-700",
    pos: "bg-amber-100 text-amber-700",
    both: "bg-brand-100 text-brand-700",
};

const FLOW_LABELS: Record<FulfillmentMode, string> = {
    standard: "Standard",
    daily_prepare: "Daily Prepare",
};

const FLOW_BADGE_CLASS: Record<FulfillmentMode, string> = {
    standard: "bg-[var(--bg-muted)] text-[var(--text-table-cell)]",
    daily_prepare: "bg-indigo-100 text-indigo-700",
};

interface ProductFormData {
    name: string;
    sku: string;
    category: ProductCategory;
    fulfillment_mode: FulfillmentMode;
    unit: string;
    sale_price: string;
}

const EMPTY_FORM: ProductFormData = {
    name: "",
    sku: "",
    category: "amenity",
    fulfillment_mode: "standard",
    unit: "pieces",
    sale_price: "",
};

/* ── Component ── */

export default function ProductsPage() {
    const { toast } = useToast();

    // Data
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Filters
    const [searchQuery, setSearchQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState<"all" | ProductCategory>("all");
    const [showActiveOnly, setShowActiveOnly] = useState(true);

    // Add / Edit dialog
    const [formOpen, setFormOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [form, setForm] = useState<ProductFormData>(EMPTY_FORM);
    const [isSaving, setIsSaving] = useState(false);

    // Delete / Deactivate confirmation dialog
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    /* ── Fetch ── */

    const fetchProducts = useCallback(async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            if (categoryFilter !== "all") params.set("category", categoryFilter);
            if (showActiveOnly) params.set("is_active", "true");
            const res = await fetch(`/api/products?${params.toString()}`);
            const data = await readJsonSafe<{ products?: Product[] }>(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load products");
            }
            setProducts(Array.isArray(data.products) ? data.products : []);
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load products",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [categoryFilter, showActiveOnly, toast]);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    /* ── Filtered list ── */

    const filteredProducts = useMemo(() => {
        if (!searchQuery.trim()) return products;
        const q = searchQuery.toLowerCase();
        return products.filter(
            (p) =>
                p.name.toLowerCase().includes(q) ||
                (p.sku && p.sku.toLowerCase().includes(q))
        );
    }, [products, searchQuery]);

    /* ── Form helpers ── */

    const openAddDialog = () => {
        setEditingProduct(null);
        setForm(EMPTY_FORM);
        setFormOpen(true);
    };

    const openEditDialog = (product: Product) => {
        setEditingProduct(product);
        setForm({
            name: product.name,
            sku: product.sku ?? "",
            category: product.category,
            fulfillment_mode: product.fulfillment_mode ?? "standard",
            unit: product.unit,
            sale_price: product.sale_price != null ? String(product.sale_price) : "",
        });
        setFormOpen(true);
    };

    const handleFormChange = (field: keyof ProductFormData, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const isFormValid = form.name.trim().length >= 1;

    const handleSave = async () => {
        if (!isFormValid) return;
        try {
            setIsSaving(true);
            const payload: Record<string, unknown> = {
                name: form.name.trim(),
                sku: form.sku.trim() || null,
                category: form.category,
                fulfillment_mode: form.fulfillment_mode,
                unit: form.unit.trim() || "pieces",
                sale_price: form.sale_price.trim() ? parseFloat(form.sale_price) : null,
            };

            const isEditing = !!editingProduct;
            const url = isEditing
                ? `/api/products/${editingProduct.id}`
                : "/api/products";
            const method = isEditing ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to save product");
            }

            toast({
                title: "Success",
                description: isEditing
                    ? `Product "${form.name.trim()}" updated`
                    : `Product "${form.name.trim()}" created`,
            });
            setFormOpen(false);
            fetchProducts();
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to save product",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    /* ── Delete / Deactivate ── */

    const handleConfirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            setIsDeleting(true);
            const res = await fetch(`/api/products/${deleteTarget.id}`, {
                method: "DELETE",
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to deactivate product");
            }
            toast({
                title: "Success",
                description: `"${deleteTarget.name}" has been deactivated`,
            });
            setDeleteTarget(null);
            fetchProducts();
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to deactivate product",
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };

    /* ── Format helpers ── */

    const formatPrice = (price: number | null): string => {
        if (price == null) return "\u2014";
        return price.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " THB";
    };

    /* ── Render ── */

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                        Inventory
                    </p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                        Products
                    </h1>
                </div>
                <Button
                    onClick={openAddDialog}
                    className="bg-brand-600 hover:bg-brand-700 text-white h-9"
                >
                    <PlusIcon className="w-4 h-4 mr-1.5" />
                    Add Product
                </Button>
            </div>

            {/* Toolbar: Search + Category Filter + Active Toggle */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Input
                        placeholder="Search by name or SKU..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9"
                    />
                </div>

                <div className="w-40">
                    <Select
                        value={categoryFilter}
                        onValueChange={(val) =>
                            setCategoryFilter(val as "all" | ProductCategory)
                        }
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Categories</SelectItem>
                            <SelectItem value="amenity">Amenity</SelectItem>
                            <SelectItem value="pos">POS</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <button
                    onClick={() => setShowActiveOnly((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        showActiveOnly
                            ? "border-brand-300 bg-brand-50 text-brand-700"
                            : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    {showActiveOnly ? (
                        <EyeIcon className="w-3.5 h-3.5" />
                    ) : (
                        <EyeOffIcon className="w-3.5 h-3.5" />
                    )}
                    {showActiveOnly ? "Active only" : "Show all"}
                </button>

                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fetchProducts()}
                    disabled={isLoading}
                    className="h-9 w-9 shrink-0"
                >
                    <RefreshCwIcon
                        className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                    />
                </Button>
            </div>

            {/* Product Table / Card List */}
            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-16 animate-pulse rounded-xl bg-slate-200"
                        />
                    ))}
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="text-center py-16 bg-[var(--bg-body)] border-2 border-dashed rounded-xl">
                    <PackageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    {products.length === 0 ? (
                        <>
                            <h3 className="text-lg font-medium text-[var(--text-table-cell)]">
                                No products yet
                            </h3>
                            <p className="text-sm text-[var(--text-secondary)] mt-1">
                                Add your first product to get started.
                            </p>
                            <Button
                                className="mt-4 h-9 bg-brand-600 hover:bg-brand-700 text-white"
                                onClick={openAddDialog}
                            >
                                <PlusIcon className="w-4 h-4 mr-1.5" />
                                Add Product
                            </Button>
                        </>
                    ) : (
                        <>
                            <h3 className="text-lg font-medium text-[var(--text-table-cell)]">
                                No products match your search
                            </h3>
                            <p className="text-sm text-[var(--text-secondary)] mt-1">
                                Try adjusting your filters or search query.
                            </p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    {/* Desktop Table */}
                    <div className="hidden md:block card overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-body)]/60">
                                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Name
                                    </th>
                                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        SKU
                                    </th>
                                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Category
                                    </th>
                                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Flow
                                    </th>
                                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Unit
                                    </th>
                                    <th className="text-right px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Sale Price
                                    </th>
                                    <th className="text-center px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="text-right px-4 py-3 font-semibold text-[var(--text-secondary)] text-xs uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredProducts.map((product) => (
                                    <tr
                                        key={product.id}
                                        className={`hover:bg-[var(--bg-body)]/80 transition-colors ${
                                            !product.is_active ? "opacity-50" : ""
                                        }`}
                                    >
                                        <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                                            {product.name}
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                                            {product.sku || "\u2014"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                    CATEGORY_BADGE_CLASS[product.category]
                                                }`}
                                            >
                                                {CATEGORY_LABELS[product.category]}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                    FLOW_BADGE_CLASS[product.fulfillment_mode ?? "standard"]
                                                }`}
                                            >
                                                {FLOW_LABELS[product.fulfillment_mode ?? "standard"]}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                                            {product.unit}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-[var(--text-table-cell)]">
                                            {formatPrice(product.sale_price)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <Badge
                                                variant={
                                                    product.is_active
                                                        ? "default"
                                                        : "secondary"
                                                }
                                                className="text-[10px]"
                                            >
                                                {product.is_active
                                                    ? "Active"
                                                    : "Inactive"}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        openEditDialog(product)
                                                    }
                                                    className="h-8 text-xs text-[var(--text-secondary)] hover:text-brand-600"
                                                >
                                                    <EditIcon className="w-3.5 h-3.5 mr-1" />
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        setDeleteTarget({
                                                            id: product.id,
                                                            name: product.name,
                                                        })
                                                    }
                                                    className="h-8 text-xs text-red-400 hover:text-red-600 hover:bg-red-50"
                                                >
                                                    <Trash2Icon className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile Card List */}
                    <div className="md:hidden space-y-3">
                        {filteredProducts.map((product) => (
                            <div
                                key={product.id}
                                className={`card p-4 ${
                                    !product.is_active ? "opacity-50" : ""
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-sm font-bold text-[var(--text-primary)]">
                                                {product.name}
                                            </h3>
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    CATEGORY_BADGE_CLASS[
                                                        product.category
                                                    ]
                                                }`}
                                            >
                                                {
                                                    CATEGORY_LABELS[
                                                        product.category
                                                    ]
                                                }
                                            </span>
                                            <span
                                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    FLOW_BADGE_CLASS[product.fulfillment_mode ?? "standard"]
                                                }`}
                                            >
                                                {FLOW_LABELS[product.fulfillment_mode ?? "standard"]}
                                            </span>
                                            <Badge
                                                variant={
                                                    product.is_active
                                                        ? "default"
                                                        : "secondary"
                                                }
                                                className="text-[10px]"
                                            >
                                                {product.is_active
                                                    ? "Active"
                                                    : "Inactive"}
                                            </Badge>
                                        </div>
                                        {product.sku && (
                                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                                SKU: {product.sku}
                                            </p>
                                        )}
                                        <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-secondary)]">
                                            <span>Unit: {product.unit}</span>
                                            <span className="font-medium text-[var(--text-table-cell)]">
                                                {formatPrice(product.sale_price)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                openEditDialog(product)
                                            }
                                            className="h-8 w-8 p-0 text-[var(--text-muted)] hover:text-brand-600"
                                        >
                                            <EditIcon className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                setDeleteTarget({
                                                    id: product.id,
                                                    name: product.name,
                                                })
                                            }
                                            className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                                        >
                                            <Trash2Icon className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* ── Add / Edit Product Dialog ── */}
            <Dialog
                open={formOpen}
                onOpenChange={(open) => {
                    if (!open) setFormOpen(false);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {editingProduct ? "Edit Product" : "Add Product"}
                        </DialogTitle>
                        <DialogDescription>
                            {editingProduct
                                ? "Update the product details below."
                                : "Fill in the details to create a new product."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 mt-2">
                        {/* Name */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                Name <span className="text-red-500">*</span>
                            </label>
                            <Input
                                placeholder="e.g. Shampoo, Water Bottle"
                                value={form.name}
                                onChange={(e) =>
                                    handleFormChange("name", e.target.value)
                                }
                            />
                        </div>

                        {/* SKU */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                SKU
                            </label>
                            <Input
                                placeholder="e.g. SHP-001 (optional)"
                                value={form.sku}
                                onChange={(e) =>
                                    handleFormChange("sku", e.target.value)
                                }
                            />
                        </div>

                        {/* Category */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                Category
                            </label>
                            <Select
                                value={form.category}
                                onValueChange={(val) =>
                                    handleFormChange(
                                        "category",
                                        val as ProductCategory
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="amenity">
                                        Amenity
                                    </SelectItem>
                                    <SelectItem value="pos">POS</SelectItem>
                                    <SelectItem value="both">Both</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Fulfillment Flow */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                Fulfillment Flow
                            </label>
                            <Select
                                value={form.fulfillment_mode}
                                onValueChange={(val) =>
                                    handleFormChange(
                                        "fulfillment_mode",
                                        val as FulfillmentMode
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select flow" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="standard">
                                        Standard (manual transfer)
                                    </SelectItem>
                                    <SelectItem value="daily_prepare">
                                        Daily Prepare (FO flow)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Unit */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                Unit
                            </label>
                            <Input
                                placeholder="e.g. pieces, bottles, sets"
                                value={form.unit}
                                onChange={(e) =>
                                    handleFormChange("unit", e.target.value)
                                }
                            />
                        </div>

                        {/* Sale Price */}
                        <div>
                            <label className="block text-sm font-medium text-[var(--text-table-cell)] mb-1">
                                Sale Price (THB)
                            </label>
                            <Input
                                type="number"
                                placeholder="0.00 (optional)"
                                value={form.sale_price}
                                onChange={(e) =>
                                    handleFormChange(
                                        "sale_price",
                                        e.target.value
                                    )
                                }
                                min="0"
                                step="0.01"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setFormOpen(false)}
                            className="h-9"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={!isFormValid || isSaving}
                            className="h-9 bg-brand-600 hover:bg-brand-700 text-white"
                        >
                            {isSaving
                                ? "Saving..."
                                : editingProduct
                                  ? "Update"
                                  : "Create"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Delete / Deactivate Confirmation Dialog ── */}
            <Dialog
                open={!!deleteTarget}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Deactivate Product</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to deactivate &ldquo;
                            {deleteTarget?.name}&rdquo;? The product will be
                            marked as inactive and hidden from active listings.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(null)}
                            className="h-9"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirmDelete}
                            disabled={isDeleting}
                            className="h-9 bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isDeleting ? "Deactivating..." : "Deactivate"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
