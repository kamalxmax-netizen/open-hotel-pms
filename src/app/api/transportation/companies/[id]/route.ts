import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteParams = { params: { id: string } };

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

const idSchema = z.string().uuid("Invalid company id");

const pierUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Pier name is required").max(120),
  location_note: z.string().trim().max(500).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

const companyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    contact_phone: z.string().trim().max(80).optional().nullable(),
    contact_line: z.string().trim().max(120).optional().nullable(),
    contact_whatsapp: z.string().trim().max(120).optional().nullable(),
    website: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    is_active: z.boolean().optional(),
    piers: z.array(pierUpsertSchema).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
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

async function fetchCompanyWithPiers(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  companyId: string
) {
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
    .order("sort_order", { ascending: true, foreignTable: "boat_piers" })
    .order("name", { ascending: true, foreignTable: "boat_piers" })
    .maybeSingle();

  if (error) return { error };
  if (!data) return { data: null };
  return { data: normalizeCompany(data as unknown as BoatCompanyRow) };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const parsedId = idSchema.safeParse(params.id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: parsedId.error.issues[0]?.message ?? "Invalid id." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const result = await fetchCompanyWithPiers(supabase, parsedId.data);

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    }
    if (!result.data) {
      return NextResponse.json({ success: false, error: "Company not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, company: result.data });
  } catch (err) {
    console.error("transportation/companies/:id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
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
    const companyId = parsedId.data;

    const json = await request.json().catch(() => null);
    const parsed = companyUpdateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data: existingCompany, error: existingError } = await supabase
      .from("boat_companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existingCompany) {
      return NextResponse.json({ success: false, error: "Company not found." }, { status: 404 });
    }

    const companyUpdates: Record<string, unknown> = {};
    if (body.name !== undefined) companyUpdates.name = body.name;
    if (body.contact_phone !== undefined) companyUpdates.contact_phone = body.contact_phone?.trim() || null;
    if (body.contact_line !== undefined) companyUpdates.contact_line = body.contact_line?.trim() || null;
    if (body.contact_whatsapp !== undefined) companyUpdates.contact_whatsapp = body.contact_whatsapp?.trim() || null;
    if (body.website !== undefined) companyUpdates.website = body.website?.trim() || null;
    if (body.notes !== undefined) companyUpdates.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) companyUpdates.is_active = body.is_active;

    if (Object.keys(companyUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from("boat_companies")
        .update(companyUpdates)
        .eq("id", companyId);
      if (updateError) {
        if (updateError.code === "23505") {
          return NextResponse.json({ success: false, error: "Company name already exists." }, { status: 409 });
        }
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }
    }

    if (body.piers !== undefined) {
      const incomingPiers = body.piers;
      const incomingIdSet = new Set<string>();
      const incomingNameSet = new Set<string>();

      for (const pier of incomingPiers) {
        if (pier.id) {
          if (incomingIdSet.has(pier.id)) {
            return NextResponse.json(
              { success: false, error: `Duplicate pier id in request: ${pier.id}` },
              { status: 400 }
            );
          }
          incomingIdSet.add(pier.id);
        }
        const key = pier.name.trim().toLowerCase();
        if (incomingNameSet.has(key)) {
          return NextResponse.json(
            { success: false, error: `Duplicate pier name in request: ${pier.name}` },
            { status: 400 }
          );
        }
        incomingNameSet.add(key);
      }

      const { data: existingPiers, error: existingPiersError } = await supabase
        .from("boat_piers")
        .select("id, company_id, name")
        .eq("company_id", companyId);

      if (existingPiersError) {
        return NextResponse.json({ success: false, error: existingPiersError.message }, { status: 500 });
      }

      const existingById = new Map<string, { id: string; company_id: string; name: string }>();
      for (const pier of existingPiers ?? []) {
        existingById.set(String(pier.id), {
          id: String(pier.id),
          company_id: String(pier.company_id),
          name: String(pier.name),
        });
      }

      const keepIds = new Set<string>();

      for (const pier of incomingPiers) {
        if (pier.id) {
          const current = existingById.get(pier.id);
          if (!current) {
            return NextResponse.json(
              { success: false, error: `Pier id ${pier.id} does not belong to this company.` },
              { status: 400 }
            );
          }

          const updatePayload: Record<string, unknown> = {
            name: pier.name,
          };
          if (pier.location_note !== undefined) updatePayload.location_note = pier.location_note?.trim() || null;
          if (pier.sort_order !== undefined) updatePayload.sort_order = pier.sort_order;
          if (pier.is_active !== undefined) updatePayload.is_active = pier.is_active;

          const { error: pierUpdateError } = await supabase
            .from("boat_piers")
            .update(updatePayload)
            .eq("id", pier.id)
            .eq("company_id", companyId);

          if (pierUpdateError) {
            if (pierUpdateError.code === "23505") {
              return NextResponse.json(
                { success: false, error: "Pier name already exists for this company." },
                { status: 409 }
              );
            }
            return NextResponse.json({ success: false, error: pierUpdateError.message }, { status: 500 });
          }
          keepIds.add(pier.id);
          continue;
        }

        const { data: insertedPier, error: pierInsertError } = await supabase
          .from("boat_piers")
          .insert({
            company_id: companyId,
            name: pier.name,
            location_note: pier.location_note?.trim() || null,
            sort_order: pier.sort_order ?? 0,
            is_active: pier.is_active ?? true,
          })
          .select("id")
          .single();

        if (pierInsertError) {
          if (pierInsertError.code === "23505") {
            return NextResponse.json(
              { success: false, error: "Pier name already exists for this company." },
              { status: 409 }
            );
          }
          return NextResponse.json({ success: false, error: pierInsertError.message }, { status: 500 });
        }
        keepIds.add(String(insertedPier.id));
      }

      const removeIds = (existingPiers ?? [])
        .map((row) => String(row.id))
        .filter((id) => !keepIds.has(id));

      if (removeIds.length > 0) {
        const { error: removeError } = await supabase
          .from("boat_piers")
          .delete()
          .eq("company_id", companyId)
          .in("id", removeIds);

        if (removeError) {
          return NextResponse.json({ success: false, error: removeError.message }, { status: 500 });
        }
      }
    }

    const result = await fetchCompanyWithPiers(supabase, companyId);
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    }
    if (!result.data) {
      return NextResponse.json({ success: false, error: "Company not found after update." }, { status: 404 });
    }

    return NextResponse.json({ success: true, company: result.data });
  } catch (err) {
    console.error("transportation/companies/:id PUT failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
