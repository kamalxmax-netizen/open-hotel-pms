import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { getVarianceConfig } from "@/lib/linen/monthly";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const configSchema = z.object({
  green_min: z.coerce.number().int().min(0).max(999),
  green_max: z.coerce.number().int().min(0).max(999),
  yellow_min: z.coerce.number().int().min(0).max(999),
  yellow_max: z.coerce.number().int().min(0).max(999),
}).refine((value) => value.yellow_min <= value.green_min, {
  message: "yellow_min must be less than or equal to green_min.",
  path: ["yellow_min"],
}).refine((value) => value.green_min <= value.green_max, {
  message: "green_min must be less than or equal to green_max.",
  path: ["green_min"],
}).refine((value) => value.green_max <= value.yellow_max, {
  message: "green_max must be less than or equal to yellow_max.",
  path: ["green_max"],
});

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const config = await getVarianceConfig(supabase);
    return NextResponse.json(config);
  } catch (error) {
    console.error("api/linen/variance-config GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load variance config.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { supabase, actor } = await requireLinenAccess(request);
    if (!actor.isAdmin) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = configSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("linen_variance_config")
      .upsert({
        id: 1,
        ...parsed.data,
        updated_at: new Date().toISOString(),
        updated_by: actor.userId,
      })
      .select("*")
      .maybeSingle();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      config: {
        id: 1,
        green_min: Number((data as any)?.green_min ?? parsed.data.green_min),
        green_max: Number((data as any)?.green_max ?? parsed.data.green_max),
        yellow_min: Number((data as any)?.yellow_min ?? parsed.data.yellow_min),
        yellow_max: Number((data as any)?.yellow_max ?? parsed.data.yellow_max),
        updated_at: String((data as any)?.updated_at ?? new Date().toISOString()),
        updated_by: (data as any)?.updated_by ?? actor.userId,
      },
    });
  } catch (error) {
    console.error("api/linen/variance-config PUT failed", error);
    const { status, message } = linenApiError(error, "Failed to save variance config.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
