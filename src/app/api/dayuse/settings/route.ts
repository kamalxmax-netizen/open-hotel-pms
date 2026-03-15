import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("hotel_settings")
      .select("dayuse_rate, dayuse_duration_min, dayuse_extend_rate, dayuse_extend_min")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      settings: {
        dayuse_rate: round2(Number(data?.dayuse_rate ?? 200)),
        dayuse_duration_min: Number(data?.dayuse_duration_min ?? 120),
        dayuse_extend_rate: round2(Number(data?.dayuse_extend_rate ?? 100)),
        dayuse_extend_min: Number(data?.dayuse_extend_min ?? 60),
      },
    });
  } catch (err) {
    console.error("dayuse/settings GET failed", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

