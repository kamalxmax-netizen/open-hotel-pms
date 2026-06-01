import type { SupabaseClient } from "@supabase/supabase-js";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const MONTHLY_VENDOR_PATH = "/linen-vendor/monthly";
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const tokenHits = new Map<string, { count: number; resetAt: number }>();

export type MonthlyVendorTokenRow = {
  id: string;
  year: number;
  month: number;
  token: string;
  vendor_name: string | null;
  expires_at: string;
  revoked: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
};

export class LinenMonthlyVendorTokenError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function rateLimitMonthlyToken(token: string) {
  const now = Date.now();
  const current = tokenHits.get(token);
  if (!current || current.resetAt <= now) {
    tokenHits.set(token, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (current.count >= RATE_LIMIT_MAX) {
    throw new LinenMonthlyVendorTokenError("Too many requests. Please wait a minute and try again.", 429);
  }
  current.count += 1;
}

function dateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function monthStartDate(year: number, month: number): string {
  return dateUtc(year, month, 1).toISOString().slice(0, 10);
}

function bangkokMonthStartUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - BANGKOK_OFFSET_MS);
}

export function assertMonthlyStatementInput(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new LinenMonthlyVendorTokenError("Invalid statement year.", 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new LinenMonthlyVendorTokenError("Invalid statement month.", 400);
  }
}

export function getBangkokMonthParts(now = new Date()) {
  const bangkok = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return {
    year: bangkok.getUTCFullYear(),
    month: bangkok.getUTCMonth() + 1,
    day: bangkok.getUTCDate(),
  };
}

export function getPreviousBangkokMonth(now = new Date()) {
  const { year, month } = getBangkokMonthParts(now);
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function resolveBangkokFirstDayStatementMonth(now = new Date()) {
  const parts = getBangkokMonthParts(now);
  if (parts.day !== 1) return null;
  return parts.month === 1 ? { year: parts.year - 1, month: 12 } : { year: parts.year, month: parts.month - 1 };
}

export function getNextBangkokMonthStartIso(now = new Date()) {
  const { year, month } = getBangkokMonthParts(now);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return bangkokMonthStartUtc(next.year, next.month).toISOString();
}

export function buildMonthlyVendorUrl(baseUrl: string | null | undefined, token: string) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}${MONTHLY_VENDOR_PATH}/${token}`;
}

export async function getLatestMonthlyVendorName(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<string | null> {
  assertMonthlyStatementInput(year, month);
  const startDate = monthStartDate(year, month);
  const endDate = month === 12 ? monthStartDate(year + 1, 1) : monthStartDate(year, month + 1);

  const { data, error } = await supabase
    .from("laundry_batches")
    .select("vendor_name, business_date, pickup_round")
    .gte("business_date", startDate)
    .lt("business_date", endDate)
    .not("vendor_name", "is", null)
    .order("business_date", { ascending: false })
    .order("pickup_round", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const vendorName = String((data as any)?.vendor_name ?? "").trim();
  return vendorName || null;
}

export async function createMonthlyVendorToken(
  supabase: SupabaseClient,
  year: number,
  month: number,
  options: {
    vendorName?: string | null;
    baseUrl?: string | null;
    createdBy?: string | null;
    now?: Date;
    reuseActive?: boolean;
  } = {}
) {
  assertMonthlyStatementInput(year, month);

  const expiresAt = getNextBangkokMonthStartIso(options.now ?? new Date());
  if (options.reuseActive) {
    const { data: existing, error: existingError } = await supabase
      .from("laundry_monthly_vendor_tokens")
      .select("token, expires_at")
      .eq("year", year)
      .eq("month", month)
      .eq("revoked", false)
      .gt("expires_at", (options.now ?? new Date()).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      const token = String((existing as any).token);
      return {
        token,
        url: buildMonthlyVendorUrl(options.baseUrl, token),
        expires_at: String((existing as any).expires_at),
      };
    }
  }

  const { error: revokeError } = await supabase
    .from("laundry_monthly_vendor_tokens")
    .update({ revoked: true })
    .eq("year", year)
    .eq("month", month)
    .eq("revoked", false);
  if (revokeError) throw new Error(revokeError.message);

  const insertRow: Record<string, unknown> = {
    year,
    month,
    vendor_name: options.vendorName ?? null,
    expires_at: expiresAt,
  };
  if (options.createdBy) insertRow.created_by = options.createdBy;

  const { data, error } = await supabase
    .from("laundry_monthly_vendor_tokens")
    .insert(insertRow)
    .select("token, expires_at")
    .single();
  if (error) throw new Error(error.message);

  const token = String((data as any).token);
  return {
    token,
    url: buildMonthlyVendorUrl(options.baseUrl, token),
    expires_at: String((data as any).expires_at ?? expiresAt),
  };
}

export async function validateMonthlyVendorToken(
  supabase: SupabaseClient,
  token: string,
  options: { now?: Date } = {}
): Promise<MonthlyVendorTokenRow> {
  const normalizedToken = String(token ?? "").trim();
  if (!UUID_RE.test(normalizedToken)) {
    throw new LinenMonthlyVendorTokenError("Invalid token.", 401);
  }
  rateLimitMonthlyToken(`monthly:${normalizedToken}`);

  const { data, error } = await supabase
    .from("laundry_monthly_vendor_tokens")
    .select("*")
    .eq("token", normalizedToken)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new LinenMonthlyVendorTokenError("Invalid token.", 401);
  if ((data as any).revoked) throw new LinenMonthlyVendorTokenError("Token was revoked.", 401);

  const expiresAtMs = Date.parse(String((data as any).expires_at ?? ""));
  const nowMs = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
    throw new LinenMonthlyVendorTokenError("Token expired.", 401);
  }

  return data as MonthlyVendorTokenRow;
}
