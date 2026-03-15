import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  computeRatePlanAccessSummary,
  fetchRatePlanAccessMappings,
  normalizeRatePlanTierCode,
  RATE_PLAN_TIER_LABEL,
} from "@/lib/rate-plan-eligibility";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

type DiscountType = "percent" | "fixed" | "override";

type RouteParams = { params: { id: string } };

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function parseApplyToRoomTypes(value: unknown): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const values = value
    .map((item) => toNumber(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item))
    .filter((item) => item > 0);
  return [...new Set(values)];
}

function isDiscountType(value: unknown): value is DiscountType {
  return value === "percent" || value === "fixed" || value === "override";
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

function mapRatePlanWithAccess(plan: Record<string, unknown>, tierCodes: Array<"loyal" | "vip" | "longest">, profileIds: string[]) {
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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  noStore();
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing rate plan id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("rate_plans")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Rate plan not found." }, { status: 404 });

    const { tierMappings, profileMappings } = await fetchRatePlanAccessMappings(supabase, [id]);
    const tierCodes = tierMappings
      .map((row) => normalizeRatePlanTierCode(row.tier_code))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    const profileIds = profileMappings
      .map((row) => row.profile_id ? String(row.profile_id) : "")
      .filter(Boolean);

    return NextResponse.json({ success: true, ratePlan: mapRatePlanWithAccess(data, tierCodes, profileIds) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing rate plan id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    const tierCodes = body.tier_codes !== undefined ? parseTierCodes(body.tier_codes) : null;
    const profileIds = body.profile_ids !== undefined ? parseStringArray(body.profile_ids) : null;

    if (body.code !== undefined) {
      const code = String(body.code).trim().toUpperCase();
      if (!code) return NextResponse.json({ error: "code cannot be empty." }, { status: 400 });
      updates.code = code;
    }
    if (body.name_en !== undefined) {
      const value = String(body.name_en).trim();
      if (!value) return NextResponse.json({ error: "name_en cannot be empty." }, { status: 400 });
      updates.name_en = value;
    }
    if (body.name_th !== undefined) updates.name_th = body.name_th ? String(body.name_th) : null;
    if (body.description !== undefined) updates.description = body.description ? String(body.description) : null;

    if (body.discount_type !== undefined) {
      if (!isDiscountType(body.discount_type)) {
        return NextResponse.json({ error: "discount_type must be percent, fixed, or override." }, { status: 400 });
      }
      updates.discount_type = body.discount_type;
    }

    if (body.discount_value !== undefined) {
      const value = toNumber(body.discount_value);
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "discount_value must be >= 0." }, { status: 400 });
      }
      updates.discount_value = Number(value.toFixed(2));
    }

    if (body.min_nights !== undefined) {
      const value = Math.trunc(toNumber(body.min_nights));
      if (!Number.isFinite(value) || value < 1) {
        return NextResponse.json({ error: "min_nights must be >= 1." }, { status: 400 });
      }
      updates.min_nights = value;
    }

    if (body.max_nights !== undefined) {
      if (body.max_nights == null || body.max_nights === "") {
        updates.max_nights = null;
      } else {
        const value = Math.trunc(toNumber(body.max_nights));
        if (!Number.isFinite(value) || value < 1) {
          return NextResponse.json({ error: "max_nights must be >= 1 or null." }, { status: 400 });
        }
        updates.max_nights = value;
      }
    }

    if (body.valid_from !== undefined) updates.valid_from = body.valid_from ? String(body.valid_from) : null;
    if (body.valid_until !== undefined) updates.valid_until = body.valid_until ? String(body.valid_until) : null;
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
    if (body.sort_order !== undefined) {
      const value = Math.trunc(toNumber(body.sort_order));
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
      }
      updates.sort_order = value;
    }

    if (body.apply_to_room_types !== undefined) {
      const parsed = parseApplyToRoomTypes(body.apply_to_room_types);
      if (parsed == null && body.apply_to_room_types != null) {
        return NextResponse.json({ error: "apply_to_room_types must be an array or null." }, { status: 400 });
      }
      updates.apply_to_room_types = parsed;
    }

    const hasAccessMappingUpdates = tierCodes !== null || profileIds !== null;

    if (Object.keys(updates).length === 0 && !hasAccessMappingUpdates) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const minNights = updates.min_nights as number | undefined;
    const maxNights = updates.max_nights as number | null | undefined;
    if (minNights !== undefined && maxNights !== undefined && maxNights !== null && maxNights < minNights) {
      return NextResponse.json({ error: "max_nights must be >= min_nights." }, { status: 400 });
    }

    const validFrom = updates.valid_from as string | null | undefined;
    const validUntil = updates.valid_until as string | null | undefined;
    if (validFrom && validUntil && validUntil < validFrom) {
      return NextResponse.json({ error: "valid_until must be >= valid_from." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    let data: Record<string, unknown> | null = null;
    let error: { message: string } | null = null;

    if (Object.keys(updates).length > 0) {
      const updateRes = await supabase
        .from("rate_plans")
        .update(updates)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      data = updateRes.data;
      error = updateRes.error;
    } else {
      const currentRes = await supabase
        .from("rate_plans")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      data = currentRes.data;
      error = currentRes.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Rate plan not found." }, { status: 404 });

    let nextTierCodes = tierCodes;
    let nextProfileIds = profileIds;
    if (tierCodes !== null || profileIds !== null) {
      const existing = await fetchRatePlanAccessMappings(supabase, [id]);
      nextTierCodes = tierCodes ?? existing.tierMappings
        .map((row) => normalizeRatePlanTierCode(row.tier_code))
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
      nextProfileIds = profileIds ?? existing.profileMappings
        .map((row) => row.profile_id ? String(row.profile_id) : "")
        .filter(Boolean);

      await syncRatePlanAccessMappings({
        supabase,
        ratePlanId: id,
        tierCodes: nextTierCodes,
        profileIds: nextProfileIds,
      });
    }

    return NextResponse.json({
      success: true,
      ratePlan: mapRatePlanWithAccess(data, nextTierCodes ?? [], nextProfileIds ?? [])
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing rate plan id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("rate_plans")
      .update({ is_active: false })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Rate plan not found." }, { status: 404 });

    return NextResponse.json({
      success: true,
      message: "Rate plan set to inactive.",
      ratePlan: data
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
