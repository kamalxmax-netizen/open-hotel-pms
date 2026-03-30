const MASK_PREFIX = "***";
const VISIBLE_TAIL = 4;
const MASKED_ROLES = new Set(["frontdesk", "supervisor", "housekeeping"]);
const CHECKIN_UNMASK_ROLES = new Set(["frontdesk", "supervisor"]);

const SENSITIVE_FIELDS = ["passport_no", "id_card_number", "id_number"] as const;

type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

export type MaskableGuest = Record<string, unknown> & {
  passport_no?: string | null;
  id_card_number?: string | null;
  id_number?: string | null;
  _masked?: boolean;
  _masked_fields?: string[];
};

export function toBangkokDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export function maskValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const tail = text.slice(-VISIBLE_TAIL);
  return `${MASK_PREFIX}${tail}`;
}

export function maskSensitiveFields<T extends MaskableGuest>(guest: T): T {
  if (!guest || typeof guest !== "object") return guest;

  const masked = { ...guest } as T;
  const touched: string[] = [];
  for (const field of SENSITIVE_FIELDS) {
    const nextValue = maskValue(masked[field] as string | null | undefined);
    if (nextValue !== null) {
      masked[field] = nextValue as T[SensitiveField];
      touched.push(field);
    }
  }

  if (touched.length > 0) {
    masked._masked = true as T["_masked"];
    masked._masked_fields = touched as T["_masked_fields"];
  }

  return masked;
}

export function containsMaskedPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  return text.includes("•") || text.startsWith("***");
}

export function isCheckinModeEnabled(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function shouldMaskIdentityForRole(role: string | null | undefined): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "admin") return false;
  if (MASKED_ROLES.has(normalized)) return true;
  return true;
}

export function canRoleUnmaskInCheckin(role: string | null | undefined): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "admin") return true;
  return CHECKIN_UNMASK_ROLES.has(normalized);
}

export async function resolveBusinessDate(
  supabase: any,
  fallbackDate = toBangkokDate(new Date())
): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();

  if (error) return fallbackDate;
  const value = String(data?.business_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallbackDate;
  return value;
}

export async function validateGuestUnmaskAccess(params: {
  supabase: any;
  reservationId: string;
  guestProfileId: string;
  businessDate: string;
}): Promise<boolean> {
  const { supabase, reservationId, guestProfileId, businessDate } = params;
  if (!reservationId || !guestProfileId) return false;

  const { data: reservation, error: reservationError } = await supabase
    .from("reservations")
    .select("id, status, checked_in_at, checkin_date, guest_profile_id")
    .eq("id", reservationId)
    .maybeSingle();

  if (reservationError || !reservation) return false;
  if (String(reservation.status ?? "") !== "active") return false;

  const isPrimaryGuest = String(reservation.guest_profile_id ?? "") === guestProfileId;
  let isLinkedAccompanyingGuest = false;

  if (!isPrimaryGuest) {
    const { data: linkedGuest, error: linkedGuestError } = await supabase
      .from("reservation_guests")
      .select("guest_profile_id")
      .eq("reservation_id", reservationId)
      .eq("guest_profile_id", guestProfileId)
      .maybeSingle();

    if (linkedGuestError) return false;
    isLinkedAccompanyingGuest = Boolean(linkedGuest);
  }

  if (!isPrimaryGuest && !isLinkedAccompanyingGuest) return false;

  // In-house guests (already checked in, not yet checked out) can be unmasked.
  if (reservation.checked_in_at) return true;

  // Due-in guests can be unmasked only on business date.
  return String(reservation.checkin_date ?? "") === businessDate;
}

export async function insertDataUnmaskAuditLog(params: {
  supabase: any;
  userId: string;
  reservationId: string;
  guestProfileId: string;
  businessDate: string;
}): Promise<void> {
  const { supabase, userId, reservationId, guestProfileId, businessDate } = params;
  await supabase.from("audit_logs").insert({
    actor_user_id: userId,
    action: "data_unmasked",
    entity_type: "data_unmask",
    entity_id: guestProfileId,
    source: "manual",
    business_date: businessDate,
    note: "Identity fields unmasked for active check-in flow.",
    after_json: {
      reservation_id: reservationId,
      fields: ["passport_no", "id_card_number", "id_number"],
      reason: "checkin_flow",
    },
  });
}
