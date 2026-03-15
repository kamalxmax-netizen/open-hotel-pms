import { listNights } from "@/lib/dates";

type DiscountType = "percent" | "fixed" | "override";

type RatePlanRow = {
  id: string;
  code: string;
  name_en: string;
  discount_type: DiscountType;
  discount_value: number | string;
  min_nights: number;
  max_nights: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  apply_to_room_types: number[] | null;
};

export type AppliedRateNight = {
  stay_date: string;
  rack_rate: number;
  applied_rate: number;
  discount_amount: number;
};

export class RatePlanPricingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RatePlanPricingError";
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

function applyDiscount(rackRate: number, discountType: DiscountType, discountValue: number) {
  if (discountType === "percent") {
    return round2(Math.max(0, rackRate * (1 - discountValue / 100)));
  }
  if (discountType === "fixed") {
    return round2(Math.max(0, rackRate - discountValue));
  }
  return round2(discountValue);
}

function isNightAllowedByPeriod(night: string, validFrom: string | null, validUntil: string | null): boolean {
  if (validFrom && night < validFrom) return false;
  if (validUntil && night > validUntil) return false;
  return true;
}

export async function calculateAppliedRateNights(params: {
  supabase: any;
  roomTypeId: number;
  checkinDate: string;
  checkoutDate: string;
  ratePlanId: string;
}): Promise<{ nights: AppliedRateNight[]; totalApplied: number }> {
  const { supabase, roomTypeId, checkinDate, checkoutDate, ratePlanId } = params;

  let nights: string[] = [];
  try {
    nights = listNights(checkinDate, checkoutDate);
  } catch (err) {
    throw new RatePlanPricingError((err as Error).message, 400);
  }

  const { data: roomRows, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_type_id", roomTypeId)
    .eq("is_sellable", true);
  if (roomError) {
    throw new RatePlanPricingError(roomError.message, 500);
  }
  if (!roomRows || roomRows.length === 0) {
    throw new RatePlanPricingError("No sellable rooms found for this room type.", 404);
  }

  const roomIds = roomRows.map((room: any) => room.id);

  const { data: rateRows, error: rateError } = await supabase
    .from("rate_templates")
    .select("stay_date, price, room_id")
    .in("room_id", roomIds)
    .in("stay_date", nights);
  if (rateError) {
    throw new RatePlanPricingError(rateError.message, 500);
  }

  const rackByDate = new Map<string, number>();
  for (const night of nights) {
    const rowsForNight = (rateRows ?? []).filter((row: any) => row.stay_date === night);
    if (rowsForNight.length === 0) {
      rackByDate.set(night, 0);
      continue;
    }
    const average =
      rowsForNight.reduce((sum: number, row: any) => sum + toNumber(row.price), 0) / rowsForNight.length;
    rackByDate.set(night, round2(average));
  }

  const { data: planData, error: planError } = await supabase
    .from("rate_plans")
    .select("*")
    .eq("id", ratePlanId)
    .maybeSingle();
  if (planError) {
    throw new RatePlanPricingError(planError.message, 500);
  }
  if (!planData) {
    throw new RatePlanPricingError("Rate plan not found.", 404);
  }

  const selectedPlan = planData as RatePlanRow;
  if (!selectedPlan.is_active) {
    throw new RatePlanPricingError("Rate plan is inactive.", 400);
  }

  const totalNights = nights.length;
  if (totalNights < (selectedPlan.min_nights ?? 1)) {
    throw new RatePlanPricingError(`Rate plan requires minimum ${selectedPlan.min_nights} night(s).`, 400);
  }
  if (selectedPlan.max_nights != null && totalNights > selectedPlan.max_nights) {
    throw new RatePlanPricingError(`Rate plan allows maximum ${selectedPlan.max_nights} night(s).`, 400);
  }

  const applicableTypes = selectedPlan.apply_to_room_types ?? null;
  if (applicableTypes && applicableTypes.length > 0) {
    const normalized = applicableTypes.map((item) => Number(item));
    if (!normalized.includes(roomTypeId)) {
      throw new RatePlanPricingError("Rate plan is not applicable to this room type.", 400);
    }
  }

  const validFrom = selectedPlan.valid_from;
  const validUntil = selectedPlan.valid_until;
  const hasInvalidNight = nights.some((night) => !isNightAllowedByPeriod(night, validFrom, validUntil));
  if (hasInvalidNight) {
    throw new RatePlanPricingError("Rate plan is outside valid date range for selected stay.", 400);
  }

  const discountType = selectedPlan.discount_type;
  const discountValue = toNumber(selectedPlan.discount_value);

  const nightly: AppliedRateNight[] = nights.map((stayDate) => {
    const rackRate = rackByDate.get(stayDate) ?? 0;
    const appliedRate = applyDiscount(rackRate, discountType, discountValue);
    const discountAmount = round2(rackRate - appliedRate);
    return {
      stay_date: stayDate,
      rack_rate: rackRate,
      applied_rate: appliedRate,
      discount_amount: discountAmount
    };
  });

  const totalApplied = round2(nightly.reduce((sum, row) => sum + row.applied_rate, 0));
  return { nights: nightly, totalApplied };
}

export async function applyNightlyRatesToReservation(params: {
  supabase: any;
  reservationId: string;
  nights: AppliedRateNight[];
  totalApplied: number;
}): Promise<void> {
  const { supabase, reservationId, nights, totalApplied } = params;

  for (const night of nights) {
    const { error } = await supabase
      .from("reservation_nights")
      .update({ nightly_price: night.applied_rate })
      .eq("reservation_id", reservationId)
      .eq("stay_date", night.stay_date)
      .is("cancelled_at", null);
    if (error) {
      throw new RatePlanPricingError(error.message, 500);
    }
  }

  const { error: reservationError } = await supabase
    .from("reservations")
    .update({ total_price: totalApplied })
    .eq("id", reservationId);
  if (reservationError) {
    throw new RatePlanPricingError(reservationError.message, 500);
  }
}
