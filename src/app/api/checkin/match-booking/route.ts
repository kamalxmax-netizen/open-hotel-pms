import {
  getBusinessDate,
  isUuid,
  smartNameConfidence,
  MobileCheckinError,
  requireMobileCheckinAuth,
} from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  ocr_name: z.string().min(1),
  scan_id: z.string().optional(),
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function toSortableRoom(roomNumber: string | null): string {
  return String(roomNumber ?? "").trim();
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
    await requireMobileCheckinAuth(supabase, request);

    const payload = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!payload.success) {
      throw new MobileCheckinError("Invalid payload.", 400, "INVALID_PAYLOAD");
    }

    const scanId = String(payload.data.scan_id ?? "").trim();
    const businessDate = payload.data.business_date ?? (await getBusinessDate(supabase));

    const { data: dueRows, error: dueError } = await supabase
      .from("reservations")
      .select("id, guest_name, checkin_date, checkout_date, source, status")
      .eq("checkin_date", businessDate)
      .in("status", ["active", "draft_checkin"])
      .is("checked_in_at", null);

    if (dueError) {
      throw new MobileCheckinError(dueError.message, 500, "DUE_QUERY_FAILED");
    }

    const reservations = (dueRows ?? []).map((row: any) => ({
      reservation_id: String(row.id),
      guest_name: String(row.guest_name ?? "").trim(),
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      source: String(row.source ?? "walkin"),
      status: String(row.status ?? "active"),
    }));

    const reservationIds = reservations.map((row) => row.reservation_id);
    const roomByReservation = new Map<string, string | null>();

    if (reservationIds.length > 0) {
      const { data: nightRows, error: nightError } = await supabase
        .from("reservation_nights")
        .select("reservation_id, rooms(room_number)")
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

    const ocrName = payload.data.ocr_name;
    const matches = reservations
      .map((row) => ({
        reservation_id: row.reservation_id,
        guest_name: row.guest_name,
        room_number: roomByReservation.get(row.reservation_id) ?? null,
        checkin_date: row.checkin_date,
        checkout_date: row.checkout_date,
        source: row.source,
        confidence: smartNameConfidence(ocrName, row.guest_name),
      }))
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return toSortableRoom(a.room_number).localeCompare(toSortableRoom(b.room_number), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    const best = matches.length > 0 ? matches[0] : null;
    const autoMatched = Boolean(best && best.confidence >= 80);

    if (scanId && isUuid(scanId)) {
      // NOTE: match_confidence stores name-match ratio (smart multi-strategy 0-100),
      // not OCR/MRZ extraction quality.
      const { error: scanUpdateError } = await supabase
        .from("passport_scans")
        .update({
          matched_reservation_id: autoMatched ? best?.reservation_id ?? null : null,
          match_confidence: best?.confidence ?? null,
        })
        .eq("id", scanId);

      if (scanUpdateError) {
        throw new MobileCheckinError(scanUpdateError.message, 500, "SCAN_UPDATE_FAILED");
      }

      if (autoMatched && best?.reservation_id) {
        const { data: linkedScan, error: linkError } = await supabase
          .from("passport_scans")
          .update({
            reservation_id: best.reservation_id,
            matched_reservation_id: best.reservation_id,
          })
          .eq("id", scanId)
          .select("id, image_path")
          .maybeSingle();

        if (linkError) {
          throw new MobileCheckinError(linkError.message, 500, "SCAN_LINK_FAILED");
        }

        await moveScanImageToReservationFolder({
          supabase,
          scanId,
          reservationId: best.reservation_id,
          imagePath: linkedScan?.image_path ? String(linkedScan.image_path) : null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        matches,
        best_match: autoMatched && best
          ? {
              reservation_id: best.reservation_id,
              confidence: best.confidence,
            }
          : null,
        auto_matched: autoMatched,
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
