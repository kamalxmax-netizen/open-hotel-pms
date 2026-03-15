import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  product_id: z.string().uuid().optional(),
  action: z.enum(["use", "transfer_out", "transfer_in", "sale", "receive", "adjust", "return"]).optional(),
  floor_number: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 0), "Invalid floor_number"),
  reference_type: z.string().trim().max(60).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 50))
    .refine((v) => Number.isInteger(v) && v > 0 && v <= 500, "limit must be 1-500"),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0))
    .refine((v) => Number.isInteger(v) && v >= 0, "offset must be >= 0"),
});

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
      product_id: request.nextUrl.searchParams.get("product_id") ?? undefined,
      action: request.nextUrl.searchParams.get("action") ?? undefined,
      floor_number: request.nextUrl.searchParams.get("floor_number") ?? undefined,
      reference_type: request.nextUrl.searchParams.get("reference_type") ?? undefined,
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      date_from,
      date_to,
      product_id,
      action,
      floor_number,
      reference_type,
      q,
      limit,
      offset,
    } = parsed.data;

    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("stock_transactions_v2")
      .select(
        `
        id,
        transaction_date,
        product_id,
        action,
        quantity_change,
        from_location,
        to_location,
        reference_type,
        reference_id,
        room_number,
        floor_number,
        performed_by,
        note,
        created_at,
        products(name)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (date_from) query = query.gte("transaction_date", date_from);
    if (date_to) query = query.lte("transaction_date", date_to);
    if (product_id) query = query.eq("product_id", product_id);
    if (action) query = query.eq("action", action);
    if (floor_number !== undefined) query = query.eq("floor_number", floor_number);
    if (reference_type) query = query.eq("reference_type", reference_type);
    if (q && q.length > 0) {
      query = query.or(`note.ilike.%${q}%,room_number.ilike.%${q}%,performed_by.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []).map((row: any) => ({
      id: row.id,
      transaction_date: row.transaction_date,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      action: row.action,
      quantity_change: Number(row.quantity_change ?? 0),
      from_location: row.from_location ?? null,
      to_location: row.to_location ?? null,
      reference_type: row.reference_type ?? null,
      reference_id: row.reference_id ?? null,
      room_number: row.room_number ?? null,
      floor_number: row.floor_number ?? null,
      performed_by: row.performed_by ?? null,
      note: row.note ?? null,
      created_at: row.created_at,
    }));

    return NextResponse.json({
      success: true,
      transactions: rows,
      pagination: {
        total: count ?? 0,
        limit,
        offset,
        has_more: (count ?? 0) > offset + rows.length,
      },
    });
  } catch (err) {
    console.error("stock/transactions GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
