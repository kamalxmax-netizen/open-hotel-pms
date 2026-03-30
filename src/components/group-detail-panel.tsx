"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { extractDepositGeneralNote } from "@/lib/deposit-ledger";
import { formatDateDisplay, formatDateRangeDisplay } from "@/lib/date-display";
import ReservationOptionsPanel from "./reservation-options-panel";
import ReservationDetailPage from "./reservation-detail-page";

type PaymentMethod = "cash" | "transfer" | "credit_card";
type DepositPolicy = "keep" | "set";

type MassPaymentDraft = {
    id: string;
    amount: string;
    method: PaymentMethod;
    note: string;
};

type MassCheckinRow = {
    reservation_id: string;
    booking_code: string;
    guest_name: string;
    room_number: string;
    selected: boolean;
    checkin_time: string;
    deposit_policy: DepositPolicy;
    deposit_amount: string;
    deposit_note: string;
    payments: MassPaymentDraft[];
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
    { value: "cash", label: "Cash" },
    { value: "transfer", label: "Transfer" },
    { value: "credit_card", label: "Card" }
];
const DEFAULT_GROUP_DEPOSIT_AMOUNT = 200;

function defaultBangkokTimeHHmm(): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
}

function createPaymentDraft(seed = ""): MassPaymentDraft {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return {
        id: `${seed || "payment"}-${suffix}`,
        amount: "",
        method: "cash",
        note: ""
    };
}

interface GroupDetailPanelProps {
    group: any;
    reservations: any[];
    onClose: () => void;
    onRefresh: () => void;
    onEditGroup: () => void;
}

export default function GroupDetailPanel({
    group,
    reservations,
    onClose,
    onRefresh,
    onEditGroup
}: GroupDetailPanelProps) {
    const [addingRes, setAddingRes] = useState(false);
    const [resCodeInput, setResCodeInput] = useState("");
    const [searchSource, setSearchSource] = useState("");
    const [searchArrivalDate, setSearchArrivalDate] = useState("");
    const [selectedReservation, setSelectedReservation] = useState<any | null>(null);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [addLoading, setAddLoading] = useState(false);
    const [error, setError] = useState("");

    const [optionsResId, setOptionsResId] = useState<string | null>(null);
    const [folioResId, setFolioResId] = useState<string | null>(null);
    const [showCreateRes, setShowCreateRes] = useState(false);
    const [unlinkingReservationId, setUnlinkingReservationId] = useState<string | null>(null);
    const [cancellingGroup, setCancellingGroup] = useState(false);
    const [massCheckinOpen, setMassCheckinOpen] = useState(false);
    const [massCheckinRows, setMassCheckinRows] = useState<MassCheckinRow[]>([]);
    const [massCheckinLoading, setMassCheckinLoading] = useState(false);
    const [massCheckinMessage, setMassCheckinMessage] = useState("");
    const [massCheckinErrors, setMassCheckinErrors] = useState<string[]>([]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                // If any sub-modal/state is open, don't close the drawer yet
                if (folioResId || optionsResId || showCreateRes || massCheckinOpen || addingRes) return;
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, folioResId, optionsResId, showCreateRes, massCheckinOpen, addingRes]);

    const totalNights = reservations.reduce((sum, r) => {
        const ci = new Date(r.checkin_date);
        const co = new Date(r.checkout_date);
        const diff = Math.round((co.getTime() - ci.getTime()) / 86400000);
        return sum + (diff > 0 ? diff : 1);
    }, 0);

    const totalPrice = reservations.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0);
    const businessDate =
        String(group?.business_date || "").trim() ||
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

    const dueInTodayAllReservations = reservations.filter((r) =>
        r.status === "active" &&
        r.checkin_date === businessDate &&
        !r.is_checked_in
    );
    const dueInTodayReservations = dueInTodayAllReservations.filter((r) =>
        r.room_number !== "Unassigned" &&
        r.room_number !== "—"
    );
    const dueInNeedsAssignCount = reservations.filter((r) =>
        r.status === "active" &&
        r.checkin_date === businessDate &&
        (r.room_number === "Unassigned" || r.room_number === "—")
    ).length;
    const nextDueInDate = reservations
        .filter((r) =>
            r.status === "active" &&
            !r.is_checked_in &&
            typeof r.checkin_date === "string" &&
            r.checkin_date > businessDate
        )
        .map((r) => String(r.checkin_date))
        .sort()[0] ?? null;
    const isGroupCompleted = String(group?.status ?? "").toLowerCase() === "completed";
    const isGroupCancelled = String(group?.status ?? "").toLowerCase() === "cancelled";
    const isGroupLocked = isGroupCompleted || isGroupCancelled;
    const canOpenCheckinWizard = !isGroupLocked && dueInTodayAllReservations.length > 0;
    const checkinWizardTitle = canOpenCheckinWizard
        ? `Open Check-in Wizard for ${formatDateDisplay(businessDate)}`
        : nextDueInDate
            ? `Check-in Wizard unlocks on ${formatDateDisplay(nextDueInDate)}`
            : "No due-in reservations for the current business date";

    function openMassCheckin(focusReservationId?: string) {
        if (dueInTodayReservations.length === 0) {
            setError("No due-in reservations with assigned rooms are ready for check-in.");
            return;
        }

        const nowTime = defaultBangkokTimeHHmm();
        const rows = dueInTodayReservations.map((r): MassCheckinRow => {
            const existingDepositAmountRaw = Number(r.deposit_amount ?? 0);
            const existingDepositAmount = Number.isFinite(existingDepositAmountRaw) ? existingDepositAmountRaw : 0;
            const existingDepositNote = extractDepositGeneralNote(r.deposit_note) ?? "";
            const hasSavedDepositState =
                existingDepositAmount > 0 || existingDepositNote.length > 0;
            const defaultDepositAmount = hasSavedDepositState
                ? existingDepositAmount
                : DEFAULT_GROUP_DEPOSIT_AMOUNT;
            const defaultDepositPolicy: DepositPolicy = hasSavedDepositState ? "keep" : "set";

            return {
                reservation_id: String(r.id),
                booking_code: String(r.booking_code || ""),
                guest_name: String(r.guest_name || ""),
                room_number: String(r.room_number || "—"),
                selected: focusReservationId ? String(r.id) === focusReservationId : true,
                checkin_time: nowTime,
                deposit_policy: defaultDepositPolicy,
                deposit_amount: defaultDepositAmount.toFixed(2),
                deposit_note: hasSavedDepositState ? existingDepositNote : "",
                payments: [createPaymentDraft(String(r.id))]
            };
        });

        setMassCheckinRows(rows);
        setMassCheckinOpen(true);
        setMassCheckinMessage("");
        setMassCheckinErrors([]);
        setError("");
    }

    function updateMassRow(reservationId: string, patch: Partial<MassCheckinRow>) {
        setMassCheckinRows((prev) =>
            prev.map((row) =>
                row.reservation_id === reservationId ? { ...row, ...patch } : row
            )
        );
    }

    function updateMassPayment(reservationId: string, paymentId: string, patch: Partial<MassPaymentDraft>) {
        setMassCheckinRows((prev) =>
            prev.map((row) => {
                if (row.reservation_id !== reservationId) return row;
                return {
                    ...row,
                    payments: row.payments.map((payment) =>
                        payment.id === paymentId ? { ...payment, ...patch } : payment
                    )
                };
            })
        );
    }

    function addMassPayment(reservationId: string) {
        setMassCheckinRows((prev) =>
            prev.map((row) => {
                if (row.reservation_id !== reservationId) return row;
                return {
                    ...row,
                    payments: [...row.payments, createPaymentDraft(reservationId)]
                };
            })
        );
    }

    function removeMassPayment(reservationId: string, paymentId: string) {
        setMassCheckinRows((prev) =>
            prev.map((row) => {
                if (row.reservation_id !== reservationId) return row;
                const filtered = row.payments.filter((payment) => payment.id !== paymentId);
                return {
                    ...row,
                    payments: filtered.length > 0 ? filtered : [createPaymentDraft(reservationId)]
                };
            })
        );
    }

    async function handleMassCheckinSubmit() {
        const selectedRows = massCheckinRows.filter((row) => row.selected);
        if (selectedRows.length === 0) {
            setMassCheckinErrors(["Please select at least one reservation."]);
            return;
        }

        setMassCheckinLoading(true);
        setMassCheckinErrors([]);
        setMassCheckinMessage("");

        try {
            const items = selectedRows.map((row) => {
                const payments = row.payments
                    .map((payment) => ({
                        method: payment.method,
                        amount: Number(payment.amount || 0),
                        note: payment.note.trim() || null
                    }))
                    .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);
                const payload: any = {
                    reservation_id: row.reservation_id,
                    checkin_time: row.checkin_time,
                    deposit_policy: row.deposit_policy,
                    payments
                };

                if (row.deposit_policy === "set") {
                    payload.deposit_amount = Number(row.deposit_amount || 0);
                    payload.deposit_note = row.deposit_note.trim() || null;
                }

                return payload;
            });

            const res = await fetch(`/api/booking-groups/${group.id}/checkin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items })
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Mass check-in failed.");
            }

            const resultRows = Array.isArray(data.results) ? data.results : [];
            const failedRows = resultRows.filter((r: any) => !r.ok);
            const successCount = Number(data?.summary?.success ?? 0);
            const failedCount = Number(data?.summary?.failed ?? failedRows.length);

            if (failedRows.length > 0) {
                setMassCheckinMessage(`Mass check-in done: ${successCount} success, ${failedCount} failed.`);
                setMassCheckinErrors(
                    failedRows.map((r: any) => {
                        const code = r.booking_code || r.reservation_id;
                        return `${code}: ${r.error || "Failed"}`;
                    })
                );
                const failedIdSet = new Set(failedRows.map((r: any) => String(r.reservation_id)));
                setMassCheckinRows((prev) => prev.filter((row) => failedIdSet.has(row.reservation_id)));
            } else {
                setMassCheckinMessage(`Mass check-in success: ${successCount} reservation(s) checked in.`);
                setMassCheckinOpen(false);
                setMassCheckinRows([]);
            }

            onRefresh();
        } catch (err: any) {
            setMassCheckinErrors([err?.message || "Mass check-in failed."]);
        } finally {
            setMassCheckinLoading(false);
        }
    }

    useEffect(() => {
        if (!addingRes) {
            setSearchResults([]);
            setSearchLoading(false);
            return;
        }

        const keyword = resCodeInput.trim();
        const hasCriteria =
            keyword.length >= 2 ||
            Boolean(searchSource) ||
            Boolean(searchArrivalDate);

        if (!hasCriteria || selectedReservation) {
            setSearchResults([]);
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const params = new URLSearchParams();
                params.set("status", "active");
                params.set("page", "1");
                if (keyword.length >= 2) params.set("q", keyword);
                if (searchSource) params.set("source", searchSource);
                if (searchArrivalDate) {
                    params.set("date_from", searchArrivalDate);
                    params.set("date_to", searchArrivalDate);
                }
                const res = await fetch(`/api/reservations?${params.toString()}`, { cache: "no-store" });
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok || !data.success) {
                    setSearchResults([]);
                    return;
                }
                setSearchResults((data.reservations ?? []).slice(0, 8));
            } catch {
                if (!cancelled) setSearchResults([]);
            } finally {
                if (!cancelled) setSearchLoading(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [addingRes, resCodeInput, searchSource, searchArrivalDate, selectedReservation]);

    function selectReservation(item: any) {
        setSelectedReservation(item);
        setSearchResults([]);
        setError("");
    }

    const handleAddReservation = async () => {
        if (!selectedReservation?.id) {
            setError("Please select a reservation from the list first.");
            return;
        }

        setAddLoading(true);
        setError("");

        try {
            const targetRes = selectedReservation;

            if (targetRes.booking_group_id === group.id) {
                throw new Error("Already in this group");
            }
            if (targetRes.booking_group_id && targetRes.booking_group_id !== group.id) {
                throw new Error("This reservation is already linked to another group.");
            }

            // 2. Add to group
            const addRes = await fetch(`/api/booking-groups/${group.id}/add-reservation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reservation_id: targetRes.id })
            });
            const addData = await addRes.json();

            if (!addRes.ok) {
                throw new Error(addData.error || "Failed to add to group");
            }

            setSelectedReservation(null);
            setSearchResults([]);
            setError("");
            onRefresh();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setAddLoading(false);
        }
    };

    const handleLinkSameName = async () => {
        if (!selectedReservation?.id) {
            setError("Please select a reservation first.");
            return;
        }

        setAddLoading(true);
        setError("");

        try {
            const res = await fetch(`/api/booking-groups/${group.id}/add-reservation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reservation_id: selectedReservation.id,
                    link_same_name: true,
                })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to link same-name bookings.");
            }

            const linkedCount = Number(data.linked_count ?? 0);
            const blockedCount = Number(data.blocked_count ?? 0);
            setError("");
            setSelectedReservation(null);
            setSearchResults([]);
            onRefresh();

            if (blockedCount > 0) {
                setMassCheckinMessage(`Linked ${linkedCount} booking(s). ${blockedCount} booking(s) were skipped because they already belong to another group.`);
            } else {
                setMassCheckinMessage(`Linked ${linkedCount} booking(s) with the same guest name and due-in date.`);
            }
        } catch (err: any) {
            setError(err.message || "Failed to link same-name bookings.");
        } finally {
            setAddLoading(false);
        }
    };

    const handleUnlinkReservation = async (reservationId: string, bookingCode: string) => {
        if (!reservationId) return;
        const confirmed = window.confirm(`Unlink booking ${bookingCode || reservationId} from this group?`);
        if (!confirmed) return;

        setUnlinkingReservationId(reservationId);
        setError("");
        try {
            const res = await fetch(`/api/booking-groups/${group.id}/reservations/${reservationId}`, {
                method: "DELETE",
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to unlink reservation from group.");
            }

            onRefresh();
        } catch (err: any) {
            setError(err?.message || "Failed to unlink reservation from group.");
        } finally {
            setUnlinkingReservationId(null);
        }
    };

    const handleCancelGroup = async () => {
        const confirmed = window.confirm(
            `Cancel group ${group.group_code}? This will unlink all bookings from the group.`
        );
        if (!confirmed) return;

        setCancellingGroup(true);
        setError("");
        try {
            const res = await fetch(`/api/booking-groups/${group.id}`, {
                method: "DELETE",
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to cancel group.");
            }

            onRefresh();
        } catch (err: any) {
            setError(err?.message || "Failed to cancel group.");
        } finally {
            setCancellingGroup(false);
        }
    };

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm flex justify-end">
            <div className="w-[1000px] h-full bg-[var(--bg-surface)] shadow-2xl flex flex-col animate-slide-in-right overflow-hidden border-l border-[var(--border-default)]">

                {/* Header */}
                {/* Header Section: Hero Layout */}
                <div className="bg-[var(--bg-body)] border-b border-[var(--border-default)] px-6 py-6 select-none relative">
                    <div className="flex items-start justify-between gap-6">
                        <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
                                    {group.group_code}
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${group.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' :
                                        group.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' :
                                            'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20'
                                    }`}>
                                    {group.status}
                                </span>
                            </div>
                            <h2 className="text-2xl font-extrabold text-[var(--text-primary)] leading-tight tracking-tight">
                                {group.group_name}
                            </h2>
                            <div className="flex items-center gap-4 text-xs font-medium text-[var(--text-muted)]">
                                {group.contact_name && (
                                    <span className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] transition-colors">
                                        <span className="opacity-70 text-base">👤</span> {group.contact_name}
                                    </span>
                                )}
                                {group.contact_phone && (
                                    <span className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] transition-colors">
                                        <span className="opacity-70 text-base">📞</span> {group.contact_phone}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-3">
                            <button
                                className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] transition-all hover:rotate-90"
                                onClick={onClose}
                                title="Close Panel"
                            >
                                <span className="text-xl leading-none">✕</span>
                            </button>
                            <div className="flex items-center gap-1.5">
                                <button
                                    className="btn btn-secondary btn-sm h-8 px-3 text-xs font-bold border-[var(--border-default)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50 transition-all active:scale-95"
                                    onClick={onEditGroup}
                                    disabled={isGroupLocked}
                                    title={isGroupLocked ? "Completed or cancelled groups are locked." : "Edit group info"}
                                >
                                    Edit Info
                                </button>
                                {!isGroupCancelled && (
                                    <button
                                        className="btn btn-sm h-8 px-4 text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 border-none dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700 disabled:opacity-50 transition-all active:scale-95 shadow-sm"
                                        onClick={handleCancelGroup}
                                        disabled={cancellingGroup}
                                    >
                                        {cancellingGroup ? "Wait..." : "Cancel Group"}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Summary Bar */}
                {/* Summary Dashboard Section */}
                <div className="bg-[var(--bg-surface)] border-b border-[var(--border-default)] px-6 py-6 select-none shadow-sm relative overflow-hidden group/dash">
                    {/* Subtle Background Pattern */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none transition-transform duration-1000 group-hover/dash:scale-105">
                        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <path d="M0 0 L100 100 M100 0 L0 100" stroke="currentColor" strokeWidth="0.1" />
                        </svg>
                    </div>

                    <div className="relative flex flex-wrap items-center justify-between gap-6 z-10">
                        {/* Stats Cards: Expanded for better space utilization */}
                        <div className="flex items-center gap-10 flex-1">
                            <div className="min-w-[70px]">
                                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1 opacity-70">Rooms</div>
                                <div className="text-2xl font-black text-brand-700 dark:text-brand-400 leading-none">{reservations.length}</div>
                            </div>
                            <div className="min-w-[70px] border-l-2 border-[var(--border-subtle)] pl-10">
                                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1 opacity-70">Nights</div>
                                <div className="text-2xl font-black text-brand-700 dark:text-brand-400 leading-none">{totalNights}</div>
                            </div>
                            <div className="flex-1 border-l-2 border-[var(--border-subtle)] pl-10">
                                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] mb-1 opacity-70">Total Group Price</div>
                                <div className="text-2xl font-black text-brand-700 dark:text-brand-400 leading-none">฿{totalPrice.toLocaleString()}</div>
                            </div>
                        </div>

                        {/* CTA Cluster: Full Labels */}
                        <div className="flex items-center gap-2">
                            <Link
                                href={`/pms/groups/${group.id}/checkin-wizard`}
                                className={`h-11 px-5 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-sm active:scale-95 ${canOpenCheckinWizard
                                        ? "bg-brand-600 hover:bg-brand-700 text-white shadow-brand-500/20"
                                        : "bg-[var(--bg-muted)] text-[var(--text-muted)] border border-[var(--border-subtle)] pointer-events-none grayscale opacity-60"
                                    }`}
                                aria-disabled={!canOpenCheckinWizard}
                                onClick={(e) => !canOpenCheckinWizard && e.preventDefault()}
                                title={checkinWizardTitle}
                            >
                                <span className={canOpenCheckinWizard ? "animate-pulse" : ""}>✨</span>
                                <span>Check-in Wizard</span>
                            </Link>
                            <button
                                className="h-11 px-5 rounded-xl bg-white dark:bg-slate-800 text-[var(--text-primary)] border border-indigo-200 dark:border-indigo-500/20 font-black text-xs uppercase tracking-wider transition-all hover:bg-indigo-50 dark:hover:bg-slate-700 shadow-sm active:scale-95 flex items-center gap-2 disabled:opacity-50"
                                onClick={() => setShowCreateRes(true)}
                                disabled={isGroupLocked}
                            >
                                <span>+ Create New Reservation</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Note Area */}
                {group.note && (
                    <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-400 border-b border-amber-200 dark:border-amber-500/20 text-sm flex gap-3">
                        <span className="mt-0.5">📝</span>
                        <p className="flex-1 whitespace-pre-wrap">{group.note}</p>
                    </div>
                )}

                {/* List Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg-body)] space-y-6">

                    <div className="flex justify-between items-center mb-2">
                        <div>
                            <h3 className="font-bold text-[var(--text-secondary)] text-lg">Reservations in Group</h3>
                            {dueInNeedsAssignCount > 0 && (
                                <p className="text-xs text-amber-700 mt-0.5">
                                    {dueInNeedsAssignCount} due-in reservation{dueInNeedsAssignCount !== 1 ? "s" : ""} still need room assignment before check-in
                                </p>
                            )}
                        </div>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                if (isGroupLocked) return;
                                if (addingRes) {
                                    setAddingRes(false);
                                    setResCodeInput("");
                                    setSearchSource("");
                                    setSearchArrivalDate("");
                                    setSelectedReservation(null);
                                    setSearchResults([]);
                                    setError("");
                                    return;
                                }
                                setAddingRes(true);
                            }}
                            disabled={isGroupLocked}
                        >
                            + Link Existing Booking
                        </button>
                    </div>

                    {addingRes && (
                        <div className="bg-[var(--bg-body)]/40 border-2 border-[var(--border-subtle)] p-6 rounded-2xl shadow-sm animate-fade-in mb-6">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex-[2] min-w-[200px]">
                                    <input
                                        type="text"
                                        className="form-input h-10 text-sm bg-[var(--bg-surface)] border-[var(--border-default)] focus:ring-2 focus:ring-brand-500/20 transition-all font-medium"
                                        placeholder="Booking code / guest / phone"
                                        value={resCodeInput}
                                        onChange={e => {
                                            setResCodeInput(e.target.value);
                                            setSelectedReservation(null);
                                            setError("");
                                        }}
                                    />
                                </div>
                                <div className="w-32">
                                    <select
                                        className="form-select h-10 text-sm bg-[var(--bg-surface)] border-[var(--border-default)] focus:ring-2 focus:ring-brand-500/20 transition-all font-medium"
                                        value={searchSource}
                                        onChange={(e) => {
                                            setSearchSource(e.target.value);
                                            setSelectedReservation(null);
                                            setError("");
                                        }}
                                    >
                                        <option value="">All source</option>
                                        <option value="walkin">Walk-in</option>
                                        <option value="direct">Direct</option>
                                        <option value="ota">OTA</option>
                                        <option value="agent">Agent</option>
                                    </select>
                                </div>
                                <div className="w-40">
                                    <input
                                        type="date"
                                        className="form-input h-10 text-sm bg-[var(--bg-surface)] border-[var(--border-default)] focus:ring-2 focus:ring-brand-500/20 transition-all font-medium"
                                        value={searchArrivalDate}
                                        onChange={(e) => {
                                            setSearchArrivalDate(e.target.value);
                                            setSelectedReservation(null);
                                            setError("");
                                        }}
                                    />
                                </div>

                                <div className="flex items-center gap-2 ml-auto">
                                    <button
                                        className="h-10 px-4 rounded-lg bg-brand-600 text-white font-black text-[11px] uppercase tracking-wider hover:bg-brand-700 transition-all shadow-sm active:scale-95 disabled:opacity-50"
                                        onClick={handleAddReservation}
                                        disabled={addLoading || !selectedReservation}
                                    >
                                        {addLoading ? "Linking..." : "Link to Group"}
                                    </button>
                                    <button
                                        className="h-10 px-4 rounded-lg border border-indigo-200 dark:border-indigo-500/30 text-[var(--text-secondary)] font-black text-[11px] uppercase tracking-wider hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all active:scale-95 disabled:opacity-50"
                                        onClick={handleLinkSameName}
                                        disabled={addLoading || !selectedReservation}
                                        title="Link bookings with the same guest name and due-in date"
                                    >
                                        Same Name
                                    </button>
                                    <button
                                        className="h-10 px-3 rounded-lg text-[var(--text-muted)] hover:text-rose-500 font-black text-[11px] uppercase tracking-wider transition-all active:scale-95"
                                        onClick={() => {
                                            setAddingRes(false);
                                            setError("");
                                            setResCodeInput("");
                                            setSearchSource("");
                                            setSearchArrivalDate("");
                                            setSelectedReservation(null);
                                            setSearchResults([]);
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>

                            {selectedReservation && (
                                <div className="w-full mt-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-400 flex items-center justify-between gap-2 shadow-sm">
                                    <span className="flex items-center gap-2">
                                        <span className="text-lg">✅</span>
                                        <span>
                                            Selected: <b className="font-black truncate max-w-[200px] inline-block align-bottom">{selectedReservation.booking_code}</b> · <span className="font-bold">{selectedReservation.guest_name}</span>
                                        </span>
                                    </span>
                                    <button
                                        className="font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline"
                                        onClick={() => setSelectedReservation(null)}
                                        type="button"
                                    >
                                        Change
                                    </button>
                                </div>
                            )}

                            {!selectedReservation && (
                                searchLoading ||
                                searchResults.length > 0 ||
                                resCodeInput.trim().length >= 2 ||
                                Boolean(searchSource) ||
                                Boolean(searchArrivalDate)
                            ) && (
                                    <div className="w-full mt-4 border border-[var(--border-default)] rounded-xl overflow-hidden bg-[var(--bg-surface)] shadow-lg animate-fade-in">
                                        {searchLoading ? (
                                            <div className="px-4 py-3 text-xs text-[var(--text-muted)] animate-pulse">Searching...</div>
                                        ) : searchResults.length === 0 ? (
                                            <div className="px-4 py-3 text-xs text-[var(--text-muted)]">No matching reservations found.</div>
                                        ) : (
                                            <div className="max-h-56 overflow-auto divide-y divide-[var(--border-subtle)]">
                                                {searchResults.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        className={`w-full text-left px-4 py-3 transition-all ${item.booking_group_id === group.id
                                                            ? "bg-emerald-50/80 dark:bg-emerald-500/10 cursor-not-allowed grayscale opacity-60"
                                                            : item.booking_group_id
                                                                ? "bg-amber-50/80 dark:bg-amber-500/10 cursor-not-allowed grayscale opacity-60"
                                                                : "hover:bg-brand-50 dark:hover:bg-brand-500/10 active:bg-brand-100"
                                                            }`}
                                                        onClick={() => {
                                                            if (item.booking_group_id) return;
                                                            selectReservation(item);
                                                        }}
                                                        disabled={Boolean(item.booking_group_id)}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="text-xs font-black text-[var(--text-primary)]">{item.booking_code} · {item.guest_name}</div>
                                                            {item.booking_group_id === group.id && (
                                                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">
                                                                    Linked Here
                                                                </span>
                                                            )}
                                                            {item.booking_group_id && item.booking_group_id !== group.id && (
                                                                <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20">
                                                                    Linked Other
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[11px] text-[var(--text-muted)] mt-1 font-medium flex items-center gap-2">
                                                            <span>{formatDateRangeDisplay(item.checkin_date, item.checkout_date)}</span>
                                                            <span className="opacity-30">|</span>
                                                            <span>Room {item.room_number}</span>
                                                            <span className="opacity-30">|</span>
                                                            <span className="uppercase">{String(item.source || "Direct").toUpperCase()}</span>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                        </div>
                    )}

                    {error && <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-200">{error}</div>}

                    {massCheckinMessage && (
                        <div className="text-emerald-700 text-sm bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                            {massCheckinMessage}
                        </div>
                    )}

                    {massCheckinErrors.length > 0 && (
                        <div className="text-rose-700 text-sm bg-rose-50 p-3 rounded-lg border border-rose-200 space-y-1">
                            {massCheckinErrors.map((message, idx) => (
                                <p key={`${message}-${idx}`}>• {message}</p>
                            ))}
                        </div>
                    )}

                    {massCheckinOpen && (
                        <div className="bg-[var(--bg-surface)] border-2 border-emerald-200 p-4 rounded-xl shadow-sm space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-emerald-800">Mass Check-in Policy</h4>
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                        Set check-in time, deposit policy, and optional split payments per booking before running check-in.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        type="button"
                                        onClick={() => setMassCheckinRows((prev) => prev.map((row) => ({ ...row, selected: true })))}
                                    >
                                        Select All
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        type="button"
                                        onClick={() => setMassCheckinRows((prev) => prev.map((row) => ({ ...row, selected: false })))}
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            <div className="max-h-[360px] overflow-auto space-y-2 pr-1">
                                {massCheckinRows.map((row) => (
                                    <div key={row.reservation_id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
                                                <input
                                                    type="checkbox"
                                                    checked={row.selected}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { selected: e.target.checked })}
                                                />
                                                <span>{row.booking_code}</span>
                                                <span className="text-[var(--text-muted)]">·</span>
                                                <span>{row.guest_name}</span>
                                                <span className="text-[var(--text-muted)]">· Room {row.room_number}</span>
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-12 gap-2 mt-2">
                                            <div className="col-span-12 md:col-span-2">
                                                <label className="form-label">Check-in Time</label>
                                                <input
                                                    type="time"
                                                    className="form-input text-sm"
                                                    value={row.checkin_time}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { checkin_time: e.target.value })}
                                                />
                                            </div>
                                            <div className="col-span-12 md:col-span-2">
                                                <label className="form-label">Deposit Policy</label>
                                                <select
                                                    className="form-select text-sm"
                                                    value={row.deposit_policy}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { deposit_policy: e.target.value as DepositPolicy })}
                                                >
                                                    <option value="keep">Keep</option>
                                                    <option value="set">Set</option>
                                                </select>
                                            </div>
                                            <div className="col-span-12 md:col-span-2">
                                                <label className="form-label">Deposit Amt</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    className="form-input text-sm"
                                                    value={row.deposit_amount}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { deposit_amount: e.target.value })}
                                                    disabled={row.deposit_policy !== "set"}
                                                />
                                            </div>
                                            <div className="col-span-12 md:col-span-3">
                                                <label className="form-label">Deposit Note</label>
                                                <input
                                                    type="text"
                                                    className="form-input text-sm"
                                                    placeholder="e.g. VIP no deposit / cash hold"
                                                    value={row.deposit_note}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { deposit_note: e.target.value })}
                                                    disabled={row.deposit_policy !== "set"}
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="form-label mb-0">Pending Payments (Optional)</label>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => addMassPayment(row.reservation_id)}
                                                >
                                                    + Add Payment
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                {row.payments.map((payment, index) => (
                                                    <div key={payment.id} className="grid grid-cols-12 gap-2 items-end">
                                                        <div className="col-span-12 md:col-span-2">
                                                            <label className="form-label">Amount #{index + 1}</label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.01"
                                                                className="form-input text-sm"
                                                                value={payment.amount}
                                                                onChange={(e) => updateMassPayment(row.reservation_id, payment.id, { amount: e.target.value })}
                                                            />
                                                        </div>
                                                        <div className="col-span-12 md:col-span-3">
                                                            <label className="form-label">Method</label>
                                                            <select
                                                                className="form-select text-sm"
                                                                value={payment.method}
                                                                onChange={(e) =>
                                                                    updateMassPayment(
                                                                        row.reservation_id,
                                                                        payment.id,
                                                                        { method: e.target.value as PaymentMethod }
                                                                    )
                                                                }
                                                            >
                                                                {PAYMENT_METHOD_OPTIONS.map((method) => (
                                                                    <option key={method.value} value={method.value}>{method.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div className="col-span-12 md:col-span-6">
                                                            <label className="form-label">Payment Note</label>
                                                            <input
                                                                type="text"
                                                                className="form-input text-sm"
                                                                placeholder="Optional payment note"
                                                                value={payment.note}
                                                                onChange={(e) => updateMassPayment(row.reservation_id, payment.id, { note: e.target.value })}
                                                            />
                                                        </div>
                                                        <div className="col-span-12 md:col-span-1">
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-sm w-full"
                                                                onClick={() => removeMassPayment(row.reservation_id, payment.id)}
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setMassCheckinOpen(false);
                                        setMassCheckinRows([]);
                                        setMassCheckinErrors([]);
                                    }}
                                    disabled={massCheckinLoading}
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={handleMassCheckinSubmit}
                                    disabled={massCheckinLoading}
                                >
                                    {massCheckinLoading ? "Checking in..." : "Confirm Mass Check-in"}
                                </button>
                            </div>
                        </div>
                    )}

                    {reservations.length === 0 ? (
                        <div className="text-center py-12 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-sm">
                            <span className="text-4xl">📭</span>
                            <h4 className="font-bold text-[var(--text-secondary)] mt-3">No reservations yet</h4>
                            <p className="text-[var(--text-muted)] text-sm mt-1">Create a new booking or link an existing one.</p>
                        </div>
                    ) : (
                        <div className="bg-[var(--bg-surface)] rounded-xl shadow-sm border border-[var(--border-default)] overflow-hidden">
                            <table className="data-table">
                                <thead className="bg-[var(--bg-body)]">
                                    <tr>
                                        <th>Room</th>
                                        <th>Guest</th>
                                        <th>Dates</th>
                                        <th>Status</th>
                                        <th className="text-right">Price</th>
                                        <th className="text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border-subtle)]">
                                    {reservations.map(r => {
                                        const isDueInToday = r.status === "active" && r.checkin_date === businessDate;
                                        const isUnassigned = r.room_number === "Unassigned" || r.room_number === "—";
                                        const canCheckin = isDueInToday && !isUnassigned && !r.is_checked_in;
                                        return (
                                            <tr key={r.id} className={`hover:bg-[var(--bg-body)] transition-colors group/row ${canCheckin ? "bg-emerald-50/20 dark:bg-emerald-500/5" : ""}`}>
                                                <td className="py-4 px-5">
                                                    <div className="flex flex-col">
                                                        <span className="font-black text-[var(--text-primary)] text-sm tracking-tight leading-none mb-1">
                                                            {isUnassigned ? "Unassigned" : `Room ${r.room_number}`}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider opacity-70">
                                                            {r.room_type || "N/A"}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <div className="flex flex-col">
                                                        <span className="font-extrabold text-[var(--text-secondary)] text-sm leading-none mb-1">{r.guest_name}</span>
                                                        <span className="text-[10px] text-[var(--text-muted)] font-black tracking-tight opacity-90 uppercase">
                                                            #{String(r.booking_code || "").split('-').pop()}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-bold text-[var(--text-secondary)] mb-1">
                                                            {formatDateDisplay(r.checkin_date)}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-[var(--text-muted)] opacity-60">
                                                            {formatDateDisplay(r.checkout_date)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5">
                                                    <div className="flex flex-col gap-1.5 items-start">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${r.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" :
                                                                r.status === "cancelled" ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20" :
                                                                    "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20"
                                                            }`}>
                                                            {r.status}
                                                        </span>
                                                        {r.is_checked_in && (
                                                            <span className="text-[9px] font-black text-emerald-600 tracking-tighter uppercase">✓ In-House</span>
                                                        )}
                                                        {isDueInToday && !r.is_checked_in && (
                                                            <span className="text-[9px] font-black text-sky-600 tracking-tighter uppercase">→ Pending Arrival</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-4 px-5 text-right font-black text-sm text-[var(--text-primary)] tracking-tight">
                                                    ฿{Number(r.total_price || 0).toLocaleString()}
                                                </td>
                                                <td className="py-4 px-5 text-left">
                                                    <div className="flex items-center justify-start gap-2">
                                                        <button
                                                            className="h-8 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20 border border-indigo-100 dark:border-indigo-500/20 transition-all active:scale-95 whitespace-nowrap"
                                                            onClick={() => setFolioResId(String(r.id))}
                                                        >
                                                            FOLIO
                                                        </button>
                                                        <button
                                                            className="h-8 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-all active:scale-95 whitespace-nowrap"
                                                            onClick={() => setOptionsResId(String(r.id))}
                                                        >
                                                            OPTIONS
                                                        </button>
                                                        {!isGroupCancelled && (
                                                            <button
                                                                className="h-8 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20 border border-rose-100 dark:border-rose-500/20 transition-all active:scale-95 whitespace-nowrap disabled:opacity-50"
                                                                onClick={() => handleUnlinkReservation(String(r.id), String(r.booking_code || r.id))}
                                                                disabled={unlinkingReservationId === String(r.id)}
                                                            >
                                                                {unlinkingReservationId === String(r.id) ? "..." : "UNLINK"}
                                                            </button>
                                                        )}
                                                        {canCheckin && canOpenCheckinWizard && (
                                                            <Link
                                                                href={`/pms/groups/${group.id}/checkin-wizard`}
                                                                className="h-8 px-3 rounded-lg flex items-center bg-brand-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-brand-700 transition-all active:scale-95 whitespace-nowrap"
                                                            >
                                                                Wiz
                                                            </Link>
                                                        )}
                                                        {isDueInToday && isUnassigned && (
                                                            <span className="text-[9px] font-extrabold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20 whitespace-nowrap">
                                                                Room Assignment Required
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {showCreateRes && (
                <ReservationDetailPage
                    mode="create"
                    bookingGroupId={group.id}
                    onClose={() => setShowCreateRes(false)}
                    onSuccess={() => {
                        setShowCreateRes(false);
                        onRefresh();
                    }}
                />
            )}

            {folioResId && (
                <ReservationDetailPage
                    mode="edit"
                    reservationId={folioResId}
                    onClose={() => setFolioResId(null)}
                    onSuccess={() => {
                        setFolioResId(null);
                        onRefresh();
                    }}
                />
            )}

            {optionsResId && (
                <ReservationOptionsPanel
                    reservationId={optionsResId}
                    guestName={reservations.find(r => r.id === optionsResId)?.guest_name || ""}
                    checkinDate={reservations.find(r => r.id === optionsResId)?.checkin_date || ""}
                    checkoutDate={reservations.find(r => r.id === optionsResId)?.checkout_date || ""}
                    onClose={() => setOptionsResId(null)}
                />
            )}

        </div>
    );
}
