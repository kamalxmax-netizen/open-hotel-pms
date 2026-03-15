import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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

const routeQuerySchema = z.object({
  company_id: z.string().uuid().optional(),
  is_active: z.enum(["true", "false", "all"]).optional(),
});

const routeCreateSchema = z.object({
  company_id: z.string().uuid("company_id must be uuid"),
  departure_pier_id: z.string().uuid().optional().nullable(),
  origin: z.string().trim().min(1, "origin is required").max(160),
  destination: z.string().trim().min(1, "destination is required").max(160),
  boat_type: z.string().trim().max(80).optional().default("speedboat"),
  departure_times: z.array(z.string().regex(timeRegex, "departure_times must be HH:MM")).min(1),
  duration_minutes: z.number().int().positive().optional().nullable(),
  ticket_price: z.number().min(0).optional().nullable(),
  cost_price: z.number().min(0).optional().nullable(),
  includes_pickup: z.boolean().optional().default(false),
  pickup_fee: z.number().min(0).optional().nullable(),
  season_label: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
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

async function mapRoutesWithNames(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  rows: BoatRouteRow[]
) {
  const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));
  const pierIds = Array.from(new Set(rows.map((row) => row.departure_pier_id).filter(Boolean) as string[]));

  const companyNameById = new Map<string, string>();
  const pierNameById = new Map<string, string>();

  if (companyIds.length > 0) {
    const { data: companies, error } = await supabase
      .from("boat_companies")
      .select("id, name")
      .in("id", companyIds);
    if (error) return { error };
    for (const c of companies ?? []) {
      companyNameById.set(String(c.id), String(c.name));
    }
  }

  if (pierIds.length > 0) {
    const { data: piers, error } = await supabase
      .from("boat_piers")
      .select("id, name")
      .in("id", pierIds);
    if (error) return { error };
    for (const p of piers ?? []) {
      pierNameById.set(String(p.id), String(p.name));
    }
  }

  const mapped = rows.map((row) => ({
    ...row,
    departure_times: row.departure_times ?? [],
    company_name: companyNameById.get(String(row.company_id)) ?? null,
    departure_pier_name: row.departure_pier_id ? (pierNameById.get(String(row.departure_pier_id)) ?? null) : null,
  }));

  return { data: mapped };
}

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = routeQuerySchema.safeParse({
      company_id: request.nextUrl.searchParams.get("company_id") ?? undefined,
      is_active: request.nextUrl.searchParams.get("is_active") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const companyId = parsedQuery.data.company_id;
    const isActiveParam = parsedQuery.data.is_active ?? "true";
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("boat_routes")
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
      .order("origin", { ascending: true })
      .order("destination", { ascending: true })
      .order("created_at", { ascending: false });

    if (companyId) query = query.eq("company_id", companyId);
    if (isActiveParam !== "all") query = query.eq("is_active", isActiveParam === "true");

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const mappedResult = await mapRoutesWithNames(supabase, (data ?? []) as BoatRouteRow[]);
    if (mappedResult.error) {
      return NextResponse.json({ success: false, error: mappedResult.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, routes: mappedResult.data ?? [] });
  } catch (err) {
    console.error("transportation/routes GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = routeCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const normalizedDepartureTimes = normalizeTimeArray(body.departure_times);
    const supabase = createServerSupabaseClient();

    const companyCheck = await assertCompanyExists(supabase, body.company_id);
    if (companyCheck.error) {
      return NextResponse.json(
        { success: false, error: "company_id does not exist." },
        { status: 400 }
      );
    }

    if (body.departure_pier_id) {
      const pierCheck = await assertPierBelongsCompany(supabase, body.departure_pier_id, body.company_id);
      if (pierCheck.error) {
        return NextResponse.json(
          { success: false, error: "departure_pier_id does not belong to company_id." },
          { status: 400 }
        );
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from("boat_routes")
      .insert({
        company_id: body.company_id,
        departure_pier_id: body.departure_pier_id ?? null,
        origin: body.origin,
        destination: body.destination,
        boat_type: body.boat_type?.trim() || "speedboat",
        departure_times: normalizedDepartureTimes,
        duration_minutes: body.duration_minutes ?? null,
        ticket_price: body.ticket_price ?? null,
        cost_price: body.cost_price ?? null,
        includes_pickup: body.includes_pickup ?? false,
        pickup_fee: body.pickup_fee ?? null,
        season_label: body.season_label?.trim() || null,
        notes: body.notes?.trim() || null,
        is_active: body.is_active ?? true,
      })
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
      .single();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    const mappedResult = await mapRoutesWithNames(supabase, [inserted as unknown as BoatRouteRow]);
    if (mappedResult.error) {
      return NextResponse.json({ success: false, error: mappedResult.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, route: mappedResult.data?.[0] ?? null }, { status: 201 });
  } catch (err) {
    console.error("transportation/routes POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
