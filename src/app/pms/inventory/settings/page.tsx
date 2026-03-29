"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PackageIcon, SettingsIcon, ListOrderedIcon, ShieldAlertIcon } from "lucide-react";
import { useAdminRole } from "@/hooks/use-admin-role";

import { ProductsTab } from "./ProductsTab";
import { StockManagementTab } from "./StockManagementTab";
import { DisplayOrderTab } from "./DisplayOrderTab";

type TabKey = "products" | "stock" | "display_order";

function InventorySettingsPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isAdmin, loading } = useAdminRole();

    const [activeTab, setActiveTab] = useState<TabKey>("products");

    useEffect(() => {
        const tab = searchParams.get("tab") as TabKey | null;
        if (tab && ["products", "stock", "display_order"].includes(tab)) {
            setActiveTab(tab);
        }
    }, [searchParams]);

    const handleTabChange = (tab: TabKey) => {
        setActiveTab(tab);
        router.replace(`/pms/inventory/settings?tab=${tab}`);
    };

    if (loading) {
        return (
            <div className="p-6 flex justify-center items-center h-40">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="p-6 max-w-lg mx-auto mt-10">
                <div className="card p-8 text-center border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20">
                    <ShieldAlertIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-red-700 dark:text-red-400">Access Denied</h2>
                    <p className="text-sm text-red-600 dark:text-red-300 mt-2">
                        You do not have permission to view this page. This area is restricted to administrators and supervisors.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                        Admin
                    </p>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                        Inventory Settings
                    </h1>
                </div>
            </div>

            <div className="flex border-b border-[var(--border-subtle)] overflow-x-auto no-scrollbar">
                <button
                    onClick={() => handleTabChange("products")}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === "products"
                            ? "border-brand-600 text-brand-700 dark:text-brand-400"
                            : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    <PackageIcon className="w-4 h-4" />
                    Products
                </button>
                <button
                    onClick={() => handleTabChange("stock")}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === "stock"
                            ? "border-brand-600 text-brand-700 dark:text-brand-400"
                            : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    <SettingsIcon className="w-4 h-4" />
                    Stock Management
                </button>
                <button
                    onClick={() => handleTabChange("display_order")}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === "display_order"
                            ? "border-brand-600 text-brand-700 dark:text-brand-400"
                            : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-input)]"
                    }`}
                >
                    <ListOrderedIcon className="w-4 h-4" />
                    Display Order
                </button>
            </div>

            <div className="pt-2">
                {activeTab === "products" && <ProductsTab />}
                {activeTab === "stock" && <StockManagementTab />}
                {activeTab === "display_order" && <DisplayOrderTab />}
            </div>
        </div>
    );
}

export default function InventorySettingsPage() {
    return (
        <Suspense fallback={<div className="p-6" />}>
            <InventorySettingsPageInner />
        </Suspense>
    );
}
