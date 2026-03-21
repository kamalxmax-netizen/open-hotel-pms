import { tm30Filename } from "@/lib/gov-export/constants";
import { buildTM30Workbook } from "@/lib/gov-export/excel-builder";
import { queryTM30Guests } from "@/lib/gov-export/tm30-query";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bangkokToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const querySchema = z.object({
  date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD").optional(),
});

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const rawDate = request.nextUrl.searchParams.get("date")?.trim() || undefined;
    const format = request.nextUrl.searchParams.get("format") === "xls" ? "xls" : "json";

    const parsed = querySchema.safeParse({ date: rawDate });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const date = parsed.data.date ?? bangkokToday();
    const result = await queryTM30Guests(supabase as any, date);

    if (format === "xls") {
      const buffer = buildTM30Workbook(result.guests);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.ms-excel",
          "Content-Disposition": `attachment; filename="${tm30Filename(date)}"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      date,
      guests: result.guests,
      validations: result.validations,
      summary: {
        total_guests: result.guests.length,
        warning_count: result.validations.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
