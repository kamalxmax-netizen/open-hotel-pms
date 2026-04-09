"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

type PaymentMethod = "cash" | "transfer" | "credit_card";
type Mode = "split" | "master";

type DemoReservation = {
  id: string;
  bookingCode: string;
  roomNumber: string;
  guestName: string;
  roomTotal: number;
  roomPaid: number;
  depositDefault: number;
  depositPaid: number;
};

type SplitPlan = {
  roomAmount: string;
  roomMethod: PaymentMethod;
  roomNote: string;
  depositAmount: string;
  depositMethod: PaymentMethod;
  depositNote: string;
};

type MasterPlan = {
  roomAmount: string;
  roomMethod: PaymentMethod;
  roomNote: string;
  depositAmount: string;
  depositMethod: PaymentMethod;
  depositNote: string;
};

const DEMO_ROWS: DemoReservation[] = [
  {
    id: "res-204",
    bookingCode: "BK-GRP-204",
    roomNumber: "204",
    guestName: "Pauline Michelle Rubben",
    roomTotal: 1780,
    roomPaid: 520,
    depositDefault: 200,
    depositPaid: 0,
  },
  {
    id: "res-228",
    bookingCode: "BK-GRP-228",
    roomNumber: "228",
    guestName: "Cemal Cem Zohre",
    roomTotal: 1780,
    roomPaid: 0,
    depositDefault: 200,
    depositPaid: 0,
  },
  {
    id: "res-236",
    bookingCode: "BK-GRP-236",
    roomNumber: "236",
    guestName: "Nakita Prakash Parwani",
    roomTotal: 1320,
    roomPaid: 300,
    depositDefault: 200,
    depositPaid: 0,
  },
];

const PAYMENT_OPTIONS: Array<{
  id: PaymentMethod;
  label: string;
}> = [
  { id: "cash", label: "Cash" },
  { id: "transfer", label: "Transfer" },
  { id: "credit_card", label: "Card" },
];

function money(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function methodTone(method: PaymentMethod, active: boolean) {
  if (!active) {
    return "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-input)] hover:bg-[var(--bg-surface-hover)]";
  }

  if (method === "cash") {
    return "border-emerald-500 bg-emerald-600 text-white shadow-md shadow-emerald-500/20";
  }
  if (method === "transfer") {
    return "border-sky-500 bg-sky-600 text-white shadow-md shadow-sky-500/20";
  }
  return "border-violet-500 bg-violet-600 text-white shadow-md shadow-violet-500/20";
}

function PaymentMethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PAYMENT_OPTIONS.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`group min-h-[56px] rounded-xl border px-3 py-3 text-left transition-all ${methodTone(option.id, active)}`}
          >
            <div className="flex items-center justify-center">
              <span className="text-sm font-black tracking-wide whitespace-nowrap">{option.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SummaryBand({
  label,
  amount,
  sub,
  tone,
}: {
  label: string;
  amount: number;
  sub: string;
  tone: "room" | "deposit" | "collect";
}) {
  const toneClass =
    tone === "room"
      ? "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100"
      : tone === "deposit"
        ? "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100"
        : "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-100";

  const accentClass =
    tone === "room"
      ? "text-sky-700 dark:text-sky-300"
      : tone === "deposit"
        ? "text-amber-700 dark:text-amber-300"
        : "text-emerald-700 dark:text-emerald-300";

  return (
    <div className={`rounded-2xl border px-5 py-5 ${toneClass}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.24em] ${accentClass}`}>{label}</div>
      <div className="mt-3 text-4xl font-black tracking-tight">฿ {money(amount)}</div>
      <div className="mt-2 text-sm opacity-80">{sub}</div>
    </div>
  );
}

function statusTone(value: number) {
  if (value < 0) {
    return "refund";
  }
  if (value === 0) {
    return "paid";
  }
  return "due";
}

function statusLabel(value: number) {
  if (value < 0) {
    return `Refund ฿ ${money(Math.abs(value))}`;
  }
  if (value === 0) {
    return "Paid in full";
  }
  return `Remain ฿ ${money(value)}`;
}

function StatusChip({ value }: { value: number }) {
  const tone = statusTone(value);
  const className =
    tone === "paid"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300"
      : tone === "refund"
        ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300"
        : "border-red-300 bg-red-100 text-red-800 dark:border-red-500/20 dark:bg-red-500/15 dark:text-red-300";

  return (
    <div className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${className}`}>
      {statusLabel(value)}
    </div>
  );
}

function ResultBanner({ value }: { value: number }) {
  const tone = statusTone(value);
  const className =
    tone === "paid"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300"
      : tone === "refund"
        ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300"
        : "border-red-300 bg-red-100 text-red-800 dark:border-red-500/20 dark:bg-red-500/15 dark:text-red-300";

  const text =
    tone === "paid"
      ? "Paid"
      : tone === "refund"
        ? `Refund ฿ ${money(Math.abs(value))}`
        : `Remain ฿ ${money(value)}`;

  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${className}`}>
      <span className="text-[11px] font-bold uppercase tracking-[0.22em]">Result</span>
      <span className="text-base font-black tracking-tight">{text}</span>
    </div>
  );
}

export default function GroupCheckinWizardPrototypePage() {
  const [mode, setMode] = useState<Mode>("split");
  const [splitPlans, setSplitPlans] = useState<Record<string, SplitPlan>>(
    Object.fromEntries(
      DEMO_ROWS.map((row) => [
        row.id,
        {
          roomAmount: String(Math.max(0, row.roomTotal - row.roomPaid)),
          roomMethod: "cash" as PaymentMethod,
          roomNote: "",
          depositAmount: String(Math.max(0, row.depositDefault - row.depositPaid)),
          depositMethod: "cash" as PaymentMethod,
          depositNote: "",
        },
      ])
    )
  );
  const [masterPlan, setMasterPlan] = useState<MasterPlan>({
    roomAmount: String(DEMO_ROWS.reduce((sum, row) => sum + Math.max(0, row.roomTotal - row.roomPaid), 0)),
    roomMethod: "cash",
    roomNote: "",
    depositAmount: String(DEMO_ROWS.reduce((sum, row) => sum + Math.max(0, row.depositDefault - row.depositPaid), 0)),
    depositMethod: "transfer",
    depositNote: "",
  });

  const roomBalance = useMemo(
    () => DEMO_ROWS.reduce((sum, row) => sum + Math.max(0, row.roomTotal - row.roomPaid), 0),
    []
  );
  const depositBalance = useMemo(
    () => DEMO_ROWS.reduce((sum, row) => sum + Math.max(0, row.depositDefault - row.depositPaid), 0),
    []
  );

  const splitRows = useMemo(
    () =>
      DEMO_ROWS.map((row) => {
        const plan = splitPlans[row.id];
        const roomDue = Math.max(0, row.roomTotal - row.roomPaid);
        const depositDue = Math.max(0, row.depositDefault - row.depositPaid);
        const roomCollect = toMoney(plan.roomAmount);
        const depositCollect = toMoney(plan.depositAmount);
        const totalDue = roomDue + depositDue;
        const totalCollect = roomCollect + depositCollect;
        return {
          ...row,
          roomDue,
          depositDue,
          roomCollect,
          depositCollect,
          roomRemain: Number((roomDue - roomCollect).toFixed(2)),
          depositRemain: Number((depositDue - depositCollect).toFixed(2)),
          totalDue,
          totalCollect,
          totalRemain: Number((totalDue - totalCollect).toFixed(2)),
        };
      }),
    [splitPlans]
  );

  const collectingNow = useMemo(() => {
    if (mode === "master") {
      return toMoney(masterPlan.roomAmount) + toMoney(masterPlan.depositAmount);
    }
    return splitRows.reduce((sum, row) => sum + row.roomCollect + row.depositCollect, 0);
  }, [masterPlan.depositAmount, masterPlan.roomAmount, mode, splitRows]);

  const balanceAfter = Number((roomBalance + depositBalance - collectingNow).toFixed(2));

  function updateSplitPlan(reservationId: string, patch: Partial<SplitPlan>) {
    setSplitPlans((prev) => ({
      ...prev,
      [reservationId]: {
        ...prev[reservationId],
        ...patch,
      },
    }));
  }

  function fillAllSplit() {
    setSplitPlans(
      Object.fromEntries(
        DEMO_ROWS.map((row) => [
          row.id,
          {
            roomAmount: String(Math.max(0, row.roomTotal - row.roomPaid)),
            roomMethod: splitPlans[row.id]?.roomMethod ?? "cash",
            roomNote: splitPlans[row.id]?.roomNote ?? "",
            depositAmount: String(Math.max(0, row.depositDefault - row.depositPaid)),
            depositMethod: splitPlans[row.id]?.depositMethod ?? "cash",
            depositNote: splitPlans[row.id]?.depositNote ?? "",
          },
        ])
      )
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-brand-600 dark:text-brand-300">
            <Sparkles className="h-3.5 w-3.5" />
            Prototype Only
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tight text-[var(--text-primary)]">Group Check-in Payment</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
              ทดลอง composition ใหม่ที่เน้นยอดเงินเป็นหลัก แยก room charge กับ deposit ชัด และลองกดเล่นได้โดยไม่เซฟจริง
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fillAllSplit}
            className="border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-surface-hover)]"
          >
            Fill Full Amount
          </button>
          <Link
            href="/pms/groups"
            className="bg-brand-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
          >
            Back to Groups
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SummaryBand
          label="Room Balance"
          amount={roomBalance}
          sub="ยอดค้างค่าห้องทั้งหมดของกลุ่ม"
          tone="room"
        />
        <SummaryBand
          label="Deposit Outstanding"
          amount={depositBalance}
          sub="ยอดมัดจำที่ยังต้องเก็บ แยกจากค่าห้อง"
          tone="deposit"
        />
        <SummaryBand
          label="Collecting Now"
          amount={collectingNow}
          sub={
            balanceAfter < 0
              ? `Refund due ฿ ${money(Math.abs(balanceAfter))}`
              : `Balance after check-in ฿ ${money(balanceAfter)}`
          }
          tone="collect"
        />
      </section>

      <div className="space-y-5">
        <main className="space-y-5">
          <section className="border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--text-secondary)]">Step 3 Prototype</div>
                <div className="mt-1 text-2xl font-black tracking-tight text-[var(--text-primary)]">Same payment idea as Booking. Cleaner for groups.</div>
              </div>
              <div className="inline-flex border border-[var(--border-default)] bg-[var(--bg-muted)] p-1">
                {(["split", "master"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`px-4 py-2 text-sm font-semibold transition ${
                      mode === option
                        ? "bg-[var(--bg-surface)] text-brand-700 shadow-sm dark:text-brand-300"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {option === "split" ? "Split by Room" : "Master Payment"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {mode === "split" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {splitRows.map((row) => {
                const plan = splitPlans[row.id];
                const cardTone =
                  statusTone(row.totalRemain) === "paid"
                    ? "border-emerald-300 bg-emerald-50/90 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                    : statusTone(row.totalRemain) === "refund"
                      ? "border-amber-300 bg-amber-50/90 dark:border-amber-500/20 dark:bg-amber-500/10"
                      : "border-red-300 bg-red-50/90 dark:border-red-500/20 dark:bg-red-500/10";

                return (
                  <section
                    key={row.id}
                    className={`rounded-xl border p-2.5 transition hover:shadow-sm ${cardTone}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-default)] pb-4">
                      <div className="min-w-0">
                        <div className="text-[2rem] font-black tracking-tight text-[var(--text-primary)]">Room {row.roomNumber}</div>
                        <h2 className="mt-1 truncate text-[15px] font-black tracking-tight text-[var(--text-primary)]">{row.guestName}</h2>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--text-secondary)]">{row.bookingCode}</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <StatusChip value={row.totalRemain} />
                        <div className="text-right">
                          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Total Due</div>
                          <div className="mt-1 text-[1.35rem] font-black tracking-tight text-[var(--text-primary)]">฿ {money(row.totalDue)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 space-y-2.5">
                      <div className="rounded-xl border border-sky-300 bg-sky-100/90 p-2.5 dark:border-sky-500/30 dark:bg-sky-500/10">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">Room Charge</div>
                            <div className="mt-1 text-[1.35rem] font-black tracking-tight text-sky-950 dark:text-sky-100">฿ {money(row.roomDue)}</div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">After Save</div>
                            <div className={`mt-1 text-lg font-black ${row.roomRemain < 0 ? "text-amber-700 dark:text-amber-300" : row.roomRemain === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                              {row.roomRemain < 0 ? "-" : ""}฿ {money(Math.abs(row.roomRemain))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
                          <input
                            value={plan.roomAmount}
                            onChange={(event) => updateSplitPlan(row.id, { roomAmount: event.target.value })}
                            placeholder="Amount"
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-10 w-full rounded-xl border border-sky-300 bg-white px-3.5 text-base font-black text-[var(--text-primary)] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/30 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            className="h-10 min-w-[124px] rounded-xl bg-brand-600 px-3.5 text-[10px] font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
                          >
                            Add Room Payment
                          </button>
                        </div>

                        <div className="mt-2">
                          <PaymentMethodPicker
                            value={plan.roomMethod}
                            onChange={(value) => updateSplitPlan(row.id, { roomMethod: value })}
                          />
                        </div>

                        <input
                          value={plan.roomNote}
                          onChange={(event) => updateSplitPlan(row.id, { roomNote: event.target.value })}
                          placeholder="Payment note / Ref ID (optional)"
                          className="mt-2 h-10 w-full rounded-xl border border-sky-300 bg-white px-3.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/30 dark:bg-slate-950"
                        />
                      </div>

                      <div className="rounded-xl border border-amber-300 bg-amber-100/90 p-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Deposit</div>
                            <div className="mt-1 text-[1.35rem] font-black tracking-tight text-amber-950 dark:text-amber-100">฿ {money(row.depositDue)}</div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">After Save</div>
                            <div className={`mt-1 text-lg font-black ${row.depositRemain < 0 ? "text-amber-700 dark:text-amber-300" : row.depositRemain === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                              {row.depositRemain < 0 ? "-" : ""}฿ {money(Math.abs(row.depositRemain))}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
                          <input
                            value={plan.depositAmount}
                            onChange={(event) => updateSplitPlan(row.id, { depositAmount: event.target.value })}
                            placeholder="Amount"
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-10 w-full rounded-xl border border-amber-300 bg-white px-3.5 text-base font-black text-[var(--text-primary)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-500/30 dark:bg-slate-950"
                          />
                          <button
                            type="button"
                            className="h-10 min-w-[124px] rounded-xl bg-brand-600 px-3.5 text-[10px] font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
                          >
                            Add Deposit
                          </button>
                        </div>

                        <div className="mt-2">
                          <PaymentMethodPicker
                            value={plan.depositMethod}
                            onChange={(value) => updateSplitPlan(row.id, { depositMethod: value })}
                          />
                        </div>

                        <input
                          value={plan.depositNote}
                          onChange={(event) => updateSplitPlan(row.id, { depositNote: event.target.value })}
                          placeholder="Deposit note / reason if no deposit"
                          className="mt-2 h-10 w-full rounded-xl border border-amber-300 bg-white px-3.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-500/30 dark:bg-slate-950"
                        />
                      </div>
                    </div>

                    <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Already paid</div>
                        <div className="mt-1 text-lg font-black tracking-tight text-[var(--text-primary)]">฿ {money(row.roomPaid + row.depositPaid)}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Collect Now</div>
                        <div className="mt-1 text-lg font-black tracking-tight text-[var(--text-primary)]">฿ {money(row.totalCollect)}</div>
                      </div>
                      <ResultBanner value={row.totalRemain} />
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
                <div className="border-b border-[var(--border-default)] pb-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--text-secondary)]">Master Payment Workspace</div>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-primary)]">Booking payment idea, but one master panel.</h2>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">Use one master line for room charges and one for deposit. Payment note should follow every allocated room under that method.</p>
                </div>
                <div className="mt-5 space-y-4">
                  <div className="rounded-xl border border-sky-300 bg-sky-100/90 p-4 dark:border-sky-500/30 dark:bg-sky-500/10">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300">Room Charge</div>
                        <div className="mt-2 text-3xl font-black tracking-tight text-sky-950 dark:text-sky-100">฿ {money(roomBalance)}</div>
                      </div>
                      <button
                        type="button"
                        className="h-12 rounded-xl bg-brand-600 px-4 text-xs font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
                      >
                        Add Room Payment
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      <PaymentMethodPicker
                        value={masterPlan.roomMethod}
                        onChange={(value) => setMasterPlan((prev) => ({ ...prev, roomMethod: value }))}
                      />
                      <input
                        value={masterPlan.roomAmount}
                        onChange={(event) => setMasterPlan((prev) => ({ ...prev, roomAmount: event.target.value }))}
                        placeholder="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-12 w-full rounded-xl border border-sky-300 bg-white px-4 text-xl font-black text-[var(--text-primary)] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/30 dark:bg-slate-950"
                      />
                      <input
                        value={masterPlan.roomNote}
                        onChange={(event) => setMasterPlan((prev) => ({ ...prev, roomNote: event.target.value }))}
                        placeholder="Payment note / Ref ID (optional)"
                        className="h-12 w-full rounded-xl border border-sky-300 bg-white px-4 text-sm text-[var(--text-primary)] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-sky-500/30 dark:bg-slate-950"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-300 bg-amber-100/90 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Deposit</div>
                        <div className="mt-2 text-3xl font-black tracking-tight text-amber-950 dark:text-amber-100">฿ {money(depositBalance)}</div>
                      </div>
                      <button
                        type="button"
                        className="h-12 rounded-xl bg-brand-600 px-4 text-xs font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
                      >
                        Add Deposit
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      <PaymentMethodPicker
                        value={masterPlan.depositMethod}
                        onChange={(value) => setMasterPlan((prev) => ({ ...prev, depositMethod: value }))}
                      />
                      <input
                        value={masterPlan.depositAmount}
                        onChange={(event) => setMasterPlan((prev) => ({ ...prev, depositAmount: event.target.value }))}
                        placeholder="Amount"
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-12 w-full rounded-xl border border-amber-300 bg-white px-4 text-xl font-black text-[var(--text-primary)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-500/30 dark:bg-slate-950"
                      />
                      <input
                        value={masterPlan.depositNote}
                        onChange={(event) => setMasterPlan((prev) => ({ ...prev, depositNote: event.target.value }))}
                        placeholder="Deposit note / reason if no deposit"
                        className="h-12 w-full rounded-xl border border-amber-300 bg-white px-4 text-sm text-[var(--text-primary)] outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-amber-500/30 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      <div className="sticky bottom-0 z-20 -mx-6 border-t border-[var(--border-default)] bg-[color:var(--bg-surface)]/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Prototype only</div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">กดเล่นได้เต็มที่ แต่จะไม่เซฟและไม่แตะข้อมูลจริง</div>
          </div>
          <button
            type="button"
            onClick={() => window.alert("Prototype only — no save is performed.")}
            className="inline-flex items-center gap-2 bg-brand-600 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-700"
          >
            Confirm Prototype
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
