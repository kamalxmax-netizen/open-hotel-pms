import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isValidDateString, listNights } from "@/lib/dates";

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const roomTypeIdRaw = body.room_type_id;
    const roomIdRaw = body.room_id ? String(body.room_id) : "";
    const checkinDate = String(body.checkin_date ?? "");
    const checkoutDate = String(body.checkout_date ?? "");
    const ratePlanId = body.rate_plan_id ? String(body.rate_plan_id) : null;

    const roomTypeId = Number(roomTypeIdRaw);
    if (!Number.isFinite(roomTypeId) || roomTypeId <= 0) {
      return NextResponse.json({ error: "room_type_id is required." }, { status: 400 });
    }
    if (!isValidDateString(checkinDate) || !isValidDateString(checkoutDate)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }

    let nights: string[] = [];
    try {
      nights = listNights(checkinDate, checkoutDate);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();

    const { data: roomRows, error: roomError } = await supabase
      .from("rooms")
      .select("id, sort_order, room_number")
      .eq("room_type_id", roomTypeId)
      .eq("is_sellable", true)
      .order("sort_order", { ascending: true })
      .order("room_number", { ascending: true });

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }
    if (!roomRows || roomRows.length === 0) {
      return NextResponse.json({ error: "No sellable rooms found for this room type." }, { status: 404 });
    }

    let pricingRoomIds = roomRows.slice(0, 1).map((room) => room.id);
    if (roomIdRaw) {
      const selectedRoom = roomRows.find((room) => String(room.id) === roomIdRaw);
      if (!selectedRoom) {
        return NextResponse.json({ error: "Selected room is not valid for this room type." }, { status: 400 });
      }
      pricingRoomIds = [selectedRoom.id];
    }

    const { data: rateRows, error: rateError } = await supabase
      .from("rate_templates")
      .select("stay_date, price, room_id")
      .in("room_id", pricingRoomIds)
      .in("stay_date", nights);

    if (rateError) {
      return NextResponse.json({ error: rateError.message }, { status: 500 });
    }

    const rackByDate = new Map<string, number>();
    for (const night of nights) {
      const rowsForNight = (rateRows ?? []).filter((row) => row.stay_date === night);
      if (rowsForNight.length === 0) {
        rackByDate.set(night, 0);
        continue;
      }
      const average =
        rowsForNight.reduce((sum, row) => sum + toNumber(row.price), 0) / rowsForNight.length;
      rackByDate.set(night, round2(average));
    }

    let selectedPlan: RatePlanRow | null = null;
    if (ratePlanId) {
      const { data, error } = await supabase
        .from("rate_plans")
        .select("*")
        .eq("id", ratePlanId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ error: "Rate plan not found." }, { status: 404 });
      }
      selectedPlan = data as RatePlanRow;
    }
    const totalNights = nights.length;
    if (selectedPlan) {
      if (!selectedPlan.is_active) {
        return NextResponse.json({ error: "Rate plan is inactive." }, { status: 400 });
      }

      if (totalNights < (selectedPlan.min_nights ?? 1)) {
        return NextResponse.json({
          error: `Rate plan requires minimum ${selectedPlan.min_nights} night(s).`
        }, { status: 400 });
      }
      if (selectedPlan.max_nights != null && totalNights > selectedPlan.max_nights) {
        return NextResponse.json({
          error: `Rate plan allows maximum ${selectedPlan.max_nights} night(s).`
        }, { status: 400 });
      }

      const applicableTypes = selectedPlan.apply_to_room_types ?? null;
      if (applicableTypes && applicableTypes.length > 0) {
        const normalized = applicableTypes.map((item) => Number(item));
        if (!normalized.includes(roomTypeId)) {
          return NextResponse.json({
            error: "Rate plan is not applicable to this room type."
          }, { status: 400 });
        }
      }

      const validFrom = selectedPlan.valid_from;
      const validUntil = selectedPlan.valid_until;
      const hasInvalidNight = nights.some((night) => !isNightAllowedByPeriod(night, validFrom, validUntil));
      if (hasInvalidNight) {
        return NextResponse.json({
          error: "Rate plan is outside valid date range for selected stay."
        }, { status: 400 });
      }
    }

    const discountType: DiscountType = selectedPlan?.discount_type ?? "percent";
    const discountValue = selectedPlan ? toNumber(selectedPlan.discount_value) : 0;

    const nightly = nights.map((date) => {
      const rackRate = rackByDate.get(date) ?? 0;
      const appliedRate = applyDiscount(rackRate, discountType, discountValue);
      const discountAmount = round2(rackRate - appliedRate);
      return {
        date,
        rack_rate: rackRate,
        applied_rate: appliedRate,
        discount_amount: discountAmount
      };
    });

    const totalRack = round2(nightly.reduce((sum, row) => sum + row.rack_rate, 0));
    const totalApplied = round2(nightly.reduce((sum, row) => sum + row.applied_rate, 0));
    const totalDiscount = round2(totalRack - totalApplied);

    return NextResponse.json({
      success: true,
      nights: nightly,
      total_rack: totalRack,
      total_applied: totalApplied,
      total_discount: totalDiscount,
      rate_plan: {
        id: selectedPlan?.id ?? null,
        code: selectedPlan?.code ?? "RACK",
        name_en: selectedPlan?.name_en ?? "Rack / Rate Grid"
      }
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
