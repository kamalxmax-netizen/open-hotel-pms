import {
  abbreviatedTaxErrorResponse,
  requireAbbreviatedTaxActor,
} from "@/lib/abbreviated-tax-invoice/api-auth";
import { shiftGeneratedLine, shiftRow, shiftRows } from "@/lib/abbreviated-tax-invoice/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const preGenerateShiftBaseSchema = z.object({
  entry_id: z.string().uuid(),
  tax_group: z.enum(["A", "B", "C", "D", "E"]),
  unit_price: z.coerce.number().min(0),
  quantity: z.coerce.number().int().min(1).optional(),
  qty: z.coerce.number().int().min(1).optional(),
  original_date: z.string().regex(DATE_RE),
  target_date: z.string().regex(DATE_RE),
  reason: z.string().trim().max(500).optional(),
});

const preGenerateShiftSchema = preGenerateShiftBaseSchema.refine((value) => value.quantity !== undefined || value.qty !== undefined, {
  message: "quantity or qty is required",
  path: ["quantity"],
}).transform(({ qty, ...value }) => ({
  ...value,
  quantity: value.quantity ?? qty ?? 1,
}));

const preGenerateShiftWithModeSchema = preGenerateShiftBaseSchema.extend({
  mode: z.literal("pre_generate").optional(),
}).refine((value) => value.quantity !== undefined || value.qty !== undefined, {
  message: "quantity or qty is required",
  path: ["quantity"],
}).transform(({ qty, mode: _mode, ...value }) => ({
  ...value,
  quantity: value.quantity ?? qty ?? 1,
}));

const bodySchema = z.union([
  z.object({
    mode: z.literal("post_generate").optional(),
    line_id: z.string().uuid(),
    target_date: z.string().regex(DATE_RE),
  }),
  z.object({
    mode: z.literal("pre_generate").optional(),
    shifts: z.array(preGenerateShiftSchema).min(1).max(100),
  }),
  preGenerateShiftWithModeSchema,
]);

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAbbreviatedTaxActor(request);
    if (!actor.ok) return actor.response;

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if ("line_id" in parsed.data) {
      const result = await shiftGeneratedLine(actor.supabase, parsed.data.line_id, parsed.data.target_date, actor.user.id);
      return NextResponse.json({ success: true, mode: "post_generate", data: result });
    }

    if ("shifts" in parsed.data) {
      const result = await shiftRows(actor.supabase, { shifts: parsed.data.shifts }, actor.user.id);
      return NextResponse.json({ success: true, mode: "pre_generate", data: result });
    }

    const result = await shiftRow(
      actor.supabase,
      {
        entry_id: parsed.data.entry_id,
        tax_group: parsed.data.tax_group,
        unit_price: parsed.data.unit_price,
        quantity: parsed.data.quantity,
        original_date: parsed.data.original_date,
        target_date: parsed.data.target_date,
        reason: parsed.data.reason,
      },
      actor.user.id
    );
    return NextResponse.json({ success: true, mode: "pre_generate", data: result });
  } catch (err) {
    return abbreviatedTaxErrorResponse(err);
  }
}
