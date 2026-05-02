import {
  loadRR3AuditPeriod,
  rr3OverridesCanEdit,
} from "@/lib/gov-export/rr3-row-overrides";
import {
  RR3_DEFAULT_DESTINATION,
  RR3_DEFAULT_OCCUPATION,
  normalizeThaiGovBuddhistDateText,
} from "@/lib/gov-export/constants";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2025).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const keySchema = z.object({
  reservation_id: z.string().uuid(),
  guest_profile_id: z.string().uuid(),
});

const overrideSchema = keySchema.extend({
  checkin_datetime: z.string().trim().max(80).default(""),
  room_number: z.string().trim().max(40).default(""),
  full_name: z.string().trim().min(1).max(160),
  nationality: z.string().trim().max(80).default(""),
  id_or_passport: z.string().trim().max(100).default(""),
  current_address: z.string().trim().max(180).default(""),
  occupation: z.string().trim().max(80).default(RR3_DEFAULT_OCCUPATION),
  coming_from: z.string().trim().max(180).default(""),
  going_to: z.string().trim().max(180).default(RR3_DEFAULT_DESTINATION),
  checkout_datetime: z.string().trim().max(80).default(""),
  remarks: z.string().trim().max(180).default(""),
});

function stripRR3Time(value: string): string {
  return normalizeThaiGovBuddhistDateText(value);
}

async function loadContext(request: NextRequest, requireWrite = false) {
  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (requireWrite) {
    try {
      await assertAdminOrSupervisor(supabase, user.id);
    } catch {
      return {
        ok: false as const,
        response: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }),
      };
    }
  }

  const parsed = querySchema.safeParse({
    year: request.nextUrl.searchParams.get("year") ?? undefined,
    month: request.nextUrl.searchParams.get("month") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: "Invalid query.", details: parsed.error.flatten() }, { status: 400 }),
    };
  }

  const period = await loadRR3AuditPeriod(supabase as any, parsed.data.year, parsed.data.month);
  const editState = rr3OverridesCanEdit({
    year: parsed.data.year,
    month: parsed.data.month,
    periodId: period?.id ?? null,
  });
  if (requireWrite && !editState.canEdit) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: editState.reason ?? "Cannot edit RR3 rows." }, { status: 409 }),
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
    year: parsed.data.year,
    month: parsed.data.month,
    period,
    editState,
  };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await loadContext(request);
    if (!ctx.ok) return ctx.response;
    return NextResponse.json({
      success: true,
      period: ctx.period,
      can_edit: ctx.editState.canEdit,
      edit_reason: ctx.editState.reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await loadContext(request, true);
    if (!ctx.ok) return ctx.response;
    if (!ctx.period?.id) {
      return NextResponse.json({ success: false, error: "Monthly Audit Snapshot is required." }, { status: 409 });
    }

    const parsed = overrideSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid RR3 row correction.", details: parsed.error.flatten() }, { status: 400 });
    }

    const row = {
      period_id: ctx.period.id,
      ...parsed.data,
      checkin_datetime: stripRR3Time(parsed.data.checkin_datetime),
      checkout_datetime: stripRR3Time(parsed.data.checkout_datetime),
      updated_by: ctx.user.id,
    };
    const { data, error } = await ctx.supabase
      .from("rr3_row_overrides")
      .upsert(
        { ...row, created_by: ctx.user.id },
        { onConflict: "period_id,reservation_id,guest_profile_id" }
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, row: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await loadContext(request, true);
    if (!ctx.ok) return ctx.response;
    if (!ctx.period?.id) {
      return NextResponse.json({ success: false, error: "Monthly Audit Snapshot is required." }, { status: 409 });
    }

    const parsed = keySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid RR3 row key.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { error } = await ctx.supabase
      .from("rr3_row_overrides")
      .delete()
      .eq("period_id", ctx.period.id)
      .eq("reservation_id", parsed.data.reservation_id)
      .eq("guest_profile_id", parsed.data.guest_profile_id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
