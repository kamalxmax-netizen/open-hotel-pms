import type { GuestLoyaltySnapshot } from "@/lib/guest-loyalty";
import { normalizeGuestLoyaltySnapshot } from "@/lib/guest-loyalty";

type SupabaseLike = any;

type ProfileLookupRow = {
  id: string;
  vip_tier: string | null;
  stay_count: number | null;
  night_count?: number | null;
  main_stay_count?: number | null;
  main_night_count?: number | null;
  accompanying_stay_count?: number | null;
  accompanying_night_count?: number | null;
};

function diffStayNights(checkinDate: string | null | undefined, checkoutDate: string | null | undefined): number {
  const checkinMs = checkinDate ? new Date(`${checkinDate}T00:00:00`).getTime() : NaN;
  const checkoutMs = checkoutDate ? new Date(`${checkoutDate}T00:00:00`).getTime() : NaN;
  if (!Number.isFinite(checkinMs) || !Number.isFinite(checkoutMs)) return 1;
  return Math.max(1, Math.round((checkoutMs - checkinMs) / 86400000));
}

export async function resolvePrimaryGuestProfileMap(
  supabase: SupabaseLike,
  reservationIds: string[],
  seed: Map<string, string | null>
): Promise<Map<string, string | null>> {
  const next = new Map<string, string | null>(seed);
  const missingReservationIds = reservationIds.filter((reservationId) => {
    const profileId = next.get(reservationId);
    return !profileId;
  });

  if (missingReservationIds.length === 0) {
    return next;
  }

  const { data, error } = await supabase
    .from("reservation_guests")
    .select("reservation_id, guest_profile_id, display_order")
    .in("reservation_id", missingReservationIds)
    .eq("role", "primary")
    .order("display_order", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(error.message ?? "Failed to resolve primary guest profiles.");
  }

  for (const row of (data ?? []) as Array<{ reservation_id: string; guest_profile_id: string | null }>) {
    const reservationId = String(row.reservation_id ?? "");
    if (!reservationId || next.get(reservationId)) continue;
    next.set(reservationId, row.guest_profile_id ? String(row.guest_profile_id) : null);
  }

  return next;
}

export async function fetchGuestLoyaltyByProfileId(
  supabase: SupabaseLike,
  profileIds: string[]
): Promise<Map<string, GuestLoyaltySnapshot>> {
  const map = new Map<string, GuestLoyaltySnapshot>();
  if (profileIds.length === 0) return map;

  // ── Run all 4 queries in parallel (they all only depend on profileIds) ──
  const [profileResult, partyResult, primaryFallbackResult, legacyResult] = await Promise.all([
    supabase
      .from("guest_profiles")
      .select("id, vip_tier")
      .in("id", profileIds),
    supabase
      .from("reservation_guests")
      .select(`
        reservation_id,
        guest_profile_id,
        role,
        reservations!inner(
          id,
          status,
          checkin_date,
          checkout_date
        )
      `)
      .in("guest_profile_id", profileIds)
      .eq("reservations.status", "checked_out"),
    supabase
      .from("reservations")
      .select("id, guest_profile_id, checkin_date, checkout_date, status")
      .in("guest_profile_id", profileIds)
      .eq("status", "checked_out"),
    supabase
      .from("legacy_stays")
      .select("id, guest_profile_id, date_in, date_out, nights")
      .in("guest_profile_id", profileIds),
  ]);

  if (profileResult.error) {
    throw new Error(profileResult.error.message ?? "Failed to load guest loyalty fields.");
  }

  for (const row of (profileResult.data ?? []) as Array<Pick<ProfileLookupRow, "id" | "vip_tier">>) {
    const profileId = row?.id ? String(row.id) : "";
    if (!profileId) continue;
    map.set(
      profileId,
      normalizeGuestLoyaltySnapshot({
        vip_tier: row.vip_tier ?? "regular",
        stay_count: 0,
        night_count: 0,
        main_stay_count: 0,
        main_night_count: 0,
        accompanying_stay_count: 0,
        accompanying_night_count: 0,
      })
    );
  }

  if (partyResult.error) {
    throw new Error(partyResult.error.message ?? "Failed to load guest loyalty reservation party history.");
  }

  const persistedPrimaryReservationKeys = new Set<string>();
  const seenRoleKeys = new Set<string>();

  for (const row of (partyResult.data ?? []) as Array<{
    reservation_id: string;
    guest_profile_id: string | null;
    role: string | null;
    reservations?: { id?: string; checkin_date?: string | null; checkout_date?: string | null } | null;
  }>) {
    const profileId = row?.guest_profile_id ? String(row.guest_profile_id) : "";
    const reservationId = row?.reservation_id ? String(row.reservation_id) : "";
    if (!profileId || !reservationId) continue;
    const role = row?.role === "primary" ? "primary" : "accompanying";
    const roleKey = `${reservationId}:${profileId}:${role}`;
    if (seenRoleKeys.has(roleKey)) continue;
    seenRoleKeys.add(roleKey);
    if (role === "primary") {
      persistedPrimaryReservationKeys.add(`${reservationId}:${profileId}`);
    }

    const snapshot = map.get(profileId) ?? normalizeGuestLoyaltySnapshot({ vip_tier: "regular" });
    const nights = diffStayNights(row.reservations?.checkin_date, row.reservations?.checkout_date);
    snapshot.stay_count += 1;
    snapshot.night_count += nights;
    if (role === "primary") {
      snapshot.main_stay_count += 1;
      snapshot.main_night_count += nights;
    } else {
      snapshot.accompanying_stay_count += 1;
      snapshot.accompanying_night_count += nights;
    }
    map.set(profileId, snapshot);
  }

  if (primaryFallbackResult.error) {
    throw new Error(primaryFallbackResult.error.message ?? "Failed to load fallback primary guest loyalty history.");
  }

  for (const row of (primaryFallbackResult.data ?? []) as Array<{
    id: string;
    guest_profile_id: string | null;
    checkin_date?: string | null;
    checkout_date?: string | null;
  }>) {
    const profileId = row?.guest_profile_id ? String(row.guest_profile_id) : "";
    const reservationId = row?.id ? String(row.id) : "";
    if (!profileId || !reservationId) continue;
    const primaryKey = `${reservationId}:${profileId}`;
    if (persistedPrimaryReservationKeys.has(primaryKey)) continue;

    const snapshot = map.get(profileId) ?? normalizeGuestLoyaltySnapshot({ vip_tier: "regular" });
    const nights = diffStayNights(row.checkin_date, row.checkout_date);
    snapshot.stay_count += 1;
    snapshot.night_count += nights;
    snapshot.main_stay_count += 1;
    snapshot.main_night_count += nights;
    map.set(profileId, snapshot);
  }

  // ── Add legacy stays (imported historical data) ──
  if (!legacyResult.error) {
    for (const row of (legacyResult.data ?? []) as Array<{
      id: string;
      guest_profile_id: string | null;
      date_in?: string | null;
      date_out?: string | null;
      nights?: number | null;
    }>) {
      const profileId = row?.guest_profile_id ? String(row.guest_profile_id) : "";
      if (!profileId) continue;

      const snapshot = map.get(profileId) ?? normalizeGuestLoyaltySnapshot({ vip_tier: "regular" });
      const nights = row.nights ?? diffStayNights(row.date_in, row.date_out);
      snapshot.stay_count += 1;
      snapshot.night_count += nights;
      snapshot.main_stay_count += 1;
      snapshot.main_night_count += nights;
      map.set(profileId, snapshot);
    }
  }

  return map;
}

export async function buildReservationLoyaltyMap(
  supabase: SupabaseLike,
  reservationIds: string[],
  seed: Map<string, string | null>
): Promise<Map<string, GuestLoyaltySnapshot>> {
  const resolvedPrimaryMap = await resolvePrimaryGuestProfileMap(supabase, reservationIds, seed);
  const profileIds = Array.from(
    new Set(Array.from(resolvedPrimaryMap.values()).filter((profileId): profileId is string => Boolean(profileId)))
  );
  const loyaltyByProfileId = await fetchGuestLoyaltyByProfileId(supabase, profileIds);

  const loyaltyByReservationId = new Map<string, GuestLoyaltySnapshot>();
  for (const [reservationId, profileId] of resolvedPrimaryMap.entries()) {
    if (!profileId) continue;
    const loyalty = loyaltyByProfileId.get(profileId);
    if (!loyalty) continue;
    loyaltyByReservationId.set(reservationId, loyalty);
  }

  return loyaltyByReservationId;
}
