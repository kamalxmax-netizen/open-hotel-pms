import { rr3Filename } from "@/lib/gov-export/constants";
import { buildRR3Workbook } from "@/lib/gov-export/excel-builder";
import { queryRR3Guests } from "@/lib/gov-export/rr3-query";
import type { RR3FilterParams } from "@/lib/gov-export/types";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  year: z.coerce.number().int().min(2025).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      year: request.nextUrl.searchParams.get("year") ?? undefined,
      month: request.nextUrl.searchParams.get("month") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const year = parsed.data.year;
    const month = parsed.data.month;
    const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "json";

    const sources = (request.nextUrl.searchParams.get("sources") ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    const filters: RR3FilterParams = {
      year,
      month,
      sources,
      tax_invoice_only: request.nextUrl.searchParams.get("tax_invoice") === "true",
      include_accompanying: request.nextUrl.searchParams.get("include_accompanying") !== "false",
    };

    const result = await queryRR3Guests(supabase as any, filters);

    if (format === "xlsx") {
      const buffer = buildRR3Workbook(result.entries);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${rr3Filename(year, month)}"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      filters,
      entries: result.entries,
      validations: result.validations,
      summary: result.summary,
      price_summary: result.price_summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
