import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const patchSchema = z
  .object({
    regular_day_off: z.coerce.number().int().min(0).max(6).optional(),
    shift_preference: z.enum(["morning_fixed", "rotate"]).optional(),
    night_rotation_order: z.coerce.number().int().min(1).max(10).nullable().optional(),
    extra_day_offs_per_month: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (value) =>
      value.regular_day_off !== undefined ||
      value.shift_preference !== undefined ||
      value.night_rotation_order !== undefined ||
      value.extra_day_offs_per_month !== undefined,
    { message: "At least one field is required." }
  );

async function requireAuthenticated(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  request: NextRequest
) {
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const, user };
}

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireAuthenticated(supabase, request);
    if (!auth.ok) return auth.response;

    try {
      await assertAdminOrSupervisor(supabase, auth.user.id);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Forbidden";
      const status = message === "Forbidden" ? 403 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    const parsedParams = paramsSchema.safeParse(context.params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: "Invalid path params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = patchSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const configId = parsedParams.data.id;
    const payload = parsedBody.data;

    const { data: current, error: currentError } = await supabase
      .from("roster_config")
      .select("id, shift_preference, night_rotation_order")
      .eq("id", configId)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ success: false, error: currentError.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ success: false, error: "Roster config not found." }, { status: 404 });
    }

    const currentPreference = String((current as Record<string, unknown>).shift_preference ?? "rotate");
    const currentRotationOrder =
      (current as Record<string, unknown>).night_rotation_order === null
        ? null
        : Number((current as Record<string, unknown>).night_rotation_order);

    const nextPreference = payload.shift_preference ?? (currentPreference as "morning_fixed" | "rotate");
    let nextRotationOrder =
      payload.night_rotation_order !== undefined ? payload.night_rotation_order : currentRotationOrder;

    if (nextPreference === "morning_fixed") {
      if (payload.night_rotation_order !== undefined && payload.night_rotation_order !== null) {
        return NextResponse.json(
          { success: false, error: "night_rotation_order must be null for morning_fixed." },
          { status: 400 }
        );
      }
      nextRotationOrder = null;
    } else if (!nextRotationOrder) {
      return NextResponse.json(
        { success: false, error: "night_rotation_order is required when shift_preference is rotate." },
        { status: 400 }
      );
    }

    const updatePayload: Record<string, unknown> = {};
    if (payload.regular_day_off !== undefined) updatePayload.regular_day_off = payload.regular_day_off;
    if (payload.shift_preference !== undefined) updatePayload.shift_preference = payload.shift_preference;
    if (payload.extra_day_offs_per_month !== undefined) {
      updatePayload.extra_day_offs_per_month = payload.extra_day_offs_per_month;
    }
    if (nextPreference === "morning_fixed") {
      updatePayload.night_rotation_order = null;
    } else if (payload.night_rotation_order !== undefined || payload.shift_preference !== undefined) {
      updatePayload.night_rotation_order = nextRotationOrder;
    }

    const { data, error } = await supabase
      .from("roster_config")
      .update(updatePayload)
      .eq("id", configId)
      .select("id, staff_id, regular_day_off, shift_preference, night_rotation_order, extra_day_offs_per_month, created_at, updated_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("api/staff/roster-config/[id] PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const auth = await requireAuthenticated(supabase, request);
    if (!auth.ok) return auth.response;

    try {
      await assertAdminOrSupervisor(supabase, auth.user.id);
    } catch (guardError) {
      const message = guardError instanceof Error ? guardError.message : "Forbidden";
      const status = message === "Forbidden" ? 403 : 500;
      return NextResponse.json({ success: false, error: message }, { status });
    }

    const parsedParams = paramsSchema.safeParse(context.params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: "Invalid path params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const configId = parsedParams.data.id;
    const { data, error } = await supabase
      .from("roster_config")
      .delete()
      .eq("id", configId)
      .select("id, staff_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: "Roster config not found." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: String((data as Record<string, unknown>).id),
        staff_id: String((data as Record<string, unknown>).staff_id),
      },
    });
  } catch (err) {
    console.error("api/staff/roster-config/[id] DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

