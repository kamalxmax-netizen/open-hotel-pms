"use client";

import { PackageSearch, PackageCheck, Archive } from "lucide-react";

interface LfSummaryCardsProps {
    pendingCount: number;
    claimedMonthCount: number;
    totalCount: number;
    isLoading: boolean;
}

export default function LfSummaryCards({ pendingCount, claimedMonthCount, totalCount, isLoading }: LfSummaryCardsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card p-5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-900/10 border-amber-200 dark:border-amber-900/30">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <PackageSearch className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-amber-800/70 dark:text-amber-500/70">Pending Items</p>
                        {isLoading ? (
                            <div className="h-8 w-16 bg-amber-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-3xl font-bold text-amber-700 dark:text-amber-500">{pendingCount}</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-5 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-900/10 border-emerald-200 dark:border-emerald-900/30">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <PackageCheck className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-emerald-800/70 dark:text-emerald-500/70">Claimed (This Month)</p>
                        {isLoading ? (
                            <div className="h-8 w-16 bg-emerald-200/50 animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-500">{claimedMonthCount}</p>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-5">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[var(--bg-muted)] flex items-center justify-center text-[var(--text-secondary)]">
                        <Archive className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-[var(--text-secondary)]">Total Items</p>
                        {isLoading ? (
                            <div className="h-8 w-16 bg-[var(--bg-muted)] animate-pulse rounded mt-1" />
                        ) : (
                            <p className="text-3xl font-bold text-[var(--text-primary)]">{totalCount}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
