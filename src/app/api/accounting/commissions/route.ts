import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
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
  staff_name: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createSchema = z.object({
  transfer_id: z.string().uuid(),
  staff_name: z.string().trim().min(1).max(120),
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
      staff_name: request.nextUrl.searchParams.get("staff_name") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { status, date_from, date_to, staff_name, limit, offset } = parsed.data;
    const supabase = createServerSupabaseClient();
    const auth = await requireStaffAuth(supabase, request);
    if (auth.error) return auth.error;

    let query = supabase
      .from("commission_ledger")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (date_from) query = query.gte("created_at", `${date_from}T00:00:00+07:00`);
    if (date_to) query = query.lt("created_at", `${date_to}T23:59:59+07:00`);
    if (staff_name) query = query.ilike("staff_name", `%${staff_name}%`);

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
    console.error("api/accounting/commissions GET failed", err);
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

    const { data: existing, error: existingError } = await supabase
      .from("commission_ledger")
      .select("id")
      .eq("transfer_id", payload.transfer_id)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Commission already exists for this transfer." },
        { status: 409 }
      );
    }

    const { data: transfer, error: transferError } = await supabase
      .from("transfers")
      .select("id, reservation_id, selling_price, cost_price, driver_commission")
      .eq("id", payload.transfer_id)
      .maybeSingle();
    if (transferError) {
      return NextResponse.json({ success: false, error: transferError.message }, { status: 500 });
    }
    if (!transfer) {
      return NextResponse.json({ success: false, error: "Transfer not found." }, { status: 404 });
    }

    const reservationId = transfer.reservation_id ? String(transfer.reservation_id) : null;
    let guestProfileId: string | null = null;
    if (reservationId) {
      const { data: reservation, error: reservationError } = await supabase
        .from("reservations")
        .select("guest_profile_id")
        .eq("id", reservationId)
        .maybeSingle();
      if (reservationError) {
        return NextResponse.json({ success: false, error: reservationError.message }, { status: 500 });
      }
      guestProfileId = reservation?.guest_profile_id ? String(reservation.guest_profile_id) : null;
    }

    const baseAmount = Number(transfer.selling_price ?? 0);
    const commissionAmount = Number(transfer.driver_commission ?? 0);

    const { data: inserted, error: insertError } = await supabase
      .from("commission_ledger")
      .insert({
        transfer_id: payload.transfer_id,
        reservation_id: reservationId,
        guest_profile_id: guestProfileId,
        staff_name: payload.staff_name,
        rule_type: "fixed",
        rule_value: 0,
        base_amount: Number(baseAmount.toFixed(2)),
        commission_amount: Number(commissionAmount.toFixed(2)),
        status: "pending",
      })
      .select("*")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      action: "commission_created",
      entity_type: "commission_ledger",
      entity_id: String(inserted?.id ?? ""),
      after_json: inserted,
      change_reason: "manual_create",
      business_date: businessDate,
      source: normalizeAuditSource("manual"),
    });
    if (auditError) {
      console.error("commission audit log insert failed", auditError);
    }

    return NextResponse.json({ success: true, commission: inserted });
  } catch (err) {
    console.error("api/accounting/commissions POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
