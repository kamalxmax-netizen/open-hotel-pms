import {
    assertBusinessDayOpen,
    computeFeeSummary,
    normalizePaymentMethod,
    toLocalDate,
} from "@/lib/folio-fees";
import {
    buildDepositSnapshotNote,
    computeHeldDepositFromRows,
    extractDepositGeneralNote,
} from "@/lib/deposit-ledger";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fromSatang, toSatang } from "@/lib/money";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

const TX_TYPES = new Set(["payment", "refund", "deposit"]);

type RouteParams = { params: { id: string } };

type PaymentRow = {
    id: string;
    tx_type: "payment" | "refund" | "deposit";
    method: "cash" | "transfer" | "credit_card" | "other";
    amount: number | string;
    note: string | null;
    paid_at: string;
    paid_date: string;
    created_at: string;
    revenue_category?: string | null;
    fee_template_code?: string | null;
    is_record_only?: boolean | null;
    extra_fee_templates?: {
        code: string;
        name: string;
        icon: string | null;
        category: string;
    } | null;
};

function isMissingFeeRelationError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
    if (!error) return false;
    const code = String(error.code ?? "").toUpperCase();
    if (code === "42P01" || code === "42703" || code === "PGRST200" || code === "PGRST204") return true;
    const message = String(error.message ?? "").toLowerCase();
    return (
        message.includes("extra_fee_templates")
        || message.includes("fee_template_code")
        || (message.includes("relation") && message.includes("does not exist"))
        || (message.includes("column") && message.includes("does not exist"))
        || message.includes("could not find a relationship")
    );
}

function toNumber(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizePaymentRows(rows: any[]): PaymentRow[] {
    return rows.map((row) => {
        const templateValue = Array.isArray(row.extra_fee_templates)
            ? row.extra_fee_templates[0] ?? null
            : row.extra_fee_templates ?? null;

        return {
            id: String(row.id ?? ""),
            tx_type: row.tx_type,
            method: row.method,
            amount: row.amount,
            note: row.note ?? null,
            paid_at: row.paid_at,
            paid_date: row.paid_date,
            created_at: row.created_at,
            revenue_category: row.revenue_category ?? null,
            fee_template_code: row.fee_template_code ?? null,
            is_record_only: row.is_record_only ?? false,
            extra_fee_templates: templateValue
                ? {
                    code: String(templateValue.code ?? ""),
                    name: String(templateValue.name ?? ""),
                    icon: templateValue.icon ?? null,
                    category: String(templateValue.category ?? ""),
                }
                : null,
        };
    });
}

async function fetchPaymentRowsWithOptionalFeeFields(supabase: ReturnType<typeof createServerSupabaseClient>, reservationId: string): Promise<PaymentRow[]> {
    const richSelect = `
                id,
                tx_type,
                method,
                amount,
                note,
                paid_at,
                paid_date,
                created_at,
                revenue_category,
                fee_template_code,
                is_record_only,
                extra_fee_templates(code, name, icon, category)
            `;

    const baseSelect = `
                id,
                tx_type,
                method,
                amount,
                note,
                paid_at,
                paid_date,
                created_at,
                revenue_category,
                is_record_only
            `;

    const richRes = await supabase
        .from("folio_payments")
        .select(richSelect)
        .eq("reservation_id", reservationId)
        .order("paid_at", { ascending: false })
        .order("created_at", { ascending: false });

    if (!richRes.error) {
        return normalizePaymentRows(richRes.data ?? []);
    }

    if (!isMissingFeeRelationError(richRes.error)) {
        throw new Error(richRes.error.message);
    }

    const baseRes = await supabase
        .from("folio_payments")
        .select(baseSelect)
        .eq("reservation_id", reservationId)
        .order("paid_at", { ascending: false })
        .order("created_at", { ascending: false });

    if (baseRes.error) {
        throw new Error(baseRes.error.message);
    }

    const rows = (baseRes.data ?? []).map((row: any) => ({
        ...row,
        fee_template_code: null,
        extra_fee_templates: null,
    }));
    return normalizePaymentRows(rows);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
    noStore();
    try {
        const reservationId = params.id;
        if (!reservationId) {
            return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
        }

        const supabase = createServerSupabaseClient();

        const { data: reservation, error: reservationError } = await supabase
            .from("reservations")
            .select("id, total_price, deposit_amount, deposit_note, deposit_paid_at")
            .eq("id", reservationId)
            .maybeSingle();

        if (reservationError) {
            return NextResponse.json({ error: reservationError.message }, { status: 500 });
        }
        if (!reservation) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }

        const payments = await fetchPaymentRowsWithOptionalFeeFields(supabase, reservationId);
        const mergedPayments = [...payments].sort((a, b) => {
            const left = Date.parse(String(b.paid_at ?? ""));
            const right = Date.parse(String(a.paid_at ?? ""));
            if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
            return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
        });
        const summary = computeFeeSummary(
            toNumber(reservation.total_price),
            toNumber(reservation.deposit_amount),
            mergedPayments
        );

        return NextResponse.json({
            success: true,
            reservation_id: reservationId,
            payments: mergedPayments,
            summary: {
                ...summary,
                total_price: summary.room_charges_total,
            }
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const reservationId = params.id;
        if (!reservationId) {
            return NextResponse.json({ error: "Missing reservation id." }, { status: 400 });
        }

        const body = await request.json().catch(() => ({}));
        const txType = String(body.tx_type ?? "payment");
        const methodRaw = String(body.method ?? "cash");
        const method = normalizePaymentMethod(methodRaw);
        const amountSatang = toSatang(body.amount);
        const amount = fromSatang(amountSatang);
        const note = body.note ? String(body.note) : null;
        const cashierName =
            typeof body.cashier_name === "string" && body.cashier_name.trim().length > 0
                ? body.cashier_name.trim()
                : "FO";
        const allowDuringCheckin = body.allow_during_checkin === true;

        if (!TX_TYPES.has(txType)) {
            return NextResponse.json({ error: "Invalid tx_type." }, { status: 400 });
        }
        if (!method) {
            return NextResponse.json({ error: "Invalid method." }, { status: 400 });
        }
        if (!Number.isFinite(amount) || amountSatang <= 0) {
            return NextResponse.json({ error: "amount must be > 0." }, { status: 400 });
        }

        const supabase = createServerSupabaseClient();

        const { data: reservation, error: reservationError } = await supabase
            .from("reservations")
            .select("id, status, checked_in_at, total_price, deposit_amount, deposit_note")
            .eq("id", reservationId)
            .maybeSingle();

        if (reservationError) {
            return NextResponse.json({ error: reservationError.message }, { status: 500 });
        }
        if (!reservation) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }
        if (
            txType === "deposit" &&
            (reservation.status !== "active" || (!reservation.checked_in_at && !allowDuringCheckin))
        ) {
            return NextResponse.json(
                { error: "Deposit is locked before check-in. Use pre-payment until guest is checked in." },
                { status: 409 }
            );
        }

        const localDate = toLocalDate(new Date());
        try {
            await assertBusinessDayOpen(supabase, localDate);
        } catch (guardError) {
            const message = guardError instanceof Error ? guardError.message : "Business day already closed.";
            return NextResponse.json({ error: message }, { status: 400 });
        }

        const revenueCategory = txType === "deposit" ? "deposit" : "room_revenue";

        const { error: insertError } = await supabase
            .from("folio_payments")
            .insert({
                reservation_id: reservationId,
                tx_type: txType,
                method,
                amount,
                note,
                revenue_category: revenueCategory,
                cashier_name: cashierName,
                paid_date: localDate,
                paid_at: new Date().toISOString()
            });

        if (insertError) {
            return NextResponse.json({ error: insertError.message }, { status: 500 });
        }

        if (txType === "deposit") {
            const { data: depositRows, error: depositRowsError } = await supabase
                .from("folio_payments")
                .select("method, amount, note, paid_at, tx_type, revenue_category")
                .eq("reservation_id", reservationId)
                .eq("revenue_category", "deposit")
                .order("paid_at", { ascending: true });

            if (depositRowsError) {
                return NextResponse.json({ error: depositRowsError.message }, { status: 500 });
            }

            const generalNote = extractDepositGeneralNote(reservation.deposit_note);
            const netByMethod = new Map<string, { method: string; amount: number; note: string | null }>();
            for (const row of depositRows ?? []) {
                const method = String(row.method ?? "other");
                const current = netByMethod.get(method) ?? { method, amount: 0, note: null };
                const amount = fromSatang(toSatang(row.amount ?? 0));
                if (row.tx_type === "deposit") current.amount += amount;
                else if (row.tx_type === "refund") current.amount -= amount;
                if (!current.note && typeof row.note === "string" && row.note.trim()) {
                    current.note = row.note.trim();
                }
                netByMethod.set(method, current);
            }
            const lines = Array.from(netByMethod.values()).filter((line) => line.amount > 0);
            const nextDepositAmount = computeHeldDepositFromRows(depositRows ?? []);
            const nextPaidAt =
                (depositRows ?? []).some((row: any) => row.tx_type === "deposit")
                    ? String(
                        [...(depositRows ?? [])]
                            .filter((row: any) => row.tx_type === "deposit")
                            .slice(-1)[0]?.paid_at ?? new Date().toISOString()
                    )
                    : null;
            const nextDepositNote = buildDepositSnapshotNote(lines, generalNote);

            const { error: syncReservationDepositError } = await supabase
                .from("reservations")
                .update({
                    deposit_amount: nextDepositAmount,
                    deposit_paid_at: nextPaidAt,
                    deposit_note: nextDepositNote,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", reservationId);

            if (syncReservationDepositError) {
                return NextResponse.json({ error: syncReservationDepositError.message }, { status: 500 });
            }
        }

        const payments = await fetchPaymentRowsWithOptionalFeeFields(supabase, reservationId);
        const refreshedReservation =
            txType === "deposit"
                ? await supabase
                    .from("reservations")
                    .select("total_price, deposit_amount")
                    .eq("id", reservationId)
                    .maybeSingle()
                : null;
        const inserted = payments[0] ?? null;
        const summary = computeFeeSummary(
            toNumber(refreshedReservation?.data?.total_price ?? reservation.total_price),
            toNumber(refreshedReservation?.data?.deposit_amount ?? reservation.deposit_amount),
            payments
        );

        return NextResponse.json({
            success: true,
            payment: inserted,
            summary: {
                ...summary,
                total_price: summary.room_charges_total,
            }
        }, { status: 201 });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
