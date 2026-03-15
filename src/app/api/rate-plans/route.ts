import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  annotateEligibleRatePlans,
  computeRatePlanAccessSummary,
  fetchRatePlanAccessMappings,
  fetchRatePlanGuestTier,
  normalizeRatePlanTierCode,
  RATE_PLAN_TIER_LABEL,
} from "@/lib/rate-plan-eligibility";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type DiscountType = "percent" | "fixed" | "override";

type RatePlanInsert = {
  code: string;
  name_en: string;
  name_th?: string | null;
  description?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  min_nights?: number;
  max_nights?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  apply_to_room_types?: number[] | null;
  sort_order?: number;
};

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function parseApplyToRoomTypes(value: unknown): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;

  const numbers = value
    .map((item) => toNumber(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item))
    .filter((item) => item > 0);

  if (numbers.length === 0) return [];
  return [...new Set(numbers)];
}

function isValidDiscountType(value: unknown): value is DiscountType {
  return value === "percent" || value === "fixed" || value === "override";
}

function sanitizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function parseTierCodes(value: unknown) {
  return parseStringArray(value)
    .map((item) => normalizeRatePlanTierCode(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mapAdminAccess(plan: Record<string, unknown>, tierCodes: Array<"loyal" | "vip" | "longest">, profileIds: string[]) {
  const accessSummary = computeRatePlanAccessSummary({ tierCodes, profileIds });
  const eligibilitySource =
    profileIds.length > 0 ? "profile" : tierCodes.length > 0 ? "tier" : "public";
  const eligibilityBadges =
    profileIds.length > 0
      ? ["Special"]
      : tierCodes.length > 0
        ? tierCodes.map((code) => RATE_PLAN_TIER_LABEL[code])
        : [];

  return {
    ...plan,
    tier_codes: tierCodes,
    profile_ids: profileIds,
    access_summary: accessSummary,
    eligibility_source: eligibilitySource,
    eligibility_badges: eligibilityBadges,
  };
}

async function syncRatePlanAccessMappings(params: {
  supabase: any;
  ratePlanId: string;
  tierCodes: string[];
  profileIds: string[];
}) {
  const { supabase, ratePlanId, tierCodes, profileIds } = params;

  const deleteTierRes = await supabase.from("rate_plan_tiers").delete().eq("rate_plan_id", ratePlanId);
  if (deleteTierRes.error) throw new Error(deleteTierRes.error.message);

  const deleteProfileRes = await supabase.from("rate_plan_profiles").delete().eq("rate_plan_id", ratePlanId);
  if (deleteProfileRes.error) throw new Error(deleteProfileRes.error.message);

  if (tierCodes.length > 0) {
    const insertTierRes = await supabase.from("rate_plan_tiers").insert(
      tierCodes.map((tierCode) => ({ rate_plan_id: ratePlanId, tier_code: tierCode }))
    );
    if (insertTierRes.error) throw new Error(insertTierRes.error.message);
  }

  if (profileIds.length > 0) {
    const insertProfileRes = await supabase.from("rate_plan_profiles").insert(
      profileIds.map((profileId) => ({ rate_plan_id: ratePlanId, profile_id: profileId }))
    );
    if (insertProfileRes.error) throw new Error(insertProfileRes.error.message);
  }
}

export async function GET(request: NextRequest) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const activeParam = request.nextUrl.searchParams.get("active");
    const scope = request.nextUrl.searchParams.get("scope") === "booking" ? "booking" : "admin";
    const roomTypeId = request.nextUrl.searchParams.get("room_type_id");
    const nightsParam = request.nextUrl.searchParams.get("nights");
    const guestProfileId = request.nextUrl.searchParams.get("guest_profile_id");
    const checkinDate = request.nextUrl.searchParams.get("checkin_date");
    const checkoutDate = request.nextUrl.searchParams.get("checkout_date");

    let query = supabase
      .from("rate_plans")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });

    if (activeParam === "true") query = query.eq("is_active", true);
    if (activeParam === "false") query = query.eq("is_active", false);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const plans = (data ?? []) as Array<Record<string, unknown>>;
    const planIds = plans.map((plan) => String(plan.id));
    const { tierMappings, profileMappings } = await fetchRatePlanAccessMappings(supabase, planIds);

    if (scope === "booking") {
      const guestTier = await fetchRatePlanGuestTier(supabase, guestProfileId);
      const eligibleRatePlans = annotateEligibleRatePlans({
        plans: plans as any[],
        tierMappings,
        profileMappings,
        guestProfileId,
        guestTierCode: guestTier,
        roomTypeId: roomTypeId ? Number(roomTypeId) : null,
        nights: nightsParam ? Number(nightsParam) : null,
        checkinDate,
        checkoutDate,
        activeOnly: activeParam !== "false",
      });

      return NextResponse.json({
        success: true,
        ratePlans: eligibleRatePlans
      });
    }

    const tierMap = new Map<string, Array<"loyal" | "vip" | "longest">>();
    for (const row of tierMappings) {
      const tierCode = normalizeRatePlanTierCode(row.tier_code);
      const planId = String(row.rate_plan_id ?? "");
      if (!planId || !tierCode) continue;
      const current = tierMap.get(planId) ?? [];
      if (!current.includes(tierCode)) current.push(tierCode);
      tierMap.set(planId, current);
    }

    const profileMap = new Map<string, string[]>();
    for (const row of profileMappings) {
      const planId = String(row.rate_plan_id ?? "");
      const profileId = row.profile_id ? String(row.profile_id) : "";
      if (!planId || !profileId) continue;
      const current = profileMap.get(planId) ?? [];
      if (!current.includes(profileId)) current.push(profileId);
      profileMap.set(planId, current);
    }

    return NextResponse.json({
      success: true,
      ratePlans: plans.map((plan) =>
        mapAdminAccess(plan, tierMap.get(String(plan.id)) ?? [], profileMap.get(String(plan.id)) ?? [])
      )
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = sanitizeCode(body.code);
    const nameEn = String(body.name_en ?? "").trim();
    const discountType = body.discount_type;
    const discountValue = toNumber(body.discount_value);
    const minNightsRaw = body.min_nights == null ? 1 : toNumber(body.min_nights);
    const maxNightsRaw = body.max_nights == null || body.max_nights === "" ? null : toNumber(body.max_nights);
    const sortOrderRaw = body.sort_order == null ? 0 : toNumber(body.sort_order);
    const validFrom = body.valid_from ? String(body.valid_from) : null;
    const validUntil = body.valid_until ? String(body.valid_until) : null;
    const applyToRoomTypes = parseApplyToRoomTypes(body.apply_to_room_types);
    const tierCodes = parseTierCodes(body.tier_codes);
    const profileIds = parseStringArray(body.profile_ids);

    if (!code) {
      return NextResponse.json({ error: "code is required." }, { status: 400 });
    }
    if (!nameEn) {
      return NextResponse.json({ error: "name_en is required." }, { status: 400 });
    }
    if (!isValidDiscountType(discountType)) {
      return NextResponse.json({ error: "discount_type must be percent, fixed, or override." }, { status: 400 });
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      return NextResponse.json({ error: "discount_value must be >= 0." }, { status: 400 });
    }
    if (!Number.isFinite(minNightsRaw) || minNightsRaw < 1) {
      return NextResponse.json({ error: "min_nights must be >= 1." }, { status: 400 });
    }
    if (maxNightsRaw != null && (!Number.isFinite(maxNightsRaw) || maxNightsRaw < minNightsRaw)) {
      return NextResponse.json({ error: "max_nights must be >= min_nights." }, { status: 400 });
    }
    if (!Number.isFinite(sortOrderRaw)) {
      return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
    }
    if (validFrom && validUntil && validUntil < validFrom) {
      return NextResponse.json({ error: "valid_until must be >= valid_from." }, { status: 400 });
    }

    const payload: RatePlanInsert = {
      code,
      name_en: nameEn,
      name_th: body.name_th ? String(body.name_th) : null,
      description: body.description ? String(body.description) : null,
      discount_type: discountType,
      discount_value: Number(discountValue.toFixed(2)),
      min_nights: Math.trunc(minNightsRaw),
      max_nights: maxNightsRaw == null ? null : Math.trunc(maxNightsRaw),
      valid_from: validFrom,
      valid_until: validUntil,
      is_active: body.is_active == null ? true : Boolean(body.is_active),
      apply_to_room_types: applyToRoomTypes,
      sort_order: Math.trunc(sortOrderRaw)
    };

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("rate_plans")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.id) {
      return NextResponse.json({ error: "Rate plan was created without id." }, { status: 500 });
    }

    await syncRatePlanAccessMappings({
      supabase,
      ratePlanId: String(data.id),
      tierCodes,
      profileIds,
    });

    return NextResponse.json({
      success: true,
      ratePlan: mapAdminAccess(data, tierCodes, profileIds)
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
