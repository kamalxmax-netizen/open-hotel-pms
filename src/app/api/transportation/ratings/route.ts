import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ratingCreateSchema = z.object({
  transfer_id: z.string().uuid("transfer_id must be a valid UUID"),
  score_punctuality: z.number().int().min(1).max(5),
  score_value: z.number().int().min(1).max(5),
  score_service: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
  rated_by: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const body = await request.json().catch(() => null);
    const parsed = ratingCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    const { data: transfer, error: transferError } = await supabase
      .from("transfers")
      .select("id, status, driver_id")
      .eq("id", payload.transfer_id)
      .maybeSingle();
    if (transferError) {
      return NextResponse.json({ success: false, error: transferError.message }, { status: 500 });
    }
    if (!transfer) {
      return NextResponse.json({ success: false, error: "Transfer not found." }, { status: 404 });
    }
    if (transfer.status !== "completed") {
      return NextResponse.json({ success: false, error: "Can only rate completed transfers." }, { status: 400 });
    }
    if (!transfer.driver_id) {
      return NextResponse.json(
        { success: false, error: "Transfer has no assigned driver and cannot be rated." },
        { status: 400 }
      );
    }
    const driverId = String(transfer.driver_id);

    const { data: existingRating, error: existingRatingError } = await supabase
      .from("driver_ratings")
      .select("id")
      .eq("transfer_id", payload.transfer_id)
      .maybeSingle();
    if (existingRatingError) {
      return NextResponse.json({ success: false, error: existingRatingError.message }, { status: 500 });
    }
    if (existingRating) {
      return NextResponse.json({ success: false, error: "Rating already exists for this transfer." }, { status: 409 });
    }

    const { data: rating, error: ratingError } = await supabase
      .from("driver_ratings")
      .insert({
        transfer_id: payload.transfer_id,
        driver_id: driverId,
        score_punctuality: payload.score_punctuality,
        score_value: payload.score_value,
        score_service: payload.score_service,
        comment: payload.comment ?? null,
        rated_by: payload.rated_by ?? null,
      })
      .select("*")
      .single();
    if (ratingError) {
      return NextResponse.json({ success: false, error: ratingError.message }, { status: 500 });
    }

    const { data: allRatings, error: allRatingsError } = await supabase
      .from("driver_ratings")
      .select("score_punctuality, score_value, score_service")
      .eq("driver_id", driverId);
    if (allRatingsError) {
      return NextResponse.json({ success: false, error: allRatingsError.message }, { status: 500 });
    }

    const list = allRatings ?? [];
    const newDriverAvg =
      list.length === 0
        ? 0
        : Math.round(
            (list.reduce((sum, row: any) => {
              const p = Number(row.score_punctuality ?? 0);
              const v = Number(row.score_value ?? 0);
              const s = Number(row.score_service ?? 0);
              return sum + (p + v + s) / 3;
            }, 0) /
              list.length) *
              100
          ) / 100;

    const { error: updateDriverError } = await supabase.from("drivers").update({ rating_avg: newDriverAvg }).eq("id", driverId);
    if (updateDriverError) {
      return NextResponse.json({ success: false, error: updateDriverError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, rating, new_driver_avg: newDriverAvg }, { status: 201 });
  } catch (err) {
    console.error("transportation/ratings POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
