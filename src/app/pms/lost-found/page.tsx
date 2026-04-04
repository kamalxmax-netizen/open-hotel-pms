"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Archive } from "lucide-react";

import LfSummaryCards from "@/components/lost-found/lf-summary-cards";
import LfFilterBar, { LfFilterState } from "@/components/lost-found/lf-filter-bar";
import LfItemTable from "@/components/lost-found/lf-item-table";
import LfDetailDrawer from "@/components/lost-found/lf-detail-drawer";
import LfClaimModal from "@/components/lost-found/lf-claim-modal";
import LfReportModal from "@/components/lost-found/lf-report-modal";

export default function LostFoundPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [items, setItems] = useState<any[]>([]);
    const [summary, setSummary] = useState({ pending: 0, claimedMonth: 0, total: 0 });
    
    // UI State
    const [filters, setFilters] = useState<LfFilterState>({
        status: "pending",
        dateFrom: "",
        dateTo: "",
        room: "",
        guest: "",
        reportedBy: ""
    });
    
    const [selectedItem, setSelectedItem] = useState<any>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);

    // Initial fetch and fetch on filter change
    useEffect(() => {
        const fetchSummary = async () => {
            try {
                const res = await fetch("/api/lost-found/summary");
                if (res.ok) {
                    const json = await res.json();
                    const data = json.summary || {};
                    setSummary({
                        pending: data.pending || 0,
                        claimedMonth: data.claimed_this_month || 0,
                        total: data.total || 0
                    });
                }
            } catch (err) {
                console.error("Failed to fetch L&F summary", err);
            }
        };

        fetchSummary();
    }, []); // Only on mount or when successfully modified

    const fetchItems = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.status !== "all") params.append("status", filters.status);
            if (filters.dateFrom) params.append("date_from", filters.dateFrom);
            if (filters.dateTo) params.append("date_to", filters.dateTo);
            if (filters.room) params.append("room_number", filters.room);
            if (filters.guest) params.append("guest_name", filters.guest);
            if (filters.reportedBy) params.append("reported_by", filters.reportedBy);

            const res = await fetch(`/api/lost-found?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setItems(data.items || []);
            }
        } catch (err) {
            console.error("Failed to fetch L&F items", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
    }, [filters]);

    // Handlers
    const handleViewDetail = (item: any) => {
        setSelectedItem(item);
        setIsDrawerOpen(true);
    };

    const handleClaimClick = (item: any) => {
        setSelectedItem(item);
        setIsClaimModalOpen(true);
    };

    const handleClaimSuccess = () => {
        setIsClaimModalOpen(false);
        setIsDrawerOpen(false); // Close drawer if it was open
        // Refresh data
        fetchItems();
        // Also refresh summary since pending count changed
        fetch("/api/lost-found/summary").then(res => res.json()).then(json => {
            const data = json?.summary;
            if (data) {
                setSummary({
                    pending: data.pending || 0,
                    claimedMonth: data.claimed_this_month || 0,
                    total: data.total || 0
                });
            }
        }).catch(console.error);
    };

    const handleReportSuccess = () => {
        setIsReportModalOpen(false);
        fetchItems();
        // Also refresh summary
        fetch("/api/lost-found/summary").then(res => res.json()).then(json => {
            const data = json?.summary;
            if (data) {
                setSummary({
                    pending: data.pending || 0,
                    claimedMonth: data.claimed_this_month || 0,
                    total: data.total || 0
                });
            }
        }).catch(console.error);
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen pb-24">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Lost & Found</h1>
                    <p className="text-[var(--text-secondary)] mt-1">Manage guest items left behind.</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Link 
                        href="/pms/lost-found/expired"
                        className="btn-ghost flex-1 md:flex-none justify-center border border-[var(--border-strong)]"
                    >
                        <Archive className="w-4 h-4 mr-2" />
                        Expired Items
                    </Link>
                    <button 
                        onClick={() => setIsReportModalOpen(true)}
                        className="btn-primary flex-1 md:flex-none justify-center"
                    >
                        <Plus className="w-4 h-4 mr-1" />
                        Report Item
                    </button>
                </div>
            </div>

            <LfSummaryCards 
                pendingCount={summary.pending} 
                claimedMonthCount={summary.claimedMonth} 
                totalCount={summary.total} 
                isLoading={false} 
            />

            <LfFilterBar filters={filters} onChange={setFilters} />

            <LfItemTable 
                items={items} 
                isLoading={isLoading} 
                onViewDetail={handleViewDetail}
                onClaimClick={handleClaimClick}
            />

            {/* Overlays / Drawers / Modals */}
            <LfDetailDrawer 
                item={selectedItem} 
                isOpen={isDrawerOpen} 
                onClose={() => setIsDrawerOpen(false)} 
                onClaimClick={handleClaimClick} 
            />

            <LfClaimModal 
                item={selectedItem} 
                isOpen={isClaimModalOpen} 
                onClose={() => setIsClaimModalOpen(false)} 
                onSuccess={handleClaimSuccess} 
            />

            <LfReportModal 
                isOpen={isReportModalOpen} 
                onClose={() => setIsReportModalOpen(false)} 
                onSuccess={handleReportSuccess} 
            />
        </div>
    );
}
