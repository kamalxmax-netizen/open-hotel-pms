import {
  applyCheckinFinancials,
  fetchProfileCompleteness,
  getBusinessDate,
  insertCheckinAudit,
  levenshteinRatioPercent,
  mapCheckinPaymentMethod,
  MobileAccompanyingInput,
  MobileCheckinError,
  MobileGuestInfoInput,
  requireMobileCheckinAuth,
  resolvePrimaryGuestProfile,
  syncAccompanyingGuests,
  toBangkokTimeHHmm,
} from "@/lib/mobile-checkin";
import { linkPrimaryGuestToReservation, ReservationPartyError } from "@/lib/reservation-party";
import { stampReservationPassportScanExpiry } from "@/lib/passport-scan-retention";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const guestInfoSchema = z.object({
  full_name: z.string().default(""),
  passport_no: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
});

const accompanyingSchema = z.object({
  full_name: z.string().default(""),
  passport_no: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  source: z.enum(["ocr", "manual"]).optional().nullable(),
});

const bodySchema = z.object({
  reservation_id: z.string().uuid(),
  selected_profile_id: z.string().uuid().optional().nullable(),
  guest_info: guestInfoSchema,
  accompanying_guests: z.array(accompanyingSchema).optional().default([]),
  payment_method: z.string().optional(),
  payment_amount: z.number().optional(),
  deposit_method: z.string().optional(),
  deposit_amount: z.number().optional(),
  scan_id: z.string().uuid().optional(),
  force_draft: z.boolean().optional().default(false),
  cashier_name: z.string().optional(),
  booking_name_note: z.string().optional().nullable(),
});

const BOOKED_NAME_NOTE_PREFIX = "จองมาในชื่อ ";

function buildUpsertedBookingNameNote(params: {
  existingNote: unknown;
  bookingNameNote: unknown;
  originalReservationName: string;
  effectiveGuestName: string;
}): string | null {
  const existingNote = String(params.existingNote ?? "").trim();
  const explicitNoteRaw = String(params.bookingNameNote ?? "").trim();
  const hasPrefix = explicitNoteRaw.startsWith(BOOKED_NAME_NOTE_PREFIX);
  let nextBookedNameLine = explicitNoteRaw;

  if (explicitNoteRaw && !hasPrefix) {
    nextBookedNameLine = `${BOOKED_NAME_NOTE_PREFIX}${explicitNoteRaw}`.trim();
  }

  if (!nextBookedNameLine) {
    const original = String(params.originalReservationName ?? "").trim();
    const current = String(params.effectiveGuestName ?? "").trim();
    if (original && current && original.toLowerCase() !== current.toLowerCase()) {
      nextBookedNameLine = `${BOOKED_NAME_NOTE_PREFIX}${original}`;
    }
  }

  const retained = existingNote
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith(BOOKED_NAME_NOTE_PREFIX.trim()));

  if (nextBookedNameLine) {
    retained.push(nextBookedNameLine);
  }

  const merged = retained.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return merged || null;
}

function buildReservationImagePath(reservationId: string, currentPath: string): string {
  const rawName = String(currentPath || "").split("/").pop() || `scan_${Date.now()}.jpg`;
  const fileName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${reservationId}/${fileName}`;
}

async function moveScanImageToReservationFolder(params: {
  supabase: any;
  scanId: string;
  reservationId: string;
  imagePath: string | null;
}): Promise<void> {
  const { supabase, scanId, reservationId, imagePath } = params;
  const fromPath = String(imagePath ?? "").trim();
  if (!fromPath || !fromPath.startsWith("unmatched/")) return;

  const toPath = buildReservationImagePath(reservationId, fromPath);
  if (toPath === fromPath) return;

  const { error: copyError } = await supabase.storage
    .from("passport-photos")
    .copy(fromPath, toPath);
  if (copyError) return;

  await supabase.storage.from("passport-photos").remove([fromPath]);
  await supabase.from("passport_scans").update({ image_path: toPath }).eq("id", scanId);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireMobileCheckinAuth(supabase, request);

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new MobileCheckinError("Invalid payload.", 400, "INVALID_PAYLOAD");
    }

    const payload = parsed.data;
    const businessDate = await getBusinessDate(supabase);

    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("id, booking_code, guest_name, guest_profile_id, status, checked_in_at, checkin_time, note")
      .eq("id", payload.reservation_id)
      .maybeSingle();

    if (reservationError) {
      throw new MobileCheckinError(reservationError.message, 500, "RESERVATION_READ_FAILED");
    }
    if (!reservation) {
      throw new MobileCheckinError("Reservation not found.", 404, "RESERVATION_NOT_FOUND");
    }

    const reservationStatus = String(reservation.status ?? "active");
    if (reservationStatus !== "active" && reservationStatus !== "draft_checkin") {
      throw new MobileCheckinError("Reservation is not eligible for check-in.", 409, "RESERVATION_STATUS_BLOCKED");
    }
    if (reservation.checked_in_at) {
      throw new MobileCheckinError("Reservation is already checked in.", 409, "ALREADY_CHECKED_IN");
    }
    const reservationGuestName = String(reservation.guest_name ?? "").trim();

    // NOTE: this value comes from passport_scans.match_confidence and is
    // a name-match ratio (Levenshtein 0-100), not MRZ/OCR extraction quality.
    let scanNameMatchConfidence: number | null = null;
    let scanParsed: Record<string, unknown> | null = null;
    let scanImagePath: string | null = null;

    if (payload.scan_id) {
      const { data: scanRow, error: scanError } = await supabase
        .from("passport_scans")
        .select("id, reservation_id, ocr_parsed, match_confidence, image_path")
        .eq("id", payload.scan_id)
        .maybeSingle();

      if (scanError) {
        throw new MobileCheckinError(scanError.message, 500, "SCAN_READ_FAILED");
      }
      if (!scanRow) {
        throw new MobileCheckinError("Passport scan not found.", 404, "SCAN_NOT_FOUND");
      }

      scanImagePath = String(scanRow.image_path ?? "").trim() || null;
      const rawConfidence = scanRow.match_confidence;
      scanNameMatchConfidence = rawConfidence == null ? null : Number(rawConfidence);
      if (scanNameMatchConfidence != null && !Number.isFinite(scanNameMatchConfidence)) {
        scanNameMatchConfidence = null;
      }
      scanParsed = (scanRow.ocr_parsed as Record<string, unknown> | null) ?? null;

      if (scanNameMatchConfidence == null && scanParsed) {
        const first = String(scanParsed.firstName ?? "").trim();
        const family = String(scanParsed.familyName ?? "").trim();
        const parsedName = `${first} ${family}`.trim();
        if (parsedName && reservationGuestName) {
          scanNameMatchConfidence = levenshteinRatioPercent(parsedName, reservationGuestName);
        }
      }
    }

    const scanBelowThreshold = payload.scan_id
      ? scanNameMatchConfidence == null || scanNameMatchConfidence < 80
      : false;

    const guestInfoInput = payload.guest_info as MobileGuestInfoInput;
    // Always use OCR/form name — booking name goes to booking_name_note
    const effectiveName = guestInfoInput.full_name || reservationGuestName || "Unknown Guest";
    const nextReservationNote = buildUpsertedBookingNameNote({
      existingNote: (reservation as any)?.note ?? null,
      bookingNameNote: payload.booking_name_note ?? null,
      originalReservationName: reservationGuestName,
      effectiveGuestName: effectiveName,
    });

    const resolvedPrimary = await resolvePrimaryGuestProfile({
      supabase,
      reservationId: payload.reservation_id,
      preferredGuestProfileId: payload.selected_profile_id ?? null,
      existingGuestProfileId: reservation.guest_profile_id ? String(reservation.guest_profile_id) : null,
      guestInfo: {
        ...guestInfoInput,
        full_name: effectiveName,
      },
      passportRaw: scanParsed,
    });

    await linkPrimaryGuestToReservation(supabase as any, payload.reservation_id, resolvedPrimary.guestProfileId);

    const accompanying = (payload.accompanying_guests ?? []).slice(0, 3) as MobileAccompanyingInput[];
    await syncAccompanyingGuests({
      supabase,
      reservationId: payload.reservation_id,
      primaryGuestProfileId: resolvedPrimary.guestProfileId,
      accompanyingGuests: accompanying,
    });

    const completeness = await fetchProfileCompleteness(supabase, resolvedPrimary.guestProfileId);
    const isDraft = Boolean(payload.force_draft || scanBelowThreshold);
    const existingCheckinTime = String((reservation as any)?.checkin_time ?? "").trim();
    const draftCapturedCheckinTime = existingCheckinTime || toBangkokTimeHHmm(new Date());

    // Mobile check-in only saves guest data — FO does actual C/I from desktop.
    // No checked_in_at stamp here.

    const beforeJson = {
      status: reservationStatus,
      checked_in_at: reservation.checked_in_at ?? null,
      guest_profile_id: reservation.guest_profile_id ?? null,
    };

    const reservationUpdatePayload: Record<string, unknown> = {
      status: "active",
      guest_name: effectiveName,
      guest_profile_id: resolvedPrimary.guestProfileId,
      note: nextReservationNote,
    };
    if (isDraft) {
      // Capture arrival/check-in attempt time for draft without marking as in-house.
      reservationUpdatePayload.checkin_time = draftCapturedCheckinTime;
    }

    const { error: reservationUpdateError } = await supabase
      .from("reservations")
      .update(reservationUpdatePayload)
      .eq("id", payload.reservation_id);

    if (reservationUpdateError) {
      throw new MobileCheckinError(reservationUpdateError.message, 500, "RESERVATION_UPDATE_FAILED");
    }

    if (payload.scan_id) {
      const { error: scanUpdateError } = await supabase
        .from("passport_scans")
        .update({
          reservation_id: payload.reservation_id,
          matched_reservation_id: payload.reservation_id,
          match_confidence: scanNameMatchConfidence,
        })
        .eq("id", payload.scan_id);

      if (scanUpdateError) {
        throw new MobileCheckinError(scanUpdateError.message, 500, "SCAN_LINK_FAILED");
      }

      await moveScanImageToReservationFolder({
        supabase,
        scanId: payload.scan_id,
        reservationId: payload.reservation_id,
        imagePath: scanImagePath,
      });
    }

    try {
      await stampReservationPassportScanExpiry({
        supabase,
        reservationId: payload.reservation_id,
      });
    } catch (stampError) {
      throw new MobileCheckinError(
        stampError instanceof Error ? stampError.message : "Failed to stamp passport scan retention.",
        500,
        "PASSPORT_RETENTION_STAMP_FAILED"
      );
    }

    const paymentMethod = mapCheckinPaymentMethod(payload.payment_method);
    const depositMethod = mapCheckinPaymentMethod(payload.deposit_method) ?? paymentMethod;
    const paymentAmount = Number(payload.payment_amount ?? 0);
    const depositAmount = Number(payload.deposit_amount ?? 0);
    if ((Number.isFinite(paymentAmount) && paymentAmount > 0) || (Number.isFinite(depositAmount) && depositAmount > 0)) {
      await applyCheckinFinancials({
        supabase,
        reservationId: payload.reservation_id,
        method: paymentMethod,
        depositMethod,
        paymentAmount,
        depositAmount,
        cashierName: payload.cashier_name,
        businessDate,
      });
    }

    await insertCheckinAudit({
      supabase,
      actorUserId: auth.userId,
      reservationId: payload.reservation_id,
      action: "mobile_data_saved",
      businessDate,
      beforeJson,
      afterJson: {
        status: "active",
        checked_in_at: null,
        guest_profile_id: resolvedPrimary.guestProfileId,
        is_draft: isDraft,
        checkin_time: isDraft ? draftCapturedCheckinTime : existingCheckinTime || null,
        scan_confidence: scanNameMatchConfidence,
        missing_fields: completeness.missing_fields,
      },
      note: [
        "Mobile check-in data saved (FO must complete C/I from desktop).",
        payload.booking_name_note || "",
      ].filter(Boolean).join(" "),
    });

    return NextResponse.json({
      success: true,
      data: {
        reservation_id: payload.reservation_id,
        status: "active",
        is_draft: isDraft,
        profile_complete: completeness.is_complete,
        missing_fields: completeness.missing_fields,
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

    if (error instanceof ReservationPartyError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
