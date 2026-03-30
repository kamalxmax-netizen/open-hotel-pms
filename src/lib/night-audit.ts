import type { BookingSource, NoShowPending } from "@/lib/types";
import { normalizeAuditSource } from "@/lib/audit-utils";

type SupabaseLike = {
  from: (table: string) => any;
};

export type NightAuditSettings = {
  businessDate: string;
  hotelTimezone: string;
  sellableRooms: number;
};

export type NightAuditPaymentTotals = {
  cash: number;
  transfer: number;
  credit_card: number;
  other: number;
  total: number;
};

export type PendingWizardDraftSummary = {
  pendingCount: number;
  healedCount: number;
};

function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

export function shiftDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function toBangkokWindow(dateString: string): { from: string; to: string } {
  return {
    from: `${dateString}T00:00:00+07:00`,
    to: `${dateString}T24:00:00+07:00`,
  };
}

export async function getNightAuditSettings(supabase: SupabaseLike): Promise<NightAuditSettings> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date, hotel_timezone, sellable_rooms")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data?.business_date) {
    throw new Error("Hotel settings not found. Run Supabase migrations first.");
  }

  return {
    businessDate: String(data.business_date),
    hotelTimezone: String(data.hotel_timezone ?? "Asia/Bangkok"),
    sellableRooms: Number(data.sellable_rooms ?? 1) || 1,
  };
}

function normalizePaymentMethod(raw: unknown): keyof Omit<NightAuditPaymentTotals, "total"> {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "cash" || value === "transfer" || value === "credit_card" || value === "other") {
    return value;
  }
  return "other";
}

/**
 * Payment totals used by Night Audit cards/snapshot.
 * Aligns with Payment Daily by excluding void pairs (original + reversal)
 * and record-only rows from cash received totals.
 */
export async function getNightAuditPaymentTotals(
  supabase: SupabaseLike,
  businessDate: string
): Promise<NightAuditPaymentTotals> {
  const { data, error } = await supabase
    .from("folio_payments")
    .select("id, tx_type, method, amount, void_of, is_void_reversal, is_record_only")
    .eq("paid_date", businessDate)
    .in("tx_type", ["payment", "refund", "deposit"]);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    id?: string | null;
    tx_type?: string | null;
    method?: string | null;
    amount?: number | null;
    void_of?: string | null;
    is_void_reversal?: boolean | null;
    is_record_only?: boolean | null;
  }>;

  const voidedPaymentIds = new Set<string>();
  for (const row of rows) {
    const reversalId = String(row.id ?? "").trim();
    const originalId = String(row.void_of ?? "").trim();
    if (!originalId) continue;
    voidedPaymentIds.add(originalId);
    if (reversalId) voidedPaymentIds.add(reversalId);
  }

  const totals: Omit<NightAuditPaymentTotals, "total"> = {
    cash: 0,
    transfer: 0,
    credit_card: 0,
    other: 0,
  };

  for (const row of rows) {
    const rowId = String(row.id ?? "").trim();
    if (voidedPaymentIds.has(rowId)) continue;
    if (String(row.tx_type ?? "").trim().toLowerCase() !== "payment") continue;
    if (row.is_void_reversal === true) continue;
    if (row.is_record_only === true) continue;

    const method = normalizePaymentMethod(row.method);
    const amount = Number(row.amount ?? 0) || 0;
    totals[method] += amount;
  }

  return {
    ...totals,
    total: totals.cash + totals.transfer + totals.credit_card + totals.other,
  };
}

export async function normalizePendingGroupCheckinWizardDrafts(
  supabase: SupabaseLike,
  businessDate: string
): Promise<PendingWizardDraftSummary> {
  const { data: openDrafts, error: openDraftsError } = await supabase
    .from("group_checkin_wizard_drafts")
    .select("id, booking_group_id, business_date, current_step")
    .eq("business_date", businessDate)
    .eq("status", "draft");

  if (openDraftsError) {
    if (isMissingRelationError(openDraftsError)) {
      return { pendingCount: 0, healedCount: 0 };
    }
    throw new Error(openDraftsError.message);
  }

  const drafts = (openDrafts ?? []).filter((row: any) => row?.id && row?.booking_group_id);
  if (drafts.length === 0) {
    return { pendingCount: 0, healedCount: 0 };
  }

  const groupIds = Array.from(new Set(drafts.map((row: any) => String(row.booking_group_id))));
  const { data: pendingReservations, error: pendingReservationsError } = await supabase
    .from("reservations")
    .select("id, booking_group_id")
    .in("booking_group_id", groupIds)
    .eq("status", "active")
    .eq("checkin_date", businessDate)
    .is("checked_in_at", null);

  if (pendingReservationsError) {
    throw new Error(pendingReservationsError.message);
  }

  const pendingGroupIds = new Set(
    (pendingReservations ?? [])
      .map((row: any) => String(row.booking_group_id ?? ""))
      .filter(Boolean)
  );

  const staleDrafts = drafts.filter((row: any) => !pendingGroupIds.has(String(row.booking_group_id)));

  if (staleDrafts.length > 0) {
    const staleIds = staleDrafts.map((row: any) => String(row.id));
    const { error: healError } = await supabase
      .from("group_checkin_wizard_drafts")
      .update({
        status: "completed",
        current_step: 4,
        last_committed_at: new Date().toISOString(),
      })
      .in("id", staleIds)
      .eq("status", "draft");

    if (healError) {
      throw new Error(healError.message);
    }

    const auditRows = staleDrafts
      .map((row: any) => ({
        action: "night_audit_auto_completed_wizard_draft",
        entity_type: "booking_group",
        entity_id: String(row.booking_group_id ?? ""),
        after_json: {
          draft_id: String(row.id ?? ""),
          business_date: row.business_date ?? businessDate,
          current_step: Number(row.current_step ?? 0),
          reason: "all_due_in_rooms_already_checked_in",
        },
        business_date: row.business_date ?? businessDate,
        source: normalizeAuditSource("night_audit"),
      }))
      .filter((row: { entity_id: string }) => row.entity_id);

    if (auditRows.length > 0) {
      await supabase.from("audit_logs").insert(auditRows);
    }
  }

  return {
    pendingCount: drafts.length - staleDrafts.length,
    healedCount: staleDrafts.length,
  };
}

function normalizeRoomNumber(row: any): string | null {
  const roomRef = Array.isArray(row?.rooms) ? row.rooms[0] : row?.rooms;
  return roomRef?.room_number ? String(roomRef.room_number) : null;
}

function normalizeNightRows(value: any): Array<any> {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => !row?.cancelled_at);
}

export async function listPendingNoShows(
  supabase: SupabaseLike,
  businessDate: string
): Promise<NoShowPending[]> {
  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      phone,
      source,
      checkin_date,
      checkout_date,
      total_price,
      no_show_fee,
      checked_in_at,
      reservation_nights(
        id,
        stay_date,
        cancelled_at,
        rooms(room_number)
      )
    `)
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .is("checked_in_at", null)
    .order("checkin_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const activeNights = normalizeNightRows(row.reservation_nights).sort((left: any, right: any) =>
      String(left?.stay_date ?? "").localeCompare(String(right?.stay_date ?? ""))
    );

    return {
      id: String(row.id),
      booking_code: String(row.booking_code ?? ""),
      guest_name: String(row.guest_name ?? ""),
      phone: row.phone ? String(row.phone) : null,
      source: String(row.source ?? "walkin") as BookingSource,
      checkin_date: String(row.checkin_date ?? ""),
      checkout_date: String(row.checkout_date ?? ""),
      total_price: Math.round((Number(row.total_price) || 0) * 100) / 100,
      no_show_fee: row.no_show_fee === null || row.no_show_fee === undefined
        ? null
        : Math.round((Number(row.no_show_fee) || 0) * 100) / 100,
      nights_count: activeNights.length,
      room_number: activeNights.length > 0 ? normalizeRoomNumber(activeNights[0]) : null,
    };
  });
}

export async function getNoShowCandidateById(
  supabase: SupabaseLike,
  reservationId: string,
  businessDate: string
): Promise<NoShowPending | null> {
  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      booking_code,
      guest_name,
      phone,
      source,
      checkin_date,
      checkout_date,
      total_price,
      no_show_fee,
      checked_in_at,
      reservation_nights(
        id,
        stay_date,
        cancelled_at,
        room_id,
        rooms(room_number)
      )
    `)
    .eq("id", reservationId)
    .eq("status", "active")
    .lte("checkin_date", businessDate)
    .is("checked_in_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;

  const activeNights = normalizeNightRows(data.reservation_nights).sort((left: any, right: any) =>
    String(left?.stay_date ?? "").localeCompare(String(right?.stay_date ?? ""))
  );

  return {
    id: String(data.id),
    booking_code: String(data.booking_code ?? ""),
    guest_name: String(data.guest_name ?? ""),
    phone: data.phone ? String(data.phone) : null,
    source: String(data.source ?? "walkin") as BookingSource,
    checkin_date: String(data.checkin_date ?? ""),
    checkout_date: String(data.checkout_date ?? ""),
    total_price: Math.round((Number(data.total_price) || 0) * 100) / 100,
    no_show_fee: data.no_show_fee === null || data.no_show_fee === undefined
      ? null
      : Math.round((Number(data.no_show_fee) || 0) * 100) / 100,
    nights_count: activeNights.length,
    room_number: activeNights.length > 0 ? normalizeRoomNumber(activeNights[0]) : null,
  };
}
