import { listNights } from "@/lib/dates";

const GAS_WEB_APP_URL = process.env.GAS_SYNC_WEB_APP_URL;

export type SheetSyncDateEntry = {
  date: string;
  guest_name: string | null;
  price: number;
  is_ota: boolean;
};

export type SheetSyncPayload = {
  action: "upsert" | "clear";
  room_number: string;
  dates: SheetSyncDateEntry[];
  api_key: string;
};

export type ReservationSheetSyncGroup = {
  room_number: string;
  dates: SheetSyncDateEntry[];
};

type SupabaseLike = {
  from: (table: string) => any;
};

type ReservationNightSyncRow = {
  stay_date: string | null;
  nightly_price: number | string | null;
  dayuse_session?: number | null;
  rooms?: { room_number?: string | null } | Array<{ room_number?: string | null }> | null;
  reservations?:
    | {
        guest_name?: string | null;
        source?: string | null;
        total_price?: number | string | null;
        checkin_date?: string | null;
        checkout_date?: string | null;
        status?: string | null;
      }
    | Array<{
        guest_name?: string | null;
        source?: string | null;
        total_price?: number | string | null;
        checkin_date?: string | null;
        checkout_date?: string | null;
        status?: string | null;
      }>
    | null;
};

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return (value ?? null) as T | null;
}

function deriveFallbackNightlyPrice(
  totalPriceRaw: unknown,
  checkinDateRaw: unknown,
  checkoutDateRaw: unknown
): number {
  const totalPrice = round2(toNumber(totalPriceRaw));
  const checkinDate = String(checkinDateRaw ?? "");
  const checkoutDate = String(checkoutDateRaw ?? "");

  if (!checkinDate || !checkoutDate || totalPrice <= 0) return 0;

  try {
    const nights = listNights(checkinDate, checkoutDate);
    if (nights.length <= 0) return 0;
    return round2(totalPrice / nights.length);
  } catch {
    return 0;
  }
}

export function isOtaSource(sourceRaw: unknown): boolean {
  return String(sourceRaw ?? "").trim().toLowerCase() === "ota";
}

export async function loadReservationSheetSyncGroups(params: {
  supabase: SupabaseLike;
  reservationId: string;
  action: "upsert" | "clear";
  includeCancelledNights?: boolean;
}): Promise<ReservationSheetSyncGroup[]> {
  const { supabase, reservationId, action, includeCancelledNights = false } = params;
  let query = supabase
    .from("reservation_nights")
    .select(
      "stay_date, nightly_price, dayuse_session, rooms(room_number), reservations!reservation_nights_reservation_id_fkey(guest_name, source, total_price, checkin_date, checkout_date, status)"
    )
    .eq("reservation_id", reservationId)
    .eq("dayuse_session", 0)
    .order("stay_date", { ascending: true });

  if (!includeCancelledNights) {
    query = query.is("cancelled_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message ?? "Failed to load reservation nights for Google Sheet sync.");
  }

  const grouped = new Map<string, Map<string, SheetSyncDateEntry>>();
  for (const rawRow of (data ?? []) as ReservationNightSyncRow[]) {
    const room = getOne(rawRow.rooms);
    const reservation = getOne(rawRow.reservations);

    const roomNumber = String(room?.room_number ?? "").trim();
    const stayDate = String(rawRow?.stay_date ?? "").trim();
    const reservationStatus = String(reservation?.status ?? "").trim().toLowerCase();
    if (!roomNumber || !stayDate) continue;
    if (reservationStatus === "cancelled" || reservationStatus === "no_show") continue;

    if (!grouped.has(roomNumber)) {
      grouped.set(roomNumber, new Map<string, SheetSyncDateEntry>());
    }

    const byDate = grouped.get(roomNumber)!;
    if (action === "clear") {
      byDate.set(stayDate, {
        date: stayDate,
        guest_name: null,
        price: 0,
        is_ota: false,
      });
      continue;
    }

    const guestName = String(reservation?.guest_name ?? "").trim() || null;
    const fallbackNightlyPrice = deriveFallbackNightlyPrice(
      reservation?.total_price,
      reservation?.checkin_date,
      reservation?.checkout_date
    );
    const nightlyPrice = round2(toNumber(rawRow?.nightly_price));
    byDate.set(stayDate, {
      date: stayDate,
      guest_name: guestName,
      price: nightlyPrice > 0 ? nightlyPrice : fallbackNightlyPrice,
      is_ota: isOtaSource(reservation?.source),
    });
  }

  return Array.from(grouped.entries())
    .map(([roomNumber, byDate]): ReservationSheetSyncGroup => ({
      room_number: roomNumber,
      dates: Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date)),
    }))
    .filter((group) => group.dates.length > 0)
    .sort((left, right) => Number(left.room_number) - Number(right.room_number));
}

export async function pushToGoogleSheet(payload: SheetSyncPayload): Promise<boolean> {
  if (!GAS_WEB_APP_URL) return false;

  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let remoteSuccess = response.ok;
    const bodyText = await response.text().catch(() => "");
    if (bodyText) {
      try {
        const bodyJson = JSON.parse(bodyText);
        if (typeof bodyJson?.success === "boolean") {
          remoteSuccess = response.ok && bodyJson.success;
        }
      } catch {
        // Keep response.ok fallback when body is not JSON.
      }
    }

    if (!remoteSuccess) {
      console.error("[GoogleSheetSync] Push returned non-success response.", {
        status: response.status,
        room_number: payload.room_number,
        action: payload.action,
      });
    }

    return remoteSuccess;
  } catch (error) {
    console.error("[GoogleSheetSync] Push failed:", error);
    return false;
  }
}
