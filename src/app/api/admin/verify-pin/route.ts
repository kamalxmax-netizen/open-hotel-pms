import {
  RATE_OVERRIDE_TOKEN_TTL_SECONDS,
  issueRateOverrideToken,
  verifyAdminOverridePin,
} from "@/lib/admin/pin";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  pin: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const actor = await getAuthenticatedUser(supabase, request);
    if (!actor) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (!verifyAdminOverridePin(parsed.data.pin)) {
      return NextResponse.json({ success: false, error: "Invalid PIN." }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      ok: true,
      token: issueRateOverrideToken(actor.id),
      expires_in_seconds: RATE_OVERRIDE_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
