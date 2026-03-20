import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
    fetchExtraFeeTemplate,
    insertExtraFeePayment,
    normalizeOperatorPaymentMethod,
    normalizePaymentMethod,
} from "@/lib/folio-fees";
import { computeCheckoutNetPaidSatang, computeExtraChargeNetSatang } from "@/lib/checkout-balance";
import { formatMoney, fromSatang, toSatang } from "@/lib/money";
import { syncDynamicRoomLinksForReservation } from "@/lib/logbook-api";
import { syncBookingGroupStatusById } from "@/lib/booking-group-status";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { NextRequest, NextResponse } from "next/server";

function toLocalDate(d: Date, tz = "Asia/Bangkok"): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function formatShortDate(date: string): string {
    const [year, month, day] = String(date || "").split("-");
    if (!year || !month || !day) return "";
    return `${day}/${month}`;
}

function getBangkokMinutes(date = new Date()): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((part) => part.type === "hour")?.value;
    const minutePart = parts.find((part) => part.type === "minute")?.value;
    const hour = Number(hourPart);
    const minute = Number(minutePart);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return hour * 60 + minute;
}

type PartyRole = "primary" | "accompanying";

function diffStayNights(checkinDate: string, checkoutDate: string): number {
    const checkinMs = new Date(`${checkinDate}T00:00:00`).getTime();
    const checkoutMs = new Date(`${checkoutDate}T00:00:00`).getTime();
    if (!Number.isFinite(checkinMs) || !Number.isFinite(checkoutMs)) return 1;
    return Math.max(1, Math.round((checkoutMs - checkinMs) / 86400000));
}

function isMissingColumnError(error: unknown): boolean {
    const message = typeof error === "object" && error !== null && "message" in error
        ? String((error as any).message ?? "")
        : String(error ?? "");
    return /column .* does not exist/i.test(message);
}

async function applyGuestCheckoutCounters(params: {
    supabase: ReturnType<typeof createServerSupabaseClient>;
    reservationId: string;
    fallbackPrimaryGuestProfileId: string | null;
    checkinDate: string;
    checkoutDate: string;
    stayDate: string;
}) {
    const { supabase, reservationId, fallbackPrimaryGuestProfileId, checkinDate, checkoutDate, stayDate } = params;
    const checkoutStayDate = checkoutDate || stayDate;
    const stayNights = diffStayNights(checkinDate, checkoutDate);

    const partyRoleByProfileId = new Map<string, PartyRole>();
    const reservationGuestsResult = await supabase
        .from("reservation_guests")
        .select("guest_profile_id, role")
        .eq("reservation_id", reservationId);

    if (reservationGuestsResult.error) {
        throw reservationGuestsResult.error;
    }

    for (const row of reservationGuestsResult.data ?? []) {
        const guestProfileId = String((row as any)?.guest_profile_id ?? "").trim();
        if (!guestProfileId) continue;
        const role: PartyRole = (row as any)?.role === "primary" ? "primary" : "accompanying";
        const existingRole = partyRoleByProfileId.get(guestProfileId);
        if (!existingRole || role === "primary") {
            partyRoleByProfileId.set(guestProfileId, role);
        }
    }

    const hasPrimaryInParty = Array.from(partyRoleByProfileId.values()).includes("primary");
    if (!hasPrimaryInParty && fallbackPrimaryGuestProfileId) {
        partyRoleByProfileId.set(fallbackPrimaryGuestProfileId, "primary");
    }

    const participantIds = Array.from(partyRoleByProfileId.keys());
    if (participantIds.length === 0) {
        return { mode: "none" as const, updated_profiles: 0 };
    }

    const updateLastStayDate = (existing: string | null) => {
        if (!existing) return checkoutStayDate;
        return existing >= checkoutStayDate ? existing : checkoutStayDate;
    };

    const profilesV2Result = await supabase
        .from("guest_profiles")
        .select("id, stay_count, night_count, main_stay_count, main_night_count, accompanying_stay_count, accompanying_night_count, last_stay_date")
        .in("id", participantIds);

    if (!profilesV2Result.error) {
        const profileRows = profilesV2Result.data ?? [];
        const profileById = new Map<string, any>();
        for (const row of profileRows) {
            profileById.set(String((row as any).id), row);
        }

        let updatedProfiles = 0;
        for (const profileId of participantIds) {
            const profile = profileById.get(profileId);
            if (!profile) continue;
            const role = partyRoleByProfileId.get(profileId) ?? "accompanying";
            const updates: Record<string, unknown> = {
                stay_count: Number(profile.stay_count ?? 0) + 1,
                night_count: Number(profile.night_count ?? 0) + stayNights,
                last_stay_date: updateLastStayDate(profile.last_stay_date ? String(profile.last_stay_date) : null),
            };
            if (role === "primary") {
                updates.main_stay_count = Number(profile.main_stay_count ?? 0) + 1;
                updates.main_night_count = Number(profile.main_night_count ?? 0) + stayNights;
            } else {
                updates.accompanying_stay_count = Number(profile.accompanying_stay_count ?? 0) + 1;
                updates.accompanying_night_count = Number(profile.accompanying_night_count ?? 0) + stayNights;
            }

            const updateResult = await supabase
                .from("guest_profiles")
                .update(updates)
                .eq("id", profileId);
            if (updateResult.error) throw updateResult.error;
            updatedProfiles += 1;
        }

        return { mode: "v2" as const, updated_profiles: updatedProfiles };
    }

    if (!isMissingColumnError(profilesV2Result.error)) {
        throw profilesV2Result.error;
    }

    // Backward-compatible fallback for environments where v2 columns are not migrated yet.
    const profilesLegacyResult = await supabase
        .from("guest_profiles")
        .select("id, stay_count, last_stay_date")
        .in("id", participantIds);
    if (profilesLegacyResult.error) throw profilesLegacyResult.error;

    const legacyById = new Map<string, any>();
    for (const row of profilesLegacyResult.data ?? []) {
        legacyById.set(String((row as any).id), row);
    }

    let updatedProfiles = 0;
    for (const profileId of participantIds) {
        const profile = legacyById.get(profileId);
        if (!profile) continue;
        const updateResult = await supabase
            .from("guest_profiles")
            .update({
                stay_count: Number(profile.stay_count ?? 0) + 1,
                last_stay_date: updateLastStayDate(profile.last_stay_date ? String(profile.last_stay_date) : null),
            })
            .eq("id", profileId);
        if (updateResult.error) throw updateResult.error;
        updatedProfiles += 1;
    }

    return { mode: "legacy" as const, updated_profiles: updatedProfiles };
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = createServerSupabaseClient();
        const reservationId = params.id;
        const body = await request.json().catch(() => ({}));

        // Payment details
        const paymentMethod = normalizeOperatorPaymentMethod(body.payment_method ?? "cash");
        const paymentAmountSatang = toSatang(body.payment_amount);
        const paymentAmount: number = fromSatang(paymentAmountSatang);
        const paymentNote: string = body.payment_note ?? "";
        const nowDate = new Date();
        const now = nowDate.toISOString();
        const bangkokMinutes = getBangkokMinutes(nowDate);
        const policyFeeRaw = (body.policy_fee && typeof body.policy_fee === "object")
            ? body.policy_fee as Record<string, unknown>
            : null;
        const policyFeeMethod = policyFeeRaw ? normalizeOperatorPaymentMethod(policyFeeRaw.payment_method) : null;
        const policyFeeAmountSatang = policyFeeRaw ? toSatang(policyFeeRaw.amount) : 0;
        const policyFee = policyFeeRaw
            ? {
                fee_template_code: String(policyFeeRaw.fee_template_code ?? "").trim().toUpperCase(),
                amount: fromSatang(policyFeeAmountSatang),
                method: policyFeeMethod,
                note: typeof policyFeeRaw.note === "string" && policyFeeRaw.note.trim()
                    ? String(policyFeeRaw.note).trim()
                    : null
            }
            : null;

        if (!paymentMethod) {
            return NextResponse.json({ error: "Invalid payment_method." }, { status: 400 });
        }
        if (policyFee) {
            if (policyFee.fee_template_code !== "LATE_CHECKOUT_FEE") {
                return NextResponse.json({ error: "policy_fee must use LATE_CHECKOUT_FEE." }, { status: 400 });
            }
            if (!policyFee.method) {
                return NextResponse.json({ error: "Invalid policy_fee.payment_method." }, { status: 400 });
            }
            if (policyFeeAmountSatang <= 0) {
                return NextResponse.json({ error: "policy_fee.amount must be > 0." }, { status: 400 });
            }
            if (bangkokMinutes < 13 * 60) {
                return NextResponse.json({ error: "LATE_CHECKOUT_FEE is only allowed after 13:00." }, { status: 409 });
            }
        }

        // Deposit handling: support both legacy deposit_action and the extracted drawer booleans.
        const depositAction: "apply" | "refund" =
            body.deposit_action === "apply" || body.apply_deposit === true
                ? "apply"
                : "refund";
        const depositRefundMethod = normalizePaymentMethod(body.deposit_refund_method ?? "cash") ?? "cash";

        // Force checkout bypasses loan/trace warnings (user acknowledged)
        const forceCheckout: boolean = body.force_checkout === true || body.force === true;

        // Verify reservation
        const { data: reservation, error: resError } = await supabase
            .from("reservations")
            .select("id, booking_group_id, status, guest_name, total_price, checkin_date, checkout_date, deposit_amount, guest_profile_id")
            .eq("id", reservationId)
            .maybeSingle();

        if (resError || !reservation) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }
        if (reservation.status !== "active") {
            return NextResponse.json({ error: "Reservation is not active." }, { status: 400 });
        }

        const totalPriceSatang = toSatang(reservation.total_price);
        const depositAmountSatang = toSatang(reservation.deposit_amount);
        const totalPrice = fromSatang(totalPriceSatang);
        const depositAmount = fromSatang(depositAmountSatang);

        // Calculate existing payments
        const { data: existingPayments } = await supabase
            .from("folio_payments")
            .select("amount, tx_type, revenue_category, note, is_record_only")
            .eq("reservation_id", reservationId);

        const { netPaidSatang: priorPaidSatang } = computeCheckoutNetPaidSatang(existingPayments ?? []);
        const priorExtraChargeSatang = computeExtraChargeNetSatang(existingPayments ?? []);
        let policyTemplateCode: string | null = null;
        if (policyFee) {
            const template = await fetchExtraFeeTemplate(supabase, policyFee.fee_template_code);
            if (!template || !template.is_active) {
                return NextResponse.json({ error: "LATE_CHECKOUT_FEE template is not available." }, { status: 409 });
            }
            policyTemplateCode = template.code;
        }

        const creditsBeforeThisPaymentSatang =
            priorPaidSatang + (depositAction === "apply" ? depositAmountSatang : 0);
        const effectiveTotalSatang = totalPriceSatang + priorExtraChargeSatang + policyFeeAmountSatang;
        // policy_fee is posted as its own extra_charge payment row in the same request.
        // Count it here to avoid forcing FO to enter the fee amount again in payment_amount.
        const currentActionCreditsSatang = paymentAmountSatang + policyFeeAmountSatang;
        const balanceBeforePaymentSatang = effectiveTotalSatang - creditsBeforeThisPaymentSatang;
        const balanceBeforePayment = fromSatang(balanceBeforePaymentSatang);
        const remainingAfterEnteredPaymentSatang = balanceBeforePaymentSatang - currentActionCreditsSatang;

        // If balance is 0 or negative, allow zero payment
        if (currentActionCreditsSatang <= 0 && balanceBeforePaymentSatang > 0) {
            return NextResponse.json({
                error: `Outstanding balance of ฿${formatMoney(balanceBeforePayment)}. Payment required.`
            }, { status: 400 });
        }

        if (remainingAfterEnteredPaymentSatang > 0) {
            return NextResponse.json({
                error: `Outstanding balance of ฿${formatMoney(fromSatang(remainingAfterEnteredPaymentSatang))}. Full payment required before checkout.`
            }, { status: 400 });
        }

        // Check for open non-HK loan items (warn if not force_checkout).
        // HK-collect loans remain open for maid collection flow after checkout.
        if (!forceCheckout) {
            const { data: openLoanTraces } = await supabase
                .from("reservation_traces")
                .select("id, loan_item_code, loan_items(requires_hk_collection)")
                .eq("reservation_id", reservationId)
                .eq("status", "open")
                .not("loan_item_code", "is", null);

            const blockingOpenLoans = (openLoanTraces ?? []).filter((trace: any) => {
                const requiresHkCollection = Boolean(trace?.loan_items?.requires_hk_collection);
                return !requiresHkCollection;
            });

            if (blockingOpenLoans.length > 0) {
                return NextResponse.json({
                    error: "Unreturned front-desk loan items. Return these items first or set force_checkout=true.",
                    code: "OPEN_LOANS",
                    blocking_open_loan_count: blockingOpenLoans.length,
                }, { status: 409 });
            }
        }

        const localDate = toLocalDate(nowDate);

        // 1. Write folio_payment for checkout (skip if 0)
        if (paymentAmountSatang > 0) {
            const { error: checkoutPaymentError } = await supabase.from("folio_payments").insert({
                reservation_id: reservationId,
                tx_type: "payment",
                method: paymentMethod,
                amount: paymentAmount,
                note: paymentNote || null,
                revenue_category: "room_revenue",
                cashier_name: "FO",
                paid_date: localDate,
                paid_at: now
            });
            if (checkoutPaymentError) {
                return NextResponse.json({ error: checkoutPaymentError.message }, { status: 500 });
            }
        }

        if (policyFee && policyTemplateCode) {
            await insertExtraFeePayment(supabase, {
                reservationId,
                feeTemplateCode: policyTemplateCode,
                amount: policyFee.amount,
                method: policyFee.method!,
                note: policyFee.note || `Late checkout ${String(Math.floor(bangkokMinutes / 60)).padStart(2, "0")}:${String(bangkokMinutes % 60).padStart(2, "0")}`,
                paidAt: now,
                paidDate: localDate,
            });
        }

        // 2. Handle deposit refund if requested (policy: always refund as cash)
        let depositRefundedSatang = 0;
        if (depositAction === "refund" && depositAmountSatang > 0) {
            depositRefundedSatang = depositAmountSatang;
            const { error: depositRefundError } = await supabase.from("folio_payments").insert({
                reservation_id: reservationId,
                tx_type: "refund",
                method: depositRefundMethod,
                amount: depositAmount,
                note: "Deposit refund on checkout",
                revenue_category: "deposit",
                cashier_name: "FO",
                paid_date: localDate,
                paid_at: now
            });
            if (depositRefundError) {
                return NextResponse.json({ error: depositRefundError.message }, { status: 500 });
            }
        }

        // 3. Update reservation status to checked_out
        const updatePayload: Record<string, unknown> = {
            status: "checked_out",
            updated_at: now,
            checked_out_at: now,
        };
        const { error: updateError } = await supabase
            .from("reservations")
            .update(updatePayload)
            .eq("id", reservationId);

        if (updateError && /checked_out_at/i.test(updateError.message)) {
            const fallback = await supabase
                .from("reservations")
                .update({ status: "checked_out", updated_at: now })
                .eq("id", reservationId);
            if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            }
        } else if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        let checkoutCounterResult: { mode: "v2" | "legacy" | "none"; updated_profiles: number } | null = null;
        try {
            checkoutCounterResult = await applyGuestCheckoutCounters({
                supabase,
                reservationId,
                fallbackPrimaryGuestProfileId: reservation.guest_profile_id ? String(reservation.guest_profile_id) : null,
                checkinDate: String(reservation.checkin_date ?? localDate),
                checkoutDate: String(reservation.checkout_date ?? localDate),
                stayDate: localDate,
            });
        } catch (counterError) {
            console.error("guest checkout counters update failed:", counterError);
        }

        // 4. Get room and mark as dirty
        const { data: night } = await supabase
            .from("reservation_nights")
            .select("room_id")
            .eq("reservation_id", reservationId)
            .is("cancelled_at", null)
            .limit(1)
            .maybeSingle();

        let checkedOutRoomNumber: string | null = null;
        if (night?.room_id) {
            const { data: roomRow } = await supabase
                .from("rooms")
                .select("room_number")
                .eq("id", night.room_id)
                .maybeSingle();
            checkedOutRoomNumber = roomRow?.room_number ? String(roomRow.room_number) : null;

            await supabase.from("housekeeping_tasks").upsert(
                {
                    room_id: night.room_id,
                    stay_date: localDate,
                    task_seq: 1,
                    status: "dirty",
                    is_no_service: false,
                    no_service_note: null,
                    no_service_marked_at: null,
                    no_service_marked_by: null,
                    started_at: null,
                    finished_at: null,
                    approved_at: null,
                    accumulated_ms: 0,
                },
                { onConflict: "room_id,stay_date,task_seq" }
            );
        }

        if (checkedOutRoomNumber) {
            await syncDynamicRoomLinksForReservation(supabase, {
                reservationId,
                nextRoomCode: checkedOutRoomNumber,
            });

            const { error: dynamicCheckoutLabelError } = await supabase
                .from("logbook_note_links")
                .update({
                    label: `Room ${checkedOutRoomNumber} ${formatShortDate(localDate)}`,
                })
                .eq("link_type", "room")
                .eq("room_link_mode", "dynamic")
                .eq("ref_id", reservationId);

            if (dynamicCheckoutLabelError) {
                return NextResponse.json({ error: dynamicCheckoutLabelError.message }, { status: 500 });
            }
        }

        // 5. Audit log
        await supabase.from("audit_logs").insert({
            action: "checked_out",
            entity_type: "reservation",
            entity_id: reservationId,
            after_json: {
                guest_name: reservation.guest_name,
                total_price: reservation.total_price,
                payment_method: paymentMethod,
                payment_amount: paymentAmount,
                payment_note: paymentNote,
                deposit_action: depositAction,
                deposit_refunded: fromSatang(depositRefundedSatang),
                deposit_refund_method: depositRefundedSatang > 0 ? depositRefundMethod : null,
                policy_fee: policyFee ? {
                    code: policyFee.fee_template_code,
                    amount: policyFee.amount,
                    method: policyFee.method,
                    note: policyFee.note,
                } : null,
                guest_counter_update: checkoutCounterResult,
                checked_out_at: now
            },
            business_date: localDate,
            source: normalizeAuditSource("manual"),
        });

        if (reservation.booking_group_id) {
            try {
                await syncBookingGroupStatusById(supabase, String(reservation.booking_group_id));
            } catch (syncError) {
                console.error("group status sync after checkout failed:", reservation.booking_group_id, syncError);
            }
        }

        return NextResponse.json({
            success: true,
            message: "Checked out successfully.",
            total_price: totalPrice,
            payment_amount: paymentAmount,
            policy_fee_recorded: Boolean(policyFee),
            deposit_refunded: fromSatang(depositRefundedSatang),
            deposit_action: depositAction,
            deposit_refund_method: depositRefundedSatang > 0 ? depositRefundMethod : null
        });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
