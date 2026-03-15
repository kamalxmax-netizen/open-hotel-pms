import type { RatePlanEligibilitySource, RatePlanTierCode } from "@/lib/types";

type DiscountType = "percent" | "fixed" | "override";

export type RatePlanBaseRow = {
  id: string;
  code: string;
  name_en: string;
  name_th: string | null;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number | string;
  min_nights: number | string | null;
  max_nights: number | string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  apply_to_room_types: number[] | string[] | null;
  sort_order: number | string | null;
};

export type RatePlanAccessMappingRow = {
  rate_plan_id: string;
  tier_code?: string | null;
  profile_id?: string | null;
};

export type RatePlanEligibilityAnnotated<T extends RatePlanBaseRow = RatePlanBaseRow> = T & {
  tier_codes: RatePlanTierCode[];
  profile_ids: string[];
  access_summary: {
    is_public: boolean;
    tier_codes: RatePlanTierCode[];
    profile_ids: string[];
  };
  eligibility_source: RatePlanEligibilitySource;
  eligibility_badges: string[];
  source_priority: number;
};

export const RATE_PLAN_TIER_LABEL: Record<RatePlanTierCode, string> = {
  loyal: "Loyal",
  vip: "VIP",
  longest: "VIP+",
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function normalizeRatePlanTierCode(value: unknown): RatePlanTierCode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "loyal" || normalized === "vip" || normalized === "longest") {
    return normalized;
  }
  return null;
}

export function isRatePlanEligibleByStayContext(plan: RatePlanBaseRow, params?: {
  roomTypeId?: number | null;
  nights?: number | null;
}): boolean {
  const roomTypeId = params?.roomTypeId ?? null;
  const nights = params?.nights ?? null;
  const minNights = Math.max(1, Math.trunc(toNumber(plan.min_nights ?? 1)));
  const maxNights = plan.max_nights == null ? null : Math.trunc(toNumber(plan.max_nights));

  if (roomTypeId && Array.isArray(plan.apply_to_room_types) && plan.apply_to_room_types.length > 0) {
    const applicableRoomTypes = plan.apply_to_room_types
      .map((value) => Math.trunc(toNumber(value)))
      .filter((value) => value > 0);
    if (!applicableRoomTypes.includes(roomTypeId)) return false;
  }

  if (nights != null && nights > 0) {
    if (minNights > nights) return false;
    if (maxNights != null && nights > maxNights) return false;
  }

  return true;
}

export function isRatePlanEligibleByDateContext(plan: RatePlanBaseRow, params?: {
  checkinDate?: string | null;
  checkoutDate?: string | null;
}): boolean {
  const checkinDate = params?.checkinDate ?? null;
  const checkoutDate = params?.checkoutDate ?? null;
  if (!checkinDate || !checkoutDate) return true;
  if (plan.valid_from && checkoutDate <= plan.valid_from) return false;
  if (plan.valid_until && checkinDate > plan.valid_until) return false;
  return true;
}

export function annotateEligibleRatePlans<T extends RatePlanBaseRow>(params: {
  plans: T[];
  tierMappings?: RatePlanAccessMappingRow[];
  profileMappings?: RatePlanAccessMappingRow[];
  guestProfileId?: string | null;
  guestTierCode?: string | null;
  roomTypeId?: number | null;
  nights?: number | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
  activeOnly?: boolean;
}): RatePlanEligibilityAnnotated<T>[] {
  const {
    plans,
    tierMappings = [],
    profileMappings = [],
    guestProfileId = null,
    guestTierCode = null,
    roomTypeId = null,
    nights = null,
    checkinDate = null,
    checkoutDate = null,
    activeOnly = false,
  } = params;

  const normalizedGuestTier = normalizeRatePlanTierCode(guestTierCode);
  const normalizedGuestProfileId = guestProfileId ? String(guestProfileId) : null;

  const tierMap = new Map<string, RatePlanTierCode[]>();
  for (const row of tierMappings) {
    const planId = String(row.rate_plan_id ?? "");
    const tierCode = normalizeRatePlanTierCode(row.tier_code);
    if (!planId || !tierCode) continue;
    const existing = tierMap.get(planId) ?? [];
    if (!existing.includes(tierCode)) existing.push(tierCode);
    tierMap.set(planId, existing);
  }

  const profileMap = new Map<string, string[]>();
  for (const row of profileMappings) {
    const planId = String(row.rate_plan_id ?? "");
    const profileId = row.profile_id ? String(row.profile_id) : "";
    if (!planId || !profileId) continue;
    const existing = profileMap.get(planId) ?? [];
    if (!existing.includes(profileId)) existing.push(profileId);
    profileMap.set(planId, existing);
  }

  return plans
    .filter((plan) => {
      if (activeOnly && !plan.is_active) return false;
      if (!isRatePlanEligibleByStayContext(plan, { roomTypeId, nights })) return false;
      if (!isRatePlanEligibleByDateContext(plan, { checkinDate, checkoutDate })) return false;

      const tierCodes = tierMap.get(String(plan.id)) ?? [];
      const profileIds = profileMap.get(String(plan.id)) ?? [];
      const isPublic = tierCodes.length === 0 && profileIds.length === 0;

      if (isPublic) return true;
      if (!normalizedGuestProfileId) return false;

      const profileMatch = profileIds.includes(normalizedGuestProfileId);
      const tierMatch = normalizedGuestTier ? tierCodes.includes(normalizedGuestTier) : false;
      return profileMatch || tierMatch;
    })
    .map((plan) => {
      const tierCodes = tierMap.get(String(plan.id)) ?? [];
      const profileIds = profileMap.get(String(plan.id)) ?? [];
      const isPublic = tierCodes.length === 0 && profileIds.length === 0;
      const profileMatch = normalizedGuestProfileId ? profileIds.includes(normalizedGuestProfileId) : false;
      const tierMatch = normalizedGuestTier ? tierCodes.includes(normalizedGuestTier) : false;

      let eligibilitySource: RatePlanEligibilitySource = "public";
      if (profileMatch) eligibilitySource = "profile";
      else if (tierMatch) eligibilitySource = "tier";

      const eligibilityBadges =
        eligibilitySource === "profile"
          ? ["Special"]
          : eligibilitySource === "tier" && normalizedGuestTier
            ? [RATE_PLAN_TIER_LABEL[normalizedGuestTier]]
            : [];

      const sourcePriority = eligibilitySource === "profile" ? 0 : eligibilitySource === "tier" ? 1 : 2;

      return {
        ...plan,
        tier_codes: tierCodes,
        profile_ids: profileIds,
        access_summary: {
          is_public: isPublic,
          tier_codes: tierCodes,
          profile_ids: profileIds,
        },
        eligibility_source: eligibilitySource,
        eligibility_badges: eligibilityBadges,
        source_priority: sourcePriority,
      };
    })
    .sort((a, b) => {
      if (a.source_priority !== b.source_priority) return a.source_priority - b.source_priority;
      const sortA = Math.trunc(toNumber(a.sort_order ?? 0));
      const sortB = Math.trunc(toNumber(b.sort_order ?? 0));
      if (sortA !== sortB) return sortA - sortB;
      return String(a.code).localeCompare(String(b.code));
    });
}

export function computeRatePlanAccessSummary(params: {
  tierCodes?: RatePlanTierCode[];
  profileIds?: string[];
}): {
  is_public: boolean;
  label: string;
} {
  const tierCodes = [...new Set((params.tierCodes ?? []).filter(Boolean))];
  const profileIds = [...new Set((params.profileIds ?? []).filter(Boolean))];
  if (tierCodes.length === 0 && profileIds.length === 0) {
    return { is_public: true, label: "Public" };
  }
  if (profileIds.length > 0 && tierCodes.length === 0) {
    return { is_public: false, label: `Special: ${profileIds.length} profile${profileIds.length === 1 ? "" : "s"}` };
  }
  if (profileIds.length === 0) {
    return { is_public: false, label: `Tier: ${tierCodes.map((code) => RATE_PLAN_TIER_LABEL[code]).join(", ")}` };
  }
  return {
    is_public: false,
    label: `Special + Tier (${profileIds.length} profile${profileIds.length === 1 ? "" : "s"})`
  };
}

export class RatePlanEligibilityError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RatePlanEligibilityError";
    this.status = status;
  }
}

export async function fetchRatePlanGuestTier(supabase: any, guestProfileId?: string | null): Promise<RatePlanTierCode | null> {
  if (!guestProfileId) return null;
  const { data, error } = await supabase
    .from("guest_profiles")
    .select("vip_tier")
    .eq("id", guestProfileId)
    .maybeSingle();
  if (error) {
    throw new RatePlanEligibilityError(error.message, 500);
  }
  return normalizeRatePlanTierCode(data?.vip_tier);
}

export async function fetchRatePlanAccessMappings(supabase: any, planIds?: string[]) {
  const normalizedPlanIds = [...new Set((planIds ?? []).map((value) => String(value)).filter(Boolean))];

  let tierQuery = supabase.from("rate_plan_tiers").select("rate_plan_id, tier_code");
  let profileQuery = supabase.from("rate_plan_profiles").select("rate_plan_id, profile_id");

  if (normalizedPlanIds.length > 0) {
    tierQuery = tierQuery.in("rate_plan_id", normalizedPlanIds);
    profileQuery = profileQuery.in("rate_plan_id", normalizedPlanIds);
  }

  const [tierRes, profileRes] = await Promise.all([tierQuery, profileQuery]);
  if (tierRes.error) {
    throw new RatePlanEligibilityError(tierRes.error.message, 500);
  }
  if (profileRes.error) {
    throw new RatePlanEligibilityError(profileRes.error.message, 500);
  }

  return {
    tierMappings: (tierRes.data ?? []) as RatePlanAccessMappingRow[],
    profileMappings: (profileRes.data ?? []) as RatePlanAccessMappingRow[],
  };
}

export async function resolveReservationGuestProfileId(supabase: any, reservationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("reservation_guests")
    .select("guest_profile_id")
    .eq("reservation_id", reservationId)
    .eq("is_primary", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new RatePlanEligibilityError(error.message, 500);
  }
  return data?.guest_profile_id ? String(data.guest_profile_id) : null;
}

export async function assertRatePlanEligibleForGuest(params: {
  supabase: any;
  ratePlanId: string;
  guestProfileId?: string | null;
  roomTypeId?: number | null;
  nights?: number | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
}) {
  const { supabase, ratePlanId, guestProfileId = null, roomTypeId = null, nights = null, checkinDate = null, checkoutDate = null } = params;
  const { data: plan, error: planError } = await supabase
    .from("rate_plans")
    .select("*")
    .eq("id", ratePlanId)
    .maybeSingle();
  if (planError) {
    throw new RatePlanEligibilityError(planError.message, 500);
  }
  if (!plan) {
    throw new RatePlanEligibilityError("Rate plan not found.", 404);
  }

  const { tierMappings, profileMappings } = await fetchRatePlanAccessMappings(supabase, [ratePlanId]);
  const guestTierCode = await fetchRatePlanGuestTier(supabase, guestProfileId);
  const eligiblePlans = annotateEligibleRatePlans({
    plans: [plan as RatePlanBaseRow],
    tierMappings,
    profileMappings,
    guestProfileId,
    guestTierCode,
    roomTypeId,
    nights,
    checkinDate,
    checkoutDate,
    activeOnly: true,
  });

  if (eligiblePlans.length === 0) {
    throw new RatePlanEligibilityError("Selected rate plan is not available for this guest.", 400);
  }

  return eligiblePlans[0];
}
