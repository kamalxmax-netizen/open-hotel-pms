import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

type BoatRouteRow = {
  id: string;
  company_id: string;
  departure_pier_id: string | null;
  origin: string;
  destination: string;
  boat_type: string | null;
  departure_times: string[] | null;
  duration_minutes: number | null;
  ticket_price: number | null;
  cost_price: number | null;
  includes_pickup: boolean;
  pickup_fee: number | null;
  season_label: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const idSchema = z.string().uuid("Invalid route id");
const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeClockTime(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return value;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return value;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return value;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTimeArray(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => normalizeClockTime(v)))).sort();
}

const routeUpdateSchema = z
  .object({
    company_id: z.string().uuid().optional(),
    departure_pier_id: z.string().uuid().optional().nullable(),
    origin: z.string().trim().min(1).max(160).optional(),
    destination: z.string().trim().min(1).max(160).optional(),
    boat_type: z.string().trim().max(80).optional(),
    departure_times: z.array(z.string().regex(timeRegex, "departure_times must be HH:MM")).min(1).optional(),
    duration_minutes: z.number().int().positive().optional().nullable(),
    ticket_price: z.number().min(0).optional().nullable(),
    cost_price: z.number().min(0).optional().nullable(),
    includes_pickup: z.boolean().optional(),
    pickup_fee: z.number().min(0).optional().nullable(),
    season_label: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

async function assertCompanyExists(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  companyId: string
) {
  const { data, error } = await supabase
    .from("boat_companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (error) return { error };
  if (!data) return { error: { message: "company_id not found" } };
  return { data: true as const };
}

async function assertPierBelongsCompany(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  pierId: string,
  companyId: string
) {
  const { data, error } = await supabase
    .from("boat_piers")
    .select("id")
    .eq("id", pierId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) return { error };
  if (!data) return { error: { message: "departure_pier_id not found for selected company" } };
  return { data: true as const };
}

async function mapRouteWithNames(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  routeRow: BoatRouteRow
) {
  const [companyRes, pierRes] = await Promise.all([
    supabase
      .from("boat_companies")
      .select("id, name")
      .eq("id", routeRow.company_id)
      .maybeSingle(),
    routeRow.departure_pier_id
      ? supabase
          .from("boat_piers")
          .select("id, name")
          .eq("id", routeRow.departure_pier_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as { data: null; error: null }),
  ]);

  if (companyRes.error) return { error: companyRes.error };
  if (pierRes.error) return { error: pierRes.error };

  return {
    data: {
      ...routeRow,
      departure_times: routeRow.departure_times ?? [],
      company_name: companyRes.data?.name ?? null,
      departure_pier_name: pierRes.data?.name ?? null,
    },
  };
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }
    const routeId = parsedId.data;

    const json = await request.json().catch(() => null);
    const parsed = routeUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const supabase = createServerSupabaseClient();
    const { data: existing, error: existingError } = await supabase
      .from("boat_routes")
      .select("id, company_id, departure_pier_id")
      .eq("id", routeId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ success: false, error: "Route not found." }, { status: 404 });
    }

    const targetCompanyId = body.company_id ?? String(existing.company_id);

    if (body.company_id) {
      const companyCheck = await assertCompanyExists(supabase, body.company_id);
      if (companyCheck.error) {
        return NextResponse.json(
          { success: false, error: "company_id does not exist." },
          { status: 400 }
        );
      }
    }

    if (body.departure_pier_id) {
      const pierCheck = await assertPierBelongsCompany(supabase, body.departure_pier_id, targetCompanyId);
      if (pierCheck.error) {
        return NextResponse.json(
          { success: false, error: "departure_pier_id does not belong to company_id." },
          { status: 400 }
        );
      }
    }

    if (body.company_id && body.departure_pier_id === undefined && existing.departure_pier_id) {
      const currentPierCheck = await assertPierBelongsCompany(
        supabase,
        String(existing.departure_pier_id),
        targetCompanyId
      );
      if (currentPierCheck.error) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Current departure pier does not belong to new company_id. Provide departure_pier_id or set departure_pier_id to null.",
          },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.company_id !== undefined) updates.company_id = body.company_id;
    if (body.departure_pier_id !== undefined) updates.departure_pier_id = body.departure_pier_id ?? null;
    if (body.origin !== undefined) updates.origin = body.origin;
    if (body.destination !== undefined) updates.destination = body.destination;
    if (body.boat_type !== undefined) updates.boat_type = body.boat_type?.trim() || "speedboat";
    if (body.departure_times !== undefined) updates.departure_times = normalizeTimeArray(body.departure_times);
    if (body.duration_minutes !== undefined) updates.duration_minutes = body.duration_minutes ?? null;
    if (body.ticket_price !== undefined) updates.ticket_price = body.ticket_price ?? null;
    if (body.cost_price !== undefined) updates.cost_price = body.cost_price ?? null;
    if (body.includes_pickup !== undefined) updates.includes_pickup = body.includes_pickup;
    if (body.pickup_fee !== undefined) updates.pickup_fee = body.pickup_fee ?? null;
    if (body.season_label !== undefined) updates.season_label = body.season_label?.trim() || null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    const { data: updated, error: updateError } = await supabase
      .from("boat_routes")
      .update(updates)
      .eq("id", routeId)
      .select(`
        id,
        company_id,
        departure_pier_id,
        origin,
        destination,
        boat_type,
        departure_times,
        duration_minutes,
        ticket_price,
        cost_price,
        includes_pickup,
        pickup_fee,
        season_label,
        notes,
        is_active,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ success: false, error: "Route not found." }, { status: 404 });
    }

    const mapped = await mapRouteWithNames(supabase, updated as unknown as BoatRouteRow);
    if (mapped.error) {
      return NextResponse.json({ success: false, error: mapped.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, route: mapped.data });
  } catch (err) {
    console.error("transportation/routes/:id PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }
    const routeId = parsedId.data;

    const supabase = createServerSupabaseClient();
    const { data: updated, error: updateError } = await supabase
      .from("boat_routes")
      .update({ is_active: false })
      .eq("id", routeId)
      .select(`
        id,
        company_id,
        departure_pier_id,
        origin,
        destination,
        boat_type,
        departure_times,
        duration_minutes,
        ticket_price,
        cost_price,
        includes_pickup,
        pickup_fee,
        season_label,
        notes,
        is_active,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ success: false, error: "Route not found." }, { status: 404 });
    }

    const mapped = await mapRouteWithNames(supabase, updated as unknown as BoatRouteRow);
    if (mapped.error) {
      return NextResponse.json({ success: false, error: mapped.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Route set to inactive.",
      route: mapped.data,
    });
  } catch (err) {
    console.error("transportation/routes/:id DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
