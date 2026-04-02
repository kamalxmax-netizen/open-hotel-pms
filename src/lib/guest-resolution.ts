import { getCountryByCode, normalizeNationalityCode } from "@/lib/nationality-map";

type SupabaseLike = {
  from: (table: string) => any;
};

export type GuestDocumentType = "thai_id" | "passport" | "other";

export type GuestResolutionInput = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  nationality?: string | null;
  nationality_code?: string | null;
  id_type?: GuestDocumentType | null;
  id_number?: string | null;
  profile_status?: "draft" | "verified";
};

export type GuestResolutionResult = {
  action: "document_match" | "fuzzy_match" | "created_draft";
  profile: Record<string, any>;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDigits(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("66") && digits.length >= 10) return `0${digits.slice(2)}`;
  return digits;
}

export function normalizeGuestDocumentNumber(idType: GuestDocumentType, raw: string): string {
  const trimmed = raw.trim();
  if (idType === "thai_id") return trimmed.replace(/\D+/g, "");
  if (idType === "passport") {
    return trimmed.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
  }
  return trimmed.replace(/\s+/g, " ");
}

function buildDisplayLastName(input: GuestResolutionInput): string {
  const first = normalizeText(input.first_name);
  const last = normalizeText(input.last_name);
  if (last) return last;
  if (first) return first;
  return "Unknown";
}

export async function findExistingGuestProfileByDocument(
  supabase: SupabaseLike,
  params: { idType: GuestDocumentType; idNumber: string; select?: string }
) {
  const normalized = normalizeGuestDocumentNumber(params.idType, params.idNumber);
  if (!normalized) return null;

  const baseSelect = params.select
    ?? "id, first_name, last_name, phone, profile_status, id_type, id_number, id_card_number, nationality_code, country";

  let { data, error } = await supabase
    .from("guest_profiles")
    .select(baseSelect)
    .neq("profile_status", "merged")
    .eq("id_type", params.idType)
    .eq("id_number", normalized)
    .limit(1);

  if (error) {
    throw new Error(error.message ?? "Failed to lookup guest profile by document.");
  }

  if ((!data || data.length === 0) && params.idType === "thai_id") {
    const fallback = await supabase
      .from("guest_profiles")
      .select(baseSelect)
      .neq("profile_status", "merged")
      .eq("id_card_number", normalized)
      .limit(1);
    if (fallback.error) {
      throw new Error(fallback.error.message ?? "Failed to lookup guest profile by Thai ID fallback.");
    }
    data = fallback.data;
  }

  if (!data || data.length === 0) {
    const fallbackByIdNumber = await supabase
      .from("guest_profiles")
      .select(baseSelect)
      .neq("profile_status", "merged")
      .eq("id_number", normalized)
      .limit(1);
    if (fallbackByIdNumber.error) {
      throw new Error(fallbackByIdNumber.error.message ?? "Failed to lookup guest profile by id_number fallback.");
    }
    data = fallbackByIdNumber.data;
  }

  return (data ?? [])[0] ?? null;
}

export async function resolveGuestProfile(
  supabase: SupabaseLike,
  input: GuestResolutionInput
): Promise<GuestResolutionResult> {
  const normalizedCode = normalizeNationalityCode(input.nationality_code ?? input.nationality ?? null);
  const normalizedPhone = normalizeDigits(input.phone);
  const idType = input.id_type ?? null;
  const rawIdNumber = normalizeText(input.id_number);

  if (idType && rawIdNumber) {
    const existing = await findExistingGuestProfileByDocument(supabase, {
      idType,
      idNumber: rawIdNumber,
    });

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (normalizeText(input.first_name) && !existing.first_name) updates.first_name = normalizeText(input.first_name);
      if (normalizeText(input.last_name) && !existing.last_name) updates.last_name = normalizeText(input.last_name);
      if (normalizedPhone && !existing.phone) updates.phone = normalizedPhone;
      if (normalizedCode && !existing.nationality_code) {
        updates.nationality_code = normalizedCode;
        updates.country = getCountryByCode(normalizedCode) || existing.country || null;
      }
      if (Object.keys(updates).length > 0) {
        const { data: patched, error: patchError } = await supabase
          .from("guest_profiles")
          .update(updates)
          .eq("id", existing.id)
          .select("*")
          .maybeSingle();
        if (patchError) {
          throw new Error(patchError.message ?? "Failed to enrich existing guest profile.");
        }
        return {
          action: "document_match",
          profile: patched ?? existing,
        };
      }
      return {
        action: "document_match",
        profile: existing,
      };
    }
  }

  const firstName = normalizeText(input.first_name).toLowerCase();
  const lastName = normalizeText(input.last_name).toLowerCase();

  if (firstName || lastName || normalizedPhone) {
    const { data: candidates, error: candidateError } = await supabase
      .from("guest_profiles")
      .select("id, first_name, last_name, phone, profile_status, nationality_code, country")
      .neq("profile_status", "merged")
      .limit(50);

    if (candidateError) {
      throw new Error(candidateError.message ?? "Failed to load fuzzy guest profile candidates.");
    }

    const fuzzy = (candidates ?? []).find((row: any) => {
      const rowFirst = normalizeText(row.first_name).toLowerCase();
      const rowLast = normalizeText(row.last_name).toLowerCase();
      const rowPhone = normalizeDigits(row.phone);
      const nameMatch =
        Boolean(firstName || lastName) &&
        rowFirst === firstName &&
        rowLast === lastName;
      const phoneMatch = Boolean(normalizedPhone) && rowPhone === normalizedPhone;
      return nameMatch || phoneMatch;
    });

    if (fuzzy) {
      return {
        action: "fuzzy_match",
        profile: fuzzy,
      };
    }
  }

  const { data: created, error: createError } = await supabase
    .from("guest_profiles")
    .insert({
      first_name: normalizeText(input.first_name) || null,
      last_name: buildDisplayLastName(input),
      phone: normalizedPhone || null,
      nationality_code: normalizedCode ?? null,
      country: normalizedCode ? getCountryByCode(normalizedCode) || null : null,
      id_type: idType,
      id_number: rawIdNumber || null,
      profile_status: input.profile_status ?? "draft",
    })
    .select("*")
    .maybeSingle();

  if (createError) {
    const duplicateIdNumber = /duplicate key value|unique constraint|idx_guest_profiles_id_number_unique/i.test(
      createError.message ?? ""
    );
    if (duplicateIdNumber && idType && rawIdNumber) {
      const existing = await findExistingGuestProfileByDocument(supabase, {
        idType,
        idNumber: rawIdNumber,
      });
      if (existing) {
        return {
          action: "document_match",
          profile: existing,
        };
      }
    }
    throw new Error(createError.message ?? "Failed to create draft guest profile.");
  }

  return {
    action: "created_draft",
    profile: created ?? null,
  };
}
