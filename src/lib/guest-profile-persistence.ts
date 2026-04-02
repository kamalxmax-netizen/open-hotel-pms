import {
  findExistingGuestProfileByDocument,
  normalizeGuestDocumentNumber,
  type GuestDocumentType,
} from "@/lib/guest-resolution";
import {
  logGuestProfileConflictEvent,
  type GuestProfileConflictLogContext,
} from "@/lib/guest-profile-conflict-log";

type SupabaseLike = {
  from: (table: string) => any;
};

type GuestProfileMutationResult = {
  profile: Record<string, any>;
  rerouted: boolean;
};

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asGuestDocumentType(value: unknown): GuestDocumentType | null {
  const text = String(value ?? "").trim();
  return text === "thai_id" || text === "passport" || text === "other"
    ? (text as GuestDocumentType)
    : null;
}

function isDuplicateDocumentError(message: string | null | undefined): boolean {
  return /duplicate key value|unique constraint|idx_guest_profiles_id_number_unique/i.test(message ?? "");
}

function normalizeGuestProfilePayload(payload: Record<string, unknown>): {
  normalizedPayload: Record<string, unknown>;
  document: { idType: GuestDocumentType; idNumber: string } | null;
} {
  const normalizedPayload = { ...payload };

  let idType = asGuestDocumentType(normalizedPayload.id_type);
  let rawIdNumber = String(normalizedPayload.id_number ?? "").trim();
  const rawPassport = String(normalizedPayload.passport_no ?? "").trim();
  const rawThaiId = String(normalizedPayload.id_card_number ?? "").trim();

  if (!idType) {
    if (rawPassport) {
      idType = "passport";
      normalizedPayload.id_type = idType;
    } else if (rawThaiId) {
      idType = "thai_id";
      normalizedPayload.id_type = idType;
    }
  }

  if (!rawIdNumber) {
    if (idType === "passport" && rawPassport) rawIdNumber = rawPassport;
    if (idType === "thai_id" && rawThaiId) rawIdNumber = rawThaiId;
  }

  if (idType && rawIdNumber) {
    const normalizedIdNumber = normalizeGuestDocumentNumber(idType, rawIdNumber);
    normalizedPayload.id_number = normalizedIdNumber;
    if (idType === "passport") {
      normalizedPayload.passport_no = normalizedIdNumber;
    }
    if (idType === "thai_id") {
      normalizedPayload.id_card_number = normalizedIdNumber;
    }
    return {
      normalizedPayload,
      document: {
        idType,
        idNumber: normalizedIdNumber,
      },
    };
  }

  return {
    normalizedPayload,
    document: null,
  };
}

function buildConservativeConflictPatch(
  existing: Record<string, any>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const fillIfBlankKeys = [
    "first_name",
    "last_name",
    "gender",
    "nationality",
    "nationality_code",
    "passport_no",
    "dob",
    "id_card_number",
    "id_type",
    "id_number",
    "address",
    "address_line1",
    "address_line2",
    "city",
    "province",
    "postal_code",
    "country",
    "phone",
    "email",
    "whatsapp",
    "line_id",
    "car_registration",
    "vip_tier",
    "preferences",
    "notes",
  ] as const;

  for (const key of fillIfBlankKeys) {
    const nextValue = incoming[key];
    if (nextValue === undefined || isBlank(nextValue) || !isBlank(existing[key])) continue;
    patch[key] = nextValue;
  }

  if (incoming.passport_raw != null && existing.passport_raw == null) {
    patch.passport_raw = incoming.passport_raw;
  }

  if (incoming.blacklisted === true && existing.blacklisted !== true) {
    patch.blacklisted = true;
  }

  if (incoming.do_not_merge === true && existing.do_not_merge !== true) {
    patch.do_not_merge = true;
  }

  const incomingProfileStatus = String(incoming.profile_status ?? "").trim();
  const existingProfileStatus = String(existing.profile_status ?? "").trim();
  if (incomingProfileStatus === "verified" && existingProfileStatus !== "verified" && existingProfileStatus !== "merged") {
    patch.profile_status = "verified";
  } else if (!existingProfileStatus && incomingProfileStatus) {
    patch.profile_status = incomingProfileStatus;
  }

  return patch;
}

function buildResolvedProfileSnapshot(profile: Record<string, any>, documentNumber: string): Record<string, unknown> {
  const firstName = String(profile.first_name ?? "").trim();
  const lastName = String(profile.last_name ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim() || null;

  return {
    id: String(profile.id ?? "").trim() || null,
    full_name: fullName,
    id_type: String(profile.id_type ?? "").trim() || null,
    document_masked: documentNumber
      ? `${documentNumber.slice(0, 2)}${"*".repeat(Math.max(2, documentNumber.length - 4))}${documentNumber.slice(-2)}`
      : null,
  };
}

async function fetchGuestProfileById(
  supabase: SupabaseLike,
  profileId: string
): Promise<Record<string, any> | null> {
  const { data, error } = await supabase
    .from("guest_profiles")
    .select("*")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Failed to load guest profile.");
  }

  return (data as Record<string, any> | null) ?? null;
}

async function resolveConflictProfile(params: {
  supabase: SupabaseLike;
  normalizedPayload: Record<string, unknown>;
  document: { idType: GuestDocumentType; idNumber: string };
  attemptedProfileId?: string | null;
  logContext?: Omit<GuestProfileConflictLogContext, "attemptedProfileId" | "resolvedProfileId" | "documentType" | "documentNumber" | "retryCount">;
}): Promise<GuestProfileMutationResult> {
  const { supabase, normalizedPayload, document, attemptedProfileId, logContext } = params;
  const existing = await findExistingGuestProfileByDocument(supabase as any, {
    idType: document.idType,
    idNumber: document.idNumber,
    select: "*",
  });

  const resolvedProfileId = String(existing?.id ?? "").trim();
  if (!resolvedProfileId) {
    throw new Error("Guest profile conflict detected but no canonical profile was found.");
  }

  const patch = buildConservativeConflictPatch(existing ?? {}, normalizedPayload);
  let profile = existing as Record<string, any>;

  if (Object.keys(patch).length > 0) {
    const { data: patched, error: patchError } = await supabase
      .from("guest_profiles")
      .update(patch)
      .eq("id", resolvedProfileId)
      .select("*")
      .maybeSingle();

    if (patchError) {
      throw new Error(patchError.message ?? "Failed to enrich canonical guest profile.");
    }

    profile = (patched as Record<string, any> | null) ?? ({
      ...(existing ?? {}),
      ...patch,
    } as Record<string, any>);
  } else if (!profile) {
    profile = (await fetchGuestProfileById(supabase, resolvedProfileId)) ?? {};
  }

  if (logContext) {
    await logGuestProfileConflictEvent(supabase, {
      ...logContext,
      attemptedProfileId: attemptedProfileId ?? null,
      resolvedProfileId,
      documentType: document.idType,
      documentNumber: document.idNumber,
      retryCount: 1,
      resolvedProfileSnapshot: buildResolvedProfileSnapshot(profile, document.idNumber),
    });
  }

  return {
    profile,
    rerouted: resolvedProfileId !== String(attemptedProfileId ?? "").trim(),
  };
}

export async function createGuestProfileWithConflictHandling(params: {
  supabase: SupabaseLike;
  payload: Record<string, unknown>;
  logContext?: Omit<GuestProfileConflictLogContext, "attemptedProfileId" | "resolvedProfileId" | "documentType" | "documentNumber" | "retryCount">;
}): Promise<GuestProfileMutationResult> {
  const { supabase, payload, logContext } = params;
  const { normalizedPayload, document } = normalizeGuestProfilePayload(payload);

  const { data, error } = await supabase
    .from("guest_profiles")
    .insert(normalizedPayload)
    .select("*")
    .maybeSingle();

  if (!error && data) {
    return {
      profile: data as Record<string, any>,
      rerouted: false,
    };
  }

  if (document && isDuplicateDocumentError(error?.message)) {
    return resolveConflictProfile({
      supabase,
      normalizedPayload,
      document,
      attemptedProfileId: null,
      logContext,
    });
  }

  throw new Error(error?.message ?? "Failed to create guest profile.");
}

export async function updateGuestProfileWithConflictHandling(params: {
  supabase: SupabaseLike;
  profileId: string;
  payload: Record<string, unknown>;
  logContext?: Omit<GuestProfileConflictLogContext, "attemptedProfileId" | "resolvedProfileId" | "documentType" | "documentNumber" | "retryCount">;
}): Promise<GuestProfileMutationResult> {
  const { supabase, profileId, payload, logContext } = params;
  const { normalizedPayload, document } = normalizeGuestProfilePayload(payload);

  const { data, error } = await supabase
    .from("guest_profiles")
    .update(normalizedPayload)
    .eq("id", profileId)
    .select("*")
    .maybeSingle();

  if (!error && data) {
    return {
      profile: data as Record<string, any>,
      rerouted: false,
    };
  }

  if (document && isDuplicateDocumentError(error?.message)) {
    return resolveConflictProfile({
      supabase,
      normalizedPayload,
      document,
      attemptedProfileId: profileId,
      logContext,
    });
  }

  if (error) {
    throw new Error(error.message ?? "Failed to update guest profile.");
  }

  throw new Error("Guest profile not found.");
}
