import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type BoatPierRow = {
  id: string;
  company_id: string;
  name: string;
  location_note: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
};

type BoatCompanyRow = {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_line: string | null;
  contact_whatsapp: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  boat_piers?: BoatPierRow[] | null;
};

const querySchema = z.object({
  is_active: z.enum(["true", "false", "all"]).optional(),
});

const pierCreateSchema = z.object({
  name: z.string().trim().min(1, "Pier name is required").max(120),
  location_note: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional().default(0),
  is_active: z.boolean().optional().default(true),
});

const companyCreateSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(160),
  contact_phone: z.string().trim().max(80).optional().nullable(),
  contact_line: z.string().trim().max(120).optional().nullable(),
  contact_whatsapp: z.string().trim().max(120).optional().nullable(),
  website: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
  piers: z.array(pierCreateSchema).optional().default([]),
});

function normalizePiers(rows: BoatPierRow[] | null | undefined): BoatPierRow[] {
  return (rows ?? [])
    .map((row) => ({
      id: String(row.id),
      company_id: String(row.company_id),
      name: String(row.name),
      location_note: row.location_note ?? null,
      sort_order: Number(row.sort_order ?? 0),
      is_active: Boolean(row.is_active),
      created_at: row.created_at ?? undefined,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

function normalizeCompany(row: BoatCompanyRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    contact_phone: row.contact_phone ?? null,
    contact_line: row.contact_line ?? null,
    contact_whatsapp: row.contact_whatsapp ?? null,
    website: row.website ?? null,
    notes: row.notes ?? null,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    piers: normalizePiers(row.boat_piers),
  };
}

async function getCompanyWithPiers(supabase: ReturnType<typeof createServerSupabaseClient>, companyId: string) {
  const { data, error } = await supabase
    .from("boat_companies")
    .select(`
      id,
      name,
      contact_phone,
      contact_line,
      contact_whatsapp,
      website,
      notes,
      is_active,
      created_at,
      updated_at,
      boat_piers(
        id,
        company_id,
        name,
        location_note,
        sort_order,
        is_active,
        created_at
      )
    `)
    .eq("id", companyId)
    .maybeSingle();

  if (error) {
    return { error };
  }
  if (!data) {
    return { data: null };
  }

  return { data: normalizeCompany(data as unknown as BoatCompanyRow) };
}

export async function GET(request: NextRequest) {
  try {
    const parsedQuery = querySchema.safeParse({
      is_active: request.nextUrl.searchParams.get("is_active") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const isActiveParam = parsedQuery.data.is_active ?? "true";
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("boat_companies")
      .select(`
        id,
        name,
        contact_phone,
        contact_line,
        contact_whatsapp,
        website,
        notes,
        is_active,
        created_at,
        updated_at,
        boat_piers(
          id,
          company_id,
          name,
          location_note,
          sort_order,
          is_active,
          created_at
        )
      `)
      .order("name", { ascending: true })
      .order("sort_order", { ascending: true, foreignTable: "boat_piers" })
      .order("name", { ascending: true, foreignTable: "boat_piers" });

    if (isActiveParam !== "all") {
      query = query.eq("is_active", isActiveParam === "true");
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const companies = (data ?? []).map((row) => normalizeCompany(row as unknown as BoatCompanyRow));
    return NextResponse.json({ success: true, companies });
  } catch (err) {
    console.error("transportation/companies GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = companyCreateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const dedup = new Set<string>();
    for (const pier of body.piers) {
      const key = pier.name.trim().toLowerCase();
      if (dedup.has(key)) {
        return NextResponse.json(
          { success: false, error: `Duplicate pier name in request: ${pier.name}` },
          { status: 400 }
        );
      }
      dedup.add(key);
    }

    const supabase = createServerSupabaseClient();

    const { data: companyInsert, error: companyError } = await supabase
      .from("boat_companies")
      .insert({
        name: body.name,
        contact_phone: body.contact_phone?.trim() || null,
        contact_line: body.contact_line?.trim() || null,
        contact_whatsapp: body.contact_whatsapp?.trim() || null,
        website: body.website?.trim() || null,
        notes: body.notes?.trim() || null,
        is_active: body.is_active ?? true,
      })
      .select("id")
      .single();

    if (companyError) {
      if (companyError.code === "23505") {
        return NextResponse.json({ success: false, error: "Company name already exists." }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: companyError.message }, { status: 500 });
    }

    const companyId = String(companyInsert.id);

    if (body.piers.length > 0) {
      const piersPayload = body.piers.map((pier) => ({
        company_id: companyId,
        name: pier.name,
        location_note: pier.location_note?.trim() || null,
        sort_order: pier.sort_order ?? 0,
        is_active: pier.is_active ?? true,
      }));

      const { error: piersError } = await supabase.from("boat_piers").insert(piersPayload);
      if (piersError) {
        if (piersError.code === "23505") {
          return NextResponse.json(
            { success: false, error: "Pier name already exists for this company." },
            { status: 409 }
          );
        }
        return NextResponse.json({ success: false, error: piersError.message }, { status: 500 });
      }
    }

    const companyResult = await getCompanyWithPiers(supabase, companyId);
    if (companyResult.error) {
      return NextResponse.json({ success: false, error: companyResult.error.message }, { status: 500 });
    }
    if (!companyResult.data) {
      return NextResponse.json({ success: false, error: "Company created but fetch failed." }, { status: 500 });
    }

    return NextResponse.json({ success: true, company: companyResult.data }, { status: 201 });
  } catch (err) {
    console.error("transportation/companies POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
