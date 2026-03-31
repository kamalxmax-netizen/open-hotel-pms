"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import GroupBookingModal from "@/components/group-booking-modal";
import GroupDetailPanel from "@/components/group-detail-panel";
import { formatDateDisplay } from "@/lib/date-display";

type BookingGroup = {
    id: string;
    group_code: string;
    group_name: string;
    contact_name: string;
    contact_phone: string;
    contact_email?: string | null;
    source: string;
    note?: string | null;
    total_rooms: number;
    status: string;
    created_at: string;
    reservations_count: number;
    total_price: number;
    due_in_date?: string | null;
};

export default function GroupsPage() {
    const router = useRouter();

    const [groups, setGroups] = useState<BookingGroup[]>([]);
    const [searchQ, setSearchQ] = useState("");
    const [statusFilter, setStatusFilter] = useState("active");
    const [businessDate, setBusinessDate] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [justCreatedOnly, setJustCreatedOnly] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingGroup, setEditingGroup] = useState<BookingGroup | null>(null);

    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [detailGroup, setDetailGroup] = useState<any>(null);
    const [detailReservations, setDetailReservations] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");

    const setGroupQuery = useCallback((groupId: string | null) => {
        const params = new URLSearchParams(
            typeof window !== "undefined" ? window.location.search : ""
        );
        if (groupId) params.set("group_id", groupId);
        else params.delete("group_id");
        const query = params.toString();
        router.replace(query ? `/pms/groups?${query}` : "/pms/groups", { scroll: false });
    }, [router]);

    useEffect(() => {
        let cancelled = false;

        async function loadBusinessDate() {
            try {
                const res = await fetch("/api/eod/status", { cache: "no-store" });
                const data = await res.json();
                if (cancelled || !res.ok || !data?.success) return;

                const nextBusinessDate = String(data.business_date || "");
                if (!nextBusinessDate) return;

                setBusinessDate(nextBusinessDate);
                setDateFrom((prev) => prev || nextBusinessDate);
                setDateTo((prev) => prev || nextBusinessDate);
            } catch {
                // Keep the page usable even if business date lookup fails.
            }
        }

        loadBusinessDate();
        return () => {
            cancelled = true;
        };
    }, []);

    const loadGroups = useCallback(async () => {
        if (!justCreatedOnly && (!dateFrom || !dateTo)) return;
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams();
            if (statusFilter !== "all") params.set("status", statusFilter);
            if (searchQ) params.set("q", searchQ);
            if (!justCreatedOnly) {
                params.set("date_from", dateFrom);
                params.set("date_to", dateTo);
            }

            const res = await fetch(`/api/booking-groups?${params.toString()}`, { cache: "no-store" });
            const d = await res.json();
            if (d.success) setGroups(d.groups || []);
            else setError(d.error ?? "Failed to load groups.");
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, justCreatedOnly, searchQ, statusFilter]);

    useEffect(() => {
        const t = setTimeout(loadGroups, 300);
        return () => clearTimeout(t);
    }, [loadGroups]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const syncSelectedGroupFromQuery = () => {
            const queryGroupId = new URLSearchParams(window.location.search).get("group_id");
            setSelectedGroupId((prev) => (queryGroupId === prev ? prev : queryGroupId));
        };

        syncSelectedGroupFromQuery();
        window.addEventListener("popstate", syncSelectedGroupFromQuery);
        return () => window.removeEventListener("popstate", syncSelectedGroupFromQuery);
    }, []);

    const loadGroupDetail = useCallback(async (id: string) => {
        setDetailLoading(true);
        setDetailError("");
        try {
            const res = await fetch(`/api/booking-groups/${id}`, { cache: "no-store" });
            const d = await res.json();
            if (!res.ok || !d.success) {
                setDetailGroup(null);
                setDetailReservations([]);
                setDetailError(d.error ?? "Failed to load group details.");
                return;
            }
            setDetailGroup(d.group);
            setDetailReservations(d.reservations || []);
        } catch (e) {
            console.error(e);
            setDetailGroup(null);
            setDetailReservations([]);
            setDetailError("Network error while loading group details.");
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedGroupId) {
            loadGroupDetail(selectedGroupId);
        } else {
            setDetailGroup(null);
            setDetailReservations([]);
        }
    }, [selectedGroupId, loadGroupDetail]);

    const handleGroupSuccess = (groupId: string) => {
        setShowCreateModal(false);
        loadGroups();
        setSelectedGroupId(groupId);
        setGroupQuery(groupId);
    };

    const visibleGroups = groups.filter((group) => {
        if (!justCreatedOnly || !businessDate) return true;
        const createdOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(group.created_at));
        return createdOn === businessDate;
    });

    return (
        <div className="space-y-6 w-full max-w-[90rem]">
            {/* Header Area */}
            <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Group Bookings</h1>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">Manage multiple reservations under one group entity</p>
                    </div>
                    <button
                        className="btn btn-primary btn-sm flex items-center gap-1"
                        onClick={() => setShowCreateModal(true)}
                    >
                        <span>+</span> <span>New Group</span>
                    </button>
                </div>
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 sm:p-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.4fr)_auto_auto_auto_auto] items-center">
                        <div className="relative min-w-0">
                            <input
                                className="form-input pl-8 h-[42px]"
                                placeholder="Search group name / code / contact"
                                value={searchQ}
                                onChange={(e) => setSearchQ(e.target.value)}
                            />
                            <svg className="absolute left-2.5 top-3.5 h-3.5 w-3.5 text-[var(--text-muted)]" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <select
                            className="form-select w-full lg:w-auto h-[42px]"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                        <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-3 h-[42px]">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mt-0.5">From</span>
                                <input
                                    type="date"
                                    className="bg-transparent text-sm text-[var(--text-primary)] outline-none"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                />
                            </div>
                            <span className="text-[var(--text-muted)]">→</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mt-0.5">To</span>
                                <input
                                    type="date"
                                    className="bg-transparent text-sm text-[var(--text-primary)] outline-none"
                                    value={dateTo}
                                    min={dateFrom || undefined}
                                    onChange={(e) => setDateTo(e.target.value)}
                                />
                            </div>
                        </div>
                        {businessDate && (
                            <button
                                className="btn btn-secondary h-[42px] px-4 whitespace-nowrap text-sm"
                                onClick={() => {
                                    setJustCreatedOnly(false);
                                    setDateFrom(businessDate);
                                    setDateTo(businessDate);
                                }}
                            >
                                Business Date
                            </button>
                        )}
                        <button
                            className={`btn h-[42px] px-4 whitespace-nowrap text-sm ${justCreatedOnly ? "btn-primary" : "btn-secondary"}`}
                            onClick={() => setJustCreatedOnly((prev) => !prev)}
                            title={businessDate ? `Show only groups created on ${businessDate}` : "Show only groups created today"}
                        >
                            Just Created
                        </button>
                    </div>
                </div>
            </div>

            {(error || detailError) && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error || detailError}
                </div>
            )}

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--bg-muted)]" />
                    ))}
                </div>
            ) : visibleGroups.length === 0 ? (
                <div className="card p-12 text-center text-[var(--text-secondary)]">
                    <span className="text-4xl">👥</span>
                    <p className="font-bold text-[var(--text-table-cell)] mt-3">No groups found</p>
                    <p className="text-sm mt-1 mb-4">You have no active booking groups matching your search.</p>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowCreateModal(true)}
                    >
                        Create First Group
                    </button>
                </div>
            ) : (
                <div className="card overflow-hidden">
                    <table className="data-table">
                        <thead className="bg-[var(--bg-body)]">
                            <tr>
                                <th>Code</th>
                                <th>Group Name</th>
                                <th>Due In</th>
                                <th>Contact</th>
                                <th>Source</th>
                                <th>Linked Rooms</th>
                                <th className="text-right">Total Price</th>
                                <th>Status</th>
                                <th>Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                            {visibleGroups.map((g) => (
                                <tr
                                    key={g.id}
                                    className="hover:bg-indigo-50/50 dark:hover:bg-brand-500/10 cursor-pointer transition-colors"
                                    onClick={() => {
                                        setSelectedGroupId(g.id);
                                        setGroupQuery(g.id);
                                    }}
                                >
                                    <td className="py-3 px-4">
                                        <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-500/20 dark:text-indigo-400 px-2 py-1 rounded">
                                            {g.group_code}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="font-bold text-[var(--text-primary)]">{g.group_name}</div>
                                    </td>
                                    <td className="py-3 px-4 text-sm text-[var(--text-table-cell)]">
                                        {g.due_in_date ? formatDateDisplay(g.due_in_date) : "—"}
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="text-sm font-medium text-[var(--text-table-cell)]">{g.contact_name || "—"}</div>
                                        {g.contact_phone && <div className="text-xs text-[var(--text-muted)]">{g.contact_phone}</div>}
                                    </td>
                                    <td className="py-3 px-4 uppercase text-xs font-bold text-[var(--text-secondary)]">
                                        {g.source}
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${g.reservations_count > 0 ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400" : "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"
                                            }`}>
                                            {g.reservations_count}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        <div className="font-bold text-[var(--text-primary)]">฿{(g.total_price || 0).toLocaleString()}</div>
                                    </td>
                                    <td className="py-3 px-4">
                                        <span className={`badge ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                                            g.status === 'completed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                                                'bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]'
                                            }`}>
                                            {g.status.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                                        {new Date(g.created_at).toLocaleDateString("en-GB")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modals & Panels */}
            {showCreateModal && (
                <GroupBookingModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={handleGroupSuccess}
                />
            )}

            {editingGroup && (
                <GroupBookingModal
                    mode="edit"
                    group={editingGroup}
                    onClose={() => setEditingGroup(null)}
                    onSuccess={(groupId) => {
                        setEditingGroup(null);
                        setSelectedGroupId(groupId);
                        setGroupQuery(groupId);
                        loadGroupDetail(groupId);
                        loadGroups();
                    }}
                />
            )}

            {selectedGroupId && detailLoading && (
                <div className="fixed inset-0 z-40 bg-[var(--overlay-bg)] backdrop-blur-[2px] flex items-center justify-center">
                    <div className="bg-[var(--bg-surface)] p-6 rounded-xl shadow-xl flex items-center gap-3">
                        <span className="animate-spin text-xl">⏳</span> Loading Group Data...
                    </div>
                </div>
            )}

            {selectedGroupId && !detailLoading && detailGroup && (
                <GroupDetailPanel
                    group={detailGroup}
                    reservations={detailReservations}
                    onClose={() => {
                        setSelectedGroupId(null);
                        setGroupQuery(null);
                    }}
                    onRefresh={() => {
                        loadGroupDetail(selectedGroupId);
                        loadGroups();
                    }}
                    onEditGroup={() => setEditingGroup(detailGroup)}
                />
            )}
        </div>
    );
}
