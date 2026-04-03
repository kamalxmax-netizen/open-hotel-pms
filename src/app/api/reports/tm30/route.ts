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

const patchSchema = z.object({
  date: z.string().regex(DATE_RE, "date must be YYYY-MM-DD"),
  reservation_id: z.string().uuid("reservation_id must be a uuid"),
  guest_profile_id: z.string().uuid("guest_profile_id must be a uuid"),
  entry_kind: z.literal("late_added_duplicate"),
  excluded: z.boolean(),
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
    const result = await queryTM30Guests(supabase as any, date, { includeExcluded: true });
    const exportGuests = result.guests.filter((guest) => !guest.excluded_from_export);
    const lateDuplicateCount = result.guests.filter((guest) => guest.entry_kind === "late_added_duplicate").length;
    const excludedCount = result.guests.filter((guest) => guest.excluded_from_export).length;

    if (format === "xls") {
      const buffer = buildTM30Workbook(exportGuests);
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
        exportable_guests: exportGuests.length,
        excluded_guests: excludedCount,
        late_duplicate_count: lateDuplicateCount,
        warning_count: result.validations.length + lateDuplicateCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const input = parsed.data;
    const result = await queryTM30Guests(supabase as any, input.date, { includeExcluded: true });
    const targetGuest = result.guests.find(
      (guest) =>
        guest.entry_kind === "late_added_duplicate" &&
        guest.reservation_id === input.reservation_id &&
        guest.guest_profile_id === input.guest_profile_id
    );

    if (!targetGuest) {
      return NextResponse.json(
        { success: false, error: "Late-added TM.30 guest not found for this report date." },
        { status: 404 }
      );
    }

    if (input.excluded) {
      const { error } = await supabase
        .from("tm30_report_exclusions")
        .upsert(
          {
            report_date: input.date,
            reservation_id: input.reservation_id,
            guest_profile_id: input.guest_profile_id,
            exclusion_type: input.entry_kind,
            created_by: user.id,
          },
          {
            onConflict: "report_date,reservation_id,guest_profile_id,exclusion_type",
            ignoreDuplicates: false,
          }
        );
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from("tm30_report_exclusions")
        .delete()
        .eq("report_date", input.date)
        .eq("reservation_id", input.reservation_id)
        .eq("guest_profile_id", input.guest_profile_id)
        .eq("exclusion_type", input.entry_kind);
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      reservation_id: input.reservation_id,
      guest_profile_id: input.guest_profile_id,
      entry_kind: input.entry_kind,
      excluded: input.excluded,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
