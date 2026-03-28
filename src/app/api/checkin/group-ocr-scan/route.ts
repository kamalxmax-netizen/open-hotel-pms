import {
  extractIdentityFromMrz,
  normalizeScanOrder,
  resolveAndHydrateGuestProfile,
  resolveFileExtension,
  toPoolEntry,
} from "@/lib/group-ocr";
import {
  getBusinessDate,
  MobileCheckinError,
  requireMobileCheckinAuth,
} from "@/lib/mobile-checkin";
import { parsePassportMrz } from "@/lib/passport-ocr/mrz";
import { detectPassportTextFromBuffer } from "@/lib/passport-ocr/vision";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const MAX_PASSPORT_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeGroupId(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireMobileCheckinAuth(supabase, request);

    const formData = await request.formData();
    const image = formData.get("image");
    if (!(image instanceof File)) {
      throw new MobileCheckinError("image is required.", 400, "IMAGE_REQUIRED");
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      throw new MobileCheckinError(
        "Unsupported image format. Allowed: jpeg, png, webp.",
        400,
        "IMAGE_TYPE_NOT_ALLOWED"
      );
    }

    const bookingGroupId = sanitizeGroupId(formData.get("booking_group_id"));
    if (!bookingGroupId) {
      throw new MobileCheckinError("booking_group_id is required.", 400, "GROUP_REQUIRED");
    }

    const scanOrder = normalizeScanOrder(formData.get("scan_order"), Date.now());

    const { data: group, error: groupError } = await supabase
      .from("booking_groups")
      .select("id, group_name, group_code, status")
      .eq("id", bookingGroupId)
      .maybeSingle();

    if (groupError) {
      throw new MobileCheckinError(groupError.message, 500, "GROUP_READ_FAILED");
    }
    if (!group || String(group.status ?? "") !== "active") {
      throw new MobileCheckinError("Group not found or inactive.", 404, "GROUP_NOT_FOUND");
    }

    const businessDate = await getBusinessDate(supabase);

    const { data: dueRows, error: dueError } = await supabase
      .from("reservations")
      .select("id")
      .eq("booking_group_id", bookingGroupId)
      .eq("checkin_date", businessDate)
      .in("status", ["active", "draft_checkin"])
      .is("checked_in_at", null)
      .limit(1);

    if (dueError) {
      throw new MobileCheckinError(dueError.message, 500, "DUE_IN_READ_FAILED");
    }
    if (!Array.isArray(dueRows) || dueRows.length === 0) {
      throw new MobileCheckinError(
        "No due-in rooms for this group on current business date.",
        404,
        "NO_DUE_IN_ROOMS"
      );
    }

    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.length <= 0) {
      throw new MobileCheckinError("Uploaded image is empty.", 400, "IMAGE_EMPTY");
    }
    if (buffer.length > MAX_PASSPORT_UPLOAD_BYTES) {
      throw new MobileCheckinError(
        "Passport image is too large. Maximum file size is 10MB.",
        400,
        "IMAGE_TOO_LARGE"
      );
    }

    const ext = resolveFileExtension(image.type || "image/jpeg");
    const objectPath = `groups/${bookingGroupId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("passport-photos")
      .upload(objectPath, buffer, {
        upsert: false,
        contentType: image.type || "image/jpeg",
      });

    if (uploadError) {
      throw new MobileCheckinError(uploadError.message, 500, "STORAGE_UPLOAD_FAILED");
    }

    let rawText = "";
    let parsedMrz: ReturnType<typeof parsePassportMrz> | null = null;
    let poolStatus: "ready" | "ocr_failed" = "ocr_failed";
    let ocrSuccess = false;
    const warnings: string[] = [];
    let guestProfileId: string | null = null;
    let entry: ReturnType<typeof toPoolEntry> | null = null;

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
          entry = toPoolEntry({
            profile,
            source: "passport_ocr",
            scanOrder,
          });
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

    const { data: scanRow, error: scanError } = await supabase
      .from("passport_scans")
      .insert({
        booking_group_id: bookingGroupId,
        guest_profile_id: guestProfileId,
        reservation_id: null,
        guest_index: 0,
        image_path: objectPath,
        ocr_raw: {
          raw_text: rawText,
          content_type: image.type || "image/jpeg",
          size: buffer.length,
          scan_order: scanOrder,
        },
        ocr_parsed: parsedMrz,
        match_confidence: null,
        matched_reservation_id: null,
        pool_status: poolStatus,
        created_by: auth.userId,
      })
      .select("id")
      .single();

    if (scanError) {
      throw new MobileCheckinError(scanError.message, 500, "SCAN_INSERT_FAILED");
    }

    return NextResponse.json({
      success: true,
      scan_id: String(scanRow.id),
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
