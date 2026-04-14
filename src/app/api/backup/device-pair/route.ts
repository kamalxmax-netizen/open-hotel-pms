import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BackupHttpError,
  pairOfflineDevice,
} from "@/lib/backup";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const schema = z.object({
  pairing_token: z.string().trim().min(8).max(128),
  device_name: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const paired = await pairOfflineDevice(supabase, {
      pairing_token: parsed.data.pairing_token,
      device_name: parsed.data.device_name,
      user_agent: request.headers.get("user-agent"),
    });

    return NextResponse.json({ success: true, data: paired });
  } catch (error) {
    const status = error instanceof BackupHttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to pair this device.";
    console.error("api/backup/device-pair POST failed", error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
