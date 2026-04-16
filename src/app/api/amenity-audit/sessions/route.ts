import { getCurrentBusinessDate } from "@/lib/stock-snapshot";
import { listAmenityAuditSessions, submitAmenityAuditSession } from "@/lib/fo-amenity-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  floor_number: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const itemSchema = z.object({
  product_id: z.string().uuid(),
  system_qty_before: z.coerce.number().int().min(0),
  physical_qty: z.coerce.number().int().min(0),
  refill_to: z.coerce.number().int().min(0),
  item_note: z.string().trim().max(500).optional().nullable(),
});

const bodySchema = z.object({
  floor_number: z.coerce.number().int().positive(),
  audited_by: z.string().trim().min(1).max(120),
  session_note: z.string().trim().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1),
});

function hasAmenityAuditPermission(allowedPages: unknown): boolean {
  if (!Array.isArray(allowedPages)) return false;
  return allowedPages
    .map((entry) => String(entry ?? "").trim())
    .some((path) => path === "*" || path === "/pms/inventory/amenity-audit");
}

function canSubmitAmenityAudit(role: string | null, allowedPages: unknown): boolean {
  return role === "admin" || role === "supervisor" || role === "frontdesk" || hasAmenityAuditPermission(allowedPages);
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      floor_number: request.nextUrl.searchParams.get("floor_number") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const sessions = await listAmenityAuditSessions(supabase, {
      floorNumber: parsed.data.floor_number,
      limit: parsed.data.limit,
    });

    return NextResponse.json({ success: true, sessions });
  } catch (err) {
    console.error("amenity-audit/sessions GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    for (const item of parsed.data.items) {
      if (item.refill_to < item.physical_qty) {
        return NextResponse.json(
          { success: false, error: "refill_to must be greater than or equal to physical_qty." },
          { status: 400 }
        );
      }
      if (item.physical_qty !== item.system_qty_before && !item.item_note?.trim()) {
        return NextResponse.json(
          { success: false, error: "item_note is required when physical_qty differs from system_qty_before." },
          { status: 400 }
        );
      }
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, allowed_pages")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);

    const role = String((profile as any)?.role ?? "").trim().toLowerCase();
    if (!canSubmitAmenityAudit(role, (profile as any)?.allowed_pages)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const businessDate = await getCurrentBusinessDate(supabase);
    const result = await submitAmenityAuditSession(supabase, {
      ...parsed.data,
      business_date: businessDate,
      audited_by_user_id: user.id,
    });

    return NextResponse.json({
      success: true,
      session: {
        id: result.session_id,
        business_date: businessDate,
        floor_number: parsed.data.floor_number,
        total_items: result.items_count,
        total_overclick_units: result.total_overclick,
        total_underclick_units: result.total_underclick,
        total_refill_units: result.total_refill,
        submitted_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("amenity-audit/sessions POST failed", err);
    const anyErr = err as any;
    if (anyErr?.code === "STOCK_CONFLICT") {
      return NextResponse.json(
        {
          success: false,
          error: "Stock changed during audit. Please refresh and resubmit.",
          code: "STOCK_CONFLICT",
          stale_items: anyErr.stale_items ?? [],
        },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
