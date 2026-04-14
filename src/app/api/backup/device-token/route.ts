import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BackupHttpError,
  issueBackupPairingToken,
  requireAdminAccess,
} from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  device_name: z.string().trim().min(1).max(80).optional(),
  expires_in_minutes: z.coerce.number().int().min(5).max(24 * 60).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const user = await requireAdminAccess(supabase, request);
    const issued = await issueBackupPairingToken(supabase, {
      device_name: parsed.data.device_name,
      expires_in_minutes: parsed.data.expires_in_minutes,
      created_by_user_id: user.id,
    });

    return NextResponse.json({ success: true, data: issued });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to generate pairing token.";
    console.error("api/backup/device-token POST failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
