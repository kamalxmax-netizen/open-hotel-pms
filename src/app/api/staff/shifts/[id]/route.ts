import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const patchSchema = z.object({
  action: z.enum(["clock_in", "clock_out"]),
  at: z.string().datetime().optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    if (user) {
      try {
        await assertAdminOrSupervisor(supabase, user.id);
      } catch (guardError) {
        const message = guardError instanceof Error ? guardError.message : "Forbidden";
        const status = message === "Forbidden" ? 403 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
      }
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

    const shiftId = parsedParams.data.id;
    const action = parsedBody.data.action;
    const actionAt = parsedBody.data.at ?? nowIso();

    const { data: current, error: currentError } = await supabase
      .from("staff_shifts")
      .select("id, started_at, ended_at")
      .eq("id", shiftId)
      .maybeSingle();

    if (currentError) {
      return NextResponse.json({ success: false, error: currentError.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    }

    if (action === "clock_out") {
      if (!current.started_at) {
        return NextResponse.json(
          { success: false, error: "Cannot clock out before clock in." },
          { status: 400 }
        );
      }
      if (current.ended_at) {
        return NextResponse.json(
          { success: false, error: "Shift already clocked out." },
          { status: 400 }
        );
      }
      if (new Date(actionAt).getTime() < new Date(current.started_at).getTime()) {
        return NextResponse.json(
          { success: false, error: "Clock out time must be after clock in time." },
          { status: 400 }
        );
      }
    }
    if (action === "clock_in" && current.started_at) {
      return NextResponse.json(
        { success: false, error: "Shift already clocked in." },
        { status: 400 }
      );
    }

    const payload =
      action === "clock_in"
        ? { started_at: actionAt, ended_at: null }
        : { ended_at: actionAt };

    const { data, error } = await supabase
      .from("staff_shifts")
      .update(payload)
      .eq("id", shiftId)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("api/staff/shifts/[id] PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
