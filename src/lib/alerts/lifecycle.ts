import type { createServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseServerClient = ReturnType<typeof createServerSupabaseClient>;

export type AlertReservationLifecycleReason = "cancelled" | "no_show";

type ClearAlertsForInactiveReservationsParams = {
  supabase: SupabaseServerClient;
  reservationIds: string[];
  reason: AlertReservationLifecycleReason;
};

type ClearAlertsForInactiveReservationsResult = {
  cleared_daily_state_count: number;
  deleted_booking_alarm_count: number;
};

const CLEAR_NOTE_BY_REASON: Record<AlertReservationLifecycleReason, string> = {
  cancelled: "Auto-cleared: reservation cancelled",
  no_show: "Auto-cleared: reservation no-show",
};

function normalizeReservationIds(reservationIds: string[]) {
  return Array.from(
    new Set(
      reservationIds
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
    )
  );
}

export async function clearAlertsForInactiveReservations({
  supabase,
  reservationIds,
  reason,
}: ClearAlertsForInactiveReservationsParams): Promise<ClearAlertsForInactiveReservationsResult> {
  const uniqueIds = normalizeReservationIds(reservationIds);
  if (uniqueIds.length === 0) {
    return {
      cleared_daily_state_count: 0,
      deleted_booking_alarm_count: 0,
    };
  }

  const now = new Date().toISOString();
  const clearNote = CLEAR_NOTE_BY_REASON[reason];

  const { data: clearedRows, error: dailyStateError } = await supabase
    .from("alert_daily_state")
    .update({
      status: "cleared_auto",
      cleared_at: now,
      clear_note: clearNote,
    })
    .in("reservation_id", uniqueIds)
    .in("status", ["pending", "snoozed"])
    .select("id");

  if (dailyStateError) {
    throw new Error(dailyStateError.message);
  }

  const { data: deletedRows, error: bookingAlarmError } = await supabase
    .from("booking_alarms")
    .update({
      status: "deleted",
      deleted_at: now,
    })
    .in("reservation_id", uniqueIds)
    .eq("status", "active")
    .select("id");

  if (bookingAlarmError) {
    throw new Error(bookingAlarmError.message);
  }

  return {
    cleared_daily_state_count: clearedRows?.length ?? 0,
    deleted_booking_alarm_count: deletedRows?.length ?? 0,
  };
}
