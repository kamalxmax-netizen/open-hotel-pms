import { createServerSupabaseClient } from "@/lib/supabase/server";
import { findExistingGuestProfileByDocument, normalizeGuestDocumentNumber } from "@/lib/guest-resolution";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  id_type: z.enum(["thai_id", "passport", "other"]),
  id_number: z.string().trim().min(1).max(120),
});

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      id_type: sp.get("id_type") ?? undefined,
      id_number: sp.get("id_number") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const idType = parsed.data.id_type;
    const idNumber = normalizeGuestDocumentNumber(idType, parsed.data.id_number);
    if (!idNumber) {
      return NextResponse.json({ success: true, profile: null });
    }

    const supabase = createServerSupabaseClient();
    const profile = await findExistingGuestProfileByDocument(supabase, {
      idType,
      idNumber,
    });

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (err) {
    console.error("api/guests/by-id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
