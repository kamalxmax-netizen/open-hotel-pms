import { compareDateStrings, isValidDateString } from "@/lib/dates";
import { syncReservationNightDependencyMetadata } from "@/lib/planned-room-moves";

type SupabaseLike = {
  from: (table: string) => any;
};

type OtaReservationRow = {
  id: string;
  source: string | null;
  status: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  total_price: number | string | null;
  original_checkout_date?: string | null;
};

type ReservationNightRow = {
  stay_date: string;
  nightly_price: number | string | null;
};

export type OtaShortenResult = {
  reservation_id: string;
  old_checkout_date: string;
  new_checkout_date: string;
  old_total_price: number;
  new_total_price: number;
  cancelled_stay_dates: string[];
  original_checkout_date_saved: string | null;
};

export class OtaModificationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OtaModificationError";
    this.status = status;
  }
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function isMissingOriginalCheckoutDateColumnError(message?: string | null): boolean {
  if (!message) return false;
  return /original_checkout_date/i.test(message);
}

async function loadOtaReservationForShorten(
  supabase: SupabaseLike,
  reservationId: string
): Promise<{ row: OtaReservationRow; supportsOriginalCheckoutDate: boolean }> {
  const withOriginalSelect = `
    id,
    source,
    status,
    checkin_date,
    checkout_date,
    total_price,
    original_checkout_date
  `;
  const fallbackSelect = `
    id,
    source,
    status,
    checkin_date,
    checkout_date,
    total_price
  `;

  const withOriginal = await supabase
    .from("reservations")
    .select(withOriginalSelect)
    .eq("id", reservationId)
    .maybeSingle();

  if (withOriginal.error && isMissingOriginalCheckoutDateColumnError(withOriginal.error.message)) {
    const fallback = await supabase
      .from("reservations")
      .select(fallbackSelect)
      .eq("id", reservationId)
      .maybeSingle();
    if (fallback.error) {
      throw new OtaModificationError(fallback.error.message ?? "Failed to load OTA reservation.", 500);
    }
    if (!fallback.data) {
      throw new OtaModificationError("Reservation not found.", 404);
    }
    return { row: fallback.data as OtaReservationRow, supportsOriginalCheckoutDate: false };
  }

  if (withOriginal.error) {
    throw new OtaModificationError(withOriginal.error.message ?? "Failed to load OTA reservation.", 500);
  }
  if (!withOriginal.data) {
    throw new OtaModificationError("Reservation not found.", 404);
  }

  return { row: withOriginal.data as OtaReservationRow, supportsOriginalCheckoutDate: true };
}

export async function shortenOtaReservationForEarlyMove(params: {
  supabase: SupabaseLike;
  reservationId: string;
  newCheckoutDate: string;
  reason?: string | null;
}) {
  const { supabase, reservationId, newCheckoutDate, reason } = params;

  if (!isValidDateString(newCheckoutDate)) {
    throw new OtaModificationError("Invalid OTA shorten date. Use YYYY-MM-DD.", 400);
  }

  const { row: reservation, supportsOriginalCheckoutDate } = await loadOtaReservationForShorten(supabase, reservationId);
  const checkinDate = String(reservation.checkin_date ?? "");
  const checkoutDate = String(reservation.checkout_date ?? "");

  if (!isValidDateString(checkinDate) || !isValidDateString(checkoutDate)) {
    throw new OtaModificationError("Reservation has invalid stay dates.", 409);
  }
  if (String(reservation.source ?? "") !== "ota") {
    throw new OtaModificationError("Option B is only available for OTA reservations.", 400);
  }
  if (String(reservation.status ?? "") !== "active") {
    throw new OtaModificationError("Only active OTA reservations can be shortened.", 400);
  }
  if (compareDateStrings(newCheckoutDate, checkinDate) <= 0) {
    throw new OtaModificationError("OTA shorten date must be after check-in date.", 400);
  }
  if (compareDateStrings(newCheckoutDate, checkoutDate) >= 0) {
    throw new OtaModificationError("OTA shorten date must be earlier than current checkout date.", 400);
  }

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select("stay_date, nightly_price")
    .eq("reservation_id", reservationId)
    .is("cancelled_at", null)
    .order("stay_date", { ascending: true });

  if (nightsError) {
    throw new OtaModificationError(nightsError.message ?? "Failed to load OTA nights.", 500);
  }

  const activeNights = (nights ?? []) as ReservationNightRow[];
  const keepNights = activeNights.filter((row) => String(row.stay_date) < newCheckoutDate);
  const cancelledStayDates = activeNights
    .filter((row) => String(row.stay_date) >= newCheckoutDate)
    .map((row) => String(row.stay_date));

  const oldTotal = round2(toNumber(reservation.total_price));
  const newTotal = round2(keepNights.reduce((sum, row) => sum + toNumber(row.nightly_price), 0));
  const cancelledAt = new Date().toISOString();

  if (cancelledStayDates.length > 0) {
    const { error: cancelError } = await supabase
      .from("reservation_nights")
      .update({ cancelled_at: cancelledAt })
      .eq("reservation_id", reservationId)
      .is("cancelled_at", null)
      .gte("stay_date", newCheckoutDate);
    if (cancelError) {
      throw new OtaModificationError(cancelError.message ?? "Failed to cancel future OTA nights.", 500);
    }
  }

  const updatePayload: Record<string, unknown> = {
    checkout_date: newCheckoutDate,
    total_price: newTotal,
  };
  if (supportsOriginalCheckoutDate && !reservation.original_checkout_date) {
    updatePayload.original_checkout_date = checkoutDate;
  }

  const { error: updateError } = await supabase
    .from("reservations")
    .update(updatePayload)
    .eq("id", reservationId);
  if (updateError) {
    throw new OtaModificationError(updateError.message ?? "Failed to shorten OTA reservation.", 500);
  }

  await syncReservationNightDependencyMetadata(supabase as any, { reservationId });

  const { error: auditError } = await supabase.from("audit_logs").insert({
    action: "ota_shortened_for_early_move",
    entity_type: "reservation",
    entity_id: reservationId,
    before_json: {
      checkout_date: checkoutDate,
      total_price: oldTotal,
      original_checkout_date: supportsOriginalCheckoutDate ? reservation.original_checkout_date ?? null : null,
    },
    after_json: {
      checkout_date: newCheckoutDate,
      total_price: newTotal,
      cancelled_nights: cancelledStayDates.length,
      cancelled_stay_dates: cancelledStayDates,
      original_checkout_date_saved: supportsOriginalCheckoutDate && !reservation.original_checkout_date ? checkoutDate : null,
      reason: String(reason ?? "").trim() || null,
      ota_platform_update_required: true,
    },
  });
  if (auditError) {
    throw new OtaModificationError(auditError.message ?? "Failed to write OTA shorten audit log.", 500);
  }

  const result: OtaShortenResult = {
    reservation_id: reservationId,
    old_checkout_date: checkoutDate,
    new_checkout_date: newCheckoutDate,
    old_total_price: oldTotal,
    new_total_price: newTotal,
    cancelled_stay_dates: cancelledStayDates,
    original_checkout_date_saved:
      supportsOriginalCheckoutDate && !reservation.original_checkout_date ? checkoutDate : null,
  };

  return result;
}
