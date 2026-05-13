"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { formatShortGroupCode } from "@/lib/group-label";

const ReservationDetailPage = dynamic(() => import("@/components/reservation-detail-page"), {
    loading: () => null,
});

/* ─── Types ─────────────────────────────────────────── */
type MethodBreakdown = {
    payment: number;
    deposit: number;
    refund: number;
    net: number;
};

type PaymentDailyNote = {
    label: string;
    title?: string;
    href?: string;
};

type GroupFilter = "all" | "group" | "individual";

type PaymentDailyGroupFields = {
    booking_group_id?: string | null;
    group_code?: string | null;
    group_name?: string | null;
    group_member_count?: number | null;
    group_type?: "booking_group" | "linked_stay" | null;
};

type MethodsMap = {
    cash: MethodBreakdown;
    transfer: MethodBreakdown;
    credit_card: MethodBreakdown;
    other: MethodBreakdown;
};

type MethodKey = keyof MethodsMap;

type PriorPrepaymentMethods = Record<MethodKey, number>;

type PriorPrepaymentDetail = {
    paid_date: string | null;
    method: MethodKey;
    method_label: string;
    tx_type: "payment" | "deposit" | "refund";
    amount: number;
    note: string | null;
};

type PaymentDailyPrepaymentFields = {
    prior_prepayment_total?: number | null;
    prior_prepayment_methods?: PriorPrepaymentMethods | null;
    prior_prepayment_details?: PriorPrepaymentDetail[] | null;
};

type PaymentDailyAllRoom = {
    room_number: string;
    floor_number: number;
    is_occupied: boolean;
    has_payment_today: boolean;
};

type StayFlow = "due_out" | "due_in" | "in_house" | "normal";

type PaymentDailyTodayRoom = PaymentDailyGroupFields & PaymentDailyPrepaymentFields & {
    reservation_id: string;
    room_number: string;
    floor_number: number;
    guest_name: string;
    booking_code: string;
    checkin_date: string | null;
    checkout_date: string | null;
    stay_flow: StayFlow;
    is_dayuse: boolean;
    methods: MethodsMap;
    total_net: number;
    notes: PaymentDailyNote[];
};

type PaymentDailyAdvance = PaymentDailyGroupFields & PaymentDailyPrepaymentFields & {
    reservation_id: string;
    booking_code: string;
    guest_name: string;
    room_number: string | null;
    checkin_date: string;
    total_price: number;
    total_paid_to_date: number;
    payment_status: "deposit" | "partial" | "full";
    methods: MethodsMap;
    total_net: number;
    notes: PaymentDailyNote[];
};

type SubtotalRow = MethodsMap & { grand_net: number };

type DepositRefundRow = {
    reservation_id: string;
    booking_code: string;
    guest_name: string;
    room_number: string | null;
    method: "cash" | "transfer" | "credit_card" | "other";
    amount: number;
    paid_date: string;
    paid_at: string | null;
    note: string | null;
};

type PaymentDailyData = {
    success: boolean;
    business_date: string;
    all_rooms: PaymentDailyAllRoom[];
    today_rooms: PaymentDailyTodayRoom[];
    advance_payments: PaymentDailyAdvance[];
    pos: MethodsMap;
    today_subtotal: SubtotalRow;
    advance_subtotal: SubtotalRow;
    grand_total: SubtotalRow;
    deposit_refunds?: DepositRefundRow[];
    reconciliation: {
        cash_payments: number;
        cash_deposits: number;
        cash_refunds: number;
        non_cash_deposit_offset?: number;
        net_cash: number;
    };
    error?: string;
};

/* ─── Helpers ───────────────────────────────────────── */
function fmt(n: number) {
    if (n === 0) return "";
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney(n: number) {
    if (n === 0) return "0.00";
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundMoney(n: number) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function shortenBookingCode(bookingCode: string) {
    return `#${bookingCode.slice(-6)}`;
}

function noteBadgeClass(note: string) {
    return note.startsWith("โอน ")
        ? "bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30"
        : note === "Cancelled"
        ? "bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30"
        : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800";
}

function getPrepaymentTitle(notes: PaymentDailyNote[]) {
    const matches = notes.filter((note) => note.label.startsWith("Prepayment "));
    if (matches.length === 0) return null;
    return matches.map((note) => note.title || note.label).join("\n\n");
}

function matchesGroupFilter(row: PaymentDailyGroupFields, filter: GroupFilter) {
    const isGroup = Boolean(row.booking_group_id);
    if (filter === "group") return isGroup;
    if (filter === "individual") return !isGroup;
    return true;
}

function getGroupTitle(row: PaymentDailyGroupFields) {
    const roomCount = Number(row.group_member_count ?? 0);
    const unit = row.group_type === "linked_stay" ? "segment" : "room";
    const fallback = row.group_type === "linked_stay" ? "Linked Stay" : "Group booking";
    const roomLabel = roomCount > 0 ? `${roomCount} ${unit}${roomCount === 1 ? "" : "s"}` : fallback;
    return `${row.group_name || fallback} · ${roomLabel}`;
}

function GroupBadge({ row }: { row: PaymentDailyGroupFields }) {
    if (!row.booking_group_id) return null;
    if (row.group_type === "linked_stay") {
        return (
            <span
                title={getGroupTitle(row)}
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
            >
                LINK
            </span>
        );
    }
    return (
        <Link
            href={`/pms/groups?group_id=${encodeURIComponent(row.booking_group_id)}`}
            onClick={(e) => e.stopPropagation()}
            title={getGroupTitle(row)}
            className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-black text-fuchsia-700 shadow-sm transition-colors hover:bg-fuchsia-100 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:hover:bg-fuchsia-500/25"
        >
            {formatShortGroupCode(row.group_code)}
        </Link>
    );
}

function NoteCapsules({ notes }: { notes: PaymentDailyNote[] }) {
    if (notes.length === 0) return <span className="text-[var(--text-muted)]">-</span>;
    return (
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none max-w-full pb-0.5">
            {notes.map((note, i) => {
                const className = `shrink-0 inline-flex items-center rounded px-1.5 py-0.5 max-w-[220px] truncate ${noteBadgeClass(note.label)}`;
                if (note.href) {
                    return (
                        <Link
                            key={i}
                            href={note.href}
                            onClick={(event) => event.stopPropagation()}
                            title={note.title || note.label}
                            className={`${className} hover:underline`}
                        >
                            {note.label}
                        </Link>
                    );
                }
                return (
                    <span
                        key={i}
                        title={note.title || note.label}
                        className={className}
                    >
                        {note.label}
                    </span>
                );
            })}
        </div>
    );
}

function InlineBadge({
    children,
    className = "",
    title,
}: {
    children: React.ReactNode;
    className?: string;
    title?: string;
}) {
    return (
        <span
            title={title}
            className={`inline-flex min-w-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${className}`}
        >
            {children}
        </span>
    );
}

const PRE_BADGE_CLASS = "rounded-full bg-amber-500 text-white dark:border dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300";

/* ─── Column border constants ──────────────────────── */
// Group separator (between Cash/Transfer/Card groups)
const B = "border-r border-[var(--border-default)]";
// Inner separator (between Payment/Deposit within a group)
const Bi = "border-r border-[var(--border-default)]";

const METHOD_ORDER: MethodKey[] = ["cash", "transfer", "credit_card", "other"];
const METHOD_LABELS: Record<MethodKey, string> = {
    cash: "Cash",
    transfer: "Transfer",
    credit_card: "Card",
    other: "Other",
};

type GroupReviewRow = PaymentDailyPrepaymentFields & PaymentDailyGroupFields & {
    reservation_id: string;
    total_net: number;
};

type GroupReviewSection<T extends GroupReviewRow> = {
    groupId: string;
    groupCode: string | null;
    groupName: string | null;
    groupMemberCount: number;
    groupType: PaymentDailyGroupFields["group_type"];
    rows: T[];
    priorTotal: number;
    todayTotal: number;
    combinedTotal: number;
};

function createEmptyPriorMethods(): PriorPrepaymentMethods {
    return { cash: 0, transfer: 0, credit_card: 0, other: 0 };
}

function getPriorMethods(row: PaymentDailyPrepaymentFields): PriorPrepaymentMethods {
    return { ...createEmptyPriorMethods(), ...(row.prior_prepayment_methods ?? {}) };
}

function getPriorTotal(row: PaymentDailyPrepaymentFields): number {
    return Number(row.prior_prepayment_total ?? 0);
}

function displayDate(value: string | null | undefined) {
    const text = String(value ?? "").trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return text || "-";
    return `${match[3]}/${match[2]}/${match[1]}`;
}

function txLabel(txType: PriorPrepaymentDetail["tx_type"]) {
    if (txType === "refund") return "Refund";
    if (txType === "deposit") return "Deposit";
    return "Payment";
}

function signedMoney(value: number) {
    const prefix = value < 0 ? "-" : "";
    return `${prefix}${fmtMoney(Math.abs(value))}`;
}

function buildPrepaymentTitle(row: PaymentDailyPrepaymentFields) {
    const details = row.prior_prepayment_details ?? [];
    if (details.length === 0) return "No prepayment before this business date.";
    return details
        .map((detail) => {
            const method = detail.method_label || METHOD_LABELS[detail.method] || detail.method;
            const note = detail.note ? `\nNote: ${detail.note}` : "";
            return `${displayDate(detail.paid_date)} · ${method} · ${txLabel(detail.tx_type)} ${signedMoney(Number(detail.amount ?? 0))}${note}`;
        })
        .join("\n\n");
}

function PrepaidCell({ row, border = "" }: { row: PaymentDailyPrepaymentFields; border?: string }) {
    const total = getPriorTotal(row);
    const methods = getPriorMethods(row);
    const entries = METHOD_ORDER
        .map((method) => ({ method, amount: Number(methods[method] ?? 0) }))
        .filter((entry) => Math.abs(entry.amount) > 0.009);

    if (Math.abs(total) <= 0.009 || entries.length === 0) {
        return <td className={`px-2 py-2.5 text-right text-[var(--text-muted)] ${border}`}>-</td>;
    }

    const amountClass = total < 0
        ? "text-rose-700 dark:text-rose-300 hc:text-black"
        : "text-fuchsia-800 dark:text-pink-300 hc:text-black";

    return (
        <td
            title={buildPrepaymentTitle(row)}
            className={`px-2 py-2 align-middle text-right bg-fuchsia-50/70 text-fuchsia-900 dark:bg-pink-500/10 dark:text-pink-200 hc:bg-white hc:text-black hc:border-l-4 hc:border-black ${border}`}
        >
            <div className={`font-black leading-tight ${amountClass}`}>{signedMoney(total)}</div>
            <div className="mt-0.5 flex flex-col items-end gap-0.5 text-[10px] font-bold leading-tight">
                {entries.map((entry) => (
                    <span key={entry.method} className="rounded border border-fuchsia-200 bg-white/65 px-1 py-0.5 text-fuchsia-900 dark:border-pink-400/40 dark:bg-pink-500/10 dark:text-pink-200 hc:border-black hc:bg-white hc:text-black">
                        Prepaid {METHOD_LABELS[entry.method]} {signedMoney(entry.amount)}
                    </span>
                ))}
            </div>
        </td>
    );
}

function buildGroupReviewSections<T extends GroupReviewRow>(rows: T[]): GroupReviewSection<T>[] {
    const byGroup = new Map<string, GroupReviewSection<T>>();
    const countedPriorReservations = new Set<string>();

    for (const row of rows) {
        const groupId = String(row.booking_group_id ?? "").trim();
        if (!groupId) continue;

        const current = byGroup.get(groupId) ?? {
            groupId,
            groupCode: row.group_code ?? null,
            groupName: row.group_name ?? null,
            groupMemberCount: Number(row.group_member_count ?? 0),
            groupType: row.group_type ?? null,
            rows: [],
            priorTotal: 0,
            todayTotal: 0,
            combinedTotal: 0,
        };
        current.rows.push(row);
        current.todayTotal += Number(row.total_net ?? 0);

        const priorKey = `${groupId}::${row.reservation_id}`;
        if (!countedPriorReservations.has(priorKey)) {
            countedPriorReservations.add(priorKey);
            current.priorTotal += getPriorTotal(row);
        }

        current.priorTotal = Number(current.priorTotal.toFixed(2));
        current.todayTotal = Number(current.todayTotal.toFixed(2));
        current.combinedTotal = Number((current.priorTotal + current.todayTotal).toFixed(2));
        byGroup.set(groupId, current);
    }

    return Array.from(byGroup.values());
}

function GroupReviewHeader<T extends GroupReviewRow>({ section, colSpan }: { section: GroupReviewSection<T>; colSpan: number }) {
    const isLinkedStay = section.groupType === "linked_stay";
    const unit = isLinkedStay ? "segments" : "rooms";
    const roomCount = section.groupMemberCount > 0 ? `${section.groupMemberCount} ${unit}` : isLinkedStay ? "Linked stay" : "Group booking";
    const badge = isLinkedStay ? "LINK" : formatShortGroupCode(section.groupCode);
    return (
        <tr className={`border-y-2 hc:border-black hc:bg-white ${isLinkedStay ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-fuchsia-200 bg-fuchsia-50/80 dark:border-pink-500/30 dark:bg-pink-500/10"}`}>
            <td colSpan={colSpan} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                    {isLinkedStay ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-black text-emerald-800 shadow-sm dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200 hc:border-black hc:bg-white hc:text-black">
                            {badge}
                        </span>
                    ) : (
                        <Link
                            href={`/pms/groups?group_id=${encodeURIComponent(section.groupId)}`}
                            className="inline-flex items-center rounded-full border border-fuchsia-300 bg-white px-2.5 py-1 text-xs font-black text-fuchsia-800 shadow-sm hover:bg-fuchsia-100 dark:border-pink-400/40 dark:bg-pink-500/10 dark:text-pink-200 dark:hover:bg-pink-500/20 hc:border-black hc:bg-white hc:text-black"
                        >
                            {badge}
                        </Link>
                    )}
                    <div className="min-w-[180px]">
                        <div className="text-sm font-black text-[var(--text-primary)]">{section.groupName || "Group Booking"}</div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{roomCount}</div>
                    </div>
                    <div className="ml-auto grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded border border-fuchsia-200 bg-white/70 px-3 py-1.5 text-right dark:border-pink-400/30 dark:bg-pink-500/10 hc:border-black hc:bg-white">
                            <div className="text-[9px] font-black uppercase tracking-wider text-fuchsia-700 dark:text-pink-300 hc:text-black">Prepayment ก่อนวันนี้</div>
                            <div className="text-sm font-black text-fuchsia-900 dark:text-pink-200 hc:text-black">{fmtMoney(section.priorTotal)}</div>
                        </div>
                        <div className="rounded border border-brand-200 bg-white/70 px-3 py-1.5 text-right dark:border-brand-400/30 dark:bg-brand-500/10 hc:border-black hc:bg-white">
                            <div className="text-[9px] font-black uppercase tracking-wider text-brand-700 dark:text-brand-300 hc:text-black">จ่ายวันนี้</div>
                            <div className="text-sm font-black text-brand-900 dark:text-brand-200 hc:text-black">{fmtMoney(section.todayTotal)}</div>
                        </div>
                        <div className="rounded border border-[var(--border-default)] bg-white px-3 py-1.5 text-right dark:bg-white/5 hc:border-black hc:bg-white">
                            <div className="text-[9px] font-black uppercase tracking-wider text-[var(--text-secondary)]">รวมรับแล้ว</div>
                            <div className="text-sm font-black text-[var(--text-primary)]">{fmtMoney(section.combinedTotal)}</div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    );
}

function MoneyCell({ v, negativeRed = false, border = "", bg = "" }: { v: number; negativeRed?: boolean; border?: string; bg?: string }) {
    if (v === 0) return <td className={`px-2 py-2.5 text-right text-[var(--text-muted)] ${border} ${bg}`}>-</td>;
    const isNeg = v < 0;
    return (
        <td className={`px-2 py-2.5 text-right font-medium ${isNeg && negativeRed ? "text-rose-600" : "text-[var(--text-table-cell)]"} ${border} ${bg}`}>
            {isNeg ? `-${fmt(Math.abs(v))}` : fmt(v)}
        </td>
    );
}

/* ─── Payment Row Helper ───────────────────────────── */
function PaymentCells({ m }: { m: MethodsMap }) {
    return (
        <>
            <MoneyCell v={m.cash.payment} border={Bi} />
            <MoneyCell v={m.cash.deposit} border={B} />
            <MoneyCell v={m.transfer.payment} border={Bi} />
            <MoneyCell v={m.transfer.deposit} border={B} />
            <MoneyCell v={m.credit_card.payment + m.other.payment} border={Bi} />
            <MoneyCell v={m.credit_card.deposit + m.other.deposit} border={B} />
        </>
    );
}

/* ─── Column Header (reused for Today + Advance) ──── */
function ColumnHeaders({ groupReviewMode }: { groupReviewMode: boolean }) {
    return (
        <thead className="bg-[var(--bg-body)] text-[var(--text-secondary)] uppercase text-[11px] font-bold border-t border-[var(--border-default)]">
            <tr>
                <th rowSpan={2} className={`px-4 py-2 border-b border-l border-[var(--border-default)] ${B} w-48`}>Room / Guest</th>
                <th rowSpan={2} className={`px-4 py-2 border-b border-[var(--border-default)] ${B} text-right w-24`}>Net Total</th>
                {groupReviewMode && (
                    <th rowSpan={2} className={`px-3 py-2 border-b border-[var(--border-default)] ${B} text-right w-36 bg-fuchsia-50 text-fuchsia-800 dark:bg-pink-500/10 dark:text-pink-300 hc:bg-white hc:text-black`}>
                        Prepaid
                    </th>
                )}
                <th colSpan={2} className={`px-2 py-1.5 border-b border-[var(--border-default)] ${B} text-center bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400`}>Cash</th>
                <th colSpan={2} className={`px-2 py-1.5 border-b border-[var(--border-default)] ${B} text-center bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400`}>Transfer</th>
                <th colSpan={2} className={`px-2 py-1.5 border-b border-[var(--border-default)] ${B} text-center bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400`}>Card / Other</th>
                <th rowSpan={2} className={`px-4 py-2 border-b border-r border-[var(--border-default)] w-56`}>Notes</th>
            </tr>
            <tr>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${Bi} text-center font-semibold bg-emerald-50/60 dark:bg-emerald-950/20`}>Payment</th>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${B} text-center font-semibold bg-emerald-50/60 dark:bg-emerald-950/20`}>Deposit</th>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${Bi} text-center font-semibold bg-sky-50/60 dark:bg-sky-950/20`}>Payment</th>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${B} text-center font-semibold bg-sky-50/60 dark:bg-sky-950/20`}>Deposit</th>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${Bi} text-center font-semibold bg-violet-50/60 dark:bg-violet-950/20`}>Payment</th>
                <th className={`px-2 py-1 border-b border-[var(--border-default)] ${B} text-center font-semibold bg-violet-50/60 dark:bg-violet-950/20`}>Deposit</th>
            </tr>
        </thead>
    );
}

function PaymentTableColGroup({ groupReviewMode }: { groupReviewMode: boolean }) {
    return (
        <colgroup>
            <col className="w-48" />
            <col className="w-24" />
            {groupReviewMode && <col className="w-36" />}
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-56" />
        </colgroup>
    );
}

/* ─── Page ──────────────────────────────────────────── */
export default function PaymentDailyPage() {
    const [date, setDate] = useState("");
    const [data, setData] = useState<PaymentDailyData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [detailResId, setDetailResId] = useState<string | null>(null);
    const [detailMode, setDetailMode] = useState<"edit" | "inhouse">("edit");

    const [floorFilter, setFloorFilter] = useState<string>("all");
    const [showMode, setShowMode] = useState<"payments" | "all">("payments");
    const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
    const [showDayUse, setShowDayUse] = useState(true);
    const [showPos, setShowPos] = useState(true);
    const [showDepositRefunds, setShowDepositRefunds] = useState(false);
    const [hideAdvancePayments, setHideAdvancePayments] = useState(false);

    function openReservation(
        reservationId?: string | null,
        mode: "edit" | "inhouse" = "edit"
    ) {
        if (!reservationId) return;
        setDetailMode(mode);
        setDetailResId(reservationId);
    }

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const query = date ? `?date=${encodeURIComponent(date)}` : "";
            const res = await fetch(`/api/reports/payment-daily${query}`);
            const d = await res.json();
            if (d.success) {
                setData(d);
                if (!date && typeof d.business_date === "string" && d.business_date) {
                    setDate(d.business_date);
                }
            }
            else setError(d.error ?? "Failed to load report");
        } catch {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { load(); }, [load]);

    // Data filtering
    const allRooms = data?.all_rooms ?? [];
    const todayRoomsRaw = data?.today_rooms ?? [];
    const advancePaymentsRaw = data?.advance_payments ?? [];
    const todayRooms = todayRoomsRaw.filter((row) => matchesGroupFilter(row, groupFilter));
    const advancePayments = advancePaymentsRaw.filter((row) => matchesGroupFilter(row, groupFilter));
    const isGroupReviewMode = groupFilter === "group";
    const tableColumnCount = isGroupReviewMode ? 10 : 9;
    const visibleTodayRowsForGroupReview = todayRooms.filter((row) => {
        if (!showDayUse && row.is_dayuse) return false;
        if (floorFilter !== "all" && String(row.floor_number) !== floorFilter) return false;
        return true;
    });
    const todayGroupSections = isGroupReviewMode ? buildGroupReviewSections(visibleTodayRowsForGroupReview) : [];
    const advanceGroupSections = isGroupReviewMode ? buildGroupReviewSections(advancePayments) : [];
    const unassignedTodayRooms = todayRooms.filter((row) => row.room_number === "NO ROOM" && !row.is_dayuse);
    const floors = Array.from(new Set(allRooms.map(r => r.floor_number))).sort((a, b) => b - a);
    const displayedCashDrawer = roundMoney(data?.reconciliation.net_cash ?? 0);
    const displayedTransferTotal = roundMoney(
        (data?.grand_total.transfer.payment ?? 0) + (data?.grand_total.transfer.deposit ?? 0)
    );
    const displayedCardOtherTotal = roundMoney(
        (data?.grand_total.credit_card.payment ?? 0)
        + (data?.grand_total.credit_card.deposit ?? 0)
        + (data?.grand_total.other.payment ?? 0)
        + (data?.grand_total.other.deposit ?? 0)
    );
    const displayedGrandTotalNet = roundMoney(
        displayedCashDrawer + displayedTransferTotal + displayedCardOtherTotal
    );
    return (
        <div className="flex flex-col gap-6 max-w-[1400px] mx-auto w-full pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Payment Daily Summary</h1>
                    <p className="text-sm text-[var(--text-secondary)]">Per-room payment breakdown with advance accounting.</p>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        type="date"
                        className="input max-w-[160px] cursor-pointer"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                        {loading ? "..." : "🔄 Refresh"}
                    </button>
                </div>
            </div>

            {error && <div className="bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-4 rounded-lg border border-rose-200 dark:border-rose-800">{error}</div>}

            {/* Controls */}
            <div className="card p-2.5 px-4 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Floor:</span>
                    <select
                        className="input py-1 px-3 text-sm min-w-[70px]"
                        value={floorFilter}
                        onChange={(e) => setFloorFilter(e.target.value)}
                    >
                        <option value="all">All</option>
                        <option value="3">3</option>
                        <option value="2">2</option>
                        <option value="1">1</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Show:</span>
                    <select
                        className="input py-1 px-3 text-sm min-w-[120px]"
                        value={showMode}
                        onChange={(e) => setShowMode(e.target.value as "payments" | "all")}
                    >
                        <option value="payments">Payments Only</option>
                        <option value="all">All Rooms</option>
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-bold text-[var(--text-muted)]">Booking:</span>
                    <select
                        className="input py-1 px-3 text-sm min-w-[132px]"
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value as GroupFilter)}
                    >
                        <option value="all">All</option>
                        <option value="group">Group / Link only</option>
                        <option value="individual">Individual only</option>
                    </select>
                </div>

                <div className="flex items-center gap-3 border-l border-[var(--border-default)] pl-4">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer group">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={showDayUse} onChange={(e) => setShowDayUse(e.target.checked)} />
                        <span className="font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">Day Use</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer group">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={showPos} onChange={(e) => setShowPos(e.target.checked)} />
                        <span className="font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">POS</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer group">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={showDepositRefunds} onChange={(e) => setShowDepositRefunds(e.target.checked)} />
                        <span className="font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">Refunds</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer group">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-[var(--border-input)] rounded focus:ring-brand-500" checked={hideAdvancePayments} onChange={(e) => setHideAdvancePayments(e.target.checked)} />
                        <span className="font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">Hide Advance</span>
                    </label>
                </div>

                {data && (
                    <div className="ml-auto flex items-center gap-4 text-xs font-bold border-l border-[var(--border-default)] pl-4 h-8">
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] uppercase tracking-tighter text-[var(--text-muted)]">Net Total</span>
                            <span className="text-brand-700 text-sm">{fmtMoney(displayedGrandTotalNet)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] uppercase tracking-tighter text-[var(--text-muted)]">Cash Drawer</span>
                            <span className="text-emerald-600 text-sm">{fmtMoney(displayedCashDrawer)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] uppercase tracking-tighter text-[var(--text-muted)]">Transfer</span>
                            <span className="text-sky-600 text-sm">{fmtMoney(displayedTransferTotal)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[9px] uppercase tracking-tighter text-[var(--text-muted)]">Card/Other</span>
                            <span className="text-violet-600 text-sm">{fmtMoney(displayedCardOtherTotal)}</span>
                        </div>
                    </div>
                )}
            </div>

            {data && (
                <div className="flex flex-col gap-6">
                    {/* ═══ COMBINED TABLES ═══ */}
                    <div className="card overflow-hidden text-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap border-collapse">
                                <PaymentTableColGroup groupReviewMode={isGroupReviewMode} />
                                <ColumnHeaders groupReviewMode={isGroupReviewMode} />

                                {/* ─── Today's Rooms Section ─── */}
                                <tbody>
                                    <tr>
                                        <td colSpan={tableColumnCount} className="px-5 py-3 bg-[var(--bg-body)] border-b-2 border-[var(--border-default)]">
                                            <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-sm">Business Date Rooms</span>
                                            <span className="text-[var(--text-secondary)] text-xs font-normal ml-3">ยอดชำระสำหรับห้องใน business date นี้</span>
                                        </td>
                                    </tr>

                                    {isGroupReviewMode ? (
                                        todayGroupSections.length === 0 ? (
                                            <tr>
                                                <td colSpan={tableColumnCount} className="px-4 py-8 text-center text-[var(--text-muted)] italic">No group room payments on this business date.</td>
                                            </tr>
                                        ) : todayGroupSections.map((section) => (
                                            <React.Fragment key={`today-group-${section.groupId}`}>
                                                <GroupReviewHeader section={section} colSpan={tableColumnCount} />
                                                {section.rows.map((tr, idx) => {
                                                    const badge = tr.stay_flow === "due_out"
                                                        ? { text: "↓OUT", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" }
                                                        : tr.stay_flow === "due_in"
                                                            ? { text: "↑IN", className: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" }
                                                            : tr.stay_flow === "in_house"
                                                                ? { text: "🏠IN", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" }
                                                                : tr.is_dayuse
                                                                    ? { text: "DU", className: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400" }
                                                                    : null;
                                                    const prepaymentTitle = getPrepaymentTitle(tr.notes);
                                                    return (
                                                        <tr
                                                            key={`${section.groupId}-${tr.reservation_id || "no-res"}-${tr.room_number}-${idx}`}
                                                            className={`border-b border-[var(--border-subtle)] transition-colors cursor-pointer hover:bg-[var(--bg-body)]/70`}
                                                            onClick={() => openReservation(tr.reservation_id, tr.stay_flow === "due_in" ? "edit" : "inhouse")}
                                                        >
                                                            <td className={`px-4 py-2 ${B} leading-tight`}>
                                                                <span className="font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                                                                    {tr.room_number}
                                                                    {badge && <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.text}</span>}
                                                                    {prepaymentTitle && (
                                                                        <InlineBadge className={PRE_BADGE_CLASS} title={prepaymentTitle}>
                                                                            Pre
                                                                        </InlineBadge>
                                                                    )}
                                                                    <GroupBadge row={tr} />
                                                                </span>
                                                                <span className="text-xs text-[var(--text-secondary)] block truncate max-w-[160px]" title={tr.guest_name}>{tr.guest_name}</span>
                                                            </td>
                                                            <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(tr.total_net)}</td>
                                                            <PrepaidCell row={tr} border={B} />
                                                            <PaymentCells m={tr.methods} />
                                                            <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                                                                <NoteCapsules notes={tr.notes} />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </React.Fragment>
                                        ))
                                    ) : (
                                        <>
                                    {floors.map(floor => {
                                        if (floorFilter !== "all" && String(floor) !== floorFilter) return null;
                                        const baseRoomsOnFloor = allRooms.filter(r => r.floor_number === floor);
                                        if (baseRoomsOnFloor.length === 0) return null;

                                        return (
                                            <React.Fragment key={floor}>
                                                {/* Floor Header Row */}
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-[var(--bg-body)]/50 font-bold text-[var(--text-table-cell)] text-[10px] uppercase tracking-wider border-b border-[var(--border-default)]">
                                                        FLOOR {floor}
                                                    </td>
                                                </tr>
                                                {/* Inbound/Inhouse Rooms */}
                                                {baseRoomsOnFloor.map(br => {
                                                    const roomRows = todayRooms.filter(x => x.room_number === br.room_number && !x.is_dayuse);

                                                    if (roomRows.length === 0) {
                                                        if (showMode === "payments" || groupFilter !== "all") return null;
                                                        const isUnpaidOccupied = br.is_occupied;
                                                        return (
                                                            <tr key={`empty-${br.room_number}`} className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                                                                <td className={`px-4 py-2.5 ${B} font-medium`}>{br.room_number}{isUnpaidOccupied && <span className="ml-2 text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400 px-1.5 py-0.5 rounded font-bold uppercase">ค้างจ่าย</span>}</td>
                                                                <td className={`px-4 py-2.5 ${B} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${Bi} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${B} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${Bi} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${B} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${Bi} text-right`}>—</td>
                                                                <td className={`px-2 py-2.5 ${B} text-right`}>—</td>
                                                                <td className="px-4 py-2.5">—</td>
                                                            </tr>
                                                        );
                                                    }

                                                    return roomRows.map((tr, idx) => {
                                                        const badge = tr.stay_flow === "due_out"
                                                            ? { text: "↓OUT", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" }
                                                            : tr.stay_flow === "due_in"
                                                                ? { text: "↑IN", className: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" }
                                                                : tr.stay_flow === "in_house"
                                                                    ? { text: "🏠IN", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" }
                                                                    : null;
                                                        const prepaymentTitle = getPrepaymentTitle(tr.notes);
                                                        return (
                                                            <tr
                                                                key={`${br.room_number}-${tr.reservation_id || "no-res"}-${idx}`}
                                                                className={`border-b border-[var(--border-subtle)] transition-colors ${tr.reservation_id ? "cursor-pointer hover:bg-[var(--bg-body)]/70" : "hover:bg-[var(--bg-body)]/50"}`}
                                                                onClick={() => openReservation(tr.reservation_id, tr.stay_flow === "due_in" ? "edit" : "inhouse")}
                                                            >
                                                                <td className={`px-4 py-2 ${B} leading-tight`}>
                                                                    <span className="font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                                                                        {tr.room_number}
                                                                        {badge && <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.text}</span>}
                                                                        {prepaymentTitle && (
                                                                            <InlineBadge className={PRE_BADGE_CLASS} title={prepaymentTitle}>
                                                                                Pre
                                                                            </InlineBadge>
                                                                        )}
                                                                        <GroupBadge row={tr} />
                                                                    </span>
                                                                    <span className="text-xs text-[var(--text-secondary)] block truncate max-w-[160px]" title={tr.guest_name}>{tr.guest_name}</span>
                                                                </td>
                                                                <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(tr.total_net)}</td>
                                                                <PaymentCells m={tr.methods} />
                                                                <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                                                                    <NoteCapsules notes={tr.notes} />
                                                                </td>
                                                            </tr>
                                                        );
                                                    });
                                                })}
                                            </React.Fragment>
                                        );
                                    })}

                                    {unassignedTodayRooms.length > 0 && (
                                        <>
                                            <tr>
                                                <td colSpan={9} className="px-4 py-1.5 bg-[var(--bg-body)] font-bold text-[var(--text-table-cell)] text-[10px] uppercase tracking-wider border-b border-[var(--border-default)]">UNASSIGNED / NO ROOM</td>
                                            </tr>
                                            {unassignedTodayRooms.map((tr, idx) => {
                                                const badge = tr.stay_flow === "due_out"
                                                    ? { text: "↓OUT", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" }
                                                    : tr.stay_flow === "due_in"
                                                        ? { text: "↑IN", className: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" }
                                                        : tr.stay_flow === "in_house"
                                                            ? { text: "🏠IN", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" }
                                                            : null;
                                                const prepaymentTitle = getPrepaymentTitle(tr.notes);
                                                return (
                                                    <tr
                                                        key={`no-room-${tr.reservation_id || "no-res"}-${idx}`}
                                                        className={`border-b border-[var(--border-subtle)] transition-colors cursor-pointer hover:bg-[var(--bg-body)]/70`}
                                                        onClick={() => openReservation(tr.reservation_id, tr.stay_flow === "due_in" ? "edit" : "inhouse")}
                                                    >
                                                        <td className={`px-4 py-2 ${B} leading-tight`}>
                                                            <span className="font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                                                                NO ROOM
                                                                {badge && <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.text}</span>}
                                                                {prepaymentTitle && (
                                                                    <InlineBadge className={PRE_BADGE_CLASS} title={prepaymentTitle}>
                                                                        Pre
                                                                    </InlineBadge>
                                                                )}
                                                                <GroupBadge row={tr} />
                                                            </span>
                                                            <span className="text-xs text-[var(--text-secondary)] block truncate max-w-[160px]" title={tr.guest_name}>{tr.guest_name}</span>
                                                        </td>
                                                        <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(tr.total_net)}</td>
                                                        <PaymentCells m={tr.methods} />
                                                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px]"><NoteCapsules notes={tr.notes} /></td>
                                                    </tr>
                                                );
                                            })}
                                        </>
                                    )}

                                    {/* ─── Day Use ─── */}
                                    {showDayUse && (() => {
                                        const duRooms = todayRooms.filter(r => r.is_dayuse);
                                        if (duRooms.length === 0) return null;
                                        return (
                                            <>
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-rose-50/50 dark:bg-rose-950/30 font-bold text-rose-800 dark:text-rose-300 text-[10px] uppercase tracking-wider border-b border-rose-200 dark:border-rose-800">DAY USE</td>
                                                </tr>
                                                {duRooms.map(tr => (
                                                    <tr key={`du-${tr.room_number}`} className="hover:bg-[var(--bg-body)]/50 transition-colors border-b border-[var(--border-subtle)]">
                                                        <td className={`px-4 py-2 ${B} leading-tight`}>
                                                            <span className="font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                                                                {tr.room_number}
                                                                {getPrepaymentTitle(tr.notes) && (
                                                                    <InlineBadge className={PRE_BADGE_CLASS} title={getPrepaymentTitle(tr.notes) ?? undefined}>
                                                                        Pre
                                                                    </InlineBadge>
                                                                )}
                                                                <GroupBadge row={tr} />
                                                            </span>
                                                            <span className="text-xs text-[var(--text-secondary)] block">Day Use</span>
                                                        </td>
                                                        <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(tr.total_net)}</td>
                                                        <PaymentCells m={tr.methods} />
                                                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px]"><NoteCapsules notes={tr.notes} /></td>
                                                    </tr>
                                                ))}
                                            </>
                                        );
                                    })()}

                                    {/* ─── POS ─── */}
                                    {showPos && data.pos && data.pos.cash && (() => {
                                        const { cash, transfer, credit_card, other } = data.pos;
                                        const hasPos = cash.payment > 0 || transfer.payment > 0 || credit_card.payment > 0 || other.payment > 0;
                                        if (!hasPos) return null;
                                        const total = cash.payment + transfer.payment + credit_card.payment + other.payment;
                                        return (
                                            <>
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-amber-50/50 dark:bg-amber-950/30 font-bold text-amber-800 dark:text-amber-300 text-[10px] uppercase tracking-wider border-b border-amber-200 dark:border-amber-800">POS / F&B</td>
                                                </tr>
                                                <tr className="hover:bg-[var(--bg-body)]/50 transition-colors border-b border-[var(--border-subtle)]">
                                                    <td className={`px-4 py-2.5 ${B} font-bold text-[var(--text-primary)]`}>POS Direct Sales</td>
                                                    <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(total)}</td>
                                                    <MoneyCell v={cash.payment} border={Bi} />
                                                    <MoneyCell v={0} border={B} />
                                                    <MoneyCell v={transfer.payment} border={Bi} />
                                                    <MoneyCell v={0} border={B} />
                                                    <MoneyCell v={credit_card.payment + other.payment} border={Bi} />
                                                    <MoneyCell v={0} border={B} />
                                                    <td className="px-3 py-2.5"></td>
                                                </tr>
                                            </>
                                        );
                                    })()}
                                        </>
                                    )}

                                    {/* ─── Today Subtotal ─── */}
                                    <tr className="bg-[var(--bg-muted)] border-t-2 border-[var(--border-input)] font-bold text-sm">
                                        <td className={`px-4 py-3 ${B} text-[var(--text-primary)] uppercase`}>Business Date Subtotal</td>
                                        <td className={`px-4 py-3 ${B} text-right text-brand-800`}>{fmtMoney(data.today_subtotal.grand_net)}</td>
                                        {isGroupReviewMode && <td className={`px-3 py-3 ${B} text-right text-[var(--text-muted)]`}>-</td>}
                                        <MoneyCell v={data.today_subtotal.cash.payment} border={Bi} bg="bg-emerald-50/30 dark:bg-emerald-950/10" />
                                        <MoneyCell v={data.today_subtotal.cash.deposit} border={B} bg="bg-emerald-50/30 dark:bg-emerald-950/10" />
                                        <MoneyCell v={data.today_subtotal.transfer.payment} border={Bi} bg="bg-sky-50/30 dark:bg-sky-950/10" />
                                        <MoneyCell v={data.today_subtotal.transfer.deposit} border={B} bg="bg-sky-50/30 dark:bg-sky-950/10" />
                                        <MoneyCell v={data.today_subtotal.credit_card.payment + data.today_subtotal.other.payment} border={Bi} bg="bg-violet-50/30 dark:bg-violet-950/10" />
                                        <MoneyCell v={data.today_subtotal.credit_card.deposit + data.today_subtotal.other.deposit} border={B} bg="bg-violet-50/30 dark:bg-violet-950/10" />
                                        <td className="px-3 py-3"></td>
                                    </tr>
                                </tbody>

                                {/* ─── Advance Payments Section (Unified Alignment) ─── */}
                                {!hideAdvancePayments && (
                                    <>
                                        <tbody>
                                            <tr className="bg-[var(--bg-body)] border-y-2 border-[var(--border-default)]">
                                                <td colSpan={tableColumnCount} className="px-5 py-3">
                                                    <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-sm">Advance Payments</span>
                                                    <span className="text-[var(--text-secondary)] text-xs font-normal ml-3">ยอดรับล่วงหน้า Booking/Reservation อนาคต</span>
                                                </td>
                                            </tr>
                                        </tbody>
                                        <tbody>
                                            {advancePayments.length === 0 ? (
                                                <tr>
                                                    <td colSpan={tableColumnCount} className="px-4 py-8 text-center text-[var(--text-muted)] italic">No advance payments recorded on this business date.</td>
                                                </tr>
                                            ) : isGroupReviewMode ? (
                                                advanceGroupSections.map((section) => (
                                                    <React.Fragment key={`advance-group-${section.groupId}`}>
                                                        <GroupReviewHeader section={section} colSpan={tableColumnCount} />
                                                        {section.rows.map((adv) => (
                                                            <tr
                                                                key={`${section.groupId}-${adv.booking_code}`}
                                                                className={`border-b border-[var(--border-subtle)] transition-colors cursor-pointer hover:bg-[var(--bg-body)]/70`}
                                                                onClick={() => openReservation(adv.reservation_id, "edit")}
                                                            >
                                                                <td className={`px-4 py-2 ${B} leading-tight`}>
                                                                    <div className="flex items-center gap-2 mb-0.5">
                                                                        <span className="font-bold text-[var(--text-primary)]" title={adv.booking_code}>{shortenBookingCode(adv.booking_code)}</span>
                                                                        {adv.room_number ? (
                                                                            <InlineBadge className="bg-[var(--bg-muted)] text-[var(--text-table-cell)]">RM {adv.room_number}</InlineBadge>
                                                                        ) : (
                                                                            <InlineBadge className="bg-amber-100 text-amber-700">no room</InlineBadge>
                                                                        )}
                                                                        <GroupBadge row={adv} />
                                                                    </div>
                                                                    <span className="text-xs text-[var(--text-secondary)] block truncate max-w-[220px]" title={adv.guest_name}>{adv.guest_name}</span>
                                                                </td>
                                                                <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(adv.total_net)}</td>
                                                                <PrepaidCell row={adv} border={B} />
                                                                <PaymentCells m={adv.methods} />
                                                                <td className="px-3 py-2.5 align-middle text-xs text-[var(--text-secondary)]">
                                                                    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                                                                        <span className="shrink-0 font-semibold text-[var(--text-secondary)]">CI: {adv.checkin_date.split("-").slice(1).reverse().join("/")}</span>
                                                                        {adv.payment_status === "deposit" && <InlineBadge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400">มัดจำ</InlineBadge>}
                                                                        {adv.payment_status === "partial" && <InlineBadge className="bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400">บางส่วน</InlineBadge>}
                                                                        {adv.payment_status === "full" && <InlineBadge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">เต็ม</InlineBadge>}
                                                                        {adv.notes.length > 0 && (
                                                                            <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none pb-0.5" title={adv.notes.map((note) => note.title || note.label).join(" | ")}>
                                                                                {adv.notes.map((note, idx) => (
                                                                                    <InlineBadge key={`${adv.booking_code}-note-${idx}`} title={note.title || note.label} className={`${noteBadgeClass(note.label)} shrink-0 max-w-[220px] truncate`}>{note.label}</InlineBadge>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </React.Fragment>
                                                ))
                                            ) : advancePayments.map(adv => (
                                                <tr
                                                    key={adv.booking_code}
                                                    className={`border-b border-[var(--border-subtle)] transition-colors cursor-pointer hover:bg-[var(--bg-body)]/70`}
                                                    onClick={() => openReservation(adv.reservation_id, "edit")}
                                                >
                                                    <td className={`px-4 py-2 ${B} leading-tight`}>
                                                        <div className="flex items-center gap-2 mb-0.5">
                                                            <span className="font-bold text-[var(--text-primary)]" title={adv.booking_code}>{shortenBookingCode(adv.booking_code)}</span>
                                                            {adv.room_number ? (
                                                                <InlineBadge className="bg-[var(--bg-muted)] text-[var(--text-table-cell)]">RM {adv.room_number}</InlineBadge>
                                                            ) : (
                                                                <InlineBadge className="bg-amber-100 text-amber-700">no room</InlineBadge>
                                                            )}
                                                            <GroupBadge row={adv} />
                                                        </div>
                                                        <span className="text-xs text-[var(--text-secondary)] block truncate max-w-[220px]" title={adv.guest_name}>{adv.guest_name}</span>
                                                    </td>
                                                    <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>{fmtMoney(adv.total_net)}</td>
                                                    <PaymentCells m={adv.methods} />
                                                    <td className="px-3 py-2.5 align-middle text-xs text-[var(--text-secondary)]">
                                                        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                                                            <span className="shrink-0 font-semibold text-[var(--text-secondary)]">CI: {adv.checkin_date.split("-").slice(1).reverse().join("/")}</span>
                                                            {adv.payment_status === "deposit" && <InlineBadge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400">มัดจำ</InlineBadge>}
                                                            {adv.payment_status === "partial" && <InlineBadge className="bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400">บางส่วน</InlineBadge>}
                                                            {adv.payment_status === "full" && <InlineBadge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">เต็ม</InlineBadge>}
                                                            {adv.notes.length > 0 && (
                                                                <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none pb-0.5" title={adv.notes.map((note) => note.title || note.label).join(" | ")}>
                                                                    {adv.notes.map((note, idx) => (
                                                                        <InlineBadge key={`${adv.booking_code}-note-${idx}`} title={note.title || note.label} className={`${noteBadgeClass(note.label)} shrink-0 max-w-[220px] truncate`}>{note.label}</InlineBadge>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}

                                            {/* Advance Subtotal Row */}
                                            <tr className="bg-[var(--bg-muted)] border-t-2 border-[var(--border-input)] font-bold text-sm">
                                                <td className={`px-4 py-3 ${B} text-[var(--text-primary)] uppercase`}>Advance Subtotal</td>
                                                <td className={`px-4 py-3 ${B} text-right text-brand-800`}>{fmtMoney(data.advance_subtotal.grand_net)}</td>
                                                {isGroupReviewMode && <td className={`px-3 py-3 ${B} text-right text-[var(--text-muted)]`}>-</td>}
                                                <MoneyCell v={data.advance_subtotal.cash.payment} border={Bi} bg="bg-emerald-50/30 dark:bg-emerald-950/10" />
                                                <MoneyCell v={data.advance_subtotal.cash.deposit} border={B} bg="bg-emerald-50/30 dark:bg-emerald-950/10" />
                                                <MoneyCell v={data.advance_subtotal.transfer.payment} border={Bi} bg="bg-sky-50/30 dark:bg-sky-950/10" />
                                                <MoneyCell v={data.advance_subtotal.transfer.deposit} border={B} bg="bg-sky-50/30 dark:bg-sky-950/10" />
                                                <MoneyCell v={data.advance_subtotal.credit_card.payment + data.advance_subtotal.other.payment} border={Bi} bg="bg-violet-50/30 dark:bg-violet-950/10" />
                                                <MoneyCell v={data.advance_subtotal.credit_card.deposit + data.advance_subtotal.other.deposit} border={B} bg="bg-violet-50/30 dark:bg-violet-950/10" />
                                                <td className="px-3 py-3"></td>
                                            </tr>
                                        </tbody>
                                    </>
                                )}

                                {/* ─── Footer Totals ─── */}
                                <tfoot className="border-t-2 border-[var(--border-input)]">
                                    <tr className="font-bold text-sm bg-[var(--bg-muted)]">
                                        <td className={`px-4 py-3 ${B} text-[var(--text-primary)] uppercase tracking-wider w-48`}>Column Totals</td>
                                        <td className={`px-4 py-3 ${B} text-right text-[var(--text-muted)] w-24`}>-</td>
                                        {isGroupReviewMode && <td className={`px-3 py-3 ${B} text-right text-[var(--text-muted)]`}>-</td>}
                                        <MoneyCell v={data.grand_total.cash.payment} border={Bi} bg="bg-emerald-100/50 dark:bg-emerald-950/50" />
                                        <MoneyCell v={data.grand_total.cash.deposit} border={B} bg="bg-emerald-100/50 dark:bg-emerald-950/50" />
                                        <MoneyCell v={data.grand_total.transfer.payment} border={Bi} bg="bg-sky-100/50 dark:bg-sky-950/50" />
                                        <MoneyCell v={data.grand_total.transfer.deposit} border={B} bg="bg-sky-100/50 dark:bg-sky-950/50" />
                                        <MoneyCell v={data.grand_total.credit_card.payment + data.grand_total.other.payment} border={Bi} bg="bg-violet-100/50 dark:bg-violet-950/50" />
                                        <MoneyCell v={data.grand_total.credit_card.deposit + data.grand_total.other.deposit} border={B} bg="bg-violet-100/50 dark:bg-violet-950/50" />
                                        <td className="px-4 py-3 text-[var(--text-muted)] text-[10px] uppercase tracking-widest text-center w-56 font-black">Payment / Deposit columns</td>
                                    </tr>
                                    <tr className="font-bold text-sm border-t-2 border-emerald-200 dark:border-emerald-800">
                                        <td className={`px-4 py-4 ${B} text-emerald-900 dark:text-emerald-300 uppercase tracking-wider w-48 bg-emerald-50 dark:bg-emerald-950/30`}>Grand Total</td>
                                        <td className={`px-4 py-4 ${B} text-right text-emerald-800 dark:text-emerald-300 w-24 bg-emerald-50 dark:bg-emerald-950/30`}>{fmtMoney(displayedGrandTotalNet)}</td>
                                        {isGroupReviewMode && <td className={`px-3 py-4 ${B} text-right text-[var(--text-muted)] bg-emerald-50 dark:bg-emerald-950/30`}>-</td>}
                                        <td colSpan={2} className={`px-3 py-4 ${B} text-right bg-emerald-50 dark:bg-emerald-950/30`}>
                                            <span className="block text-[9px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Cash Drawer</span>
                                            <span className="text-emerald-900 dark:text-emerald-200">{fmtMoney(displayedCashDrawer)}</span>
                                        </td>
                                        <td colSpan={2} className={`px-3 py-4 ${B} text-right bg-sky-50 dark:bg-sky-950/30`}>
                                            <span className="block text-[9px] uppercase tracking-widest text-sky-700 dark:text-sky-400">Transfer</span>
                                            <span className="text-sky-900 dark:text-sky-200">{fmtMoney(displayedTransferTotal)}</span>
                                        </td>
                                        <td colSpan={2} className={`px-3 py-4 ${B} text-right bg-violet-50 dark:bg-violet-950/30`}>
                                            <span className="block text-[9px] uppercase tracking-widest text-violet-700 dark:text-violet-400">Card / Other</span>
                                            <span className="text-violet-900 dark:text-violet-200">{fmtMoney(displayedCardOtherTotal)}</span>
                                        </td>
                                        <td className="px-4 py-4 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest text-center w-56 bg-emerald-50 dark:bg-emerald-950/30 font-black">Night Audit total</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* ═══ Cash Reconciliation ═══ */}
                    <div className="card overflow-hidden">
                        <div className="p-5 flex flex-col md:flex-row gap-12 items-start justify-start">
                            <div>
                                <h3 className="font-bold text-[var(--text-primary)] mb-1 text-sm uppercase tracking-wider">Cash Reconciliation</h3>
                                <p className="text-[var(--text-secondary)] text-xs max-w-sm">ยอดเงินสดที่ควรมีในลิ้นชักสำหรับวันนี้</p>
                            </div>
                            <div className="bg-[var(--bg-body)] rounded-lg border border-[var(--border-default)] p-4 min-w-[280px]">
                                <div className="flex justify-between items-center py-1.5">
                                    <span className="text-[var(--text-secondary)] text-sm">Cash Payments</span>
                                    <span className="text-[var(--text-primary)] font-semibold text-sm">+{fmtMoney(data.reconciliation.cash_payments)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5 border-b border-[var(--border-default)] pb-3">
                                    <span className="text-[var(--text-secondary)] text-sm">Cash Deposits</span>
                                    <span className="text-[var(--text-primary)] font-semibold text-sm">+{fmtMoney(data.reconciliation.cash_deposits)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5 pt-3">
                                    <span className="text-[var(--text-secondary)] text-sm">Cash Refunds</span>
                                    <span className="text-rose-600 font-semibold text-sm">-{fmtMoney(data.reconciliation.cash_refunds)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5">
                                    <span className="text-[var(--text-secondary)] text-sm">Non-cash Deposit Offset</span>
                                    <span className="text-rose-600 font-semibold text-sm">-{fmtMoney(data.reconciliation.non_cash_deposit_offset ?? 0)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 mt-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 -mx-1 border border-emerald-200 dark:border-emerald-800">
                                    <span className="text-emerald-900 dark:text-emerald-300 font-bold uppercase tracking-wider text-sm">Net Cash</span>
                                    <span className="text-emerald-700 dark:text-emerald-300 font-black text-lg">{fmtMoney(data.reconciliation.net_cash)}</span>
                                </div>
                                <p className="text-[10px] text-[var(--text-muted)] text-center mt-2 uppercase tracking-widest font-bold">ยอดในลิ้นชัก</p>
                            </div>
                        </div>
                    </div>

                    {showDepositRefunds && (
                        <div className="card overflow-hidden text-sm">
                            <div className="px-5 py-3 bg-[var(--bg-body)] border-b-2 border-[var(--border-default)]">
                                <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-sm">Deposit Refunds (Info Only)</span>
                                <span className="text-[var(--text-secondary)] text-xs font-normal ml-3">ไม่กระทบ subtotal / grand total / net cash</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left whitespace-nowrap border-collapse">
                                    <thead className="bg-[var(--bg-body)] text-[var(--text-secondary)] uppercase text-[11px] font-bold">
                                        <tr>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)]">Booking</th>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)]">Guest</th>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)]">Room</th>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)]">Method</th>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)] text-right">Amount</th>
                                            <th className="px-4 py-2 border-b border-[var(--border-default)]">Note</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(data.deposit_refunds ?? []).length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)] italic">No deposit refunds on this date.</td>
                                            </tr>
                                        ) : (
                                            (data.deposit_refunds ?? []).map((row, idx) => (
                                                <tr key={`${row.reservation_id}-${row.paid_at ?? idx}`} className="border-b border-[var(--border-subtle)]">
                                                    <td className="px-4 py-2.5 font-medium text-[var(--text-table-cell)]">{row.booking_code}</td>
                                                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{row.guest_name}</td>
                                                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{row.room_number || "-"}</td>
                                                    <td className="px-4 py-2.5 text-[var(--text-secondary)] uppercase">{row.method}</td>
                                                    <td className="px-4 py-2.5 text-right font-medium text-[var(--text-table-cell)]">{fmtMoney(row.amount)}</td>
                                                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                                                        {row.note ? <NoteCapsules notes={[{ label: row.note }]} /> : "-"}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {detailResId && (
                <ReservationDetailPage
                    mode={detailMode}
                    reservationId={detailResId}
                    onClose={() => setDetailResId(null)}
                    onSuccess={() => {
                        setDetailResId(null);
                        void load();
                    }}
                />
            )}
        </div>
    );
}
