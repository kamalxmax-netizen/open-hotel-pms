import { getBusinessDate, MobileCheckinError, requireMobileCheckinAuth, toBangkokDate } from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function toBangkokDateFromIso(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { scanId: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireMobileCheckinAuth(supabase, request);

    const scanId = String(params.scanId ?? "").trim();
    if (!scanId) {
      throw new MobileCheckinError("Missing scan id.", 400, "MISSING_SCAN_ID");
    }

    const { data: scanRow, error: scanError } = await supabase
      .from("passport_scans")
      .select("id, reservation_id, image_path, ocr_parsed, created_at")
      .eq("id", scanId)
      .maybeSingle();

    if (scanError) {
      throw new MobileCheckinError(scanError.message, 500, "SCAN_READ_FAILED");
    }
    if (!scanRow) {
      throw new MobileCheckinError("Passport scan not found.", 404, "SCAN_NOT_FOUND");
    }

    if (auth.role !== "admin") {
      const businessDate = await getBusinessDate(supabase);
      const scanBangkokDate = toBangkokDateFromIso(String(scanRow.created_at ?? ""));
      if (!scanBangkokDate || scanBangkokDate < businessDate) {
        throw new MobileCheckinError("ไม่สามารถดูรูปได้หลัง Night Audit ติดต่อ Admin", 403, "PDPA_RESTRICTED");
      }
    }

    const objectPath = String(scanRow.image_path ?? "").trim();
    if (!objectPath) {
      throw new MobileCheckinError("Invalid passport image path.", 500, "INVALID_IMAGE_PATH");
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from("passport-photos")
      .createSignedUrl(objectPath, 300);

    if (signedError || !signed?.signedUrl) {
      throw new MobileCheckinError(signedError?.message ?? "Unable to generate signed URL.", 500, "SIGNED_URL_FAILED");
    }

    return NextResponse.json({
      success: true,
      data: {
        url: signed.signedUrl,
        ocr_parsed: scanRow.ocr_parsed ?? null,
        created_at: scanRow.created_at,
        reservation_id: scanRow.reservation_id,
        server_date: toBangkokDate(),
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
