import { getAmenityAuditSession } from "@/lib/fo-amenity-audit";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid session id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, _request);
    if (auth.error) return auth.error;

    const session = await getAmenityAuditSession(supabase, params.id);
    if (!session) {
      return NextResponse.json({ success: false, error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...session });
  } catch (err) {
    console.error("amenity-audit/sessions/[id] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
