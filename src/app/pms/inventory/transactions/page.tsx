"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
    ListIcon, RefreshCwIcon, CalendarIcon,
    ArrowDownIcon, ArrowUpIcon, PackageIcon, FilterIcon
} from "lucide-react";
import { StockTransaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

function formatThaiDate(dateStr: string) {
    try {
        return new Intl.DateTimeFormat("en-GB", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
            timeZone: "Asia/Bangkok",
        }).format(new Date(dateStr));
    } catch {
        return dateStr;
    }
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
    use: { label: "Used", color: "bg-sky-100 text-sky-700" },
    transfer_out: { label: "Transfer Out", color: "bg-amber-100 text-amber-700" },
    transfer_in: { label: "Transfer In", color: "bg-emerald-100 text-emerald-700" },
    sale: { label: "POS Sale", color: "bg-brand-100 text-brand-700" },
    receive: { label: "Received", color: "bg-green-100 text-green-700" },
    adjust: { label: "Adjusted", color: "bg-[var(--bg-muted)] text-[var(--text-table-cell)]" },
    return: { label: "Returned", color: "bg-purple-100 text-purple-700" },
};

/* ── Component ── */

export default function TransactionsPage() {
    const { toast } = useToast();

    // State
    const [transactions, setTransactions] = useState<StockTransaction[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    // Filters
    const [dateFrom, setDateFrom] = useState<string>(() => {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().split("T")[0];
    });
    const [dateTo, setDateTo] = useState<string>(dateFrom);
    const [actionFilter, setActionFilter] = useState<string>("");
    const [floorFilter, setFloorFilter] = useState<string>("");
    const [productSearch, setProductSearch] = useState("");

    // Pagination
    const [page, setPage] = useState(0);
    const pageSize = 50;

    // ── Fetch ──
    const fetchTransactions = useCallback(async () => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            if (dateFrom) params.set("date_from", dateFrom);
            if (dateTo) params.set("date_to", dateTo);
            if (actionFilter) params.set("action", actionFilter);
            if (floorFilter) params.set("floor_number", floorFilter);
            params.set("limit", String(pageSize));
            params.set("offset", String(page * pageSize));

            const res = await fetch(`/api/stock/transactions?${params.toString()}`);
            const data = await readJsonSafe<{
                transactions?: StockTransaction[];
                pagination?: { total?: number };
            }>(res);

            if (!res.ok || data.success === false) {
                throw new Error(data.error || "Failed to load transactions");
            }

            setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
            setTotalCount(
                typeof data.pagination?.total === "number" ? data.pagination.total : 0
            );
        } catch (err) {
            toast({
                title: "Error",
                description: err instanceof Error ? err.message : "Failed to load transactions",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [dateFrom, dateTo, actionFilter, floorFilter, page, toast]);

    useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

    // Reset page on filter change
    useEffect(() => { setPage(0); }, [dateFrom, dateTo, actionFilter, floorFilter]);

    // Local product name filter
    const filteredTx = useMemo(() => {
        if (!productSearch.trim()) return transactions;
        const q = productSearch.toLowerCase();
        return transactions.filter(t =>
            (t.product_name ?? "").toLowerCase().includes(q) ||
            (t.room_number ?? "").toLowerCase().includes(q) ||
            (t.performed_by ?? "").toLowerCase().includes(q)
        );
    }, [transactions, productSearch]);

    const totalPages = Math.ceil(totalCount / pageSize);

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Inventory</p>
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Transaction History</h1>
                    <Button variant="outline" size="sm" onClick={fetchTransactions} disabled={isLoading}>
                        <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">From</label>
                        <Input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">To</label>
                        <Input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Action</label>
                        <select
                            value={actionFilter}
                            onChange={(e) => setActionFilter(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                        >
                            <option value="">All Actions</option>
                            <option value="use">Used (HK)</option>
                            <option value="sale">POS Sale</option>
                            <option value="transfer_in">Transfer In</option>
                            <option value="transfer_out">Transfer Out</option>
                            <option value="receive">Received</option>
                            <option value="adjust">Adjusted</option>
                            <option value="return">Returned</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Floor</label>
                        <select
                            value={floorFilter}
                            onChange={(e) => setFloorFilter(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm"
                        >
                            <option value="">All Floors</option>
                            <option value="1">Floor 1</option>
                            <option value="2">Floor 2</option>
                            <option value="3">Floor 3</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Search</label>
                        <div className="relative mt-1">
                            <Input
                                placeholder="Product, room, staff..."
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
                {/* Active filters count */}
                <div className="flex items-center gap-2 mt-3">
                    <p className="text-xs text-[var(--text-muted)]">
                        Showing {filteredTx.length} of {totalCount} records
                        {(actionFilter || floorFilter) && " (filtered)"}
                    </p>
                </div>
            </div>

            {/* Transaction Table */}
            <div className="card overflow-hidden">
                {isLoading ? (
                    <div className="p-4 space-y-3">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="animate-pulse rounded-lg bg-[var(--bg-muted)] h-12" />
                        ))}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-[var(--border-subtle)]">
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Date/Time</th>
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Product</th>
                                    <th className="text-center text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Action</th>
                                    <th className="text-right text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Qty</th>
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">From / To</th>
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Room</th>
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">By</th>
                                    <th className="text-left text-xs font-semibold text-[var(--text-secondary)] uppercase px-4 py-3">Note</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredTx.map(tx => {
                                    const actionInfo = ACTION_LABELS[tx.action] ?? { label: tx.action, color: "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]" };
                                    const isNegative = tx.quantity_change < 0;
                                    return (
                                        <tr key={tx.id} className="hover:bg-[var(--bg-body)] transition-colors">
                                            <td className="px-4 py-3 text-sm text-[var(--text-secondary)] whitespace-nowrap">
                                                {formatThaiDate(tx.created_at)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-medium text-[var(--text-primary)]">{tx.product_name ?? "—"}</p>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full ${actionInfo.color}`}>
                                                    {actionInfo.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={`text-sm font-bold flex items-center justify-end gap-0.5 ${isNegative ? "text-red-600" : "text-emerald-600"}`}>
                                                    {isNegative ? <ArrowDownIcon className="w-3 h-3" /> : <ArrowUpIcon className="w-3 h-3" />}
                                                    {isNegative ? tx.quantity_change : `+${tx.quantity_change}`}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                                                {tx.from_location && tx.to_location
                                                    ? `${tx.from_location} → ${tx.to_location}`
                                                    : tx.from_location ?? tx.to_location ?? "—"
                                                }
                                            </td>
                                            <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                                                {tx.room_number ?? "—"}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                                                {tx.performed_by ?? "—"}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-[var(--text-muted)] max-w-[200px] truncate" title={tx.note ?? ""}>
                                                {tx.note ?? "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredTx.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center py-12 text-[var(--text-muted)]">
                                            <ListIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                                            <p className="text-sm">No transactions found</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)]">
                        <p className="text-xs text-[var(--text-muted)]">
                            Page {page + 1} of {totalPages}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
