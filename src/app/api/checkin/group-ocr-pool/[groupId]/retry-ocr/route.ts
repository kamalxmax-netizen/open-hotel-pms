import {
  extractIdentityFromManual,
  extractIdentityFromMrz,
  extractScanOrderFromOcrRaw,
  requireDesktopGroupOcrAuth,
  resolveAndHydrateGuestProfile,
  toPoolEntry,
} from "@/lib/group-ocr";
import { MobileCheckinError } from "@/lib/mobile-checkin";
import { parsePassportMrz } from "@/lib/passport-ocr/mrz";
import { detectPassportTextFromBuffer } from "@/lib/passport-ocr/vision";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const bodySchema = z.object({
  scan_id: z.string().min(1),
  mode: z.enum(["re_ocr", "manual"]),
  manual_data: z.record(z.any()).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  try {
    const supabase = createServerSupabaseClient();
    await requireDesktopGroupOcrAuth(supabase, request);

    const { groupId } = await context.params;
    const normalizedGroupId = String(groupId ?? "").trim();
    if (!normalizedGroupId) {
      throw new MobileCheckinError("Missing group id.", 400, "GROUP_ID_REQUIRED");
    }

    const { data: group, error: groupError } = await supabase
      .from("booking_groups")
      .select("id")
      .eq("id", normalizedGroupId)
      .maybeSingle();

    if (groupError) {
      throw new MobileCheckinError(groupError.message, 500, "GROUP_READ_FAILED");
    }
    if (!group) {
      throw new MobileCheckinError("Group not found.", 404, "GROUP_NOT_FOUND");
    }

    const json = await request.json().catch(() => null);
    const parsedBody = bodySchema.safeParse(json);
    if (!parsedBody.success) {
      throw new MobileCheckinError("Invalid payload.", 400, "INVALID_PAYLOAD");
    }

    const { scan_id: scanId, mode, manual_data } = parsedBody.data;

    const { data: scanRow, error: scanError } = await supabase
      .from("passport_scans")
      .select("id, booking_group_id, guest_profile_id, image_path, ocr_raw, ocr_parsed, pool_status")
      .eq("id", scanId)
      .eq("booking_group_id", normalizedGroupId)
      .not("pool_status", "is", null)
      .maybeSingle();

    if (scanError) {
      throw new MobileCheckinError(scanError.message, 500, "SCAN_READ_FAILED");
    }
    if (!scanRow) {
      throw new MobileCheckinError("Scan not found in this group.", 404, "SCAN_NOT_FOUND");
    }

    const scanOrder = extractScanOrderFromOcrRaw((scanRow as any).ocr_raw, Date.now());

    if (mode === "manual") {
      const identity = extractIdentityFromManual((manual_data ?? {}) as Record<string, unknown>);
      if (!identity) {
        throw new MobileCheckinError(
          "manual_data must include passport_no.",
          400,
          "MANUAL_DATA_INVALID"
        );
      }

      const profile = await resolveAndHydrateGuestProfile(supabase, identity);
      const entry = toPoolEntry({ profile, source: "passport_ocr", scanOrder });

      const manualParsed = {
        firstName: identity.first_name,
        familyName: identity.last_name,
        nationality: identity.nationality_code,
        passportNumber: identity.passport_no,
        gender: identity.gender,
        dateOfBirth: identity.dob,
        source: "manual_entry",
      };

      const { error: updateError } = await supabase
        .from("passport_scans")
        .update({
          guest_profile_id: String(profile.id),
          ocr_parsed: manualParsed,
          pool_status: "ready",
        })
        .eq("id", scanId);

      if (updateError) {
        throw new MobileCheckinError(updateError.message, 500, "SCAN_UPDATE_FAILED");
      }

      return NextResponse.json({
        success: true,
        scan_id: scanId,
        ocr_success: true,
        pool_status: "ready",
        entry,
        warnings: [],
      });
    }

    const imagePath = String((scanRow as any).image_path ?? "").trim();
    if (!imagePath) {
      throw new MobileCheckinError("Scan image path is missing.", 400, "MISSING_IMAGE_PATH");
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("passport-photos")
      .download(imagePath);

    if (downloadError || !blob) {
      throw new MobileCheckinError(
        downloadError?.message || "Unable to download passport image.",
        500,
        "IMAGE_DOWNLOAD_FAILED"
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const warnings: string[] = [];

    let rawText = "";
    let parsedMrz: ReturnType<typeof parsePassportMrz> | null = null;
    let poolStatus: "ready" | "ocr_failed" = "ocr_failed";
    let ocrSuccess = false;
    let entry: ReturnType<typeof toPoolEntry> | null = null;
    let guestProfileId: string | null = null;

    try {
      rawText = await detectPassportTextFromBuffer(buffer);
      parsedMrz = parsePassportMrz(rawText);

      if (!parsedMrz) {
        warnings.push("MRZ not detected. Photo saved for manual entry.");
      } else {
        const identity = extractIdentityFromMrz(parsedMrz);
        if (!identity) {
          warnings.push("Passport number missing from OCR result. Photo saved for manual entry.");
        } else {
          const profile = await resolveAndHydrateGuestProfile(supabase, identity);
          guestProfileId = String(profile.id ?? "");
          entry = toPoolEntry({ profile, source: "passport_ocr", scanOrder });
          poolStatus = "ready";
          ocrSuccess = true;
        }

        if (Array.isArray(parsedMrz.warnings) && parsedMrz.warnings.length > 0) {
          warnings.push(...parsedMrz.warnings.map((value) => String(value)));
        }
      }
    } catch (ocrError) {
      warnings.push(
        ocrError instanceof Error
          ? `OCR processing failed: ${ocrError.message}`
          : "OCR processing failed. Photo saved for manual entry."
      );
    }

    const { error: updateError } = await supabase
      .from("passport_scans")
      .update({
        guest_profile_id: guestProfileId,
        ocr_raw: {
          ...(typeof (scanRow as any).ocr_raw === "object" && (scanRow as any).ocr_raw !== null
            ? (scanRow as any).ocr_raw
            : {}),
          raw_text: rawText,
          content_type: blob.type || "image/jpeg",
          size: buffer.length,
          scan_order: scanOrder,
        },
        ocr_parsed: parsedMrz,
        pool_status: poolStatus,
      })
      .eq("id", scanId);

    if (updateError) {
      throw new MobileCheckinError(updateError.message, 500, "SCAN_UPDATE_FAILED");
    }

    return NextResponse.json({
      success: true,
      scan_id: scanId,
      ocr_success: ocrSuccess,
      pool_status: poolStatus,
      entry,
      warnings,
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
