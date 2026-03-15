"use client";

import { useState, useEffect, useCallback } from "react";
import {
    ClipboardListIcon, RefreshCwIcon, ChevronDownIcon,
    ChevronUpIcon, BanIcon, ChevronLeftIcon, ChevronRightIcon,
    CalendarIcon,
} from "lucide-react";
import { PosOrder, PosOrderItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

function toLocalDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function fmtAmount(n: number) {
    return n.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

function fmtDateTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

type PosFolioPayment = {
    id: string;
    tx_type: string | null;
    method: string | null;
    amount: number;
    note: string | null;
    paid_at: string | null;
    revenue_category?: string | null;
    is_record_only?: boolean | null;
};

const PAGE_SIZE = 50;

/* ── Component ── */

export default function PosOrderHistoryPage() {
    const { toast } = useToast();

    // Filters
    const [dateFilter, setDateFilter] = useState(toLocalDate(new Date()));
    const [orderTypeFilter, setOrderTypeFilter] = useState<"" | "walkin" | "guest_charge">("");
    const [statusFilter, setStatusFilter] = useState<"" | "completed" | "voided">("");

    // Data
    const [orders, setOrders] = useState<PosOrder[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(0);

    // Expanded row
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [orderItems, setOrderItems] = useState<PosOrderItem[]>([]);
    const [folioPayments, setFolioPayments] = useState<PosFolioPayment[]>([]);
    const [isLoadingItems, setIsLoadingItems] = useState(false);

    // Void dialog
    const [voidDialogOpen, setVoidDialogOpen] = useState(false);
    const [voidingOrder, setVoidingOrder] = useState<PosOrder | null>(null);
    const [isVoiding, setIsVoiding] = useState(false);

    // ── Fetch orders ──
    const fetchOrders = useCallback(async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            if (dateFilter) {
                params.set("date_from", dateFilter);
                params.set("date_to", dateFilter);
            }
            if (orderTypeFilter) params.set("order_type", orderTypeFilter);
            if (statusFilter) params.set("status", statusFilter);
            params.set("limit", String(PAGE_SIZE));
            params.set("offset", String(page * PAGE_SIZE));
            const res = await fetch(`/api/pos/orders?${params.toString()}`);
            const data = await readJsonSafe<{
                orders?: PosOrder[];
                pagination?: { total?: number };
            }>(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load orders");
            }
            setOrders(Array.isArray(data.orders) ? data.orders : []);
            setTotalCount(
                typeof data.pagination?.total === "number" ? data.pagination.total : 0
            );
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load orders",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [dateFilter, orderTypeFilter, statusFilter, page, toast]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Reset page when filters change
    useEffect(() => {
        setPage(0);
    }, [dateFilter, orderTypeFilter, statusFilter]);

    // ── Fetch order items (expand row) ──
    const fetchOrderItems = useCallback(async (orderId: string) => {
        try {
            setIsLoadingItems(true);
            const res = await fetch(`/api/pos/orders/${orderId}`);
            const data = await readJsonSafe<{ order?: PosOrder; items?: PosOrderItem[]; folio_payments?: PosFolioPayment[] }>(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load order details");
            }
            setOrderItems(Array.isArray(data.items) ? data.items : []);
            setFolioPayments(Array.isArray(data.folio_payments) ? data.folio_payments : []);
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load order details",
                variant: "destructive",
            });
        } finally {
            setIsLoadingItems(false);
        }
    }, [toast]);

    const toggleRow = (orderId: string) => {
        if (expandedOrderId === orderId) {
            setExpandedOrderId(null);
            setOrderItems([]);
            setFolioPayments([]);
        } else {
            setExpandedOrderId(orderId);
            fetchOrderItems(orderId);
        }
    };

    // ── Void order ──
    const handleVoidClick = (order: PosOrder, e: React.MouseEvent) => {
        e.stopPropagation();
        setVoidingOrder(order);
        setVoidDialogOpen(true);
    };

    const confirmVoid = async () => {
        if (!voidingOrder) return;
        try {
            setIsVoiding(true);
            const res = await fetch(`/api/pos/orders/${voidingOrder.id}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const data = await readJsonSafe(res);
            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to void order");
            }
            toast({
                title: "Order Voided",
                description: `Order #${voidingOrder.order_number} has been voided.`,
            });
            setVoidDialogOpen(false);
            setVoidingOrder(null);
            fetchOrders();
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to void order",
                variant: "destructive",
            });
        } finally {
            setIsVoiding(false);
        }
    };

    // ── Derived ──
    const totalOrders = totalCount;
    const totalRevenue = orders
        .filter((o) => o.status === "completed")
        .reduce((sum, o) => sum + o.total, 0);
    const voidedCount = orders.filter((o) => o.status === "voided").length;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">
                    Point of Sale
                </p>
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-extrabold text-slate-900">Order History</h1>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchOrders}
                        disabled={isLoading}
                    >
                        <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4 mb-6">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Date */}
                    <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-slate-400" />
                        <Input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="w-40 text-sm"
                        />
                    </div>

                    {/* Order Type */}
                    <select
                        value={orderTypeFilter}
                        onChange={(e) => setOrderTypeFilter(e.target.value as "" | "walkin" | "guest_charge")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        <option value="">All Types</option>
                        <option value="walkin">Walk-in</option>
                        <option value="guest_charge">Room Deposit</option>
                    </select>

                    {/* Status */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as "" | "completed" | "voided")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                        <option value="">All Statuses</option>
                        <option value="completed">Completed</option>
                        <option value="voided">Voided</option>
                    </select>
                </div>
            </div>

            {/* Summary Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="card p-4 animate-pulse">
                            <div className="h-2 w-20 rounded bg-slate-200 mb-3" />
                            <div className="h-7 w-24 rounded bg-slate-200" />
                        </div>
                    ))
                ) : (
                    <>
                        <div className="card p-4 border-l-4 border-l-slate-400">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                                Total Orders
                            </p>
                            <p className="text-2xl font-extrabold text-slate-900">{totalOrders}</p>
                        </div>
                        <div className="card p-4 border-l-4 border-l-brand-600">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                                Total Revenue
                            </p>
                            <p className="text-2xl font-extrabold text-brand-600">
                                {fmtAmount(totalRevenue)} THB
                            </p>
                        </div>
                        <div className="card p-4 border-l-4 border-l-red-500">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                                Voided
                            </p>
                            <p className="text-2xl font-extrabold text-red-500">{voidedCount}</p>
                        </div>
                    </>
                )}
            </div>

            {/* Orders Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Order#
                                </th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Date/Time
                                </th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Type
                                </th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Guest
                                </th>
                                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Total
                                </th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Payment
                                </th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                    Status
                                </th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <tr key={i} className="border-b border-slate-100">
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <td key={j} className="px-4 py-3">
                                                <div className="h-4 w-20 rounded bg-slate-100 animate-pulse" />
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="text-center py-12 text-slate-400">
                                        <ClipboardListIcon className="w-12 h-12 mx-auto mb-2 opacity-40" />
                                        <p className="text-sm">No orders found for this date</p>
                                    </td>
                                </tr>
                            ) : (
                                orders.map((order) => {
                                    const isExpanded = expandedOrderId === order.id;
                                    return (
                                        <OrderRow
                                            key={order.id}
                                            order={order}
                                            isExpanded={isExpanded}
                                            orderItems={isExpanded ? orderItems : []}
                                            folioPayments={isExpanded ? folioPayments : []}
                                            isLoadingItems={isExpanded && isLoadingItems}
                                            onToggle={() => toggleRow(order.id)}
                                            onVoid={(e) => handleVoidClick(order, e)}
                                        />
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {!isLoading && totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                        <p className="text-xs text-slate-500">
                            Showing {page * PAGE_SIZE + 1}
                            {" - "}
                            {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} orders
                        </p>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === 0}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                <ChevronLeftIcon className="w-4 h-4" />
                            </Button>
                            <span className="text-sm font-medium text-slate-700 px-2">
                                {page + 1} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages - 1}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                <ChevronRightIcon className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Void Confirmation Dialog */}
            <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Void Order</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-slate-600">
                            Are you sure you want to void order{" "}
                            <span className="font-bold text-slate-900">
                                #{voidingOrder?.order_number}
                            </span>
                            ?
                        </p>
                        <p className="text-sm text-slate-500 mt-2">
                            Total:{" "}
                            <span className="font-semibold text-slate-700">
                                {fmtAmount(voidingOrder?.total ?? 0)} THB
                            </span>
                        </p>
                        <p className="text-xs text-red-500 mt-3">
                            This action cannot be undone.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setVoidDialogOpen(false);
                                setVoidingOrder(null);
                            }}
                            disabled={isVoiding}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={confirmVoid}
                            disabled={isVoiding}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isVoiding ? (
                                <RefreshCwIcon className="w-4 h-4 animate-spin mr-1" />
                            ) : (
                                <BanIcon className="w-4 h-4 mr-1" />
                            )}
                            Void Order
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/* ── Order Row Sub-component ── */

function OrderRow({
    order,
    isExpanded,
    orderItems,
    folioPayments,
    isLoadingItems,
    onToggle,
    onVoid,
}: {
    order: PosOrder;
    isExpanded: boolean;
    orderItems: PosOrderItem[];
    folioPayments: PosFolioPayment[];
    isLoadingItems: boolean;
    onToggle: () => void;
    onVoid: (e: React.MouseEvent) => void;
}) {
    const paymentLabel = order.payment_method
        ? order.payment_method === "credit_card"
            ? "Card"
            : order.payment_method === "cash"
              ? "Cash"
              : order.payment_method === "transfer"
                ? "Transfer"
                : order.payment_method
        : order.order_type === "guest_charge"
          ? "Room Deposit"
          : "-";

    return (
        <>
            <tr
                onClick={onToggle}
                className={`border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50 ${
                    isExpanded ? "bg-brand-50/50" : ""
                }`}
            >
                <td className="px-4 py-3 font-semibold text-slate-900">
                    #{order.order_number}
                </td>
                <td className="px-4 py-3 text-slate-600">
                    {fmtDateTime(order.created_at)}
                </td>
                <td className="px-4 py-3">
                    <Badge variant={order.order_type === "walkin" ? "default" : "secondary"}>
                        {order.order_type === "walkin" ? "Walk-in" : "Room Deposit"}
                    </Badge>
                </td>
                <td className="px-4 py-3 text-slate-600">
                    {order.guest_name || "-"}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                    {fmtAmount(order.total)}
                </td>
                <td className="px-4 py-3 text-slate-600">
                    {paymentLabel}
                </td>
                <td className="px-4 py-3">
                    <Badge
                        variant="outline"
                        className={
                            order.status === "completed"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : order.status === "voided"
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                        }
                    >
                        {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </Badge>
                </td>
                <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        {order.status === "completed" && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onVoid}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs"
                            >
                                <BanIcon className="w-3.5 h-3.5 mr-1" />
                                Void
                            </Button>
                        )}
                        {isExpanded ? (
                            <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                        ) : (
                            <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                        )}
                    </div>
                </td>
            </tr>

            {/* Expanded Detail Row */}
            {isExpanded && (
                <tr className="bg-slate-50/80">
                    <td colSpan={8} className="px-4 py-4">
                        <div className="ml-4">
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                                Order Items
                            </p>
                            {isLoadingItems ? (
                                <div className="space-y-2">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="h-8 rounded bg-slate-100 animate-pulse" />
                                    ))}
                                </div>
                            ) : orderItems.length === 0 ? (
                                <p className="text-sm text-slate-400">No items found</p>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                Product
                                            </th>
                                            <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                Qty
                                            </th>
                                            <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                Unit Price
                                            </th>
                                            <th className="text-right py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                                Line Total
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orderItems.map((item) => (
                                            <tr
                                                key={item.id}
                                                className="border-b border-slate-100"
                                            >
                                                <td className="py-2 text-slate-900 font-medium">
                                                    {item.product_name}
                                                </td>
                                                <td className="py-2 text-right text-slate-600 tabular-nums">
                                                    {item.quantity}
                                                </td>
                                                <td className="py-2 text-right text-slate-600 tabular-nums">
                                                    {fmtAmount(item.unit_price)}
                                                </td>
                                                <td className="py-2 text-right font-semibold text-slate-900 tabular-nums">
                                                    {fmtAmount(item.line_total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 border-slate-200">
                                            <td
                                                colSpan={3}
                                                className="py-2 text-right text-xs font-bold text-slate-500 uppercase"
                                            >
                                                Order Total
                                            </td>
                                            <td className="py-2 text-right font-extrabold text-brand-600 tabular-nums">
                                                {fmtAmount(
                                                    orderItems.reduce(
                                                        (sum, i) => sum + i.line_total,
                                                        0
                                                    )
                                                )}{" "}
                                                THB
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            )}
                            {folioPayments.length > 0 && (
                                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                                        Settlement Detail
                                    </p>
                                    <div className="space-y-2">
                                        {folioPayments.map((row) => (
                                            <div key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900">
                                                        {row.note || (row.tx_type === "refund" ? "Refund" : "Payment")}
                                                    </p>
                                                    <p className="text-xs text-slate-500">
                                                        {(row.method || "-").replace("credit_card", "card")} · {row.tx_type}
                                                        {row.is_record_only ? " · record only" : ""}
                                                    </p>
                                                </div>
                                                <p className={`text-sm font-bold tabular-nums ${row.tx_type === "refund" ? "text-red-600" : "text-slate-900"}`}>
                                                    {row.tx_type === "refund" ? "-" : "+"}{fmtAmount(row.amount)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {order.note && (
                                <p className="text-xs text-slate-500 mt-3">
                                    <span className="font-semibold">Note:</span> {order.note}
                                </p>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
