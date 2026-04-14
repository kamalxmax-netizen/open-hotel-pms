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
  dry_run: z.boolean().optional(),
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

    if (parsed.data.dry_run) {
      const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await auth.supabase
        .from("passport_scans")
        .select("id", { count: "exact", head: true })
        .lt("created_at", threshold)
        .not("image_path", "is", null)
        .is("cleaned_at", null);

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({
        success: true,
        dry_run: true,
        retention_days: retentionDays,
        threshold_created_at: threshold,
        would_delete_count: Number(count ?? 0),
      });
    }

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
