import {
    extractDepositGeneralNote,
    parseDepositPayloadLines,
} from "@/lib/deposit-ledger";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fromSatang, toSatang } from "@/lib/money";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: { id: string } };

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

/* ─── GET — fetch current deposit status ─────────── */
export async function GET(_req: NextRequest, { params }: Params) {
    try {
        const supabase = createServerSupabaseClient();
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
            cashier_name,
            allow_during_checkin,
        } = body as {
            deposit_amount: number;
            deposit_note?: string;
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

        const depositLines = parseDepositPayloadLines(deposit_note, normalizedDepositAmount);
        const generalNote = extractDepositGeneralNote(deposit_note);
        const effectiveGeneralNote = normalizedDepositAmount > 0 ? null : generalNote;
        const { data, error } = await supabase.rpc("apply_deposit_snapshot_lines", {
            p_reservation_id: params.id,
            p_lines: depositLines,
            p_general_note: effectiveGeneralNote,
            p_cashier_name: typeof cashier_name === "string" && cashier_name.trim() ? cashier_name.trim() : "FO",
        });

        if (error) {
            if (String(error.message).includes("Reservation not found")) {
                return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
            }
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, deposit: data });
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
        const { error } = await supabase.rpc("apply_deposit_snapshot_lines", {
            p_reservation_id: params.id,
            p_lines: [],
            p_general_note: null,
            p_cashier_name: "FO",
        });

        if (error) {
            if (String(error.message).includes("Reservation not found")) {
                return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
            }
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "Deposit cleared." });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
