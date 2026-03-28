import { createServerSupabaseClient } from "@/lib/supabase/server";
import { computeCheckoutNetPaidSatang, computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { computeHeldDepositFromRows } from "@/lib/deposit-ledger";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import { mapEffectiveReservationAlert } from "@/lib/reservation-alerts";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

function getBangkokHour(date = new Date()): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((part) => part.type === "hour")?.value;
    const hour = Number(hourPart);
    return Number.isFinite(hour) ? hour : 0;
}

/**
 * GET /api/bookings/[id]/pre-checkout
 *
 * Returns everything the checkout UI needs to display warnings:
 * - balance_due (room charges - net payments)
 * - deposit info (kept separate, not auto-applied)
 * - open loan items (traces with loan_item_code and status=open)
 * - auto_on_co alerts
 * - open traces count
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    noStore();
    try {
        const supabase = createServerSupabaseClient();
        const reservationId = params.id;

        // 1. Reservation basics
        const { data: reservation, error: resError } = await supabase
            .from("reservations")
            .select("id, status, guest_name, total_price, deposit_amount, checkin_date, checkout_date, source")
            .eq("id", reservationId)
            .maybeSingle();

        if (resError || !reservation) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }

        const totalPriceSatang = toSatang(reservation.total_price);
        const bangkokHour = getBangkokHour();
        const isAfterHardLimit = bangkokHour > 16;

        // 2. Sum all existing payments
        const { data: payments } = await supabase
            .from("folio_payments")
            .select("amount, tx_type, revenue_category, note, is_record_only, fee_template_code")
            .eq("reservation_id", reservationId);

        const {
            totalPaidSatang,
            totalRefundedSatang,
            netPaidSatang
        } = computeCheckoutNetPaidSatang(payments ?? []);
        const depositAmountSatang = toSatang(computeHeldDepositFromRows(payments ?? []));
        const extraChargeNetSatang = computeExtraChargeNetSatang(payments ?? []);
        const lateCheckoutFeeNetSatang = (payments ?? []).reduce((sum, row: any) => {
            if (String(row?.fee_template_code ?? "").toUpperCase() !== "LATE_CHECKOUT_FEE") return sum;
            if (String(row?.revenue_category ?? "") !== "extra_charge") return sum;
            if (row?.is_record_only === true) return sum;
            const amountSatang = toSatang(row?.amount ?? 0);
            if (String(row?.tx_type ?? "") === "refund") return sum - amountSatang;
            return sum + amountSatang;
        }, 0);
        const balanceDueSatang = totalPriceSatang + extraChargeNetSatang - netPaidSatang;

        // 3. Open loan items (traces with loan_item_code that are still open)
        const { data: openLoanTraces } = await supabase
            .from("reservation_traces")
            .select("id, trace_text, loan_item_code, loan_qty, loan_items(code, name, icon, requires_hk_collection)")
            .eq("reservation_id", reservationId)
            .eq("status", "open")
            .not("loan_item_code", "is", null);

        const openLoans = (openLoanTraces ?? []).map((t: any) => ({
            trace_id: t.id,
            trace_text: t.trace_text,
            loan_item_code: t.loan_item_code,
            loan_qty: t.loan_qty || 1,
            item_name: t.loan_items?.name ?? t.loan_item_code,
            item_icon: t.loan_items?.icon ?? "📦",
            requires_hk_collection: Boolean(t.loan_items?.requires_hk_collection),
        }));
        const blockingOpenLoans = openLoans.filter((loan) => !loan.requires_hk_collection);
        const hkCollectLoans = openLoans.filter((loan) => loan.requires_hk_collection);

        // 4. Alerts with auto_on_co = true
        const { data: alerts } = await supabase
            .from("reservation_alerts")
            .select("id, reservation_id, alert_code, alert_template_id, note, custom_message, display_surfaces, severity, is_dismissed, created_at, created_by, alert_codes(code, description, dept, auto_on_co, icon), alert_templates(id, code, name, description, category, display_surfaces, severity, icon)")
            .eq("reservation_id", reservationId);

        const coAlerts = (alerts ?? [])
            .map((a: any) => mapEffectiveReservationAlert(a))
            .filter((a) => !a.is_dismissed && a.auto_on_co)
            .map((a) => ({
                id: a.id,
                code: a.template_code ?? a.alert_code ?? "ALERT",
                description: a.message,
                icon: a.icon ?? "🔔",
                note: a.note
            }));

        // 5. Open traces count
        const { count: openTracesCount } = await supabase
            .from("reservation_traces")
            .select("id", { count: "exact", head: true })
            .eq("reservation_id", reservationId)
            .eq("status", "open");

        // 6. Build warnings array
        const warnings: { type: string; message: string; severity: "error" | "warning" | "info" }[] = [];

        if (balanceDueSatang > 0) {
            warnings.push({
                type: "balance_due",
                message: `Outstanding balance: ฿${formatMoney(fromSatang(balanceDueSatang))}. Payment required before checkout.`,
                severity: "error"
            });
        }

        if (blockingOpenLoans.length > 0) {
            const itemNames = blockingOpenLoans.map(l => `${l.item_icon} ${l.item_name} ×${l.loan_qty}`).join(", ");
            warnings.push({
                type: "open_loans",
                message: `Unreturned loan items: ${itemNames}. Please collect before checkout.`,
                severity: "warning"
            });
        }

        if (hkCollectLoans.length > 0) {
            const itemNames = hkCollectLoans.map(l => `${l.item_icon} ${l.item_name} ×${l.loan_qty}`).join(", ");
            warnings.push({
                type: "hk_collect_loans",
                message: `HK collection items: ${itemNames}. These remain open for maid collection after checkout.`,
                severity: "info"
            });
        }

        if (coAlerts.length > 0) {
            for (const alert of coAlerts) {
                warnings.push({
                    type: "co_alert",
                    message: `${alert.icon} ${alert.code}: ${alert.description}${alert.note ? ` (${alert.note})` : ""}`,
                    severity: "warning"
                });
            }
        }

        if (depositAmountSatang > 0) {
            warnings.push({
                type: "deposit_held",
                message: `Deposit held: ฿${formatMoney(fromSatang(depositAmountSatang))}. Keep separate from room charges; refund on checkout if no incidentals.`,
                severity: "info"
            });
        }

        return NextResponse.json({
            success: true,
            reservation_id: reservationId,
            total_price: fromSatang(totalPriceSatang),
            deposit_amount: fromSatang(depositAmountSatang),
            total_paid: fromSatang(totalPaidSatang),
            total_refunded: fromSatang(totalRefundedSatang),
            extra_charges_total: fromSatang(extraChargeNetSatang),
            late_checkout_fee_total: fromSatang(lateCheckoutFeeNetSatang),
            has_late_checkout_fee_paid: lateCheckoutFeeNetSatang > 0,
            balance_due: fromSatang(balanceDueSatang),
            is_after_hard_limit: isAfterHardLimit,
            open_loans: openLoans,
            blocking_open_loans: blockingOpenLoans,
            hk_collect_loans: hkCollectLoans,
            co_alerts: coAlerts,
            open_traces_count: openTracesCount ?? 0,
            warnings
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
