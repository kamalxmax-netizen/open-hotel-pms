"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/* ─── Types ─────────────────────────────────────────── */
type MethodBreakdown = {
    payment: number;
    deposit: number;
    refund: number;
    net: number;
};

type MethodsMap = {
    cash: MethodBreakdown;
    transfer: MethodBreakdown;
    credit_card: MethodBreakdown;
    other: MethodBreakdown;
};

type PaymentDailyAllRoom = {
    room_number: string;
    floor_number: number;
    is_occupied: boolean;
    has_payment_today: boolean;
};

type StayFlow = "due_out" | "due_in" | "in_house" | "normal";

type PaymentDailyTodayRoom = {
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
    notes: string[];
};

type PaymentDailyAdvance = {
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
    notes: string[];
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
function toLocalDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function today() { return toLocalDate(new Date()); }

function fmt(n: number) {
    if (n === 0) return "";
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney(n: number) {
    if (n === 0) return "฿0.00";
    return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ─── Column border constants ──────────────────────── */
// Group separator (between Cash/Transfer/Card groups)
const B = "border-r border-slate-200";
// Inner separator (between Payment/Deposit within a group)
const Bi = "border-r border-slate-100";

function MoneyCell({ v, negativeRed = false, border = "" }: { v: number; negativeRed?: boolean; border?: string }) {
    if (v === 0) return <td className={`px-2 py-2.5 text-right text-slate-300 ${border}`}>-</td>;
    const isNeg = v < 0;
    return (
        <td className={`px-2 py-2.5 text-right font-medium ${isNeg && negativeRed ? "text-rose-600" : "text-slate-700"} ${border}`}>
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
function ColumnHeaders() {
    return (
        <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] font-bold">
            <tr>
                <th rowSpan={2} className={`px-4 py-2 border-b border-slate-200 ${B} w-48`}>Room / Guest</th>
                <th rowSpan={2} className={`px-4 py-2 border-b border-slate-200 ${B} text-right w-24`}>Net Total</th>
                <th colSpan={2} className={`px-2 py-1.5 border-b border-slate-200 ${B} text-center bg-emerald-50 text-emerald-700`}>Cash</th>
                <th colSpan={2} className={`px-2 py-1.5 border-b border-slate-200 ${B} text-center bg-sky-50 text-sky-700`}>Transfer</th>
                <th colSpan={2} className={`px-2 py-1.5 border-b border-slate-200 ${B} text-center bg-violet-50 text-violet-700`}>Card / Other</th>
                <th rowSpan={2} className="px-4 py-2 border-b border-slate-200 w-56">Notes</th>
            </tr>
            <tr>
                <th className={`px-2 py-1 border-b border-slate-200 ${Bi} text-center font-semibold bg-emerald-50/60`}>Payment</th>
                <th className={`px-2 py-1 border-b border-slate-200 ${B} text-center font-semibold bg-emerald-50/60`}>Deposit</th>
                <th className={`px-2 py-1 border-b border-slate-200 ${Bi} text-center font-semibold bg-sky-50/60`}>Payment</th>
                <th className={`px-2 py-1 border-b border-slate-200 ${B} text-center font-semibold bg-sky-50/60`}>Deposit</th>
                <th className={`px-2 py-1 border-b border-slate-200 ${Bi} text-center font-semibold bg-violet-50/60`}>Payment</th>
                <th className={`px-2 py-1 border-b border-slate-200 ${B} text-center font-semibold bg-violet-50/60`}>Deposit</th>
            </tr>
        </thead>
    );
}

function PaymentTableColGroup() {
    return (
        <colgroup>
            <col className="w-48" />
            <col className="w-24" />
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
    const router = useRouter();
    const [date, setDate] = useState(today());
    const [data, setData] = useState<PaymentDailyData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [floorFilter, setFloorFilter] = useState<string>("all");
    const [showMode, setShowMode] = useState<"payments" | "all">("payments");
    const [showDayUse, setShowDayUse] = useState(true);
    const [showPos, setShowPos] = useState(true);
    const [showDepositRefunds, setShowDepositRefunds] = useState(false);

    function openReservation(reservationId?: string | null) {
        if (!reservationId) return;
        router.push(`/pms/reservations?open=${reservationId}`);
    }

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/reports/payment-daily?date=${date}`);
            const d = await res.json();
            if (d.success) setData(d);
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
    const todayRooms = data?.today_rooms ?? [];
    const unassignedTodayRooms = todayRooms.filter((row) => row.room_number === "NO ROOM" && !row.is_dayuse);
    const floors = Array.from(new Set(allRooms.map(r => r.floor_number))).sort((a, b) => b - a);

    return (
        <div className="flex flex-col gap-6 max-w-[1400px] mx-auto w-full pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Payment Daily Summary</h1>
                    <p className="text-sm text-slate-500">Per-room payment breakdown with advance accounting.</p>
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

            {error && <div className="bg-rose-50 text-rose-700 p-4 rounded-lg border border-rose-200">{error}</div>}

            {/* Controls */}
            <div className="card p-3 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-600">Floor:</span>
                    <select
                        className="input py-1.5 px-3 text-sm"
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
                    <span className="text-sm font-semibold text-slate-600">Show:</span>
                    <select
                        className="input py-1.5 px-3 text-sm"
                        value={showMode}
                        onChange={(e) => setShowMode(e.target.value as "payments" | "all")}
                    >
                        <option value="payments">With Payments</option>
                        <option value="all">All Rooms</option>
                    </select>
                </div>

                <div className="flex items-center gap-4 border-l border-slate-200 pl-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500" checked={showDayUse} onChange={(e) => setShowDayUse(e.target.checked)} />
                        <span className="font-medium text-slate-700">Day Use</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500" checked={showPos} onChange={(e) => setShowPos(e.target.checked)} />
                        <span className="font-medium text-slate-700">POS</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors">
                        <input type="checkbox" className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-500" checked={showDepositRefunds} onChange={(e) => setShowDepositRefunds(e.target.checked)} />
                        <span className="font-medium text-slate-700">Deposit Refunds</span>
                    </label>
                </div>

                {data && (
                    <div className="ml-auto text-sm text-slate-600 font-semibold flex gap-4">
                        <span>Net <span className="text-brand-700 text-base">{fmtMoney(data.grand_total.grand_net)}</span></span>
                        <span>Cash Drawer <span className="text-emerald-600 text-base">{fmtMoney(data.reconciliation.net_cash)}</span></span>
                        <span>Transfer <span className="text-sky-600 text-base">{fmtMoney(data.grand_total.transfer.payment)}</span></span>
                        <span>Card / Other <span className="text-violet-600 text-base">{fmtMoney(data.grand_total.credit_card.payment + data.grand_total.other.payment)}</span></span>
                    </div>
                )}
            </div>

            {data && (
                <div className="flex flex-col gap-6">
                    {/* ═══ TODAY'S ROOMS ═══ */}
                    <div className="card overflow-hidden text-sm">
                        <div className="px-5 py-3 bg-slate-50 border-b-2 border-slate-200">
                            <span className="font-bold text-slate-800 uppercase tracking-wider text-sm">Today&apos;s Rooms</span>
                            <span className="text-slate-500 text-xs font-normal ml-3">ยอดชำระสำหรับห้องวันนี้</span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap border-collapse">
                                <PaymentTableColGroup />
                                <ColumnHeaders />
                                <tbody>
                                    {floors.map(floor => {
                                        if (floorFilter !== "all" && String(floor) !== floorFilter) return null;

                                        const baseRoomsOnFloor = allRooms.filter(r => r.floor_number === floor);
                                        if (baseRoomsOnFloor.length === 0) return null;

                                        return (
                                            <React.Fragment key={floor}>
                                                {/* Floor Header */}
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-slate-50 font-bold text-slate-700 text-xs border-b border-slate-200">
                                                        FLOOR {floor}
                                                    </td>
                                                </tr>
                                                {/* Rooms */}
                                                {baseRoomsOnFloor.map(br => {
                                                    const roomRows = todayRooms.filter(x => x.room_number === br.room_number && !x.is_dayuse);

                                                    if (roomRows.length === 0) {
                                                        if (showMode === "payments") return null;

                                                        const isUnpaidOccupied = br.is_occupied;
                                                        return (
                                                            <tr key={`empty-${br.room_number}`} className="text-slate-400 border-b border-slate-100">
                                                                <td className={`px-4 py-2.5 ${B} font-medium`}>
                                                                    {br.room_number}
                                                                    {isUnpaidOccupied && <span className="ml-2 text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold uppercase">ค้างจ่าย</span>}
                                                                </td>
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
                                                            ? { text: "↓OUT", className: "bg-amber-100 text-amber-700" }
                                                            : tr.stay_flow === "due_in"
                                                                ? { text: "↑IN", className: "bg-sky-100 text-sky-700" }
                                                                : tr.stay_flow === "in_house"
                                                                    ? { text: "🏠IN", className: "bg-emerald-100 text-emerald-700" }
                                                                    : null;
                                                        return (
                                                            <tr
                                                                key={`${br.room_number}-${tr.reservation_id || "no-res"}-${idx}`}
                                                                className={`border-b border-slate-100 transition-colors ${tr.reservation_id ? "cursor-pointer hover:bg-slate-50/70" : "hover:bg-slate-50/50"}`}
                                                                onClick={() => openReservation(tr.reservation_id)}
                                                            >
                                                                <td className={`px-4 py-2 ${B} leading-tight`}>
                                                                    <span className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                                                                        {tr.room_number}
                                                                        {badge && (
                                                                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>
                                                                                {badge.text}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <span className="text-xs text-slate-500 block truncate max-w-[160px]" title={tr.guest_name}>{tr.guest_name}</span>
                                                                </td>
                                                                <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>
                                                                    {fmtMoney(tr.total_net)}
                                                                </td>
                                                                <PaymentCells m={tr.methods} />
                                                                <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px]">
                                                                    {tr.notes.map((n, i) => (
                                                                        <span key={i} className="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 mr-1 mb-0.5 truncate max-w-full">{n}</span>
                                                                    ))}
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
                                                <td colSpan={9} className="px-4 py-1.5 bg-slate-50 font-bold text-slate-700 text-xs border-b border-slate-200 border-t border-slate-200">
                                                    UNASSIGNED / NO ROOM
                                                </td>
                                            </tr>
                                            {unassignedTodayRooms.map((tr, idx) => {
                                                const badge = tr.stay_flow === "due_out"
                                                    ? { text: "↓OUT", className: "bg-amber-100 text-amber-700" }
                                                    : tr.stay_flow === "due_in"
                                                        ? { text: "↑IN", className: "bg-sky-100 text-sky-700" }
                                                        : tr.stay_flow === "in_house"
                                                            ? { text: "🏠IN", className: "bg-emerald-100 text-emerald-700" }
                                                            : null;
                                                return (
                                                    <tr
                                                        key={`no-room-${tr.reservation_id || "no-res"}-${idx}`}
                                                        className={`border-b border-slate-100 transition-colors ${tr.reservation_id ? "cursor-pointer hover:bg-slate-50/70" : "hover:bg-slate-50/50"}`}
                                                        onClick={() => openReservation(tr.reservation_id)}
                                                    >
                                                        <td className={`px-4 py-2 ${B} leading-tight`}>
                                                            <span className="font-bold text-slate-800 inline-flex items-center gap-1.5">
                                                                NO ROOM
                                                                {badge && (
                                                                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}>
                                                                        {badge.text}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-xs text-slate-500 block truncate max-w-[160px]" title={tr.guest_name}>{tr.guest_name}</span>
                                                        </td>
                                                        <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>
                                                            {fmtMoney(tr.total_net)}
                                                        </td>
                                                        <PaymentCells m={tr.methods} />
                                                        <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px]">
                                                            {tr.notes.map((n, i) => (
                                                                <span key={i} className="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 mr-1 mb-0.5 truncate max-w-full">{n}</span>
                                                            ))}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </>
                                    )}

                                    {/* Day Use */}
                                    {showDayUse && (() => {
                                        const duRooms = todayRooms.filter(r => r.is_dayuse);
                                        if (duRooms.length === 0) return null;
                                        return (
                                            <>
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-rose-50/50 font-bold text-rose-800 text-xs border-b border-rose-200 border-t border-slate-200">
                                                        DAY USE
                                                    </td>
                                                </tr>
                                                {duRooms.map(tr => (
                                                    <tr key={`du-${tr.room_number}`} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100">
                                                        <td className={`px-4 py-2 ${B} leading-tight`}>
                                                            <span className="font-bold text-slate-800 block">{tr.room_number}</span>
                                                            <span className="text-xs text-slate-500 block">Day Use</span>
                                                        </td>
                                                        <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>
                                                            {fmtMoney(tr.total_net)}
                                                        </td>
                                                        <PaymentCells m={tr.methods} />
                                                        <td className="px-3 py-2 text-xs">
                                                            {tr.notes.map((n, i) => <span key={i} className="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 mr-1 mb-0.5">{n}</span>)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </>
                                        );
                                    })()}

                                    {/* POS */}
                                    {showPos && data.pos && data.pos.cash && (() => {
                                        const { cash, transfer, credit_card, other } = data.pos;
                                        const hasPos = cash.payment > 0 || transfer.payment > 0 || credit_card.payment > 0 || other.payment > 0;
                                        if (!hasPos) return null;
                                        const total = cash.payment + transfer.payment + credit_card.payment + other.payment;
                                        return (
                                            <>
                                                <tr>
                                                    <td colSpan={9} className="px-4 py-1.5 bg-amber-50/50 font-bold text-amber-800 text-xs border-b border-amber-200 border-t border-slate-200">
                                                        POS / F&B
                                                    </td>
                                                </tr>
                                                <tr className="hover:bg-slate-50/50 transition-colors border-b border-slate-100">
                                                    <td className={`px-4 py-2.5 ${B} font-bold text-slate-800`}>
                                                        POS Direct Sales
                                                    </td>
                                                    <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>
                                                        {fmtMoney(total)}
                                                    </td>
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
                                </tbody>

                                {/* Today Subtotal */}
                                <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                    <tr className="font-bold text-sm">
                                        <td className={`px-4 py-3 ${B} text-slate-800 uppercase`}>Today Subtotal</td>
                                        <td className={`px-4 py-3 ${B} text-right text-brand-800`}>{fmtMoney(data.today_subtotal.grand_net)}</td>
                                        <MoneyCell v={data.today_subtotal.cash.payment} border={Bi} />
                                        <MoneyCell v={data.today_subtotal.cash.deposit} border={B} />
                                        <MoneyCell v={data.today_subtotal.transfer.payment} border={Bi} />
                                        <MoneyCell v={data.today_subtotal.transfer.deposit} border={B} />
                                        <MoneyCell v={data.today_subtotal.credit_card.payment + data.today_subtotal.other.payment} border={Bi} />
                                        <MoneyCell v={data.today_subtotal.credit_card.deposit + data.today_subtotal.other.deposit} border={B} />
                                        <td className="px-3 py-3"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* ═══ ADVANCE PAYMENTS ═══ */}
                    <div className="card overflow-hidden text-sm">
                        <div className="px-5 py-3 bg-slate-50 border-b-2 border-slate-200">
                            <span className="font-bold text-slate-800 uppercase tracking-wider text-sm">Advance Payments</span>
                            <span className="text-slate-500 text-xs font-normal ml-3">ยอดรับล่วงหน้า Booking/Reservation อนาคต</span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap border-collapse">
                                <PaymentTableColGroup />
                                <ColumnHeaders />
                                <tbody>
                                    {data.advance_payments.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-8 text-center text-slate-400 italic">No advance payments recorded today.</td>
                                        </tr>
                                    ) : data.advance_payments.map(adv => (
                                        <tr
                                            key={adv.booking_code}
                                            className={`border-b border-slate-100 transition-colors ${adv.reservation_id ? "cursor-pointer hover:bg-slate-50/70" : "hover:bg-slate-50/50"}`}
                                            onClick={() => openReservation(adv.reservation_id)}
                                        >
                                            <td className={`px-4 py-2 ${B} leading-tight`}>
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <span className="font-bold text-slate-800">{adv.booking_code}</span>
                                                    {adv.room_number ? (
                                                        <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">RM {adv.room_number}</span>
                                                    ) : (
                                                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">no room</span>
                                                    )}
                                                </div>
                                                <span className="text-xs text-slate-500 block truncate max-w-[160px]" title={adv.guest_name}>{adv.guest_name}</span>
                                            </td>
                                            <td className={`px-4 py-2.5 ${B} text-right font-bold text-brand-700`}>
                                                {fmtMoney(adv.total_net)}
                                            </td>
                                            <PaymentCells m={adv.methods} />
                                            <td className="px-3 py-2 text-xs flex flex-col items-start gap-1 justify-center min-h-[50px]">
                                                <span className="font-semibold text-slate-600">CI: {adv.checkin_date.split('-').slice(1).reverse().join('/')}</span>
                                                {adv.payment_status === "deposit" && <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">มัดจำ</span>}
                                                {adv.payment_status === "partial" && <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-1.5 py-0.5 rounded">บางส่วน</span>}
                                                {adv.payment_status === "full" && <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">เต็ม</span>}
                                                {adv.notes.length > 0 && <div className="text-slate-400 mt-0.5 truncate max-w-[150px]" title={adv.notes.join(" | ")}>{adv.notes[0]}</div>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>

                                {/* Advance Subtotal */}
                                <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                    <tr className="font-bold text-sm">
                                        <td className={`px-4 py-3 ${B} text-slate-800 uppercase`}>Advance Subtotal</td>
                                        <td className={`px-4 py-3 ${B} text-right text-brand-800`}>{fmtMoney(data.advance_subtotal.grand_net)}</td>
                                        <MoneyCell v={data.advance_subtotal.cash.payment} border={Bi} />
                                        <MoneyCell v={data.advance_subtotal.cash.deposit} border={B} />
                                        <MoneyCell v={data.advance_subtotal.transfer.payment} border={Bi} />
                                        <MoneyCell v={data.advance_subtotal.transfer.deposit} border={B} />
                                        <MoneyCell v={data.advance_subtotal.credit_card.payment + data.advance_subtotal.other.payment} border={Bi} />
                                        <MoneyCell v={data.advance_subtotal.credit_card.deposit + data.advance_subtotal.other.deposit} border={B} />
                                        <td className="px-3 py-3"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* ═══ GRAND TOTAL ═══ */}
                    <div className="card overflow-hidden text-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap border-collapse">
                                <PaymentTableColGroup />
                                <tfoot className="bg-emerald-50 border-t-2 border-emerald-200">
                                    <tr className="font-bold text-sm">
                                        <td className={`px-4 py-4 ${B} text-emerald-900 uppercase tracking-wider w-48`}>Grand Total</td>
                                        <td className={`px-4 py-4 ${B} text-right text-emerald-800 w-24`}>{fmtMoney(data.grand_total.grand_net)}</td>
                                        <MoneyCell v={data.grand_total.cash.payment} border={Bi} />
                                        <MoneyCell v={data.grand_total.cash.deposit} border={B} />
                                        <MoneyCell v={data.grand_total.transfer.payment} border={Bi} />
                                        <MoneyCell v={data.grand_total.transfer.deposit} border={B} />
                                        <MoneyCell v={data.grand_total.credit_card.payment + data.grand_total.other.payment} border={Bi} />
                                        <MoneyCell v={data.grand_total.credit_card.deposit + data.grand_total.other.deposit} border={B} />
                                        <td className="px-4 py-4 text-emerald-700 text-xs uppercase tracking-wider text-center w-56">รวมทุกยอด</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* ═══ Cash Reconciliation ═══ */}
                    <div className="card overflow-hidden">
                        <div className="p-5 flex flex-col md:flex-row gap-6 items-start justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800 mb-1 text-sm uppercase tracking-wider">Cash Reconciliation</h3>
                                <p className="text-slate-500 text-xs max-w-sm">ยอดเงินสดที่ควรมีในลิ้นชักสำหรับวันนี้</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 min-w-[280px]">
                                <div className="flex justify-between items-center py-1.5">
                                    <span className="text-slate-600 text-sm">Cash Payments</span>
                                    <span className="text-slate-800 font-semibold text-sm">+{fmtMoney(data.reconciliation.cash_payments)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5 border-b border-slate-200 pb-3">
                                    <span className="text-slate-600 text-sm">Cash Deposits</span>
                                    <span className="text-slate-800 font-semibold text-sm">+{fmtMoney(data.reconciliation.cash_deposits)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5 pt-3">
                                    <span className="text-slate-600 text-sm">Cash Refunds</span>
                                    <span className="text-rose-600 font-semibold text-sm">-{fmtMoney(data.reconciliation.cash_refunds)}</span>
                                </div>
                                <div className="flex justify-between items-center py-1.5">
                                    <span className="text-slate-600 text-sm">Non-cash Deposit Offset</span>
                                    <span className="text-rose-600 font-semibold text-sm">-{fmtMoney(data.reconciliation.non_cash_deposit_offset ?? 0)}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 mt-3 bg-emerald-50 rounded-lg px-3 -mx-1 border border-emerald-200">
                                    <span className="text-emerald-900 font-bold uppercase tracking-wider text-sm">Net Cash</span>
                                    <span className="text-emerald-700 font-black text-lg">{fmtMoney(data.reconciliation.net_cash)}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 text-center mt-2 uppercase tracking-widest font-bold">ยอดในลิ้นชัก</p>
                            </div>
                        </div>
                    </div>

                    {showDepositRefunds && (
                        <div className="card overflow-hidden text-sm">
                            <div className="px-5 py-3 bg-slate-50 border-b-2 border-slate-200">
                                <span className="font-bold text-slate-800 uppercase tracking-wider text-sm">Deposit Refunds (Info Only)</span>
                                <span className="text-slate-500 text-xs font-normal ml-3">ไม่กระทบ subtotal / grand total / net cash</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left whitespace-nowrap border-collapse">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] font-bold">
                                        <tr>
                                            <th className="px-4 py-2 border-b border-slate-200">Booking</th>
                                            <th className="px-4 py-2 border-b border-slate-200">Guest</th>
                                            <th className="px-4 py-2 border-b border-slate-200">Room</th>
                                            <th className="px-4 py-2 border-b border-slate-200">Method</th>
                                            <th className="px-4 py-2 border-b border-slate-200 text-right">Amount</th>
                                            <th className="px-4 py-2 border-b border-slate-200">Note</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(data.deposit_refunds ?? []).length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-4 py-6 text-center text-slate-400 italic">No deposit refunds on this date.</td>
                                            </tr>
                                        ) : (
                                            (data.deposit_refunds ?? []).map((row, idx) => (
                                                <tr key={`${row.reservation_id}-${row.paid_at ?? idx}`} className="border-b border-slate-100">
                                                    <td className="px-4 py-2.5 font-medium text-slate-700">{row.booking_code}</td>
                                                    <td className="px-4 py-2.5 text-slate-600">{row.guest_name}</td>
                                                    <td className="px-4 py-2.5 text-slate-600">{row.room_number || "-"}</td>
                                                    <td className="px-4 py-2.5 text-slate-600 uppercase">{row.method}</td>
                                                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">{fmtMoney(row.amount)}</td>
                                                    <td className="px-4 py-2.5 text-slate-500">{row.note || "-"}</td>
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
        </div>
    );
}
