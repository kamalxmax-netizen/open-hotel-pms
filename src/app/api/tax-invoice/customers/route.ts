import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TaxInvoiceError, upsertGuestTaxProfile } from "@/lib/tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  q: z.string().trim().max(150).optional(),
  guest_profile_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const upsertSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  guest_profile_id: z.string().uuid().optional().nullable(),
  tax_id: z.string().trim().min(1).max(30),
  company_name: z.string().trim().min(1).max(255),
  address: z.string().max(1000).optional().nullable(),
  branch: z.string().max(255).optional().nullable(),
  is_default: z.boolean().optional(),
});

function escapeLike(value: string): string {
  return value.replace(/[%_,]/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      guest_profile_id: request.nextUrl.searchParams.get("guest_profile_id") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    let query = supabase
      .from("guest_tax_profiles")
      .select("id, guest_profile_id, tax_id, company_name, address, branch, is_default, created_at, updated_at")
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (input.guest_profile_id) {
      query = query.eq("guest_profile_id", input.guest_profile_id);
    }

    if (input.q) {
      const safe = escapeLike(input.q.trim());
      if (safe) {
        query = query.or(`tax_id.ilike.%${safe}%,company_name.ilike.%${safe}%`);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const saved = await upsertGuestTaxProfile(supabase, parsed.data);
    if (!saved?.id) {
      return NextResponse.json({ success: false, error: "Unable to save profile." }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("guest_tax_profiles")
      .select("id, guest_profile_id, tax_id, company_name, address, branch, is_default, created_at, updated_at")
      .eq("id", saved.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof TaxInvoiceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
