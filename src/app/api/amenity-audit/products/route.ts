import { listAmenityAuditProducts } from "@/lib/fo-amenity-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  floor_number: z.coerce.number().int().positive(),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      floor_number: request.nextUrl.searchParams.get("floor_number") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const products = await listAmenityAuditProducts(supabase, parsed.data.floor_number);

    return NextResponse.json({
      success: true,
      floor_number: parsed.data.floor_number,
      products,
    });
  } catch (err) {
    console.error("amenity-audit/products GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
