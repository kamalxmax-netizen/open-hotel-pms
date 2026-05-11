import {
    type DepositLine,
    extractDepositGeneralNote,
    normalizeDepositMethod,
    parseDepositPayloadLines,
} from "@/lib/deposit-ledger";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { fromSatang, toSatang } from "@/lib/money";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: { id: string } };

async function resolveBusinessDate(
    supabase: ReturnType<typeof createServerSupabaseClient>
): Promise<string> {
    const { data, error } = await supabase
        .from("hotel_settings")
        .select("business_date")
        .eq("id", 1)
        .maybeSingle();
    if (error) {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    }
    return String(data?.business_date ?? "") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

async function applyDepositSnapshotLines(params: {
    supabase: ReturnType<typeof createServerSupabaseClient>;
    reservationId: string;
    lines: Array<{ method: string; amount: number; note?: string | null }>;
    generalNote: string | null;
    cashierName: string;
}) {
    const { supabase, reservationId, lines, generalNote, cashierName } = params;
    const businessDate = await resolveBusinessDate(supabase);
    const wrappedSignature = await supabase.rpc("apply_deposit_snapshot_lines_v2", {
        p_reservation_id: reservationId,
        p_lines: lines,
        p_general_note: generalNote,
        p_cashier_name: cashierName,
        p_paid_date: businessDate,
    });

    if (!wrappedSignature.error) {
        return wrappedSignature.data;
    }

    const wrapperMessage = String(wrappedSignature.error.message ?? "").toLowerCase();
    const canRetryDirect =
        wrappedSignature.error.code === "42883" ||
        wrapperMessage.includes("could not find the function") ||
        wrapperMessage.includes("function public.apply_deposit_snapshot_lines_v2(");

    if (!canRetryDirect) {
        throw wrappedSignature.error;
    }

    const nextSignature = await supabase.rpc("apply_deposit_snapshot_lines", {
        p_reservation_id: reservationId,
        p_lines: lines,
        p_general_note: generalNote,
        p_cashier_name: cashierName,
        p_paid_date: businessDate,
    });

    if (!nextSignature.error) {
        return nextSignature.data;
    }

    const message = String(nextSignature.error.message ?? "").toLowerCase();
    const canRetryLegacy =
        nextSignature.error.code === "42883" ||
        message.includes("could not find the function") ||
        message.includes("function public.apply_deposit_snapshot_lines(") ||
        message.includes("could not choose the best candidate function between");

    if (!canRetryLegacy) {
        throw nextSignature.error;
    }

    const legacySignature = await supabase.rpc("apply_deposit_snapshot_lines", {
        p_reservation_id: reservationId,
        p_lines: lines,
        p_general_note: generalNote,
        p_cashier_name: cashierName,
    });

    if (legacySignature.error) {
        throw legacySignature.error;
    }

    return legacySignature.data;
}

async function assertDepositEditable(
    supabase: ReturnType<typeof createServerSupabaseClient>,
    reservationId: string,
    allowDuringCheckin = false
) {
    const { data: reservation, error } = await supabase
        .from("reservations")
        .select("id, status, checked_in_at, checkin_date")
        .eq("id", reservationId)
        .maybeSingle();

    if (error) {
        return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
    }
    if (!reservation) {
        return { ok: false as const, response: NextResponse.json({ error: "Reservation not found." }, { status: 404 }) };
    }
    if (reservation.status !== "active") {
        return {
            ok: false as const,
            response: NextResponse.json(
                { error: "Deposit can be edited only for active reservations." },
                { status: 409 }
            )
        };
    }
    if (!reservation.checked_in_at && !allowDuringCheckin) {
        return {
            ok: false as const,
            response: NextResponse.json(
                { error: "Deposit is locked before check-in. Use pre-payment until guest is checked in." },
                { status: 409 }
            )
        };
    }
    if (!reservation.checked_in_at && allowDuringCheckin) {
        const { data: settings, error: settingsError } = await supabase
            .from("hotel_settings")
            .select("business_date")
            .eq("id", 1)
            .maybeSingle();
        if (settingsError) {
            return { ok: false as const, response: NextResponse.json({ error: settingsError.message }, { status: 500 }) };
        }
        const businessDate = String(settings?.business_date ?? "");
        const checkinDate = String((reservation as { checkin_date?: string | null }).checkin_date ?? "");
        if (!businessDate || !checkinDate || businessDate < checkinDate) {
            return {
                ok: false as const,
                response: NextResponse.json(
                    { error: "Deposit can be collected on or after check-in date only." },
                    { status: 409 }
                )
            };
        }
    }
    return { ok: true as const };
}

async function loadCurrentDepositLines(
    supabase: ReturnType<typeof createServerSupabaseClient>,
    reservationId: string
): Promise<DepositLine[]> {
    const { data, error } = await supabase
        .from("folio_payments")
        .select("method, amount, tx_type, revenue_category, is_record_only")
        .eq("reservation_id", reservationId)
        .eq("revenue_category", "deposit")
        .eq("is_record_only", false)
        .order("paid_at", { ascending: true });

    if (error) throw error;

    const byMethod = new Map<DepositLine["method"], number>();
    for (const row of data ?? []) {
        const method = normalizeDepositMethod(row.method);
        const amount = fromSatang(toSatang(row.amount ?? 0));
        const current = byMethod.get(method) ?? 0;
        if (row.tx_type === "deposit" || row.tx_type === "payment") byMethod.set(method, current + amount);
        else if (row.tx_type === "refund") byMethod.set(method, current - amount);
    }

    return Array.from(byMethod.entries())
        .map(([method, amount]) => ({ method, amount: fromSatang(toSatang(amount)), note: null }))
        .filter((line) => line.amount > 0);
}

function mergeDepositDelta(
    lines: DepositLine[],
    methodRaw: unknown,
    amount: number
): DepositLine[] {
    const method = normalizeDepositMethod(methodRaw);
    const delta = fromSatang(toSatang(amount));
    const next = lines.map((line) => ({ ...line }));
    const matched = next.find((line) => normalizeDepositMethod(line.method) === method);

    if (matched) matched.amount = fromSatang(toSatang(matched.amount + delta));
    else next.push({ method, amount: delta, note: null });

    return next.filter((line) => line.amount > 0);
}

/* ─── GET — fetch current deposit status ─────────── */
export async function GET(request: NextRequest, { params }: Params) {
    try {
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request, { denyRoles: [] });
        if (auth.error) return auth.error;
        const { data, error } = await supabase
            .from("reservations")
            .select("id, booking_code, guest_name, deposit_amount, deposit_paid_at, deposit_note, total_price")
            .eq("id", params.id)
            .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data) return NextResponse.json({ error: "Reservation not found." }, { status: 404 });

        return NextResponse.json({ success: true, deposit: data });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

/* ─── POST — record deposit payment ─────────────── */
export async function POST(req: NextRequest, { params }: Params) {
    try {
        const supabase = createServerSupabaseClient();
        const body = await req.json();

        const {
            deposit_amount,
            deposit_note,
            deposit_action,
            deposit_delta_amount,
            deposit_delta_method,
            cashier_name,
            allow_during_checkin,
        } = body as {
            deposit_amount: number;
            deposit_note?: string;
            deposit_action?: string;
            deposit_delta_amount?: number;
            deposit_delta_method?: string;
            cashier_name?: string;
            allow_during_checkin?: boolean;
        };
        const editable = await assertDepositEditable(supabase, params.id, allow_during_checkin === true);
        if (!editable.ok) return editable.response;
        const depositAmountSatang = toSatang(deposit_amount);
        const normalizedDepositAmount = fromSatang(depositAmountSatang);

        if (deposit_amount === undefined || depositAmountSatang < 0) {
            return NextResponse.json({ error: "deposit_amount must be ≥ 0" }, { status: 400 });
        }

        let depositLines = parseDepositPayloadLines(deposit_note, normalizedDepositAmount);
        let generalNote = extractDepositGeneralNote(deposit_note);
        if (deposit_action === "top_up") {
            const deltaSatang = toSatang(deposit_delta_amount ?? 0);
            if (deltaSatang <= 0) {
                return NextResponse.json({ error: "deposit_delta_amount must be > 0 for top_up." }, { status: 400 });
            }
            const currentLines = await loadCurrentDepositLines(supabase, params.id);
            depositLines = mergeDepositDelta(currentLines, deposit_delta_method, fromSatang(deltaSatang));
            generalNote = null;
        }
        const effectiveGeneralNote = normalizedDepositAmount > 0 ? null : generalNote;
        try {
            const data = await applyDepositSnapshotLines({
                supabase,
                reservationId: params.id,
                lines: depositLines,
                generalNote: effectiveGeneralNote,
                cashierName: typeof cashier_name === "string" && cashier_name.trim() ? cashier_name.trim() : "FO",
            });
            return NextResponse.json({ success: true, deposit: data });
        } catch (error) {
            if (String((error as any)?.message ?? "").includes("Reservation not found")) {
                return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
            }
            return NextResponse.json({ error: String((error as any)?.message ?? error) }, { status: 500 });
        }
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

/* ─── DELETE — clear deposit (refund/cancel) ─────── */
export async function DELETE(req: NextRequest, { params }: Params) {
    try {
        const supabase = createServerSupabaseClient();
        const allowDuringCheckin = req.nextUrl.searchParams.get("allow_during_checkin") === "1";
        const editable = await assertDepositEditable(supabase, params.id, allowDuringCheckin);
        if (!editable.ok) return editable.response;
        try {
            await applyDepositSnapshotLines({
                supabase,
                reservationId: params.id,
                lines: [],
                generalNote: null,
                cashierName: "FO",
            });
        } catch (error) {
            if (String((error as any)?.message ?? "").includes("Reservation not found")) {
                return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
            }
            return NextResponse.json({ error: String((error as any)?.message ?? error) }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "Deposit cleared." });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
