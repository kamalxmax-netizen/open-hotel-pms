import type { SupabaseClient } from "@supabase/supabase-js";
import { RR3_DEFAULT_DESTINATION, RR3_DEFAULT_OCCUPATION } from "./constants";
import type { RR3GuestRecord, RR3PrintGroupKey, RR3RowOverride, RR3RowOverrideFields } from "./types";

export function normalizeRR3PrintGroup(value: unknown): RR3PrintGroupKey | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ota_tax") return "ota_tax";
  if (normalized === "walkin_direct") return "walkin_direct";
  return null;
}

export function rr3PrintGroupLabel(group: RR3PrintGroupKey): string {
  return group === "ota_tax" ? "รร.3 OTA + Tax invoice" : "รร.3 Walk-in + Direct";
}

export function isMonthEndedInBangkok(year: number, month: number): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const todayYear = Number(parts.find((part) => part.type === "year")?.value ?? 0);
  const todayMonth = Number(parts.find((part) => part.type === "month")?.value ?? 0);
  const todayDay = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  const currentKey = todayYear * 10000 + todayMonth * 100 + todayDay;
  const lastDay = new Date(year, month, 0).getDate();
  const targetEndKey = year * 10000 + month * 100 + lastDay;
  return currentKey > targetEndKey;
}

export async function loadRR3AuditPeriod(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<{ id: string; status: string | null } | null> {
  const { data, error } = await supabase
    .from("monthly_audit_periods")
    .select("id, status")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load Monthly Audit period for RR3: ${error.message}`);
  }
  if (!data?.id) return null;
  return { id: String(data.id), status: data.status ? String(data.status) : null };
}

function mapOverride(row: any): RR3RowOverride {
  return {
    id: String(row.id),
    period_id: String(row.period_id),
    reservation_id: String(row.reservation_id),
    guest_profile_id: String(row.guest_profile_id),
    checkin_datetime: String(row.checkin_datetime ?? ""),
    room_number: String(row.room_number ?? ""),
    full_name: String(row.full_name ?? ""),
    nationality: String(row.nationality ?? ""),
    id_or_passport: String(row.id_or_passport ?? ""),
    current_address: String(row.current_address ?? ""),
    occupation: String(row.occupation ?? RR3_DEFAULT_OCCUPATION),
    coming_from: String(row.coming_from ?? ""),
    going_to: String(row.going_to ?? RR3_DEFAULT_DESTINATION),
    checkout_datetime: String(row.checkout_datetime ?? ""),
    remarks: String(row.remarks ?? ""),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function loadRR3RowOverrides(
  supabase: SupabaseClient,
  periodId: string
): Promise<RR3RowOverride[]> {
  const { data, error } = await supabase
    .from("rr3_row_overrides")
    .select("*")
    .eq("period_id", periodId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load RR3 row overrides: ${error.message}`);
  }
  return ((data ?? []) as any[]).map(mapOverride);
}

export function applyRR3RowOverrides(entries: RR3GuestRecord[], overrides: RR3RowOverride[]): RR3GuestRecord[] {
  const overrideByKey = new Map(
    overrides.map((row) => [`${row.reservation_id}:${row.guest_profile_id}`, row as RR3RowOverrideFields])
  );
  return entries.map((entry) => ({
    ...entry,
    rr3_override: overrideByKey.get(`${entry.reservation_id}:${entry.guest_profile_id}`) ?? null,
  }));
}

export function rr3OverridesCanEdit(params: {
  year: number;
  month: number;
  periodId: string | null;
}): { canEdit: boolean; reason: string | null } {
  if (!params.periodId) {
    return { canEdit: false, reason: "ต้อง Snapshot Monthly Audit ก่อน จึงจะแก้แถว รร.3 ได้" };
  }
  if (!isMonthEndedInBangkok(params.year, params.month)) {
    return { canEdit: false, reason: "แก้แถว รร.3 ได้หลังจบเดือนเท่านั้น" };
  }
  return { canEdit: true, reason: null };
}
