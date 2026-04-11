import { getCountryByCode, normalizeNationalityCode } from "@/lib/nationality-map";
import { checkProfileCompleteness } from "@/lib/guest-profile-completeness";
import { resolveGuestProfile } from "@/lib/guest-resolution";
import { getGroupById } from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  source: z.enum(["thai_id", "passport_ocr", "search"]),
  guest_profile_id: z.string().uuid().optional(),
  scan_order: z.number().int().positive().optional(),
  payload: z.record(z.any()).optional(),
});

function normalizeThaiId(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function normalizePassport(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeGender(value: unknown): "M" | "F" | "Other" | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "M" || raw === "MALE" || raw === "1") return "M";
  if (raw === "F" || raw === "FEMALE" || raw === "2") return "F";
  if (raw === "ชาย") return "M";
  if (raw === "หญิง") return "F";
  if (raw === "X" || raw === "OTHER" || raw === "3") return "Other";
  return null;
}

function nonEmpty(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const THAI_NAME_PREFIXES = [
  "ร้อยตำรวจเอก", "ร้อยตำรวจโท", "ร้อยตำรวจตรี",
  "พันตำรวจเอก", "พันตำรวจโท", "พันตำรวจตรี",
  "พลตำรวจเอก", "พลตำรวจโท", "พลตำรวจตรี", "พลตำรวจจัตวา",
  "ร้อยเอก", "ร้อยโท", "ร้อยตรี",
  "พันเอก", "พันโท", "พันตรี",
  "พลเอก", "พลโท", "พลตรี",
  "พล.ต.อ.", "พล.ต.ท.", "พล.ต.ต.", "พล.ต.จ.",
  "พ.ต.อ.", "พ.ต.ท.", "พ.ต.ต.",
  "ร.ต.อ.", "ร.ต.ท.", "ร.ต.ต.",
  "จ.ส.ต.", "ส.ต.อ.", "ส.ต.ท.", "ส.ต.ต.", "ด.ต.",
  "พลตอ", "พลตท", "พลตต", "พลตจ", "พตอ", "พตท", "พตต", "รตอ", "รตท", "รตต",
  "พล.อ.", "พล.ท.", "พล.ต.",
  "พ.อ.", "พ.ท.", "พ.ต.",
  "ร.อ.", "ร.ท.", "ร.ต.",
  "น.อ.", "น.ท.", "น.ต.",
  "จ.ส.อ.", "จ.ส.ท.", "จ.ส.ต.",
  "พ.อ.อ.", "พ.อ.ท.", "พ.อ.ต.",
  "ส.อ.", "ส.ท.", "ส.ต.",
  "จ.อ.", "จ.ท.", "จ.ต.",
  "น.ส.", "ด.ช.", "ด.ญ.", "นส", "ดช", "ดญ",
  "นาย", "นางสาว", "นาง", "เด็กชาย", "เด็กหญิง",
  "ดร.", "ศ.", "รศ.", "ผศ.", "นพ.", "พญ.",
];

const THAI_NAME_PREFIX_PATTERN = new RegExp(
  `^(?:${THAI_NAME_PREFIXES.sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?:\\s*หญิง)?(?:\\s+|$)`,
  "u"
);

function stripLeadingThaiNamePrefixes(value: string): string {
  let next = String(value || "").replace(/\s+/g, " ").trim();
  let previous = "";
  while (next && next !== previous) {
    previous = next;
    next = next.replace(THAI_NAME_PREFIX_PATTERN, "").trim();
  }
  return next;
}

function buildThaiCardNameParts(payload: Record<string, unknown>): { firstName: string | null; lastName: string | null } {
  const normalized = stripLeadingThaiNamePrefixes(
    [payload.titleTH, payload.firstNameTH, payload.lastNameTH].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ")
  );
  const parts = normalized.split(/\s+/u).filter(Boolean);
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function normalizeDob(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalizeYear = (year: number) => year >= 2400 ? year - 543 : year;
  const buildValidYmd = (rawYear: string, rawMonth: string, rawDay: string): string | null => {
    const year = normalizeYear(Number(rawYear));
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${candidate}T12:00:00`);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== day
    ) {
      return null;
    }
    return candidate;
  };

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return buildValidYmd(isoMatch[1], isoMatch[2], isoMatch[3]);

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return buildValidYmd(slashMatch[3], slashMatch[2], slashMatch[1]);

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const ymdCandidate = buildValidYmd(compactMatch[1], compactMatch[2], compactMatch[3]);
    if (ymdCandidate) return ymdCandidate;
  }

  const compactDmyMatch = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compactDmyMatch) return buildValidYmd(compactDmyMatch[3], compactDmyMatch[2], compactDmyMatch[1]);

  return null;
}

function normalizeThaiAddress(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/#/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function extractLastProvinceToken(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/#/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const withoutPostalCode = normalized.replace(/\s+\d{5}$/u, "").trim();
  if (!withoutPostalCode) return null;

  const tokens = withoutPostalCode.split(/\s+/u);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i]
      .replace(/^(จังหวัด|จ\.?)/u, "")
      .replace(/[,\-]/g, "")
      .trim();
    const thaiWord = token.replace(/[^ก-๙]/gu, "").trim();
    if (thaiWord) return thaiWord;
  }

  return null;
}

function extractThaiProvince(address: unknown, explicitProvince: unknown): string | null {
  return extractLastProvinceToken(address) ?? extractLastProvinceToken(explicitProvince);
}

function buildDisplayName(profile: Record<string, unknown>): string {
  const first = String(profile.first_name ?? "").trim();
  const last = String(profile.last_name ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const memberNo = String(profile.member_no ?? "").trim();
  if (memberNo) return `Member ${memberNo}`;
  return String(profile.id ?? "Unknown Guest");
}

async function loadProfileById(supabase: ReturnType<typeof createServerSupabaseClient>, id: string) {
  const { data, error } = await supabase
    .from("guest_profiles")
    .select(
      "id, first_name, last_name, phone, member_no, profile_status, nationality_code, country, province, address, gender, dob, id_type, id_number, id_card_number, passport_no"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

function buildProfileIdentityPatch(source: "thai_id" | "passport_ocr" | "search", payload: Record<string, unknown>, profile: Record<string, unknown>) {
  if (source === "search") return {} as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  const normalizedGender =
    normalizeGender(payload.gender) ??
    normalizeGender(payload.genderEN) ??
    normalizeGender(payload.genderTH) ??
    normalizeGender(payload.sex);
  if (normalizedGender && !nonEmpty(profile.gender)) {
    patch.gender = normalizedGender;
  }

  const rawDob =
    source === "passport_ocr"
      ? payload.dateOfBirth
      : (payload.birthday ?? payload.dateOfBirth);
  const normalizedDob = normalizeDob(rawDob);
  if (normalizedDob && !nonEmpty(profile.dob)) {
    patch.dob = normalizedDob;
  }

  if (source === "passport_ocr") {
    const passportNo = normalizePassport(payload.passportNumber);
    if (passportNo) {
      if (!nonEmpty(profile.id_type)) patch.id_type = "passport";
      if (!nonEmpty(profile.id_number)) patch.id_number = passportNo;
      if (!nonEmpty(profile.passport_no)) patch.passport_no = passportNo;
    }
  }

  if (source === "thai_id") {
    const thaiId = normalizeThaiId(payload.citizenId);
    const thaiName = buildThaiCardNameParts(payload);
    const firstName = thaiName.firstName ?? nonEmpty(payload.firstNameTH) ?? nonEmpty(payload.firstNameEN);
    const lastName = thaiName.lastName ?? nonEmpty(payload.lastNameTH) ?? nonEmpty(payload.lastNameEN);
    const address = normalizeThaiAddress(payload.address);
    const province = extractThaiProvince(address, payload.province);

    if (firstName) patch.first_name = firstName;
    if (lastName) patch.last_name = lastName;
    if (!nonEmpty(profile.nationality_code)) patch.nationality_code = "THA";
    if (!nonEmpty(profile.country)) patch.country = getCountryByCode("THA") || "Thailand";
    if (address && !nonEmpty(profile.address)) patch.address = address;
    if (province && !nonEmpty(profile.province)) patch.province = province;
    if (thaiId) {
      if (!nonEmpty(profile.id_type)) patch.id_type = "thai_id";
      if (!nonEmpty(profile.id_number)) patch.id_number = thaiId;
      if (!nonEmpty(profile.id_card_number)) patch.id_card_number = thaiId;
    }
  }

  return patch;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await context.params;
    if (!groupId) {
      return NextResponse.json({ success: false, error: "Missing group ID." }, { status: 400 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const group = await getGroupById(supabase, groupId);
    if (!group) {
      return NextResponse.json({ success: false, error: "Group not found." }, { status: 404 });
    }

    const source = parsed.data.source;
    const payload = parsed.data.payload ?? {};
    const scanOrder =
      typeof parsed.data.scan_order === "number" && Number.isFinite(parsed.data.scan_order)
        ? parsed.data.scan_order
        : Date.now();

    let resolvedProfileId = "";

    if (source === "search") {
      const profileId = String(parsed.data.guest_profile_id ?? "").trim();
      if (!profileId) {
        return NextResponse.json(
          { success: false, error: "guest_profile_id is required for search source." },
          { status: 400 }
        );
      }
      resolvedProfileId = profileId;
    } else if (source === "thai_id") {
      const idNumber = normalizeThaiId(payload.citizenId);
      if (!idNumber) {
        return NextResponse.json(
          { success: false, error: "Thai ID payload missing citizenId." },
          { status: 400 }
        );
      }

      const thaiName = buildThaiCardNameParts(payload);
      const resolution = await resolveGuestProfile(supabase, {
        first_name: thaiName.firstName ?? nonEmpty(payload.firstNameTH) ?? nonEmpty(payload.firstNameEN),
        last_name: thaiName.lastName ?? nonEmpty(payload.lastNameTH) ?? nonEmpty(payload.lastNameEN),
        nationality_code: "THA",
        id_type: "thai_id",
        id_number: idNumber,
        profile_status: "draft",
      });
      resolvedProfileId = String(resolution.profile?.id ?? "");
    } else {
      const passportNo = normalizePassport(payload.passportNumber);
      if (!passportNo) {
        return NextResponse.json(
          { success: false, error: "Passport OCR payload missing passportNumber." },
          { status: 400 }
        );
      }

      const resolution = await resolveGuestProfile(supabase, {
        first_name: nonEmpty(payload.firstName),
        last_name: nonEmpty(payload.familyName),
        nationality_code: normalizeNationalityCode(nonEmpty(payload.nationality) ?? null),
        id_type: "passport",
        id_number: passportNo,
        profile_status: "draft",
      });
      resolvedProfileId = String(resolution.profile?.id ?? "");
    }

    if (!resolvedProfileId) {
      return NextResponse.json(
        { success: false, error: "Failed to resolve guest profile for pool ingestion." },
        { status: 500 }
      );
    }

    let profile = await loadProfileById(supabase, resolvedProfileId);
    if (!profile) {
      return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
    }
    if (String(profile.profile_status ?? "") === "merged") {
      return NextResponse.json({ success: false, error: "Cannot use merged profile in scan pool." }, { status: 409 });
    }

    const identityPatch = buildProfileIdentityPatch(source, payload, profile as Record<string, unknown>);
    if (Object.keys(identityPatch).length > 0) {
      const { error: patchError } = await supabase
        .from("guest_profiles")
        .update(identityPatch)
        .eq("id", resolvedProfileId);
      if (patchError) {
        throw new Error(patchError.message || "Failed to persist scanned identity fields.");
      }
      profile = await loadProfileById(supabase, resolvedProfileId);
      if (!profile) {
        return NextResponse.json({ success: false, error: "Guest profile not found after identity patch." }, { status: 404 });
      }
    }

    const completeness = checkProfileCompleteness(profile as Record<string, unknown>);
    if (completeness.is_complete && String(profile.profile_status ?? "draft") === "draft") {
      const { error: promoteError } = await supabase
        .from("guest_profiles")
        .update({ profile_status: "verified" })
        .eq("id", resolvedProfileId);
      if (promoteError) {
        throw new Error(promoteError.message || "Failed to promote profile to verified.");
      }
      profile = await loadProfileById(supabase, resolvedProfileId);
      if (!profile) {
        return NextResponse.json({ success: false, error: "Guest profile not found after promotion." }, { status: 404 });
      }
    }

    return NextResponse.json({
      success: true,
      entry: {
        guest_profile_id: String(profile.id),
        display_name: buildDisplayName(profile),
        first_name: profile.first_name ? String(profile.first_name) : null,
        last_name: profile.last_name ? String(profile.last_name) : null,
        phone: profile.phone ? String(profile.phone) : null,
        member_no: profile.member_no ? String(profile.member_no) : null,
        profile_status: profile.profile_status ? String(profile.profile_status) : null,
        nationality_code: profile.nationality_code ? String(profile.nationality_code) : null,
        source,
        scan_order: scanOrder,
        gender: profile.gender ? String(profile.gender) : null,
      },
    });
  } catch (err) {
    console.error("group check-in wizard ingest identity failed", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
