import { toBangkokDateString } from "@/lib/audit-utils";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        display_order: z.coerce.number().int().min(0),
      })
    )
    .min(1)
    .max(200),
});

export async function PUT(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = reorderSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await assertAdminOrSupervisor(supabase, user.id);

    const items = parsed.data.items;
    const uniqueIds = Array.from(new Set(items.map((item) => item.id)));
    if (uniqueIds.length !== items.length) {
      return NextResponse.json(
        { success: false, error: "Duplicate product ids in reorder payload." },
        { status: 400 }
      );
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, is_active")
      .in("id", uniqueIds);

    if (productsError) {
      return NextResponse.json({ success: false, error: productsError.message }, { status: 500 });
    }

    const productById = new Map((products ?? []).map((row: any) => [String(row.id), row]));
    for (const id of uniqueIds) {
      const row = productById.get(id);
      if (!row) {
        return NextResponse.json(
          { success: false, error: `Product ${id} not found.` },
          { status: 400 }
        );
      }
      if (!row.is_active) {
        return NextResponse.json(
          { success: false, error: `Product ${id} is inactive and cannot be reordered.` },
          { status: 400 }
        );
      }
    }

    for (const item of items) {
      const { error: updateError } = await supabase
        .from("products")
        .update({ display_order: item.display_order })
        .eq("id", item.id)
        .eq("is_active", true);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      entity_type: "inventory_settings",
      entity_id: "products",
      action: "reorder_products",
      actor_user_id: user.id,
      before_json: null,
      after_json: {
        reordered_count: items.length,
        items: items.slice(0, 20),
      },
      business_date: toBangkokDateString(),
      source: "manual",
    });
    if (auditError) {
      return NextResponse.json({ success: false, error: auditError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      updated_count: items.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
