import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import { resolveGuestProfile } from "@/lib/guest-resolution";
import { MobileCheckinError } from "@/lib/mobile-checkin";
import { getCountryByCode, normalizeNationalityCode } from "@/lib/nationality-map";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ParsedPassportMrz } from "@/lib/passport-ocr/mrz";
import type { NextRequest } from "next/server";

type SupabaseClientLike = ReturnType<typeof createServerSupabaseClient>;

const DESKTOP_ALLOWED_ROLES = new Set(["admin", "frontdesk", "supervisor"]);

export type GroupOcrIdentity = {
  first_name: string | null;
  last_name: string | null;
  passport_no: string;
  nationality_code: string | null;
  gender: "M" | "F" | "Other" | null;
  dob: string | null;
};

function nonEmpty(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePassport(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeGender(value: unknown): "M" | "F" | "Other" | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "M" || raw === "MALE" || raw === "1" || raw === "ชาย") return "M";
  if (raw === "F" || raw === "FEMALE" || raw === "2" || raw === "หญิง") return "F";
  if (raw === "X" || raw === "OTHER" || raw === "3") return "Other";
  return null;
}

export function normalizeIsoDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;

  return null;
}

export function normalizeScanOrder(value: unknown, fallback = Date.now()): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export function resolveFileExtension(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  return "jpg";
}

export function getDisplayNameFromProfile(profile: Record<string, unknown>): string {
  const first = String(profile.first_name ?? "").trim();
  const last = String(profile.last_name ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const memberNo = String(profile.member_no ?? "").trim();
  if (memberNo) return `Member ${memberNo}`;
  return String(profile.id ?? "Unknown Guest");
}

export function extractIdentityFromMrz(parsed: ParsedPassportMrz | null): GroupOcrIdentity | null {
  if (!parsed) return null;
  const passportNo = normalizePassport(parsed.passportNumber ?? "");
  if (!passportNo) return null;

  return {
    first_name: nonEmpty(parsed.firstName),
    last_name: nonEmpty(parsed.familyName),
    passport_no: passportNo,
    nationality_code: normalizeNationalityCode(nonEmpty(parsed.nationality) ?? null),
    gender: normalizeGender(parsed.gender),
    dob: normalizeIsoDate(parsed.dateOfBirth),
  };
}

export function extractIdentityFromManual(raw: Record<string, unknown>): GroupOcrIdentity | null {
  const passportNo = normalizePassport(raw.passport_no);
  if (!passportNo) return null;

  return {
    first_name: nonEmpty(raw.first_name),
    last_name: nonEmpty(raw.last_name),
    passport_no: passportNo,
    nationality_code: normalizeNationalityCode(nonEmpty(raw.nationality) ?? null),
    gender: normalizeGender(raw.gender),
    dob: normalizeIsoDate(raw.date_of_birth),
  };
}

async function loadProfileById(supabase: SupabaseClientLike, id: string) {
  const { data, error } = await supabase
    .from("guest_profiles")
    .select(
      "id, first_name, last_name, phone, member_no, profile_status, nationality_code, country, province, address, gender, dob, id_type, id_number, id_card_number, passport_no"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new MobileCheckinError(error.message, 500, "PROFILE_READ_FAILED");
  }
  return data;
}

function buildProfileIdentityPatch(identity: GroupOcrIdentity, profile: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (identity.first_name && !nonEmpty(profile.first_name)) {
    patch.first_name = identity.first_name;
  }
  if (identity.last_name && !nonEmpty(profile.last_name)) {
    patch.last_name = identity.last_name;
  }

  if (identity.gender && !nonEmpty(profile.gender)) {
    patch.gender = identity.gender;
  }
  if (identity.dob && !nonEmpty(profile.dob)) {
    patch.dob = identity.dob;
  }

  if (identity.passport_no) {
    if (!nonEmpty(profile.id_type)) patch.id_type = "passport";
    if (!nonEmpty(profile.id_number)) patch.id_number = identity.passport_no;
    if (!nonEmpty(profile.passport_no)) patch.passport_no = identity.passport_no;
  }

  if (identity.nationality_code && !nonEmpty(profile.nationality_code)) {
    patch.nationality_code = identity.nationality_code;
    patch.country = getCountryByCode(identity.nationality_code) || null;
  }

  return patch;
}

export async function resolveAndHydrateGuestProfile(
  supabase: SupabaseClientLike,
  identity: GroupOcrIdentity
): Promise<Record<string, unknown>> {
  const resolution = await resolveGuestProfile(supabase, {
    first_name: identity.first_name,
    last_name: identity.last_name,
    nationality_code: identity.nationality_code,
    id_type: "passport",
    id_number: identity.passport_no,
    profile_status: "draft",
  });

  const resolvedProfileId = String(resolution.profile?.id ?? "");
  if (!resolvedProfileId) {
    throw new MobileCheckinError(
      "Failed to resolve guest profile for OCR identity.",
      500,
      "PROFILE_RESOLVE_FAILED"
    );
  }

  let profile = await loadProfileById(supabase, resolvedProfileId);
  if (!profile) {
    throw new MobileCheckinError("Guest profile not found.", 404, "PROFILE_NOT_FOUND");
  }

  const identityPatch = buildProfileIdentityPatch(identity, profile as Record<string, unknown>);
  if (Object.keys(identityPatch).length > 0) {
    const { error: patchError } = await supabase
      .from("guest_profiles")
      .update(identityPatch)
      .eq("id", resolvedProfileId);
    if (patchError) {
      throw new MobileCheckinError(patchError.message, 500, "PROFILE_PATCH_FAILED");
    }

    profile = await loadProfileById(supabase, resolvedProfileId);
    if (!profile) {
      throw new MobileCheckinError("Guest profile not found after patch.", 404, "PROFILE_NOT_FOUND");
    }
  }

  const completeness = checkProfileCompleteness(profile as Record<string, unknown>);
  if (completeness.is_complete && String(profile.profile_status ?? "draft") === "draft") {
    const { error: promoteError } = await supabase
      .from("guest_profiles")
      .update({ profile_status: "verified" })
      .eq("id", resolvedProfileId);

    if (promoteError) {
      throw new MobileCheckinError(promoteError.message, 500, "PROFILE_PROMOTE_FAILED");
    }

    profile = await loadProfileById(supabase, resolvedProfileId);
    if (!profile) {
      throw new MobileCheckinError("Guest profile not found after promotion.", 404, "PROFILE_NOT_FOUND");
    }
  }

  return profile as Record<string, unknown>;
}

export async function requireDesktopGroupOcrAuth(
  supabase: SupabaseClientLike,
  request: NextRequest
): Promise<{ userId: string; role: "admin" | "frontdesk" | "supervisor" }> {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    throw new MobileCheckinError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const roleValue = await getUserRole(supabase, user.id);
  const role = String(roleValue ?? "").toLowerCase();
  if (!DESKTOP_ALLOWED_ROLES.has(role)) {
    throw new MobileCheckinError("Forbidden", 403, "FORBIDDEN");
  }

  return {
    userId: user.id,
    role: role as "admin" | "frontdesk" | "supervisor",
  };
}

export function toPoolEntry(params: {
  profile: Record<string, unknown>;
  source?: "passport_ocr";
  scanOrder: number;
}) {
  const profile = params.profile;

  return {
    guest_profile_id: String(profile.id),
    display_name: getDisplayNameFromProfile(profile),
    first_name: profile.first_name ? String(profile.first_name) : null,
    last_name: profile.last_name ? String(profile.last_name) : null,
    nationality_code: profile.nationality_code ? String(profile.nationality_code) : null,
    passport_no: profile.passport_no
      ? String(profile.passport_no)
      : profile.id_number
        ? String(profile.id_number)
        : null,
    gender: profile.gender ? String(profile.gender) : null,
    dob: profile.dob ? String(profile.dob) : null,
    profile_status: profile.profile_status ? String(profile.profile_status) : null,
    source: params.source ?? "passport_ocr",
    scan_order: params.scanOrder,
  };
}

export function extractScanOrderFromOcrRaw(
  ocrRaw: unknown,
  fallback: number
): number {
  if (!ocrRaw || typeof ocrRaw !== "object") return fallback;
  return normalizeScanOrder((ocrRaw as Record<string, unknown>).scan_order, fallback);
}
