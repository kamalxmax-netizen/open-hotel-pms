import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeNationalityCode } from "@/lib/nationality-map";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  query: z.string().trim().min(2, "query must be at least 2 characters"),
  nationality_code: z.string().trim().optional(),
});

type CandidateProfile = {
  id: string;
  member_no: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  dob: string | null;
  id_number: string | null;
  passport_no: string | null;
  nationality_code: string | null;
  country: string | null;
  profile_status: string | null;
  do_not_merge: boolean | null;
  stay_count: number | null;
  vip_tier: string | null;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDigits(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("66") && digits.length >= 10) return `0${digits.slice(2)}`;
  return digits;
}

function levenshtein(aRaw: string, bRaw: string): number {
  const a = aRaw;
  const b = bRaw;
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function buildMatch(profile: CandidateProfile, query: string) {
  const reasons: string[] = [];
  let score = 0;

  const q = normalizeText(query);
  const qDigits = normalizeDigits(query);
  const qParts = q.split(" ").filter(Boolean);
  const qFirst = qParts[0] ?? q;
  const qLast = qParts[qParts.length - 1] ?? q;

  const firstName = normalizeText(profile.first_name);
  const lastName = normalizeText(profile.last_name);
  const fullName = `${firstName} ${lastName}`.trim();
  const memberNo = normalizeText(profile.member_no);
  const idNumber = normalizeText(profile.id_number);
  const passportNo = normalizeText(profile.passport_no);
  const email = normalizeText(profile.email);
  const phone = normalizeDigits(profile.phone);
  const dob = normalizeText(profile.dob);

  if (idNumber && q === idNumber) {
    score += 50;
    reasons.push("id_number_exact");
  } else if (passportNo && q === passportNo) {
    score += 50;
    reasons.push("passport_exact");
  }

  if (lastName && (q === lastName || qLast === lastName)) {
    score += 20;
    reasons.push("last_name_exact");
  }

  if (firstName && (q === firstName || qFirst === firstName)) {
    score += 15;
    reasons.push("first_name_exact");
  }

  if (fullName && q.length >= 3 && (fullName === q || fullName.includes(q) || q.includes(fullName))) {
    score += 18;
    reasons.push("full_name_partial");
  }

  if (fullName && qParts.length >= 2 && qParts.every((part) => part.length >= 2 && fullName.includes(part))) {
    score += 35;
    reasons.push("full_name_all_parts");
  }

  if (firstName && qFirst.length >= 3 && firstName.includes(qFirst)) {
    score += 22;
    reasons.push("first_name_partial");
  }

  if (lastName && qLast.length >= 3 && lastName.includes(qLast)) {
    score += 18;
    reasons.push("last_name_partial");
  }

  if (phone && qDigits && qDigits === phone) {
    score += 10;
    reasons.push("phone_exact");
  } else if (phone && qDigits.length >= 4 && phone.includes(qDigits)) {
    score += 8;
    reasons.push("phone_partial");
  }

  if (email && q === email) {
    score += 10;
    reasons.push("email_exact");
  } else if (email && q.length >= 3 && email.includes(q)) {
    score += 8;
    reasons.push("email_partial");
  }

  if (memberNo && q === memberNo) {
    score += 20;
    reasons.push("member_no_exact");
  } else if (memberNo && q.length >= 3 && memberNo.includes(q)) {
    score += 10;
    reasons.push("member_no_partial");
  }

  if (firstName && qFirst.length >= 3 && levenshtein(qFirst, firstName) <= 2) {
    score += 8;
    reasons.push("first_name_fuzzy");
  }

  if (lastName && qLast.length >= 3 && levenshtein(qLast, lastName) <= 2) {
    score += 10;
    reasons.push("last_name_fuzzy");
  }

  if (dob && q === dob) {
    score += 5;
    reasons.push("dob_exact");
  }

  if (fullName && q.length >= 3 && fullName.startsWith(q)) {
    score += 12;
    reasons.push("full_name_prefix");
  }

  const level = score >= 70 ? "strong" : score >= 30 ? "possible" : "new";
  return { score, reasons, level };
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const query = parsed.data.query.trim();
    const nationalityCode = normalizeNationalityCode(parsed.data.nationality_code ?? null);
    const supabase = createServerSupabaseClient();

    let dbQuery = supabase
      .from("guest_profiles")
      .select(
        "id, member_no, first_name, last_name, phone, email, dob, id_number, passport_no, nationality_code, country, profile_status, do_not_merge, stay_count, vip_tier"
      )
      .neq("profile_status", "merged")
      .limit(50);

    if (nationalityCode) dbQuery = dbQuery.eq("nationality_code", nationalityCode);

    const safeQuery = query.replace(/[%_,]/g, "").trim();
    if (safeQuery) {
      const terms = Array.from(
        new Set(
          [safeQuery, ...safeQuery.split(/\s+/).filter((part) => part.length >= 2)]
            .map((term) => term.replace(/[%_,]/g, "").trim())
            .filter(Boolean)
        )
      );
      const fields = ["first_name", "last_name", "phone", "email", "id_number", "passport_no", "member_no"];
      const orParts: string[] = [];
      for (const term of terms) {
        for (const field of fields) {
          orParts.push(`${field}.ilike.%${term}%`);
        }
      }
      dbQuery = dbQuery.or(orParts.join(","));
    }

    const { data, error } = await dbQuery;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const matches = (data ?? [])
      .map((row) => {
        const profile = row as CandidateProfile;
        const result = buildMatch(profile, query);
        return {
          profile: {
            id: profile.id,
            member_no: profile.member_no ?? null,
            first_name: profile.first_name ?? null,
            last_name: profile.last_name ?? null,
            full_name: `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim(),
            phone: profile.phone ?? null,
            email: profile.email ?? null,
            nationality_code: profile.nationality_code ?? null,
            country: profile.country ?? null,
            profile_status: profile.profile_status ?? "draft",
            do_not_merge: Boolean(profile.do_not_merge),
            stay_count: Number(profile.stay_count ?? 0),
            vip_tier: profile.vip_tier ?? null,
          },
          score: Number(result.score.toFixed(2)),
          match_level: result.level,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      query,
      matches,
    });
  } catch (err) {
    console.error("api/guests/match POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
