"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PackageIcon,
  ArrowRightLeftIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  CalendarIcon,
  BarChart3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type ApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = {
  success?: boolean;
  error?: string;
} & T;

async function readJsonSafe<T extends Record<string, unknown>>(
  response: Response
): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return {} as ApiResponse<T>;
  }
}

function todayString(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

interface DashboardSummary {
  main_products: number;
  floor_stock_rows: number;
  low_stock_count: number;
  transactions_count: number;
}

interface LowStockItem {
  id: string;
  product_id: string;
  product_name: string | null;
  category: string | null;
  unit: string | null;
  quantity: number;
  reorder_level: number;
  updated_at: string;
  is_low_stock: boolean;
}

interface FloorOverview {
  floor_number: number;
  distinct_products: number;
  total_units: number;
}

interface FloorStockDetail {
  floor_number: number;
  product_id: string;
  product_name: string | null;
  category: string | null;
  unit: string | null;
  quantity: number;
  updated_at: string;
}

interface TopRoomUsage {
  room_number: string;
  usage_count: number;
  units_used: number;
}

interface ProductUsageEntry {
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  unit: string | null;
  room_number: string;
  floor_number: number | null;
  usage_count: number;
  units_used: number;
}

interface InventoryDashboardData {
  range: {
    date_from: string;
    date_to: string;
  };
  summary: DashboardSummary;
  low_stock_items: LowStockItem[];
  floor_overview: FloorOverview[];
  floor_stock_details: FloorStockDetail[];
  transactions_by_action: Record<string, number>;
  top_room_usage: TopRoomUsage[];
  product_usage_entries: ProductUsageEntry[];
  [key: string]: unknown;
}

export default function InventoryDashboardPage() {
  const { toast } = useToast();

  const [date, setDate] = useState(todayString());
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<InventoryDashboardData | null>(null);
  const [usageFloorFilter, setUsageFloorFilter] = useState<"all" | number>("all");
  const [expandedFloors, setExpandedFloors] = useState<Record<number, boolean>>({});

  const fetchDashboard = useCallback(
    async (selectedDate: string) => {
      try {
        setIsLoading(true);
        const params = new URLSearchParams({
          date_from: selectedDate,
          date_to: selectedDate,
        });
        const res = await fetch(`/api/inventory/dashboard?${params.toString()}`, { cache: "no-store" });
        const json = await readJsonSafe<InventoryDashboardData>(res);

        if (!res.ok || json.success === false) {
          throw new Error(json.error || "Failed to load inventory dashboard");
        }

        setData({
          range: json.range ?? { date_from: selectedDate, date_to: selectedDate },
          summary: json.summary ?? {
            main_products: 0,
            floor_stock_rows: 0,
            low_stock_count: 0,
            transactions_count: 0,
          },
          low_stock_items: Array.isArray(json.low_stock_items) ? json.low_stock_items : [],
          floor_overview: Array.isArray(json.floor_overview) ? json.floor_overview : [],
          floor_stock_details: Array.isArray(json.floor_stock_details)
            ? json.floor_stock_details
            : [],
          transactions_by_action:
            json.transactions_by_action && typeof json.transactions_by_action === "object"
              ? json.transactions_by_action
              : {},
          top_room_usage: Array.isArray(json.top_room_usage) ? json.top_room_usage : [],
          product_usage_entries: Array.isArray(json.product_usage_entries)
            ? json.product_usage_entries
            : [],
        });
      } catch (err) {
        toast({
          title: "Error",
          description:
            err instanceof Error ? err.message : "Failed to load inventory dashboard",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    fetchDashboard(date);
  }, [fetchDashboard, date]);

  const summaryTiles = data
    ? [
        {
          label: "Main Products",
          value: data.summary.main_products.toString(),
          borderColor: "border-l-sky-500",
          icon: <PackageIcon className="w-5 h-5 text-sky-500" />,
        },
        {
          label: "Floor Stock Rows",
          value: data.summary.floor_stock_rows.toString(),
          borderColor: "border-l-amber-400",
          icon: <ArrowRightLeftIcon className="w-5 h-5 text-amber-500" />,
        },
        {
          label: "Low Stock Alerts",
          value: data.summary.low_stock_count.toString(),
          borderColor: "border-l-red-500",
          icon: <AlertTriangleIcon className="w-5 h-5 text-red-500" />,
        },
        {
          label: "Transactions",
          value: data.summary.transactions_count.toString(),
          borderColor: "border-l-emerald-500",
          icon: <BarChart3Icon className="w-5 h-5 text-emerald-500" />,
        },
      ]
    : [];

  const usageFloorOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<number>();
    data.product_usage_entries.forEach((row) => {
      if (typeof row.floor_number === "number" && Number.isInteger(row.floor_number)) {
        set.add(row.floor_number);
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [data]);

  useEffect(() => {
    if (usageFloorFilter === "all") return;
    if (!usageFloorOptions.includes(usageFloorFilter)) {
      setUsageFloorFilter("all");
    }
  }, [usageFloorFilter, usageFloorOptions]);

  const filteredUsageEntries = useMemo(() => {
    if (!data) return [];
    if (usageFloorFilter === "all") return data.product_usage_entries;
    return data.product_usage_entries.filter((row) => row.floor_number === usageFloorFilter);
  }, [data, usageFloorFilter]);

  const usageSummary = useMemo(() => {
    const productKeys = new Set<string>();
    const roomKeys = new Set<string>();
    let unitsTotal = 0;
    filteredUsageEntries.forEach((row) => {
      productKeys.add(String(row.product_id ?? row.product_name ?? "unknown"));
      roomKeys.add(String(row.room_number ?? ""));
      unitsTotal += Number(row.units_used ?? 0);
    });
    return {
      products: productKeys.size,
      rooms: roomKeys.size,
      units: unitsTotal,
    };
  }, [filteredUsageEntries]);

  const usageByCategory = useMemo(() => {
    const categoryMap = new Map<
      string,
      Map<
        string,
        {
          product_id: string | null;
          product_name: string | null;
          unit: string | null;
          usage_count: number;
          units_used: number;
          rooms: Array<{
            room_number: string;
            floor_number: number | null;
            usage_count: number;
            units_used: number;
          }>;
        }
      >
    >();

    filteredUsageEntries.forEach((row) => {
      const category = String(row.category ?? "").trim() || "Uncategorized";
      const productKey = String(row.product_id ?? row.product_name ?? "unknown");

      if (!categoryMap.has(category)) categoryMap.set(category, new Map());
      const productMap = categoryMap.get(category)!;

      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          product_id: row.product_id ?? null,
          product_name: row.product_name ?? null,
          unit: row.unit ?? null,
          usage_count: 0,
          units_used: 0,
          rooms: [],
        });
      }

      const product = productMap.get(productKey)!;
      product.usage_count += Number(row.usage_count ?? 0);
      product.units_used += Number(row.units_used ?? 0);

      product.rooms.push({
        room_number: String(row.room_number ?? "-"),
        floor_number: row.floor_number ?? null,
        usage_count: Number(row.usage_count ?? 0),
        units_used: Number(row.units_used ?? 0),
      });
    });

    return Array.from(categoryMap.entries())
      .map(([category, productMap]) => {
        const products = Array.from(productMap.values()).map((product) => ({
          ...product,
          rooms: [...product.rooms].sort((a, b) => {
            if (b.units_used !== a.units_used) return b.units_used - a.units_used;
            return a.room_number.localeCompare(b.room_number, undefined, { numeric: true });
          }),
        }));

        products.sort((a, b) => {
          if (b.units_used !== a.units_used) return b.units_used - a.units_used;
          return String(a.product_name ?? "").localeCompare(String(b.product_name ?? ""), undefined, {
            numeric: true,
          });
        });

        return { category, products };
      })
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredUsageEntries]);

  function getRoomBadgeClass(floorNumber: number | null): string {
    if (usageFloorFilter !== "all") {
      return "border-[var(--border-default)] bg-[var(--bg-body)] text-[var(--text-table-cell)]";
    }
    if (floorNumber === 1) return "border-sky-200 bg-sky-50 text-sky-700";
    if (floorNumber === 2) return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (floorNumber === 3) return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-[var(--border-default)] bg-[var(--bg-body)] text-[var(--text-table-cell)]";
  }

  const floorDetailsMap = useMemo(() => {
    const map: Record<number, FloorStockDetail[]> = {};
    if (!data) return map;
    data.floor_stock_details.forEach((row) => {
      const floorNumber = Number(row.floor_number ?? 0);
      if (!Number.isInteger(floorNumber) || floorNumber <= 0) return;
      if (!map[floorNumber]) map[floorNumber] = [];
      map[floorNumber].push(row);
    });
    Object.keys(map).forEach((key) => {
      const floorNumber = Number(key);
      map[floorNumber] = map[floorNumber].sort((a, b) =>
        String(a.product_name ?? "").localeCompare(String(b.product_name ?? ""), undefined, {
          numeric: true,
        })
      );
    });
    return map;
  }, [data]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">
          INVENTORY
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Inventory Dashboard</h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-9 w-44"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchDashboard(date)}
              disabled={isLoading}
            >
              <RefreshCwIcon
                className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {isLoading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl bg-[var(--bg-muted)] h-24" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl bg-[var(--bg-muted)] h-40" />
            ))}
          </div>
          <div className="animate-pulse rounded-xl bg-[var(--bg-muted)] h-56" />
          <div className="animate-pulse rounded-xl bg-[var(--bg-muted)] h-40" />
        </div>
      )}

      {data && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryTiles.map((tile) => (
              <div
                key={tile.label}
                className={`card border-l-4 ${tile.borderColor} p-4 flex items-start justify-between`}
              >
                <div>
                  <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">{tile.label}</p>
                  <p className="text-2xl font-extrabold text-[var(--text-primary)]">{tile.value}</p>
                </div>
                <div className="mt-1">{tile.icon}</div>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Floor Stock Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((floorNum) => {
                const floor = data.floor_overview.find((f) => f.floor_number === floorNum);
                const floorDetails = floorDetailsMap[floorNum] ?? [];
                const isExpanded = Boolean(expandedFloors[floorNum]);
                const dashboardUnits = floorDetails.reduce(
                  (total, row) => total + Number(row.quantity ?? 0),
                  0
                );
                return (
                  <div key={floorNum} className="card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">Floor {floorNum}</h3>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFloors((prev) => ({ ...prev, [floorNum]: !Boolean(prev[floorNum]) }))
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
                      >
                        {isExpanded ? <ChevronUpIcon className="h-3.5 w-3.5" /> : <ChevronDownIcon className="h-3.5 w-3.5" />}
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">Distinct Products</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {floor?.distinct_products ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">Total Units</span>
                        <span className="font-bold text-[var(--text-primary)]">{floor?.total_units ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">Dashboard Items</span>
                        <span className="font-bold text-brand-700">
                          {floorDetails.length} ({dashboardUnits} units)
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                        {floorDetails.length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)]">
                            No products selected for dashboard on this floor.
                            Select in Stock Levels using "Show on Dashboard".
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-[var(--border-subtle)]">
                                  <th className="py-1.5 pr-2 text-left font-semibold text-[var(--text-secondary)]">Product</th>
                                  <th className="py-1.5 pr-2 text-right font-semibold text-[var(--text-secondary)]">Qty</th>
                                  <th className="py-1.5 text-left font-semibold text-[var(--text-secondary)]">Unit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {floorDetails.map((item) => (
                                  <tr key={`${floorNum}-${item.product_id}`} className="border-b border-slate-50">
                                    <td className="py-1.5 pr-2 text-[var(--text-table-cell)]">{item.product_name ?? "Unknown"}</td>
                                    <td className="py-1.5 pr-2 text-right font-semibold text-[var(--text-primary)]">{item.quantity}</td>
                                    <td className="py-1.5 text-[var(--text-secondary)]">{item.unit ?? "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Checklist Usage by Product</h2>
              <div className="flex items-center flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setUsageFloorFilter("all")}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                    usageFloorFilter === "all"
                      ? "bg-brand-50 text-brand-700 border-brand-200"
                      : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)]"
                  }`}
                >
                  All Floors
                </button>
                {usageFloorOptions.map((floor) => (
                  <button
                    key={floor}
                    type="button"
                    onClick={() => setUsageFloorFilter(floor)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      usageFloorFilter === floor
                        ? "bg-brand-50 text-brand-700 border-brand-200"
                        : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-default)]"
                    }`}
                  >
                    Floor {floor}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div className="card p-3">
                <p className="text-xs text-[var(--text-secondary)]">Products Used</p>
                <p className="text-xl font-extrabold text-[var(--text-primary)]">{usageSummary.products}</p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-[var(--text-secondary)]">Rooms Used</p>
                <p className="text-xl font-extrabold text-[var(--text-primary)]">{usageSummary.rooms}</p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-[var(--text-secondary)]">Total Units Used</p>
                <p className="text-xl font-extrabold text-[var(--text-primary)]">{usageSummary.units}</p>
              </div>
            </div>

            {usageByCategory.length === 0 ? (
              <div className="card p-8 text-center text-[var(--text-muted)]">
                <PackageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No checklist usage in selected filter</p>
              </div>
            ) : (
              <div className="space-y-4">
                {usageByCategory.map((group) => (
                  <div key={group.category} className="card overflow-x-auto">
                    <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">{group.category}</h3>
                      <Badge variant="secondary" className="text-[11px]">
                        {group.products.length} products
                      </Badge>
                    </div>

                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)]">
                          <th className="text-left py-2.5 px-4 font-semibold text-[var(--text-secondary)]">Product</th>
                          <th className="text-right py-2.5 px-4 font-semibold text-[var(--text-secondary)]">Total Units</th>
                          <th className="text-right py-2.5 px-4 font-semibold text-[var(--text-secondary)]">Usage Count</th>
                          <th className="text-left py-2.5 px-4 font-semibold text-[var(--text-secondary)]">Room Breakdown</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.products.map((product) => (
                          <tr
                            key={`${group.category}-${product.product_id ?? product.product_name ?? "unknown"}`}
                            className="border-b border-slate-50 hover:bg-[var(--bg-body)]/70"
                          >
                            <td className="py-2.5 px-4">
                              <p className="font-semibold text-[var(--text-primary)]">{product.product_name ?? "Unknown Product"}</p>
                              <p className="text-xs text-[var(--text-muted)]">{product.unit ?? "-"}</p>
                            </td>
                            <td className="text-right py-2.5 px-4 font-bold text-[var(--text-primary)]">{product.units_used}</td>
                            <td className="text-right py-2.5 px-4 text-[var(--text-table-cell)]">{product.usage_count}</td>
                            <td className="py-2.5 px-4">
                              <div className="flex flex-wrap gap-1.5">
                                {product.rooms.slice(0, 10).map((room) => (
                                  <span
                                    key={`${product.product_id ?? product.product_name ?? "unknown"}-${room.room_number}-${room.floor_number ?? "na"}`}
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getRoomBadgeClass(
                                      room.floor_number
                                    )}`}
                                  >
                                    Room {room.room_number}: {room.units_used}
                                  </span>
                                ))}
                                {product.rooms.length > 10 && (
                                  <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                                    +{product.rooms.length - 10} more
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">Transactions by Action</h3>
              {Object.keys(data.transactions_by_action).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No transactions</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.transactions_by_action).map(([action, count]) => (
                    <Badge key={action} variant="secondary" className="text-xs">
                      {action}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">Low Stock Items</h3>
              {data.low_stock_items.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No low stock items</p>
              ) : (
                <ul className="space-y-2">
                  {data.low_stock_items.slice(0, 8).map((item) => (
                    <li key={item.id} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-table-cell)] truncate mr-2">{item.product_name ?? "Unknown"}</span>
                      <span className="font-semibold text-amber-600">
                        {item.quantity}/{item.reorder_level}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
