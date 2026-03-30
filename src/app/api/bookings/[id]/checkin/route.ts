import {
    fetchExtraFeeTemplate,
    insertExtraFeePayment,
    normalizeOperatorPaymentMethod,
    resolveBusinessDate,
} from "@/lib/folio-fees";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fromSatang, toSatang } from "@/lib/money";
import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import { clearAssignedRoomLock, AssignedRoomLockError } from "@/lib/assigned-room-lock";
import { linkPrimaryGuestToReservation, ReservationPartyError } from "@/lib/reservation-party";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { stampReservationPassportScanExpiry } from "@/lib/passport-scan-retention";
import { NextRequest, NextResponse } from "next/server";

const PAYMENT_METHODS = new Set(["cash", "transfer", "credit_card"]);
const HK_BLOCKED_CHECKIN_STATUSES = new Set(["dirty", "in_progress", "paused"]);
const ROOM_OCCUPIED_BACK_TO_BACK_CODE = "BACK_TO_BACK_DUE_OUT_PENDING_CHECKOUT";
const ROOM_OCCUPIED_INHOUSE_CODE = "ROOM_OCCUPIED_INHOUSE";

function toLocalDate(d: Date, tz = "Asia/Bangkok"): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

function toLocalTime(d: Date, tz = "Asia/Bangkok"): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(d);
}

async function ensureHousekeepingReadyForCheckin(
    supabase: ReturnType<typeof createServerSupabaseClient>,
    roomId: string,
    stayDate: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const { data: hkTask, error: hkTaskError } = await supabase
        .from("housekeeping_tasks")
        .select("id, status")
        .eq("room_id", roomId)
        .eq("stay_date", stayDate)
        .order("task_seq", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (hkTaskError && hkTaskError.code !== "PGRST116") {
        return { ok: false, error: hkTaskError.message };
    }

    if (!hkTask) return { ok: true };

    const hkStatus = String(hkTask.status ?? "");
    if (HK_BLOCKED_CHECKIN_STATUSES.has(hkStatus)) {
        return {
            ok: false,
            error: `Room is not ready for check-in (HK status: ${hkStatus}).`
        };
    }

    // If room is cleaned but not yet approved, auto-approve at check-in.
    if (hkStatus === "cleaned") {
        const approvedAt = new Date().toISOString();
        const { error: approveError } = await supabase
            .from("housekeeping_tasks")
            .update({
                status: "approved",
                approved_at: approvedAt
            })
            .eq("id", hkTask.id);
        if (approveError) {
            return { ok: false, error: approveError.message };
        }
        await supabase
            .from("housekeeping_logs")
            .insert({
                task_id: hkTask.id,
                status: "approved",
                note: "auto-approved at check-in"
            });
    }

    return { ok: true };
}

async function ensureRoomVacantForCheckin(
    supabase: ReturnType<typeof createServerSupabaseClient>,
    roomId: string,
    stayDate: string,
    currentReservationId: string
): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
    const { data: candidates, error: candidatesError } = await supabase
        .from("reservations")
        .select("id, booking_code, guest_name, checkin_date, checkout_date, checked_in_at")
        .eq("status", "active")
        .neq("id", currentReservationId)
        .lte("checkin_date", stayDate)
        .gte("checkout_date", stayDate);

    if (candidatesError) {
        return { ok: false, error: candidatesError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
    }

    const rows = (candidates ?? []).map((row: any) => ({
        id: String(row.id ?? ""),
        booking_code: row.booking_code ? String(row.booking_code) : null,
        guest_name: row.guest_name ? String(row.guest_name) : null,
        checkin_date: row.checkin_date ? String(row.checkin_date) : null,
        checkout_date: row.checkout_date ? String(row.checkout_date) : null,
        checked_in_at: row.checked_in_at ?? null,
    })).filter((row) => row.id);

    if (rows.length === 0) return { ok: true };

    const checkedInIds = new Set<string>();
    const pendingLogLookupIds: string[] = [];
    for (const row of rows) {
        if (row.checked_in_at) {
            checkedInIds.add(row.id);
            continue;
        }
        if (row.checkin_date && row.checkin_date < stayDate) {
            checkedInIds.add(row.id);
            continue;
        }
        pendingLogLookupIds.push(row.id);
    }

    if (pendingLogLookupIds.length > 0) {
        const { data: checkinLogs, error: checkinLogError } = await supabase
            .from("audit_logs")
            .select("entity_id")
            .eq("entity_type", "reservation")
            .eq("action", "checked_in")
            .in("entity_id", pendingLogLookupIds);
        if (checkinLogError) {
            return { ok: false, error: checkinLogError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
        }
        for (const log of checkinLogs ?? []) {
            const id = String((log as any).entity_id ?? "");
            if (id) checkedInIds.add(id);
        }
    }

    const checkedInCandidateIds = rows
        .map((row) => row.id)
        .filter((id) => checkedInIds.has(id));
    if (checkedInCandidateIds.length === 0) return { ok: true };

    const { data: nights, error: nightsError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, room_id, stay_date")
        .in("reservation_id", checkedInCandidateIds)
        .is("cancelled_at", null)
        .lte("stay_date", stayDate);

    if (nightsError) {
        return { ok: false, error: nightsError.message, code: "ROOM_OCCUPANCY_CHECK_FAILED" };
    }

    const latestRoomByReservation = new Map<string, { stay_date: string; room_id: string }>();
    for (const night of nights ?? []) {
        const reservationId = String((night as any).reservation_id ?? "");
        const nightRoomId = String((night as any).room_id ?? "");
        const nightDate = String((night as any).stay_date ?? "");
        if (!reservationId || !nightRoomId || !nightDate) continue;
        const current = latestRoomByReservation.get(reservationId);
        if (!current || nightDate > current.stay_date) {
            latestRoomByReservation.set(reservationId, { stay_date: nightDate, room_id: nightRoomId });
        }
    }

    const conflict = rows.find((row) => {
        if (!checkedInIds.has(row.id)) return false;
        const latest = latestRoomByReservation.get(row.id);
        return latest?.room_id === roomId;
    });

    if (!conflict) return { ok: true };

    const isDueOutToday = String(conflict.checkout_date ?? "") === stayDate;
    const guestSuffix = conflict.guest_name ? ` ${conflict.guest_name}` : "";
    const bookingSuffix = conflict.booking_code ? ` (${conflict.booking_code})` : "";
    const occupiedBy = isDueOutToday ? "due-out guest" : "in-house guest";
    return {
        ok: false,
        error: `Room is still occupied by ${occupiedBy}${guestSuffix}${bookingSuffix}. Save Draft first, then check in again after checkout and housekeeping approval.`,
        code: isDueOutToday ? ROOM_OCCUPIED_BACK_TO_BACK_CODE : ROOM_OCCUPIED_INHOUSE_CODE,
    };
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = createServerSupabaseClient();
        const reservationId = params.id;
        const body = await request.json().catch(() => ({}));

        // Optional payment at check-in (supports split payments)
        const legacyPaymentMethodRaw: string = typeof body.payment_method === "string" ? body.payment_method : "";
        const legacyPaymentAmountSatang = toSatang(body.payment_amount);
        const legacyPaymentNote: string = typeof body.payment_note === "string" ? body.payment_note : "";
        const splitPaymentsInput: any[] = Array.isArray(body.payments) ? body.payments : [];
        const pendingPayments: Array<{
            method: "cash" | "transfer" | "credit_card";
            amount: number;
            note: string | null;
        }> = [];

        for (let i = 0; i < splitPaymentsInput.length; i++) {
            const row = splitPaymentsInput[i] ?? {};
            const method = normalizeOperatorPaymentMethod(row.method);
            const amountSatang = toSatang(row.amount);
            const amount = fromSatang(amountSatang);
            if (!method || !PAYMENT_METHODS.has(method)) {
                return NextResponse.json({ error: `Invalid payment method at payments[${i}].` }, { status: 400 });
            }
            if (!Number.isFinite(amount) || amountSatang <= 0) {
                return NextResponse.json({ error: `Invalid payment amount at payments[${i}].` }, { status: 400 });
            }
            const note = typeof row.note === "string" && row.note.trim() ? row.note.trim() : null;
            pendingPayments.push({ method, amount, note });
        }

        if (legacyPaymentAmountSatang > 0) {
            const legacyMethod = normalizeOperatorPaymentMethod(legacyPaymentMethodRaw || "cash");
            if (!legacyMethod || !PAYMENT_METHODS.has(legacyMethod)) {
                return NextResponse.json({ error: "Invalid payment_method." }, { status: 400 });
            }
            pendingPayments.push({
                method: legacyMethod,
                amount: fromSatang(legacyPaymentAmountSatang),
                note: legacyPaymentNote.trim() ? legacyPaymentNote.trim() : null
            });
        }

        const checkedInAtInput: string | null = typeof body.checked_in_at === "string" ? body.checked_in_at : null;
        const checkinTimeInput: string | null = typeof body.checkin_time === "string" ? body.checkin_time : null;
        const checkedInAtDate = checkedInAtInput ? new Date(checkedInAtInput) : new Date();
        if (Number.isNaN(checkedInAtDate.getTime())) {
            return NextResponse.json({ error: "Invalid checked_in_at datetime." }, { status: 400 });
        }
        const checkedInAtIso = checkedInAtDate.toISOString();
        const checkedInTime = (checkinTimeInput && /^\d{2}:\d{2}$/.test(checkinTimeInput))
            ? checkinTimeInput
            : toLocalTime(checkedInAtDate);
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

        if (policyFee) {
            if (policyFee.fee_template_code !== "EARLY_CHECKIN_FEE") {
                return NextResponse.json({ error: "policy_fee must use EARLY_CHECKIN_FEE." }, { status: 400 });
            }
            if (!policyFee.method) {
                return NextResponse.json({ error: "Invalid policy_fee.payment_method." }, { status: 400 });
            }
            if (policyFeeAmountSatang <= 0) {
                return NextResponse.json({ error: "policy_fee.amount must be > 0." }, { status: 400 });
            }
            if (!(checkedInTime >= "04:00" && checkedInTime < "09:00")) {
                return NextResponse.json({ error: "EARLY_CHECKIN_FEE is only allowed for 04:00-08:59 check-in." }, { status: 409 });
            }
        }

        // Verify reservation
        const { data: reservation, error: resError } = await supabase
            .from("reservations")
            .select("id, status, checkin_date, checkout_date, guest_name, total_price, guest_profile_id")
            .eq("id", reservationId)
            .maybeSingle();

        if (resError || !reservation) {
            return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
        }
        if (reservation.status !== "active") {
            return NextResponse.json({ error: "Reservation is not active." }, { status: 400 });
        }

        if (!reservation.guest_profile_id) {
            return NextResponse.json(
                { error: "Link profile before check-in." },
                { status: 409 }
            );
        }

        const { data: profile, error: profileError } = await supabase
            .from("guest_profiles")
            .select("id, first_name, last_name, gender, nationality_code, id_type, id_number, country, province, phone, profile_status, stay_count, last_stay_date, notes")
            .eq("id", reservation.guest_profile_id)
            .maybeSingle();

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 });
        }
        if (!profile) {
            return NextResponse.json({ error: "Linked profile not found." }, { status: 409 });
        }

        const profileCompleteness = checkProfileCompleteness(profile as Record<string, unknown>);
        if (!profileCompleteness.is_complete) {
            return NextResponse.json(
                {
                    error: `Incomplete profile: ${profileCompleteness.missing_fields.join(", ")}. Complete profile or Save Draft.`,
                    missing_fields: profileCompleteness.missing_fields,
                },
                { status: 409 }
            );
        }

        const { data: existingCheckinLogs, error: existingCheckinLogError } = await supabase
            .from("audit_logs")
            .select("id")
            .eq("entity_type", "reservation")
            .eq("entity_id", reservationId)
            .eq("action", "checked_in")
            .limit(1);

        if (existingCheckinLogError) {
            return NextResponse.json({ error: existingCheckinLogError.message }, { status: 500 });
        }
        if ((existingCheckinLogs ?? []).length > 0) {
            return NextResponse.json({ error: "Reservation already checked in." }, { status: 409 });
        }

        const calendarDate = toLocalDate(checkedInAtDate);
        const businessDate = await resolveBusinessDate(supabase, calendarDate);

        // Get room for this reservation
        const { data: night } = await supabase
            .from("reservation_nights")
            .select("room_id, rooms(room_number)")
            .eq("reservation_id", reservationId)
            .is("cancelled_at", null)
            .limit(1)
            .maybeSingle();

        const roomId = night?.room_id ?? null;

        // Guard room occupancy + housekeeping readiness before check-in (before updating reservation)
        if (roomId) {
            const roomVacant = await ensureRoomVacantForCheckin(supabase, roomId, businessDate, reservationId);
            if (!roomVacant.ok) {
                return NextResponse.json({ error: roomVacant.error, code: roomVacant.code }, { status: 409 });
            }
            const hkReady = await ensureHousekeepingReadyForCheckin(supabase, roomId, businessDate);
            if (!hkReady.ok) {
                return NextResponse.json({ error: hkReady.error }, { status: 409 });
            }
        }

        // Persist check-in timestamp/time on reservation
        const updateWithCheckedInAt = await supabase
            .from("reservations")
            .update({
                checked_in_at: checkedInAtIso,
                checkin_time: checkedInTime
            })
            .eq("id", reservationId);

        if (updateWithCheckedInAt.error && /checked_in_at/i.test(updateWithCheckedInAt.error.message)) {
            const fallback = await supabase
                .from("reservations")
                .update({
                    checkin_time: checkedInTime
                })
                .eq("id", reservationId);
            if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            }
        } else if (updateWithCheckedInAt.error) {
            return NextResponse.json({ error: updateWithCheckedInAt.error.message }, { status: 500 });
        }

        // Record folio_payment(s) if guest paid at check-in
        if (pendingPayments.length > 0) {
            const paidAt = new Date().toISOString();
            const paymentRows = pendingPayments.map((payment) => ({
                reservation_id: reservationId,
                tx_type: "payment",
                method: payment.method,
                amount: payment.amount,
                note: payment.note || "Paid at check-in",
                revenue_category: "room_revenue",
                cashier_name: "FO",
                paid_date: businessDate,
                paid_at: paidAt
            }));
            const { error: paymentInsertError } = await supabase
                .from("folio_payments")
                .insert(paymentRows);
            if (paymentInsertError) {
                return NextResponse.json({ error: paymentInsertError.message }, { status: 500 });
            }
        }

        if (policyFee) {
            const template = await fetchExtraFeeTemplate(supabase, policyFee.fee_template_code);
            if (!template || !template.is_active) {
                return NextResponse.json({ error: "EARLY_CHECKIN_FEE template is not available." }, { status: 409 });
            }
            await insertExtraFeePayment(supabase, {
                reservationId,
                feeTemplateCode: template.code,
                amount: policyFee.amount,
                method: policyFee.method!,
                note: policyFee.note || `Early check-in ${checkedInTime}`,
                paidAt: checkedInAtIso,
                paidDate: businessDate,
            });
        }

        // Promote draft profile on successful check-in, but do not increment stay counters here.
        // Loyalty counters are updated only at checkout.
        const profileBefore = {
            profile_status: profile.profile_status ?? null,
        };
        const currentProfileStatus = String(profile.profile_status ?? "").trim();
        const isAlreadyVerified = currentProfileStatus === "verified";
        const canPromoteToVerified =
            !isAlreadyVerified &&
            currentProfileStatus !== "merged" &&
            currentProfileStatus !== "blacklisted";
        const shouldAutoVerify = canPromoteToVerified;
        const profileUpdates: Record<string, unknown> = {};
        if (shouldAutoVerify) {
            profileUpdates.profile_status = "verified";
        } else if (!currentProfileStatus) {
            profileUpdates.profile_status = "draft";
        }
        const fallbackProfileStatus = shouldAutoVerify
            ? "verified"
            : (currentProfileStatus || "draft");
        let profileAfter: { id: string; profile_status: string | null } | null = null;
        if (Object.keys(profileUpdates).length > 0) {
            const profileUpdateResult = await supabase
                .from("guest_profiles")
                .update(profileUpdates)
                .eq("id", reservation.guest_profile_id)
                .select("id, profile_status")
                .maybeSingle();
            if (profileUpdateResult.error) {
                return NextResponse.json({ error: profileUpdateResult.error.message }, { status: 500 });
            }
            profileAfter = profileUpdateResult.data
                ? {
                    id: String((profileUpdateResult.data as any).id),
                    profile_status: (profileUpdateResult.data as any).profile_status ?? null,
                }
                : null;
        }

        try {
            await linkPrimaryGuestToReservation(supabase, reservationId, String(reservation.guest_profile_id));
        } catch (error) {
            if (error instanceof ReservationPartyError) {
                return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
            }
            return NextResponse.json({ error: (error as Error).message }, { status: 500 });
        }

        // Audit log
        const paymentTotalSatang = pendingPayments.reduce((sum, payment) => sum + toSatang(payment.amount), 0);
        const paymentTotal = fromSatang(paymentTotalSatang);
        const auditRows: Array<Record<string, unknown>> = [
            {
                action: "checked_in",
                entity_type: "reservation",
                entity_id: reservationId,
                after_json: {
                    guest_name: reservation.guest_name,
                    checkin_date: reservation.checkin_date,
                    checked_in_at: checkedInAtIso,
                    payment_methods: pendingPayments.map((payment) => payment.method),
                    payment_count: pendingPayments.length,
                    payment_amount: paymentTotal || null,
                    policy_fee: policyFee ? {
                        code: policyFee.fee_template_code,
                        amount: policyFee.amount,
                        method: policyFee.method,
                        note: policyFee.note,
                    } : null,
                    guest_profile_id: reservation.guest_profile_id,
                }
            },
        ];

        if (shouldAutoVerify || !currentProfileStatus) {
            auditRows.push({
                action: shouldAutoVerify ? "guest_profile_auto_verified" : "guest_profile_status_ensured",
                entity_type: "guest_profile",
                entity_id: String(reservation.guest_profile_id),
                before_json: profileBefore,
                after_json: profileAfter ?? {
                    profile_status: fallbackProfileStatus,
                },
                change_reason: "checkin",
            });
        }

        await supabase.from("audit_logs").insert(
            auditRows.map((row) => ({
                ...row,
                business_date: businessDate,
                source: normalizeAuditSource("manual"),
            }))
        );

        try {
            await stampReservationPassportScanExpiry({
                supabase,
                reservationId,
            });
        } catch (stampError) {
            console.error("passport retention stamp failed", stampError);
        }

        try {
            await clearAssignedRoomLock({
                supabase: supabase as any,
                reservationId,
                actor: "FO",
                reason: "Auto-released at successful check-in",
                clearReason: "checkin_auto_release",
                appendNote: false,
            });
        } catch (error) {
            if (error instanceof AssignedRoomLockError) {
                return NextResponse.json({ error: error.message, reason_code: error.code }, { status: error.status });
            }
            return NextResponse.json({ error: (error as Error).message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: "Checked in successfully.",
            payment_recorded: pendingPayments.length > 0,
            payments_recorded: pendingPayments.length,
            payment_amount: paymentTotal,
            policy_fee_recorded: Boolean(policyFee),
            checked_in_at: checkedInAtIso,
            checkin_time: checkedInTime
        });
    } catch (err) {
        console.error("api/bookings/[id]/checkin POST failed", err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
