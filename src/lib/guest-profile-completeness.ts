import { containsMaskedPlaceholder } from "@/lib/data-masking";
import { normalizeNationalityCode } from "@/lib/nationality-map";

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export type GuestProfileLike = {
  first_name?: unknown;
  last_name?: unknown;
  gender?: unknown;
  nationality_code?: unknown;
  id_type?: unknown;
  id_number?: unknown;
  _masked?: unknown;
  country?: unknown;
  province?: unknown;
  phone?: unknown;
};

export type ProfileCompletenessResult = {
  is_complete: boolean;
  missing_fields: string[];
  nationality_code_normalized: string;
  is_thai: boolean;
};

export function checkProfileCompleteness(profile: GuestProfileLike | null | undefined): ProfileCompletenessResult {
  const safeProfile: GuestProfileLike = profile ?? {};
  const nationalityCode = normalizeNationalityCode(String(safeProfile.nationality_code ?? "")) || "";
  const isThai = nationalityCode === "THA";
  const idType = String(safeProfile.id_type ?? "").trim().toLowerCase();
  const idNumber = String(safeProfile.id_number ?? "").trim();
  const isMaskedIdentity = Boolean(safeProfile._masked) || containsMaskedPlaceholder(idNumber);
  const requireIdNumber = idType !== "passport" && !isMaskedIdentity;

  const required: Record<string, boolean> = {
    first_name: true,
    last_name: true,
    gender: true,
    nationality_code: true,
    id_type: true,
    id_number: requireIdNumber,
    country: true,
    province: isThai,
    phone: isThai,
  };

  const missingFields = Object.entries(required)
    .filter(([key, requiredFlag]) => {
      if (!requiredFlag) return false;
      if (key === "nationality_code") return isBlank(nationalityCode);
      return isBlank((safeProfile as Record<string, unknown>)[key]);
    })
    .map(([key]) => key);

  if (!isMaskedIdentity && idType === "thai_id" && idNumber && !/^\d{13}$/.test(idNumber)) {
    if (!missingFields.includes("id_number")) {
      missingFields.push("id_number");
    }
  }

  return {
    is_complete: missingFields.length === 0,
    missing_fields: missingFields,
    nationality_code_normalized: nationalityCode,
    is_thai: isThai,
  };
}
