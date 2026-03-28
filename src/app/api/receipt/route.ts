import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  reservation_id: z.string().uuid(),
  guest_name: z.string().trim().min(1).max(255),
  room_numbers: z.array(z.string().trim().min(1)).min(1),
  grand_total: z.coerce.number().min(0).max(100000000),
  language: z.enum(["th", "en"]).optional().default("th"),
  note: z.string().trim().max(1000).optional().nullable(),
});

const listQuerySchema = z.object({
  date_from: z.string().regex(DATE_RE).optional(),
  date_to: z.string().regex(DATE_RE).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(50),
});

function strOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function toBangkokYY(): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
  }).format(new Date());
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = listQuerySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      per_page: request.nextUrl.searchParams.get("per_page") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const q = parsed.data;
    const dateFrom = q.date_from ?? "2025-01-01";
    const dateTo = q.date_to ?? "2099-12-31";

    const { data: rows, error } = await supabase
      .from("receipts")
      .select("id, receipt_no, reservation_id, guest_name, room_numbers, grand_total, language, printed_at, printed_by, note, created_at")
      .gte("printed_at", `${dateFrom}T00:00:00+07:00`)
      .lte("printed_at", `${dateTo}T23:59:59+07:00`)
      .order("printed_at", { ascending: false })
      .limit(5000);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const list = (rows ?? []) as any[];
    const search = String(q.search ?? "").trim().toLowerCase();
    const filtered = search
      ? list.filter((row) => {
          const bag = [
            row.receipt_no ?? "",
            row.guest_name ?? "",
            ...(Array.isArray(row.room_numbers) ? row.room_numbers : []),
          ]
            .join(" ")
            .toLowerCase();
          return bag.includes(search);
        })
      : list;

    const total = filtered.length;
    const offset = (q.page - 1) * q.per_page;
    const data = filtered.slice(offset, offset + q.per_page);

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page: q.page,
        per_page: q.per_page,
        total,
        total_pages: total > 0 ? Math.ceil(total / q.per_page) : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Generate receipt number via RPC
    const yy = toBangkokYY();
    const { data: receiptNo, error: rpcError } = await supabase
      .rpc("next_receipt_no", { p_yy: yy });

    if (rpcError) {
      return NextResponse.json({ success: false, error: rpcError.message }, { status: 500 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("receipts")
      .insert({
        receipt_no: receiptNo,
        reservation_id: input.reservation_id,
        guest_name: input.guest_name,
        room_numbers: input.room_numbers,
        grand_total: input.grand_total,
        language: input.language,
        note: strOrNull(input.note),
        printed_by: user.id,
      })
      .select("id, receipt_no, reservation_id, guest_name, room_numbers, grand_total, language, printed_at, printed_by, note, created_at")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, receipt: inserted, data: inserted }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
