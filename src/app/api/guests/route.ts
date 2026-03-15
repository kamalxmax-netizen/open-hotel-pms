import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCountryByCode, normalizeNationalityCode } from "@/lib/nationality-map";
import type { GuestProfileListResponse } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  include_merged: z.enum(["0", "1"]).optional().default("0"),
  show_all: z.enum(["0", "1"]).optional().default("0"),
  profile_status: z.enum(["all", "verified", "draft"]).optional().default("all"),
  vip_bucket: z.enum(["all", "regular", "vip"]).optional().default("all"),
  blacklisted: z.enum(["all", "normal", "blacklisted"]).optional().default("all"),
});

function sanitizeSearchTerm(raw: string) {
  return raw.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value: string) {
  const digits = value.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("66") && digits.length >= 10) return `0${digits.slice(2)}`;
  return digits;
}

type GuestListFilters = {
  q: string;
  includeMerged: boolean;
  profileStatus: "all" | "verified" | "draft";
  vipBucket: "all" | "regular" | "vip";
  blacklist: "all" | "normal" | "blacklisted";
};

function applyGuestFilters(query: any, filters: GuestListFilters) {
  if (!filters.includeMerged) {
    query = query.neq("profile_status", "merged");
  }

  if (filters.profileStatus !== "all") {
    query = query.eq("profile_status", filters.profileStatus);
  }

  if (filters.blacklist === "blacklisted") {
    query = query.eq("blacklisted", true);
  } else if (filters.blacklist === "normal") {
    query = query.eq("blacklisted", false);
  }

  if (filters.vipBucket === "regular") {
    query = query.or("vip_tier.is.null,vip_tier.eq.regular");
  } else if (filters.vipBucket === "vip") {
    query = query.in("vip_tier", ["loyal", "vip", "longest"]);
  }

  if (filters.q) {
    const safeQuery = sanitizeSearchTerm(filters.q);
    const digits = normalizeDigits(filters.q);
    const terms = Array.from(
      new Set(
        [safeQuery, digits, ...safeQuery.split(" ").filter((part) => part.length >= 2)]
          .map((term) => sanitizeSearchTerm(term))
          .filter(Boolean)
      )
    );

    const fields = [
      "last_name",
      "first_name",
      "member_no",
      "phone",
      "passport_no",
      "id_number",
      "id_card_number",
    ];

    const orParts: string[] = [];
    for (const term of terms) {
      for (const field of fields) {
        orParts.push(`${field}.ilike.%${term}%`);
      }
    }

    if (orParts.length > 0) {
      query = query.or(orParts.join(","));
    }
  }

  return query;
}

function emptyListResponse(page: number, limit: number): GuestProfileListResponse {
  return {
    success: true,
    requires_search: true,
    profiles: [],
    summary: {
      matched: 0,
      verified: 0,
      draft: 0,
      vip: 0,
    },
    total: 0,
    page,
    page_size: limit,
    total_pages: 0,
  };
}

export async function GET(request: NextRequest) {
  noStore();

  try {
    const parsed = querySchema.safeParse({
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      page: request.nextUrl.searchParams.get("page") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      include_merged: request.nextUrl.searchParams.get("include_merged") ?? undefined,
      show_all: request.nextUrl.searchParams.get("show_all") ?? undefined,
      profile_status: request.nextUrl.searchParams.get("profile_status") ?? undefined,
      vip_bucket: request.nextUrl.searchParams.get("vip_bucket") ?? undefined,
      blacklisted: request.nextUrl.searchParams.get("blacklisted") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { q, page, limit, include_merged, show_all, profile_status, vip_bucket, blacklisted } = parsed.data;
    const normalizedQ = sanitizeSearchTerm(q);
    const showAll = show_all === "1";
    const hasActiveFilters =
      profile_status !== "all" || vip_bucket !== "all" || blacklisted !== "all";
    const searchReady = normalizedQ.length >= 3;

    if (!showAll && !searchReady && !hasActiveFilters) {
      return NextResponse.json(emptyListResponse(page, limit));
    }

    const filters: GuestListFilters = {
      q: showAll ? normalizedQ : (searchReady ? normalizedQ : ""),
      includeMerged: showAll || include_merged === "1",
      profileStatus: profile_status,
      vipBucket: vip_bucket,
      blacklist: blacklisted,
    };

    const supabase = createServerSupabaseClient();
    const selectClause =
      "id, member_no, first_name, last_name, phone, email, nationality, nationality_code, country, vip_tier, blacklisted, profile_status, stay_count, last_stay_date";
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const baseRowsQuery = applyGuestFilters(
      supabase
        .from("guest_profiles")
        .select(selectClause, { count: "exact" })
        .order("last_stay_date", { ascending: false, nullsFirst: false })
        .order("last_name", { ascending: true })
        .range(start, end),
      filters
    );

    const countBaseQuery = (overrides?: Partial<GuestListFilters>) =>
      applyGuestFilters(
        supabase
          .from("guest_profiles")
          .select("id", { count: "exact", head: true }),
        { ...filters, ...overrides }
      );

    const [rowsRes, verifiedRes, draftRes, vipRes] = await Promise.all([
      baseRowsQuery,
      countBaseQuery({ profileStatus: "verified" }),
      countBaseQuery({ profileStatus: "draft" }),
      countBaseQuery({ vipBucket: "vip" }),
    ]);

    if (rowsRes.error) {
      return NextResponse.json({ success: false, error: rowsRes.error.message }, { status: 500 });
    }
    if (verifiedRes.error) {
      return NextResponse.json({ success: false, error: verifiedRes.error.message }, { status: 500 });
    }
    if (draftRes.error) {
      return NextResponse.json({ success: false, error: draftRes.error.message }, { status: 500 });
    }
    if (vipRes.error) {
      return NextResponse.json({ success: false, error: vipRes.error.message }, { status: 500 });
    }

    const total = rowsRes.count ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

    return NextResponse.json({
      success: true,
      requires_search: false,
      profiles: rowsRes.data ?? [],
      summary: {
        matched: total,
        verified: verifiedRes.count ?? 0,
        draft: draftRes.count ?? 0,
        vip: vipRes.count ?? 0,
      },
      total,
      page,
      page_size: limit,
      total_pages: totalPages,
    } satisfies GuestProfileListResponse);
  } catch (err) {
    console.error("api/guests GET failed", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const body = await request.json();

    const {
      first_name,
      last_name,
      gender,
      nationality,
      passport_no,
      dob,
      id_card_number,
      id_type,
      id_number,
      address_line1,
      address_line2,
      city,
      province,
      postal_code,
      country,
      address,
      nationality_code,
      phone,
      email,
      whatsapp,
      line_id,
      car_registration,
      vip_tier,
      preferences,
      notes,
      passport_raw,
      profile_status,
      do_not_merge,
    } = body;

    if (!last_name) {
      return NextResponse.json({ error: "last_name is required" }, { status: 400 });
    }

    const normalizedCode = normalizeNationalityCode(nationality_code || nationality);
    const resolvedCountry = country || getCountryByCode(normalizedCode) || country || null;

    const { data, error } = await supabase
      .from("guest_profiles")
      .insert({
        first_name,
        last_name,
        gender,
        nationality,
        nationality_code: normalizedCode ?? null,
        passport_no,
        dob,
        id_card_number,
        id_type,
        id_number,
        address,
        address_line1,
        address_line2,
        city,
        province,
        postal_code,
        country: resolvedCountry,
        phone,
        email,
        whatsapp,
        line_id,
        car_registration,
        vip_tier,
        preferences,
        notes,
        passport_raw,
        profile_status,
        do_not_merge,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, profile: data }, { status: 201 });
  } catch (err) {
    console.error("api/guests POST failed", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
