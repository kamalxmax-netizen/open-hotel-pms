import type { BookingSource } from "@/lib/types";
import type { ChannelFlagWithEntry, MonthlyAuditChannelFlag } from "@/lib/abbreviated-tax-invoice/types";
import { loadIssuedFullTaxInvoiceMap } from "@/lib/monthly-audit";

type SupabaseLike = {
  from: (table: string) => any;
};

export class MonthlyAuditChannelFlagError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MonthlyAuditChannelFlagError";
    this.status = status;
  }
}

const BOOKING_SOURCES = new Set(["ota", "walkin", "direct", "agent"]);

export function normalizeBookingSource(value: unknown): BookingSource {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (BOOKING_SOURCES.has(normalized)) return normalized as BookingSource;
  return "walkin";
}

export async function getChannelFlag(
  supabase: SupabaseLike,
  entryId: string
): Promise<ChannelFlagWithEntry> {
  const { data: entry, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id, source")
    .eq("id", entryId)
    .maybeSingle();

  if (entryError) throw new MonthlyAuditChannelFlagError(entryError.message, 500);
  if (!entry) throw new MonthlyAuditChannelFlagError("Monthly audit entry not found.", 404);

  const defaultChannel = normalizeBookingSource((entry as any).source);

  const { data: flag, error: flagError } = await supabase
    .from("monthly_audit_channel_flag")
    .select("*")
    .eq("entry_id", entryId)
    .maybeSingle();

  if (flagError) throw new MonthlyAuditChannelFlagError(flagError.message, 500);

  if (!flag) {
    return {
      id: "",
      audit_period_id: String((entry as any).period_id),
      entry_id: String((entry as any).id),
      actual_channel: defaultChannel,
      tax_invoice_channel: defaultChannel,
      reason: null,
      flagged_by_user_id: null,
      flagged_at: "",
      default_channel: defaultChannel,
    };
  }

  return {
    id: String((flag as any).id),
    audit_period_id: String((flag as any).audit_period_id),
    entry_id: String((flag as any).entry_id),
    actual_channel: normalizeBookingSource((flag as any).actual_channel),
    tax_invoice_channel: normalizeBookingSource((flag as any).tax_invoice_channel),
    reason: (flag as any).reason ?? null,
    flagged_by_user_id: (flag as any).flagged_by_user_id ?? null,
    flagged_at: String((flag as any).flagged_at ?? ""),
    default_channel: defaultChannel,
  };
}

export async function setChannelFlag(
  supabase: SupabaseLike,
  params: {
    entryId: string;
    actualChannel: BookingSource;
    taxInvoiceChannel: BookingSource;
    reason?: string | null;
    userId: string | null;
  }
): Promise<MonthlyAuditChannelFlag> {
  const entryId = String(params.entryId ?? "").trim();
  if (!entryId) throw new MonthlyAuditChannelFlagError("entryId is required.");

  const { data: entry, error: entryError } = await supabase
    .from("monthly_audit_entries")
    .select("id, period_id, reservation_id")
    .eq("id", entryId)
    .maybeSingle();

  if (entryError) throw new MonthlyAuditChannelFlagError(entryError.message, 500);
  if (!entry) throw new MonthlyAuditChannelFlagError("Monthly audit entry not found.", 404);

  const reservationId = String((entry as any).reservation_id ?? "").trim();
  const issuedFullTaxInvoiceMap = await loadIssuedFullTaxInvoiceMap(supabase, [reservationId]);
  if (issuedFullTaxInvoiceMap.has(reservationId)) {
    throw new MonthlyAuditChannelFlagError(
      "This booking has an issued full tax invoice. Edit it from Booking > Tax Invoice, then re-generate Monthly Audit.",
      409
    );
  }

  const actualChannel = normalizeBookingSource(params.actualChannel);
  const taxInvoiceChannel = normalizeBookingSource(params.taxInvoiceChannel);

  const { data, error } = await supabase
    .from("monthly_audit_channel_flag")
    .upsert(
      {
        audit_period_id: String((entry as any).period_id),
        entry_id: entryId,
        actual_channel: actualChannel,
        tax_invoice_channel: taxInvoiceChannel,
        reason: String(params.reason ?? "").trim() || null,
        flagged_by_user_id: params.userId,
        flagged_at: new Date().toISOString(),
      },
      { onConflict: "entry_id" }
    )
    .select("*")
    .single();

  if (error) throw new MonthlyAuditChannelFlagError(error.message, 500);

  return {
    id: String((data as any).id),
    audit_period_id: String((data as any).audit_period_id),
    entry_id: String((data as any).entry_id),
    actual_channel: normalizeBookingSource((data as any).actual_channel),
    tax_invoice_channel: normalizeBookingSource((data as any).tax_invoice_channel),
    reason: (data as any).reason ?? null,
    flagged_by_user_id: (data as any).flagged_by_user_id ?? null,
    flagged_at: String((data as any).flagged_at ?? ""),
  };
}
