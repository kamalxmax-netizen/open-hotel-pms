import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { getMonthlyMegaGrid } from "@/lib/linen/monthly";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function parseBool(value: string | null, fallback = true) {
  if (value == null) return fallback;
  return value === "1" || value === "true";
}

function parseRounds(value: string | null) {
  if (!value) return undefined;
  const rounds = value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isInteger(value) && value > 0);
  return rounds.length ? rounds : undefined;
}

export async function GET(request: NextRequest, { params }: { params: { year: string; month: string } }) {
  try {
    const { supabase } = await requireLinenAccess(request);
    const year = Number(params.year);
    const month = Number(params.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2020 || year > 2100 || month < 1 || month > 12) {
      return NextResponse.json({ success: false, error: "Invalid year/month." }, { status: 400 });
    }

    const data = await getMonthlyMegaGrid(supabase, year, month, {
      includeN: parseBool(request.nextUrl.searchParams.get("include_n")),
      includeO: parseBool(request.nextUrl.searchParams.get("include_o")),
      includeRw: parseBool(request.nextUrl.searchParams.get("include_rw")),
      includeRounds: parseRounds(request.nextUrl.searchParams.get("include_rounds")),
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("api/linen/monthly/[year]/[month]/grid GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load linen monthly grid.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
