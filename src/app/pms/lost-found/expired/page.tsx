"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Info } from "lucide-react";
import LfTableExpired from "@/components/lost-found/lf-table-expired";
import LfClearConfirm from "@/components/lost-found/lf-clear-confirm";

export default function LfExpiredPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [items, setItems] = useState<any[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    
    // Admin features
    const [showCleared, setShowCleared] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    const fetchExpiredItems = async () => {
        setIsLoading(true);
        try {
            // Ideally we check if user is admin first, maybe from a profile context, 
            // but for now we'll just send the flag if they toggled it
            const res = await fetch(`/api/lost-found/expired${showCleared ? '?show_cleared=true' : ''}`);
            if (res.ok) {
                const data = await res.json();
                setItems(data.items || []);
                
                // Set isAdmin based on a meta flag in response or profile context
                // For this implementation, we assume if the API accepts `show_cleared=true` and returns data, they are admin.
                if (data.is_admin !== undefined) {
                    setIsAdmin(data.is_admin);
                } else {
                    // Fallback to enable it for testing if not implemented by backend yet
                    setIsAdmin(true); 
                }
            }
        } catch (err) {
            console.error("Failed to fetch expired items", err);
        } finally {
            setIsLoading(false);
            setSelectedIds([]); // reset selection
        }
    };

    useEffect(() => {
        fetchExpiredItems();
    }, [showCleared]);

    const handleToggleSelect = (id: string) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleToggleSelectAll = () => {
        const unclearedItems = items.filter(i => !i.cleared_at);
        if (selectedIds.length === unclearedItems.length && unclearedItems.length > 0) {
            // Deselect all
            setSelectedIds([]);
        } else {
            // Select all uncleared
            setSelectedIds(unclearedItems.map(i => i.id));
        }
    };

    const handleClearSuccess = () => {
        setIsClearModalOpen(false);
        fetchExpiredItems();
    };

    return (
        <div className="p-6 max-w-[1200px] mx-auto min-h-screen pb-24">
            <div className="mb-6">
                <Link href="/pms/lost-found" className="inline-flex items-center text-sm font-semibold text-[var(--text-muted)] hover:text-brand-500 mb-4 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                    Back to Lost & Found
                </Link>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Expired Items</h1>
                        <p className="text-[var(--text-secondary)] mt-1">Manage items unclaimed for over 1 year.</p>
                    </div>
                </div>
            </div>

            <div className="card p-4 mb-6 bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div className="flex gap-3 text-amber-800 dark:text-amber-400 text-sm">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold">Items below have been unclaimed for over 1 year.</p>
                        <p className="mt-0.5 opacity-80">Select items to clear from the active tracking system. Clearing will permanently delete any attached photos.</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4 self-end md:self-auto shrink-0">
                    {isAdmin && (
                        <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={showCleared}
                                onChange={(e) => setShowCleared(e.target.checked)}
                                className="form-checkbox text-brand-500 rounded border-[var(--border-strong)] focus:ring-brand-500"
                            />
                            Show Cleared (Admin)
                        </label>
                    )}
                    <button 
                        onClick={() => setIsClearModalOpen(true)}
                        disabled={selectedIds.length === 0}
                        className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed justify-center text-white"
                    >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Clear Selected ({selectedIds.length})
                    </button>
                </div>
            </div>

            <LfTableExpired 
                items={items}
                isLoading={isLoading}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
            />

            <LfClearConfirm 
                isOpen={isClearModalOpen}
                onClose={() => setIsClearModalOpen(false)}
                onSuccess={handleClearSuccess}
                selectedIds={selectedIds}
            />
        </div>
    );
}
