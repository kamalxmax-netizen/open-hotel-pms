import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeAuditSource } from "@/lib/audit-utils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  status: z.enum(["pending", "approved", "paid", "reversed"]).optional(),
  date_from: z.string().regex(dateRegex, "date_from must be YYYY-MM-DD").optional(),
  date_to: z.string().regex(dateRegex, "date_to must be YYYY-MM-DD").optional(),
  tip_type: z.enum(["unassigned", "manual_staff"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createSchema = z.object({
  tip_type: z.enum(["unassigned", "manual_staff"]),
  amount: z.number().positive("amount must be > 0"),
  payment_method: z.enum(["cash", "transfer", "credit_card"]).default("cash"),
  assigned_to: z.string().trim().max(120).optional().nullable(),
  reservation_id: z.string().uuid().optional().nullable(),
  transfer_id: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  recorded_by: z.string().trim().max(120).optional().nullable(),
});

function toBangkokDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

async function assertBusinessDayOpen(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  targetDate: string
) {
  const { data, error } = await supabase
    .from("daily_snapshots")
    .select("business_date")
    .gte("business_date", targetDate)
    .order("business_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.business_date) {
    throw new Error("Business day already closed. Use reversal.");
  }
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      tip_type: request.nextUrl.searchParams.get("tip_type") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, date_from, date_to, tip_type, limit, offset } = parsed.data;
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("tip_ledger")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (tip_type) query = query.eq("tip_type", tip_type);
    if (date_from) query = query.gte("created_at", `${date_from}T00:00:00+07:00`);
    if (date_to) query = query.lt("created_at", `${date_to}T23:59:59+07:00`);

    const { data: rows, error, count } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      items: rows ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("api/accounting/tips GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const payload = parsed.data;

    const supabase = createServerSupabaseClient();
    const businessDate = toBangkokDateString();
    await assertBusinessDayOpen(supabase, businessDate);

    let reservationId: string | null = payload.reservation_id ? String(payload.reservation_id) : null;
    let guestProfileId: string | null = null;
    if (payload.tip_type === "manual_staff") {
      if (!reservationId) {
        return NextResponse.json(
          { success: false, error: "reservation_id is required for manual_staff tip." },
          { status: 400 }
        );
      }

      const { data: reservation, error: reservationError } = await supabase
        .from("reservations")
        .select("id, guest_profile_id")
        .eq("id", reservationId)
        .maybeSingle();
      if (reservationError) {
        return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
      }
      if (!reservation) {
        return NextResponse.json({ success: false, error: "Reservation not found." }, { status: 404 });
      }

      guestProfileId = reservation.guest_profile_id ? String(reservation.guest_profile_id) : null;
      if (!guestProfileId) {
        return NextResponse.json(
          {
            success: false,
            error: "Link profile to reservation before creating manual_staff tip.",
          },
          { status: 400 }
        );
      }
    } else {
      reservationId = reservationId ?? null;
      guestProfileId = null;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("tip_ledger")
      .insert({
        tip_type: payload.tip_type,
        reservation_id: reservationId,
        guest_profile_id: guestProfileId,
        transfer_id: payload.transfer_id ? String(payload.transfer_id) : null,
        amount: Number(payload.amount.toFixed(2)),
        payment_method: payload.payment_method,
        assigned_to: payload.assigned_to?.trim() || null,
        recorded_by: payload.recorded_by?.trim() || "FO",
        status: "pending",
        note: payload.note?.trim() || null,
      })
      .select("*")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      action: "tip_created",
      entity_type: "tip_ledger",
      entity_id: String(inserted?.id ?? ""),
      after_json: inserted,
      change_reason: "create",
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    });
    if (auditError) {
      console.error("tip audit log insert failed", auditError);
    }

    return NextResponse.json({ success: true, tip: inserted });
  } catch (err) {
    console.error("api/accounting/tips POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    const statusCode = message === "Business day already closed. Use reversal." ? 409 : 500;
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
