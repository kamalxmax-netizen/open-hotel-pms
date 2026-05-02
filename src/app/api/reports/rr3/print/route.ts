import { queryRR3Guests } from "@/lib/gov-export/rr3-query";
import {
  normalizeRR3PrintGroup,
  rr3PrintGroupLabel,
} from "@/lib/gov-export/rr3-row-overrides";
import { renderRR3LandscapeHtml } from "@/lib/gov-export/printRR3Html";
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
  group: z.string().optional().nullable(),
});

function filtersFromRequest(request: NextRequest, year: number, month: number): RR3FilterParams {
  const sources = (request.nextUrl.searchParams.get("sources") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return {
    year,
    month,
    sources,
    tax_invoice_only: request.nextUrl.searchParams.get("tax_invoice") === "true",
    include_accompanying: request.nextUrl.searchParams.get("include_accompanying") !== "false",
  };
}

function filteredLabel(filters: RR3FilterParams) {
  const parts: string[] = [];
  if (filters.sources.includes("ota")) parts.push("OTA");
  if (filters.sources.includes("walkin")) parts.push("Walk-in");
  if (filters.sources.includes("direct")) parts.push("Direct");
  if (filters.tax_invoice_only) parts.push("Tax invoice");
  return parts.length > 0 ? `ตาม Filter: ${parts.join(" + ")}` : "ทั้งหมด";
}

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
      group: request.nextUrl.searchParams.get("group") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid RR3 print query." }, { status: 400 });
    }

    const group = normalizeRR3PrintGroup(parsed.data.group);
    const filters: RR3FilterParams = group
      ? group === "ota_tax"
        ? { year: parsed.data.year, month: parsed.data.month, sources: ["ota"], tax_invoice_only: true, include_accompanying: true }
        : { year: parsed.data.year, month: parsed.data.month, sources: ["walkin", "direct"], tax_invoice_only: false, include_accompanying: true }
      : filtersFromRequest(request, parsed.data.year, parsed.data.month);

    const result = await queryRR3Guests(supabase as any, filters);
    const label = group ? rr3PrintGroupLabel(group) : filteredLabel(filters);
    const html = renderRR3LandscapeHtml({
      year: parsed.data.year,
      month: parsed.data.month,
      group: group ?? undefined,
      group_label: label,
      entries: result.entries,
    });

    return NextResponse.json({
      success: true,
      label,
      entry_count: result.entries.length,
      manual_count: result.entries.filter((entry) => entry.rr3_override).length,
      html,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
