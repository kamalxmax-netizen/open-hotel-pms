"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { extractDepositGeneralNote } from "@/lib/deposit-ledger";
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
    const [searchPhone, setSearchPhone] = useState("");
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
    const [massCheckinOpen, setMassCheckinOpen] = useState(false);
    const [massCheckinRows, setMassCheckinRows] = useState<MassCheckinRow[]>([]);
    const [massCheckinLoading, setMassCheckinLoading] = useState(false);
    const [massCheckinMessage, setMassCheckinMessage] = useState("");
    const [massCheckinErrors, setMassCheckinErrors] = useState<string[]>([]);

    const totalNights = reservations.reduce((sum, r) => {
        const ci = new Date(r.checkin_date);
        const co = new Date(r.checkout_date);
        const diff = Math.round((co.getTime() - ci.getTime()) / 86400000);
        return sum + (diff > 0 ? diff : 1);
    }, 0);

    const totalPrice = reservations.reduce((sum, r) => sum + (Number(r.total_price) || 0), 0);
    const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

    const dueInTodayReservations = reservations.filter((r) =>
        r.status === "active" &&
        r.checkin_date === todayYmd &&
        r.room_number !== "Unassigned" &&
        r.room_number !== "—" &&
        !r.is_checked_in
    );
    const dueInNeedsAssignCount = reservations.filter((r) =>
        r.status === "active" &&
        r.checkin_date === todayYmd &&
        (r.room_number === "Unassigned" || r.room_number === "—")
    ).length;
    const isGroupCompleted = String(group?.status ?? "").toLowerCase() === "completed";

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
        const phoneKeyword = searchPhone.trim();
        const hasCriteria =
            keyword.length >= 2 ||
            phoneKeyword.length >= 3 ||
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
                if (phoneKeyword.length >= 3) params.set("phone", phoneKeyword);
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
    }, [addingRes, resCodeInput, searchPhone, searchSource, searchArrivalDate, selectedReservation]);

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

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm flex justify-end">
            <div className="w-[800px] h-full bg-white shadow-2xl flex flex-col animate-slide-in-right overflow-hidden border-l border-slate-200">

                {/* Header */}
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-5 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <span className="text-xs font-bold font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                                {group.group_code}
                            </span>
                            <span className={`badge ${group.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                                group.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-100 text-slate-500'
                                }`}>
                                {group.status.toUpperCase()}
                            </span>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800">{group.group_name}</h2>
                        <div className="text-sm text-slate-500 mt-1 flex flex-wrap gap-4">
                            {group.contact_name && (
                                <span className="flex items-center gap-1">👤 {group.contact_name}</span>
                            )}
                            {group.contact_phone && (
                                <span className="flex items-center gap-1">📞 {group.contact_phone}</span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            className="btn btn-secondary btn-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            onClick={onEditGroup}
                            disabled={isGroupCompleted}
                            title={isGroupCompleted ? "Completed groups are locked." : "Edit group info"}
                        >
                            Edit info
                        </button>
                        <button className="btn btn-ghost btn-sm text-slate-400" onClick={onClose}>✕</button>
                    </div>
                </div>

                {/* Summary Bar */}
                <div className="bg-indigo-900 text-white px-6 py-4 flex items-center justify-between text-sm shadow-inner">
                    <div className="flex gap-8">
                        <div>
                            <div className="text-indigo-300 text-xs mb-0.5 uppercase tracking-wide">Total Rooms</div>
                            <div className="font-bold text-lg">{reservations.length}</div>
                        </div>
                        <div>
                            <div className="text-indigo-300 text-xs mb-0.5 uppercase tracking-wide">Total Nights</div>
                            <div className="font-bold text-lg">{totalNights}</div>
                        </div>
                        <div>
                            <div className="text-indigo-300 text-xs mb-0.5 uppercase tracking-wide">Group Revenue</div>
                            <div className="font-bold text-lg">฿{totalPrice.toLocaleString()}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link
                            href={`/pms/groups/${group.id}/checkin-wizard`}
                            className="bg-purple-600 hover:bg-purple-500 text-white border border-purple-500 px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-2"
                        >
                            <span className="text-purple-200">✨</span> Check-in Wizard
                        </Link>
                        <button
                            className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900/40 disabled:text-emerald-200 text-white border border-emerald-500 px-3 py-1.5 rounded-lg font-bold transition-colors"
                            onClick={() => openMassCheckin()}
                            disabled={dueInTodayReservations.length === 0}
                            title={dueInTodayReservations.length > 0
                                ? "Set deposit/payment policy and check-in all due-in reservations in one action"
                                : "No due-in reservations ready for check-in"}
                        >
                            Mass Check-in ({dueInTodayReservations.length})
                        </button>
                        <button
                            className="bg-indigo-700 hover:bg-indigo-600 text-white border border-indigo-500 px-3 py-1.5 rounded-lg font-bold transition-colors"
                            onClick={() => setShowCreateRes(true)}
                        >
                            + Create New Reservation
                        </button>
                    </div>
                </div>

                {/* Note Area */}
                {group.note && (
                    <div className="px-6 py-3 bg-amber-50 text-amber-900 border-b border-amber-200 text-sm flex gap-3">
                        <span className="mt-0.5">📝</span>
                        <p className="flex-1 whitespace-pre-wrap">{group.note}</p>
                    </div>
                )}

                {/* List Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-6">

                    <div className="flex justify-between items-center mb-2">
                        <div>
                            <h3 className="font-bold text-slate-700 text-lg">Reservations in Group</h3>
                            {dueInNeedsAssignCount > 0 && (
                                <p className="text-xs text-amber-700 mt-0.5">
                                    {dueInNeedsAssignCount} due-in reservation{dueInNeedsAssignCount !== 1 ? "s" : ""} still need room assignment before check-in
                                </p>
                            )}
                        </div>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                                if (addingRes) {
                                    setAddingRes(false);
                                    setResCodeInput("");
                                    setSearchPhone("");
                                    setSearchSource("");
                                    setSearchArrivalDate("");
                                    setSelectedReservation(null);
                                    setSearchResults([]);
                                    setError("");
                                    return;
                                }
                                setAddingRes(true);
                            }}
                        >
                            + Link Existing Booking
                        </button>
                    </div>

                    {addingRes && (
                        <div className="bg-white border-2 border-indigo-100 p-4 rounded-xl flex items-start gap-3 shadow-sm animate-fade-in">
                            <div className="flex-1 space-y-2">
                                <label className="form-label text-indigo-900 text-xs uppercase tracking-wide">Search Reservation</label>
                                <div className="grid grid-cols-12 gap-2">
                                    <div className="col-span-12 md:col-span-5">
                                        <input
                                            type="text"
                                            className="form-input text-sm"
                                            placeholder="Booking code / guest"
                                            value={resCodeInput}
                                            onChange={e => {
                                                setResCodeInput(e.target.value);
                                                setSelectedReservation(null);
                                                setError("");
                                            }}
                                        />
                                    </div>
                                    <div className="col-span-6 md:col-span-3">
                                        <input
                                            type="text"
                                            className="form-input text-sm"
                                            placeholder="Phone"
                                            value={searchPhone}
                                            onChange={e => {
                                                setSearchPhone(e.target.value);
                                                setSelectedReservation(null);
                                                setError("");
                                            }}
                                        />
                                    </div>
                                    <div className="col-span-6 md:col-span-2">
                                        <select
                                            className="form-select text-sm"
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
                                    <div className="col-span-12 md:col-span-2">
                                        <input
                                            type="date"
                                            className="form-input text-sm"
                                            value={searchArrivalDate}
                                            onChange={(e) => {
                                                setSearchArrivalDate(e.target.value);
                                                setSelectedReservation(null);
                                                setError("");
                                            }}
                                        />
                                    </div>
                                </div>
                                {!selectedReservation && (
                                    <p className="text-xs text-slate-500">
                                        Search by booking code, guest, phone, source, and arrival date, then select from result list.
                                    </p>
                                )}
                                {selectedReservation && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between gap-2">
                                        <span>
                                            Selected: <b>{selectedReservation.booking_code}</b> · {selectedReservation.guest_name}
                                        </span>
                                        <button
                                            className="text-emerald-700 hover:underline"
                                            onClick={() => {
                                                setSelectedReservation(null);
                                            }}
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
                                    searchPhone.trim().length >= 3 ||
                                    Boolean(searchSource) ||
                                    Boolean(searchArrivalDate)
                                ) && (
                                        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                            {searchLoading ? (
                                                <div className="px-3 py-2 text-xs text-slate-500">Searching...</div>
                                            ) : searchResults.length === 0 ? (
                                                <div className="px-3 py-2 text-xs text-slate-500">No matching reservations found.</div>
                                            ) : (
                                                <div className="max-h-56 overflow-auto divide-y divide-slate-100">
                                                    {searchResults.map((item) => (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            className={`w-full text-left px-3 py-2 transition-colors ${item.booking_group_id === group.id
                                                                ? "bg-emerald-50 cursor-not-allowed"
                                                                : item.booking_group_id
                                                                    ? "bg-amber-50 cursor-not-allowed"
                                                                    : "hover:bg-indigo-50"
                                                                }`}
                                                            onClick={() => {
                                                                if (item.booking_group_id) return;
                                                                selectReservation(item);
                                                            }}
                                                            disabled={Boolean(item.booking_group_id)}
                                                        >
                                                            <div className="flex items-center justify-between gap-2">
                                                                <div className="text-xs font-semibold text-slate-800">{item.booking_code} · {item.guest_name}</div>
                                                                {item.booking_group_id === group.id && (
                                                                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                                                        Linked Here
                                                                    </span>
                                                                )}
                                                                {item.booking_group_id && item.booking_group_id !== group.id && (
                                                                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                                                        Linked Other Group
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-slate-500">
                                                                {item.checkin_date} → {item.checkout_date} · Room {item.room_number} · {String(item.source || "").toUpperCase()}
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                            </div>
                            <button
                                className="btn btn-primary btn-sm h-9"
                                onClick={handleAddReservation}
                                disabled={addLoading || !selectedReservation}
                            >
                                {addLoading ? "Linking..." : "Link to Group"}
                            </button>
                            <button
                                className="btn btn-ghost btn-sm text-slate-400 h-9"
                                onClick={() => {
                                    setAddingRes(false);
                                    setError("");
                                    setResCodeInput("");
                                    setSearchPhone("");
                                    setSearchSource("");
                                    setSearchArrivalDate("");
                                    setSelectedReservation(null);
                                    setSearchResults([]);
                                }}
                            >
                                Cancel
                            </button>
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
                        <div className="bg-white border-2 border-emerald-200 p-4 rounded-xl shadow-sm space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-emerald-800">Mass Check-in Policy</h4>
                                    <p className="text-xs text-slate-500 mt-0.5">
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
                                    <div key={row.reservation_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={row.selected}
                                                    onChange={(e) => updateMassRow(row.reservation_id, { selected: e.target.checked })}
                                                />
                                                <span>{row.booking_code}</span>
                                                <span className="text-slate-400">·</span>
                                                <span>{row.guest_name}</span>
                                                <span className="text-slate-400">· Room {row.room_number}</span>
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
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 shadow-sm">
                            <span className="text-4xl">📭</span>
                            <h4 className="font-bold text-slate-700 mt-3">No reservations yet</h4>
                            <p className="text-slate-500 text-sm mt-1">Create a new booking or link an existing one.</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <table className="data-table">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th>Room</th>
                                        <th>Guest</th>
                                        <th>Dates</th>
                                        <th>Status</th>
                                        <th className="text-right">Price</th>
                                        <th className="text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {reservations.map(r => {
                                        const isDueInToday = r.status === "active" && r.checkin_date === todayYmd;
                                        const isUnassigned = r.room_number === "Unassigned" || r.room_number === "—";
                                        const canCheckin = isDueInToday && !isUnassigned && !r.is_checked_in;
                                        return (
                                            <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${canCheckin ? "bg-emerald-50/30" : ""}`}>
                                                <td className="py-3 px-4">
                                                    <div className="font-bold text-slate-800 text-sm">Room {r.room_number}</div>
                                                    <div className="text-xs text-slate-500 mt-0.5">{r.room_type}</div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="font-semibold text-slate-700 text-sm">{r.guest_name}</div>
                                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{r.booking_code}</div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="text-sm font-medium text-slate-600">{r.checkin_date}</div>
                                                    <div className="text-xs text-slate-400">→ {r.checkout_date}</div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className={`badge ${r.status === "active" ? "bg-emerald-100 text-emerald-700" :
                                                        r.status === "cancelled" ? "bg-rose-100 text-rose-700" :
                                                            r.status === "checked_out" ? "bg-slate-100 text-slate-600" :
                                                                "bg-amber-100 text-amber-700"
                                                        }`}>
                                                        {r.status}
                                                    </span>
                                                    {r.is_checked_in && (
                                                        <div className="text-[11px] text-emerald-700 mt-1 font-semibold">✓ Checked In</div>
                                                    )}
                                                    {isDueInToday && !r.is_checked_in && (
                                                        <div className="text-[11px] text-sky-700 mt-1 font-semibold">Due In Today</div>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <div className="font-bold text-slate-800 text-sm">฿{Number(r.total_price || 0).toLocaleString()}</div>
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                        <button
                                                            className="text-xs text-indigo-600 font-bold hover:underline inline-flex items-center"
                                                            onClick={() => setFolioResId(String(r.id))}
                                                        >
                                                            View Folio
                                                        </button>
                                                        <button
                                                            className="text-xs text-slate-500 font-semibold hover:underline inline-flex items-center"
                                                            onClick={() => setOptionsResId(String(r.id))}
                                                        >
                                                            Options
                                                        </button>
                                                        {canCheckin && (
                                                            <button
                                                                className="btn btn-primary btn-sm"
                                                                onClick={() => openMassCheckin(String(r.id))}
                                                            >
                                                                Check-in
                                                            </button>
                                                        )}
                                                        {isDueInToday && isUnassigned && (
                                                            <span className="text-[11px] font-semibold text-amber-700 self-center">
                                                                Assign room first
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
