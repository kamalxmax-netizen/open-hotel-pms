import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import {
  MobileCheckinError,
  getBusinessDate,
  requireMobileCheckinAuth,
  toBangkokDate,
} from "@/lib/mobile-checkin";
import { ensureReservationRoomReadyForMobileCheckin } from "@/lib/mobile-checkin-room-readiness";
import {
  buildPaymentReportVoidedIdSet,
  normalizePaymentReportCategory,
  normalizePaymentReportTxType,
  round2,
  type PaymentReportRow,
} from "@/lib/payment-reporting";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function daysBetween(checkinDate: string, checkoutDate: string): number {
  const inTs = Date.parse(`${checkinDate}T00:00:00Z`);
  const outTs = Date.parse(`${checkoutDate}T00:00:00Z`);
  if (!Number.isFinite(inTs) || !Number.isFinite(outTs)) return 0;
  const nights = Math.round((outTs - inTs) / (24 * 60 * 60 * 1000));
  return Math.max(0, nights);
}

function toSortableRoom(roomNumber: string | null): string {
  return String(roomNumber ?? "").trim();
}

function buildRoomPaymentPaidByReservation(rows: PaymentReportRow[]): Map<string, number> {
  const voidedIds = buildPaymentReportVoidedIdSet(rows);
  const paidByReservation = new Map<string, number>();

  for (const row of rows) {
    const id = String(row.id ?? "").trim();
    const reservationId = String(row.reservation_id ?? "").trim();
    if (!reservationId) continue;
    if (id && voidedIds.has(id)) continue;
    if (row.is_void_reversal === true) continue;
    if (row.is_record_only === true) continue;

    const txType = normalizePaymentReportTxType(row.tx_type);
    const category = normalizePaymentReportCategory(row.revenue_category, txType, row.note);
    if (category !== "room_revenue") continue;
    if (txType !== "payment" && txType !== "refund") continue;

    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const signedAmount = txType === "refund" ? -amount : amount;
    paidByReservation.set(reservationId, round2((paidByReservation.get(reservationId) ?? 0) + signedAmount));
  }

  return paidByReservation;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const businessDate = await getBusinessDate(supabase);

    const { data: dueRows, error: dueError } = await supabase
      .from("reservations")
      .select("id, guest_name, source, checkin_date, checkout_date, total_price, status, guest_profile_id, checked_in_at")
      .eq("checkin_date", businessDate)
      .in("status", ["active", "draft_checkin"])
      .is("checked_in_at", null)
      .order("id", { ascending: true });

    if (dueError) {
      throw new MobileCheckinError(dueError.message, 500, "DUE_QUERY_FAILED");
    }

    const reservations = (dueRows ?? []).map((row: any) => ({
      reservation_id: String(row.id),
      guest_name: String(row.guest_name ?? "").trim(),
      source: String(row.source ?? "walkin"),
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Number(row.total_price ?? 0),
      reservation_status: String(row.status ?? "active"),
      guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
    }));

    const reservationIds = reservations.map((row) => row.reservation_id);
    const roomPaidByReservation = new Map<string, number>();

    if (reservationIds.length > 0) {
      const { data: paymentRows, error: paymentError } = await supabase
        .from("folio_payments")
        .select("id, reservation_id, tx_type, amount, note, revenue_category, is_record_only, is_void_reversal, void_of")
        .in("reservation_id", reservationIds);

      if (paymentError) {
        throw new MobileCheckinError(paymentError.message, 500, "PAYMENT_BALANCE_QUERY_FAILED");
      }

      for (const [reservationId, paidAmount] of buildRoomPaymentPaidByReservation((paymentRows ?? []) as PaymentReportRow[])) {
        roomPaidByReservation.set(reservationId, Math.max(0, round2(paidAmount)));
      }
    }

    const roomByReservation = new Map<string, string | null>();
    if (reservationIds.length > 0) {
      const { data: nightRows, error: nightError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, room_id, rooms(room_number)")
        .in("reservation_id", reservationIds)
        .eq("stay_date", businessDate)
        .is("cancelled_at", null);

      if (nightError) {
        throw new MobileCheckinError(nightError.message, 500, "NIGHTS_QUERY_FAILED");
      }

      for (const row of nightRows ?? []) {
        const reservationId = String((row as any).reservation_id ?? "");
        if (!reservationId) continue;
        const roomRef = Array.isArray((row as any).rooms) ? (row as any).rooms[0] : (row as any).rooms;
        const roomNumber = roomRef?.room_number ? String(roomRef.room_number) : null;
        roomByReservation.set(reservationId, roomNumber);
      }
    }

    const scanByReservation = new Set<string>();
    if (reservationIds.length > 0) {
      const { data: scanRows, error: scanError } = await supabase
        .from("passport_scans")
        .select("reservation_id")
        .in("reservation_id", reservationIds);

      if (scanError) {
        throw new MobileCheckinError(scanError.message, 500, "SCAN_QUERY_FAILED");
      }

      for (const row of scanRows ?? []) {
        const id = String((row as any).reservation_id ?? "").trim();
        if (id) scanByReservation.add(id);
      }
    }

    const profileIds = Array.from(
      new Set(
        reservations
          .map((row) => row.guest_profile_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    const completenessByProfileId = new Map<string, { is_complete: boolean; missing_fields: string[] }>();
    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from("guest_profiles")
        .select("id, first_name, last_name, gender, nationality_code, id_type, id_number, country, province, phone")
        .in("id", profileIds);

      if (profileError) {
        throw new MobileCheckinError(profileError.message, 500, "PROFILE_QUERY_FAILED");
      }

      for (const profile of profileRows ?? []) {
        const profileId = String((profile as any).id ?? "");
        if (!profileId) continue;
        const completeness = checkProfileCompleteness(profile as Record<string, unknown>);
        completenessByProfileId.set(profileId, {
          is_complete: completeness.is_complete,
          missing_fields: completeness.missing_fields,
        });
      }
    }

    const draftReservationIds = new Set<string>();
    if (reservationIds.length > 0) {
      const { data: draftAuditRows, error: draftAuditError } = await supabase
        .from("audit_logs")
        .select("entity_id")
        .eq("entity_type", "reservation")
        .eq("action", "draft_checkin")
        .in("entity_id", reservationIds);

      if (draftAuditError) {
        throw new MobileCheckinError(draftAuditError.message, 500, "DRAFT_AUDIT_QUERY_FAILED");
      }

      for (const row of draftAuditRows ?? []) {
        const reservationId = String((row as any).entity_id ?? "").trim();
        if (reservationId) draftReservationIds.add(reservationId);
      }
    }

    const roomReadinessByReservationId = new Map<
      string,
      { room_number: string | null; hk_status: string | null; room_ready_for_checkin: boolean; room_ready_reason: string | null }
    >();
    await Promise.all(
      reservations.map(async (row) => {
        const readiness = await ensureReservationRoomReadyForMobileCheckin(
          supabase as any,
          row.reservation_id,
          businessDate,
          { autoApproveCleaned: false }
        );
        roomReadinessByReservationId.set(row.reservation_id, {
          room_number: readiness.room_number ?? roomByReservation.get(row.reservation_id) ?? null,
          hk_status: readiness.hk_status,
          room_ready_for_checkin: readiness.ok,
          room_ready_reason: readiness.ok ? null : readiness.draft_message,
        });
      })
    );

    const rooms = reservations
      .map((row) => {
        const completeness = row.guest_profile_id
          ? completenessByProfileId.get(row.guest_profile_id) ?? { is_complete: false, missing_fields: [] }
          : { is_complete: false, missing_fields: ["guest_profile_id"] };
        const reservationStatus = row.reservation_status;
        const roomTotal = round2(Number(row.total_price ?? 0));
        const roomPaid = Math.min(roomTotal, roomPaidByReservation.get(row.reservation_id) ?? 0);
        const roomBalance = Math.max(0, round2(roomTotal - roomPaid));
        const uiStatus = draftReservationIds.has(row.reservation_id)
          ? "draft_checkin"
          : reservationStatus === "active"
            ? "confirmed"
            : reservationStatus;
        const readiness = roomReadinessByReservationId.get(row.reservation_id);

        return {
          reservation_id: row.reservation_id,
          room_number: readiness?.room_number ?? roomByReservation.get(row.reservation_id) ?? null,
          guest_name: row.guest_name,
          source: row.source,
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          nights: daysBetween(row.checkin_date, row.checkout_date),
          total_price: roomTotal,
          room_paid_amount: roomPaid,
          room_balance_amount: roomBalance,
          status: uiStatus,
          reservation_status: reservationStatus,
          has_passport_scan: scanByReservation.has(row.reservation_id),
          profile_complete: completeness.is_complete,
          missing_fields: completeness.missing_fields,
          hk_status: readiness?.hk_status ?? null,
          room_ready_for_checkin: readiness?.room_ready_for_checkin ?? true,
          room_ready_reason: readiness?.room_ready_reason ?? null,
        };
      })
      .sort((a, b) =>
        toSortableRoom(a.room_number).localeCompare(toSortableRoom(b.room_number), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );

    // Optional: include in-house rooms (for Fill OCR feature)
    const includeInhouse = request.nextUrl.searchParams.get("include_inhouse") === "1";
    let inhouse: typeof rooms = [];

    if (includeInhouse) {
      const { data: inhouseRows, error: inhouseError } = await supabase
        .from("reservations")
        .select("id, guest_name, source, checkin_date, checkout_date, total_price, status, guest_profile_id, checked_in_at")
        .eq("status", "active")
        .not("checked_in_at", "is", null)
        .lte("checkin_date", businessDate)
        .gt("checkout_date", businessDate)
        .order("id", { ascending: true });

      if (!inhouseError && inhouseRows) {
        const inhouseIds = inhouseRows.map((row: any) => String(row.id));
        const inhouseRoomMap = new Map<string, string | null>();

        if (inhouseIds.length > 0) {
          const { data: inhouseNights } = await supabase
            .from("reservation_nights")
            .select("reservation_id, rooms(room_number)")
            .in("reservation_id", inhouseIds)
            .eq("stay_date", businessDate)
            .is("cancelled_at", null);

          for (const row of inhouseNights ?? []) {
            const rid = String((row as any).reservation_id ?? "");
            if (!rid || inhouseRoomMap.has(rid)) continue;
            const roomRef = Array.isArray((row as any).rooms) ? (row as any).rooms[0] : (row as any).rooms;
            inhouseRoomMap.set(rid, roomRef?.room_number ? String(roomRef.room_number) : null);
          }
        }

        inhouse = inhouseRows.map((row: any) => ({
          reservation_id: String(row.id),
          room_number: inhouseRoomMap.get(String(row.id)) ?? null,
          guest_name: String(row.guest_name ?? "").trim(),
          source: String(row.source ?? "walkin"),
          checkin_date: String(row.checkin_date ?? ""),
          checkout_date: String(row.checkout_date ?? ""),
          nights: daysBetween(String(row.checkin_date ?? ""), String(row.checkout_date ?? "")),
          total_price: Number(row.total_price ?? 0),
          room_paid_amount: 0,
          room_balance_amount: Number(row.total_price ?? 0),
          status: "in_house",
          reservation_status: "active",
          has_passport_scan: false,
          profile_complete: true,
          missing_fields: [] as string[],
          hk_status: null,
          room_ready_for_checkin: true,
          room_ready_reason: null,
        })).sort((a, b) =>
          toSortableRoom(a.room_number).localeCompare(toSortableRoom(b.room_number), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        business_date: businessDate,
        server_date: toBangkokDate(),
        rooms,
        ...(includeInhouse ? { inhouse } : {}),
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
