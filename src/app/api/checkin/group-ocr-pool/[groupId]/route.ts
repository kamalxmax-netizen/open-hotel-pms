import {
  extractScanOrderFromOcrRaw,
  getDisplayNameFromProfile,
  requireDesktopGroupOcrAuth,
} from "@/lib/group-ocr";
import { MobileCheckinError } from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const VALID_STATUS_FILTERS = new Set(["all", "ready", "ocr_failed", "assigned"]);

function normalizeStatusFilter(raw: string | null): "all" | "ready" | "ocr_failed" | "assigned" {
  const value = String(raw ?? "all").trim().toLowerCase();
  if (VALID_STATUS_FILTERS.has(value)) {
    return value as "all" | "ready" | "ocr_failed" | "assigned";
  }
  return "all";
}

function extractParsedField(ocrParsed: unknown, key: string): string | null {
  if (!ocrParsed || typeof ocrParsed !== "object") return null;
  const value = (ocrParsed as Record<string, unknown>)[key];
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export async function GET(
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
      .select("id, group_code, group_name, status")
      .eq("id", normalizedGroupId)
      .maybeSingle();

    if (groupError) {
      throw new MobileCheckinError(groupError.message, 500, "GROUP_READ_FAILED");
    }
    if (!group) {
      throw new MobileCheckinError("Group not found.", 404, "GROUP_NOT_FOUND");
    }

    const statusFilter = normalizeStatusFilter(request.nextUrl.searchParams.get("status"));

    let scanQuery = supabase
      .from("passport_scans")
      .select("id, booking_group_id, guest_profile_id, image_path, ocr_parsed, ocr_raw, pool_status, created_at")
      .eq("booking_group_id", normalizedGroupId)
      .not("pool_status", "is", null)
      .order("created_at", { ascending: true });

    if (statusFilter !== "all") {
      scanQuery = scanQuery.eq("pool_status", statusFilter);
    }

    const { data: scanRows, error: scanError } = await scanQuery;
    if (scanError) {
      throw new MobileCheckinError(scanError.message, 500, "POOL_READ_FAILED");
    }

    const scans = (scanRows ?? []).map((row: any) => ({
      scan_id: String(row.id ?? ""),
      guest_profile_id: row.guest_profile_id ? String(row.guest_profile_id) : null,
      image_path: row.image_path ? String(row.image_path) : null,
      ocr_parsed: row.ocr_parsed ?? null,
      ocr_raw: row.ocr_raw ?? null,
      pool_status: String(row.pool_status ?? "") as "ready" | "ocr_failed" | "assigned",
      created_at: row.created_at ? String(row.created_at) : null,
    })).filter((row) => row.scan_id);

    const profileIds = Array.from(
      new Set(
        scans
          .map((row) => row.guest_profile_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    const profileById = new Map<string, Record<string, unknown>>();
    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from("guest_profiles")
        .select("id, first_name, last_name, member_no, profile_status, nationality_code, passport_no, id_number, gender, dob")
        .in("id", profileIds);

      if (profileError) {
        throw new MobileCheckinError(profileError.message, 500, "PROFILE_READ_FAILED");
      }

      for (const row of profileRows ?? []) {
        const profileId = String((row as any).id ?? "").trim();
        if (!profileId) continue;
        profileById.set(profileId, row as Record<string, unknown>);
      }
    }

    const failedScansWithPath = scans.filter((scan) => scan.pool_status === "ocr_failed" && scan.image_path);
    const signedUrlByScanId = new Map<string, string | null>();

    await Promise.all(
      failedScansWithPath.map(async (scan) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from("passport-photos")
          .createSignedUrl(String(scan.image_path), 600);

        if (signedError || !signed?.signedUrl) {
          signedUrlByScanId.set(scan.scan_id, null);
          return;
        }

        signedUrlByScanId.set(scan.scan_id, signed.signedUrl);
      })
    );

    const pool = scans.map((scan, index) => {
      const profile = scan.guest_profile_id ? profileById.get(scan.guest_profile_id) : null;
      const scanOrder = extractScanOrderFromOcrRaw(scan.ocr_raw, index + 1);

      return {
        scan_id: scan.scan_id,
        pool_status: scan.pool_status,
        guest_profile_id: scan.guest_profile_id,
        display_name: profile
          ? getDisplayNameFromProfile(profile)
          : extractParsedField(scan.ocr_parsed, "firstName") || null,
        first_name: profile
          ? (profile.first_name ? String(profile.first_name) : null)
          : extractParsedField(scan.ocr_parsed, "firstName"),
        last_name: profile
          ? (profile.last_name ? String(profile.last_name) : null)
          : extractParsedField(scan.ocr_parsed, "familyName"),
        nationality_code: profile
          ? (profile.nationality_code ? String(profile.nationality_code) : null)
          : extractParsedField(scan.ocr_parsed, "nationality"),
        passport_no: profile
          ? (profile.passport_no ? String(profile.passport_no) : profile.id_number ? String(profile.id_number) : null)
          : extractParsedField(scan.ocr_parsed, "passportNumber"),
        gender: profile
          ? (profile.gender ? String(profile.gender) : null)
          : extractParsedField(scan.ocr_parsed, "gender"),
        source: "passport_ocr",
        scan_order: scanOrder,
        created_at: scan.created_at,
        image_path: scan.image_path,
        image_url: signedUrlByScanId.get(scan.scan_id) ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      group_id: String(group.id),
      group_name: String(group.group_name ?? ""),
      group_code: String(group.group_code ?? ""),
      total_scans: pool.length,
      pool,
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
