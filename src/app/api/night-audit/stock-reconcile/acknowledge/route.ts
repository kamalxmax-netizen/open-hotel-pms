import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import {
  acknowledgeStockReconcileSection,
  getCurrentBusinessDate,
  getStockReconcileStatus,
  isBusinessDate,
} from "@/lib/stock-snapshot";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  section: z.enum(["pos", "amenity_prepare", "amenity_direct"]),
  note: z.string().trim().max(500).optional().nullable(),
});

function displayNameFromEmail(email: string | null | undefined): string {
  const prefix = String(email ?? "").split("@")[0]?.trim();
  return prefix || "FO";
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

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const businessDate =
      parsed.data.business_date && isBusinessDate(parsed.data.business_date)
        ? parsed.data.business_date
        : await getCurrentBusinessDate(supabase);
    const reconcile = await getStockReconcileStatus(supabase, businessDate);
    const sectionStatus = reconcile[parsed.data.section].status;
    const isClean = sectionStatus === "clean";

    if (!isClean && !parsed.data.note?.trim()) {
      return NextResponse.json(
        { success: false, error: "note is required when the selected section is not clean." },
        { status: 400 }
      );
    }

    const result = await acknowledgeStockReconcileSection(supabase, {
      businessDate,
      section: parsed.data.section,
      note: parsed.data.note?.trim() || null,
      status: isClean ? "clean" : "acknowledged",
      acknowledgedBy: displayNameFromEmail(user.email),
      acknowledgedByUserId: user.id,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("night-audit/stock-reconcile/acknowledge POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
