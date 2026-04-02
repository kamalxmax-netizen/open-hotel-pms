import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  canRoleUnmaskInCheckin,
  containsMaskedPlaceholder,
  insertDataUnmaskAuditLog,
  isCheckinModeEnabled,
  maskSensitiveFields,
  resolveBusinessDate,
  shouldMaskIdentityForRole,
  validateGuestUnmaskAccess,
} from "@/lib/data-masking";
import { updateGuestProfileWithConflictHandling } from "@/lib/guest-profile-persistence";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { getCountryByCode, normalizeNationalityCode } from "@/lib/nationality-map";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { z } from "zod";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid guest profile id"),
});

const patchSchema = z
  .object({
    first_name: z.string().trim().max(120).optional(),
    last_name: z.string().trim().max(120).optional(),
    gender: z.enum(["M", "F", "Other"]).optional().nullable(),
    nationality: z.string().trim().max(120).optional().nullable(),
    nationality_code: z.string().trim().max(12).optional().nullable(),
    passport_no: z.string().trim().max(120).optional().nullable(),
    dob: z.string().trim().max(32).optional().nullable(),
    id_card_number: z.string().trim().max(120).optional().nullable(),
    id_type: z.enum(["thai_id", "passport", "other"]).optional().nullable(),
    id_number: z.string().trim().max(120).optional().nullable(),
    address: z.string().trim().max(1000).optional().nullable(),
    address_line1: z.string().trim().max(500).optional().nullable(),
    address_line2: z.string().trim().max(500).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    province: z.string().trim().max(120).optional().nullable(),
    postal_code: z.string().trim().max(40).optional().nullable(),
    country: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(120).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    whatsapp: z.string().trim().max(120).optional().nullable(),
    line_id: z.string().trim().max(120).optional().nullable(),
    car_registration: z.string().trim().max(120).optional().nullable(),
    vip_tier: z.string().trim().max(120).optional().nullable(),
    preferences: z.string().trim().max(2000).optional().nullable(),
    notes: z.string().trim().max(4000).optional().nullable(),
    blacklisted: z.boolean().optional(),
    passport_raw: z.record(z.any()).optional().nullable(),
    profile_status: z.enum(["draft", "verified", "merged", "blacklisted"]).optional(),
    do_not_merge: z.boolean().optional(),
    reservation_id: z.string().uuid().optional().nullable(),
    source_flow: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

type LinkedReservation = {
  id: string;
  booking_code: string | null;
  status: string | null;
};

function normalizeLinkedReservation(raw: unknown): LinkedReservation | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    booking_code: row.booking_code ? String(row.booking_code) : null,
    status: row.status ? String(row.status) : null,
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  noStore();
  try {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid id." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
    }

    const role = await getUserRole(supabase, user.id);
    const id = parsed.data.id;
    const checkinMode = isCheckinModeEnabled(request.nextUrl.searchParams.get("checkin_mode"));
    const reservationId = String(request.nextUrl.searchParams.get("reservation_id") ?? "").trim();
    const businessDate = await resolveBusinessDate(supabase);

    const [profileRes, staysRes] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select("id, booking_code, checkin_date, checkout_date, total_price, status, source, note")
        .eq("guest_profile_id", id)
        .order("checkin_date", { ascending: false })
        .limit(20),
    ]);

    if (profileRes.error) {
      return NextResponse.json({ success: false, error: profileRes.error.message }, { status: 500 });
    }
    if (!profileRes.data) {
      return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
    }
    if (staysRes.error) {
      return NextResponse.json({ success: false, error: staysRes.error.message }, { status: 500 });
    }

    const shouldMask = shouldMaskIdentityForRole(role);
    let canUnmask = !shouldMask;
    if (shouldMask && canRoleUnmaskInCheckin(role) && checkinMode && reservationId) {
      canUnmask = await validateGuestUnmaskAccess({
        supabase,
        reservationId,
        guestProfileId: id,
        businessDate,
      });
      if (canUnmask) {
        try {
          await insertDataUnmaskAuditLog({
            supabase,
            userId: user.id,
            reservationId,
            guestProfileId: id,
            businessDate,
          });
        } catch {
          // Best-effort audit only; never block guest loading.
        }
      }
    }

    const profilePayload = canUnmask
      ? profileRes.data
      : maskSensitiveFields(profileRes.data as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      profile: profilePayload,
      stays: staysRes.data ?? [],
    });
  } catch (err) {
    console.error("api/guests/[id] GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid id." }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = patchSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsedBody.data)) {
      if (value !== undefined) updates[key] = value;
    }
    const reservationId = String(parsedBody.data.reservation_id ?? "").trim();
    const sourceFlow = String(parsedBody.data.source_flow ?? "").trim();
    delete updates.reservation_id;
    delete updates.source_flow;
    for (const key of ["passport_no", "id_card_number", "id_number"] as const) {
      if (containsMaskedPlaceholder(updates[key])) {
        delete updates[key];
      }
    }

    const explicitNationalityCode = parsedBody.data.nationality_code;
    const explicitCountry = parsedBody.data.country;
    const normalizedCode = normalizeNationalityCode(explicitNationalityCode)
      ?? normalizeNationalityCode(parsedBody.data.nationality);

    if (normalizedCode) {
      updates.nationality_code = normalizedCode;
      if (explicitCountry == null || explicitCountry === "") {
        const mappedCountry = getCountryByCode(normalizedCode);
        if (mappedCountry) updates.country = mappedCountry;
      }
    }

    const supabase = createServerSupabaseClient();
    const targetId = parsedParams.data.id;
    const actor = await getAuthenticatedUser(supabase, request).catch(() => null);
    const businessDate = await resolveBusinessDate(supabase);
    if (Object.keys(updates).length === 0) {
      const { data: current, error: currentError } = await supabase
        .from("guest_profiles")
        .select("*")
        .eq("id", targetId)
        .maybeSingle();
      if (currentError) {
        return NextResponse.json({ success: false, error: currentError.message }, { status: 500 });
      }
      if (!current) {
        return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
      }
      return NextResponse.json({ success: true, profile: current });
    }

    const mutation = await updateGuestProfileWithConflictHandling({
      supabase,
      profileId: targetId,
      payload: updates,
      logContext: {
        actorUserId: actor?.id ?? null,
        reservationId: reservationId || null,
        businessDate,
        sourceFlow: sourceFlow || "guest_profile_api_patch",
        terminalId: request.headers.get("x-terminal-id") ?? request.headers.get("x-device-id"),
        userAgent: request.headers.get("user-agent"),
        source: "manual",
      },
    });

    if (!mutation.profile) {
      return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, profile: mutation.profile, rerouted: mutation.rerouted });
  } catch (err) {
    console.error("api/guests/[id] PATCH failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid id." }, { status: 400 });
    }

    const guestProfileId = parsedParams.data.id;
    const supabase = createServerSupabaseClient();

    const [{ data: profile, error: profileError }, { data: primaryLinks, error: primaryError }, { data: accompanyingLinks, error: accompanyingError }] = await Promise.all([
      supabase
        .from("guest_profiles")
        .select("id")
        .eq("id", guestProfileId)
        .maybeSingle(),
      supabase
        .from("reservations")
        .select("id, booking_code, status")
        .eq("guest_profile_id", guestProfileId),
      supabase
        .from("reservation_guests")
        .select("reservation_id, reservations(id, booking_code, status)")
        .eq("guest_profile_id", guestProfileId),
    ]);

    if (profileError) {
      return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ success: false, error: "Guest profile not found." }, { status: 404 });
    }
    if (primaryError) {
      return NextResponse.json({ success: false, error: primaryError.message }, { status: 500 });
    }
    if (accompanyingError) {
      return NextResponse.json({ success: false, error: accompanyingError.message }, { status: 500 });
    }

    const normalizedPrimary = (primaryLinks ?? [])
      .map((row) => normalizeLinkedReservation(row))
      .filter((row): row is LinkedReservation => Boolean(row));

    const normalizedAccompanying = (accompanyingLinks ?? [])
      .map((row: any) => {
        const reservationRaw = Array.isArray(row?.reservations) ? row.reservations[0] : row?.reservations;
        return normalizeLinkedReservation(reservationRaw);
      })
      .filter((row): row is LinkedReservation => Boolean(row));

    const linkedReservationIds = new Set<string>([
      ...normalizedPrimary.map((row) => row.id),
      ...normalizedAccompanying.map((row) => row.id),
    ]);

    const activePrimary = normalizedPrimary.filter((row) => row.status === "active");
    const activeAccompanying = normalizedAccompanying.filter((row) => row.status === "active");

    if (linkedReservationIds.size > 0) {
      const hasActiveBooking = activePrimary.length > 0 || activeAccompanying.length > 0;
      return NextResponse.json(
        {
          success: false,
          error: hasActiveBooking
            ? "Cannot delete guest profile while linked to active booking(s). Unlink profile first."
            : "Cannot delete guest profile with booking history. Unlink from all reservations first.",
          code: "profile_in_use",
          linked_reservation_count: linkedReservationIds.size,
          active_links: {
            primary: activePrimary,
            accompanying: activeAccompanying,
          },
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await supabase
      .from("guest_profiles")
      .delete()
      .eq("id", guestProfileId);

    if (deleteError) {
      if (deleteError.code === "23503") {
        return NextResponse.json(
          {
            success: false,
            error: "Cannot delete guest profile because it is still referenced by other records.",
            code: "profile_in_use",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted_profile_id: guestProfileId });
  } catch (err) {
    console.error("api/guests/[id] DELETE failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
