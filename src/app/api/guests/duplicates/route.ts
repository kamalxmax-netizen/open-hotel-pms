import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStaffAuth } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
    status: z.enum(["pending", "merged", "dismissed", "do_not_merge"]).optional().default("pending"),
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

const scanSchema = z.object({
    limit_profiles: z.coerce.number().int().min(10).max(5000).optional().default(1500),
});

type ScanProfile = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    passport_no: string | null;
    id_type: string | null;
    id_number: string | null;
    do_not_merge: boolean | null;
    profile_status: string | null;
};

function normalizeText(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function fullName(p: ScanProfile): string {
    return normalizeText(`${p.first_name ?? ""} ${p.last_name ?? ""}`);
}

function pairKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function toOrderedPair(a: string, b: string): { profile_a: string; profile_b: string } {
    return a < b ? { profile_a: a, profile_b: b } : { profile_a: b, profile_b: a };
}

function scorePair(a: ScanProfile, b: ScanProfile): { score: number; match_fields: Record<string, string> } | null {
    const fields: Record<string, string> = {};
    let score = 0;

    const aName = fullName(a);
    const bName = fullName(b);
    const aLast = normalizeText(a.last_name);
    const bLast = normalizeText(b.last_name);
    const aPhone = normalizeText(a.phone);
    const bPhone = normalizeText(b.phone);
    const aPassport = normalizeText(a.passport_no);
    const bPassport = normalizeText(b.passport_no);
    const aIdType = normalizeText(a.id_type);
    const bIdType = normalizeText(b.id_type);
    const aIdNo = normalizeText(a.id_number);
    const bIdNo = normalizeText(b.id_number);

    if (aIdType && bIdType && aIdNo && bIdNo && aIdType === bIdType && aIdNo === bIdNo) {
        score += 100;
        fields.id_number = "exact";
    }
    if (aPassport && bPassport && aPassport === bPassport) {
        score += 95;
        fields.passport_no = "exact";
    }
    if (aName && bName && aName === bName) {
        score += 70;
        fields.full_name = "exact";
    }
    if (aLast && bLast && aPhone && bPhone && aLast === bLast && aPhone === bPhone) {
        score += 70;
        fields.last_name_phone = "exact";
    }
    if (aPhone && bPhone && aPhone === bPhone) {
        score += 35;
        fields.phone = "exact";
    }

    if (score < 70) return null;
    return { score: Math.min(100, score), match_fields: fields };
}

/**
 * GET /api/guests/duplicates
 * List potential duplicate profile pairs from profile_match_scores
 */
export async function GET(request: NextRequest) {
    try {
        const sp = request.nextUrl.searchParams;
        const parsed = querySchema.safeParse({
            status: sp.get("status") ?? undefined,
            limit: sp.get("limit") ?? undefined,
            offset: sp.get("offset") ?? undefined,
        });
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: "Invalid query.", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { status, limit, offset } = parsed.data;
        const supabase = createServerSupabaseClient();
        const auth = await requireStaffAuth(supabase, request);
        if (auth.error) return auth.error;

        const { data: rows, error, count } = await supabase
            .from("profile_match_scores")
            .select("*", { count: "exact" })
            .eq("status", status)
            .order("score", { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        // Collect unique profile IDs for enrichment
        const profileIds = new Set<string>();
        for (const row of rows ?? []) {
            profileIds.add(String(row.profile_a));
            profileIds.add(String(row.profile_b));
        }

        let profileMap: Record<string, any> = {};
        if (profileIds.size > 0) {
            const { data: profiles } = await supabase
                .from("guest_profiles")
                .select("id, first_name, last_name, phone, email, nationality, nationality_code, passport_no, stay_count, profile_status")
                .in("id", Array.from(profileIds));

            for (const p of profiles ?? []) {
                profileMap[p.id] = p;
            }
        }

        // Enrich rows with profile data
        const enriched = (rows ?? []).map((row) => ({
            ...row,
            profile_a_data: profileMap[row.profile_a] ?? null,
            profile_b_data: profileMap[row.profile_b] ?? null,
        }));

        return NextResponse.json({
            success: true,
            items: enriched,
            total: count ?? 0,
            limit,
            offset,
        });
    } catch (err) {
        console.error("guests/duplicates GET failed", err);
        const message = err instanceof Error ? err.message : "Internal server error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/* ─── PATCH ─── Update duplicate pair status ─────────── */

const patchSchema = z.object({
    id: z.string().uuid("id must be a valid UUID"),
    status: z.enum(["dismissed", "do_not_merge"]),
});

export async function PATCH(request: NextRequest) {
    try {
        const json = await request.json().catch(() => null);
        const parsed = patchSchema.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { id, status } = parsed.data;
        const supabase = createServerSupabaseClient();

        const { data: pair, error: pairError } = await supabase
            .from("profile_match_scores")
            .select("id, profile_a, profile_b")
            .eq("id", id)
            .maybeSingle();
        if (pairError) {
            return NextResponse.json({ success: false, error: pairError.message }, { status: 500 });
        }
        if (!pair) {
            return NextResponse.json({ success: false, error: "Duplicate pair not found." }, { status: 404 });
        }

        const profileIds = [String(pair.profile_a), String(pair.profile_b)];
        const previousDoNotMerge = new Map<string, boolean>();

        // If do_not_merge, set flags first. If this step fails, pair status is untouched.
        if (status === "do_not_merge") {
            const { data: profiles, error: profilesError } = await supabase
                .from("guest_profiles")
                .select("id, do_not_merge")
                .in("id", profileIds);
            if (profilesError) {
                return NextResponse.json({ success: false, error: profilesError.message }, { status: 500 });
            }
            for (const row of profiles ?? []) {
                previousDoNotMerge.set(String(row.id), Boolean(row.do_not_merge));
            }

            const { error: setFlagsError } = await supabase
                .from("guest_profiles")
                .update({ do_not_merge: true })
                .in("id", profileIds);
            if (setFlagsError) {
                return NextResponse.json({ success: false, error: setFlagsError.message }, { status: 500 });
            }
        }

        const { error } = await supabase
            .from("profile_match_scores")
            .update({ status, reviewed_at: new Date().toISOString() })
            .eq("id", id);

        if (error) {
            // Best-effort rollback of do_not_merge flags if pair status update fails.
            if (status === "do_not_merge" && previousDoNotMerge.size > 0) {
                for (const profileId of profileIds) {
                    if (!previousDoNotMerge.has(profileId)) continue;
                    await supabase
                        .from("guest_profiles")
                        .update({ do_not_merge: previousDoNotMerge.get(profileId) === true })
                        .eq("id", profileId);
                }
            }
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("guests/duplicates PATCH failed", err);
        const message = err instanceof Error ? err.message : "Internal server error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

/**
 * POST /api/guests/duplicates
 * Scan active profiles and enqueue potential duplicates into profile_match_scores.
 */
export async function POST(request: NextRequest) {
    try {
        const json = await request.json().catch(() => ({}));
        const parsed = scanSchema.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const supabase = createServerSupabaseClient();
        const { limit_profiles } = parsed.data;

        const { data: profiles, error: profileError } = await supabase
            .from("guest_profiles")
            .select("id, first_name, last_name, phone, passport_no, id_type, id_number, do_not_merge, profile_status")
            .neq("profile_status", "merged")
            .eq("do_not_merge", false)
            .order("created_at", { ascending: false })
            .limit(limit_profiles);

        if (profileError) {
            return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
        }

        const rows = (profiles ?? []) as ScanProfile[];
        const seen = new Set<string>();
        const candidates: Array<{
            profile_a: string;
            profile_b: string;
            score: number;
            match_fields: Record<string, string>;
            status: "pending";
        }> = [];

        for (let i = 0; i < rows.length; i += 1) {
            for (let j = i + 1; j < rows.length; j += 1) {
                const a = rows[i];
                const b = rows[j];
                const result = scorePair(a, b);
                if (!result) continue;
                const key = pairKey(a.id, b.id);
                if (seen.has(key)) continue;
                seen.add(key);
                const ordered = toOrderedPair(a.id, b.id);
                candidates.push({
                    ...ordered,
                    score: result.score,
                    match_fields: result.match_fields,
                    status: "pending",
                });
            }
        }

        if (candidates.length === 0) {
            return NextResponse.json({
                success: true,
                scanned_profiles: rows.length,
                candidates_found: 0,
                inserted_or_updated: 0,
            });
        }

        const { error: upsertError } = await supabase
            .from("profile_match_scores")
            .upsert(candidates, {
                onConflict: "profile_a,profile_b",
                ignoreDuplicates: true,
            });

        if (upsertError) {
            return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            scanned_profiles: rows.length,
            candidates_found: candidates.length,
            inserted_or_updated: candidates.length,
        });
    } catch (err) {
        console.error("guests/duplicates POST failed", err);
        const message = err instanceof Error ? err.message : "Internal server error";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
