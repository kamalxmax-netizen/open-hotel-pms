import { createServerSupabaseClient } from "@/lib/supabase/server";
import { findExistingGuestProfileByDocument, normalizeGuestDocumentNumber } from "@/lib/guest-resolution";
import {
  canRoleUnmaskInCheckin,
  insertDataUnmaskAuditLog,
  isCheckinModeEnabled,
  maskSensitiveFields,
  resolveBusinessDate,
  shouldMaskIdentityForRole,
  validateGuestUnmaskAccess,
} from "@/lib/data-masking";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
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
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }
    const role = await getUserRole(supabase, user.id);
    const profile = await findExistingGuestProfileByDocument(supabase, {
      idType,
      idNumber,
    });

    if (!profile) {
      return NextResponse.json({
        success: true,
        profile: null,
      });
    }

    const checkinMode = isCheckinModeEnabled(request.nextUrl.searchParams.get("checkin_mode"));
    const reservationId = String(request.nextUrl.searchParams.get("reservation_id") ?? "").trim();
    const shouldMask = shouldMaskIdentityForRole(role);
    let canUnmask = !shouldMask;

    if (shouldMask && canRoleUnmaskInCheckin(role) && checkinMode && reservationId) {
      const businessDate = await resolveBusinessDate(supabase);
      canUnmask = await validateGuestUnmaskAccess({
        supabase,
        reservationId,
        guestProfileId: String((profile as any).id ?? ""),
        businessDate,
      });
      if (canUnmask) {
        try {
          await insertDataUnmaskAuditLog({
            supabase,
            userId: user.id,
            reservationId,
            guestProfileId: String((profile as any).id ?? ""),
            businessDate,
          });
        } catch {
          // Best-effort audit only.
        }
      }
    }

    return NextResponse.json({
      success: true,
      profile: canUnmask ? profile : maskSensitiveFields(profile as Record<string, unknown>),
    });
  } catch (err) {
    console.error("api/guests/by-id GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
