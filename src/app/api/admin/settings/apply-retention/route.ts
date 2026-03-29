import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRouteAccess } from "@/lib/guest-migration";
import {
  applyPassportRetentionToExistingScans,
  clampPassportRetentionDays,
  getPassportRetentionDays,
} from "@/lib/passport-scan-retention";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  retention_days: z.number().int().min(7).max(90).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const configuredDays = await getPassportRetentionDays(auth.supabase);
    const retentionDays = clampPassportRetentionDays(
      Number(parsed.data.retention_days ?? configuredDays)
    );
    const recalculatedCount = await applyPassportRetentionToExistingScans({
      supabase: auth.supabase,
      retentionDays,
    });

    return NextResponse.json({
      success: true,
      retention_days: retentionDays,
      recalculated_count: recalculatedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply retention.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
