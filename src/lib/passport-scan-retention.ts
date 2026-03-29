export const DEFAULT_PASSPORT_RETENTION_DAYS = 30;
export const MIN_PASSPORT_RETENTION_DAYS = 7;
export const MAX_PASSPORT_RETENTION_DAYS = 90;

function isSchemaMissingError(message?: string | null): boolean {
  if (!message) return false;
  return /column .* does not exist|relation .* does not exist|cleaned_at|passport_photo_retention_days|passport_scans/i.test(
    message
  );
}

export function clampPassportRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PASSPORT_RETENTION_DAYS;
  const rounded = Math.trunc(value);
  if (rounded < MIN_PASSPORT_RETENTION_DAYS) return MIN_PASSPORT_RETENTION_DAYS;
  if (rounded > MAX_PASSPORT_RETENTION_DAYS) return MAX_PASSPORT_RETENTION_DAYS;
  return rounded;
}

export function computePassportExpiryIso(retentionDays: number, now = new Date()): string {
  const safeDays = clampPassportRetentionDays(retentionDays);
  return new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function getPassportRetentionDays(supabase: any): Promise<number> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("passport_photo_retention_days")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    if (isSchemaMissingError(error.message)) return DEFAULT_PASSPORT_RETENTION_DAYS;
    throw new Error(`Failed to read passport retention setting: ${error.message}`);
  }

  const raw = Number((data as any)?.passport_photo_retention_days ?? DEFAULT_PASSPORT_RETENTION_DAYS);
  return clampPassportRetentionDays(raw);
}

export async function stampReservationPassportScanExpiry(params: {
  supabase: any;
  reservationId: string;
  retentionDays?: number;
}): Promise<void> {
  const { supabase, reservationId } = params;
  if (!reservationId) return;

  const retentionDays = params.retentionDays ?? (await getPassportRetentionDays(supabase));
  const expiresAt = computePassportExpiryIso(retentionDays);

  const { error } = await supabase
    .from("passport_scans")
    .update({ expires_at: expiresAt })
    .eq("reservation_id", reservationId)
    .not("image_path", "is", null);

  if (error && !isSchemaMissingError(error.message)) {
    throw new Error(`Failed to stamp passport scan expiry: ${error.message}`);
  }
}

export async function applyPassportRetentionToExistingScans(params: {
  supabase: any;
  retentionDays: number;
}): Promise<number> {
  const { supabase } = params;
  const retentionDays = clampPassportRetentionDays(params.retentionDays);
  const { data, error } = await supabase.rpc("recalculate_passport_scan_expires_at", {
    new_retention_days: retentionDays,
  });

  if (error) {
    if (isSchemaMissingError(error.message)) return 0;
    throw new Error(`Failed to apply retention to existing scans: ${error.message}`);
  }

  return Number(data ?? 0);
}
