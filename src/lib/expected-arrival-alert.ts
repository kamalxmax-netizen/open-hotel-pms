import type { AlertSeverity } from "@/lib/reservation-alerts";

const AUTO_ALERT_CREATED_BY = "system:auto_expected_arrival";
const AUTO_ALERT_CODE = "EXP_ARRIVAL";

const AUTO_ALERT_SURFACES = [
  "arrivals",
  "room_diary",
  "calendar",
  "reservation",
  "room_drawer",
] as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

export function normalizeExpectedArrivalTime(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hhmm = raw.slice(0, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    throw new Error("expected_arrival_time must be HH:mm.");
  }
  return hhmm;
}

function buildAlertPayload(expectedArrivalTime: string): {
  severity: AlertSeverity;
  note: string;
  customMessage: string;
} {
  const minutes = toMinutes(expectedArrivalTime);
  const isBefore0900 = Number.isFinite(minutes) && minutes < 9 * 60;
  const isBefore1400 = Number.isFinite(minutes) && minutes < 14 * 60;

  if (isBefore0900) {
    return {
      severity: "warning",
      note: `Expected arrival ${expectedArrivalTime}`,
      customMessage: `Expected arrival ${expectedArrivalTime} - Early check-in request (before 09:00).`,
    };
  }

  if (isBefore1400) {
    return {
      severity: "info",
      note: `Expected arrival ${expectedArrivalTime}`,
      customMessage: `Expected arrival ${expectedArrivalTime} - Early arrival notice (before 14:00).`,
    };
  }

  return {
    severity: "info",
    note: `Expected arrival ${expectedArrivalTime}`,
    customMessage: `Expected arrival ${expectedArrivalTime}.`,
  };
}

export async function syncExpectedArrivalAlert(params: {
  supabase: any;
  reservationId: string;
  expectedArrivalTime: string | null;
}) {
  const { supabase, reservationId, expectedArrivalTime } = params;
  const shouldAlert = Boolean(expectedArrivalTime);

  if (!shouldAlert) {
    const { error } = await supabase
      .from("reservation_alerts")
      .delete()
      .eq("reservation_id", reservationId)
      .eq("alert_code", AUTO_ALERT_CODE);
    if (error) throw new Error(error.message);
    return;
  }

  const { error: alertCodeError } = await supabase
    .from("alert_codes")
    .upsert(
      {
        code: AUTO_ALERT_CODE,
        description: "Expected arrival note",
        dept: "FD",
        auto_on_co: false,
        icon: "🕒",
      },
      { onConflict: "code" }
    );
  if (alertCodeError) throw new Error(alertCodeError.message);

  const payload = buildAlertPayload(expectedArrivalTime as string);
  const { data: existingRows, error: existingError } = await supabase
    .from("reservation_alerts")
    .select("id")
    .eq("reservation_id", reservationId)
    .eq("alert_code", AUTO_ALERT_CODE);
  if (existingError) throw new Error(existingError.message);

  if (!existingRows || existingRows.length === 0) {
    const { error: insertError } = await supabase.from("reservation_alerts").insert({
      reservation_id: reservationId,
      alert_code: AUTO_ALERT_CODE,
      note: payload.note,
      custom_message: payload.customMessage,
      display_surfaces: [...AUTO_ALERT_SURFACES],
      severity: payload.severity,
      is_dismissed: false,
      created_by: AUTO_ALERT_CREATED_BY,
    });
    if (insertError) throw new Error(insertError.message);
    return;
  }

  const existingIds = existingRows
    .map((row: any) => (row?.id ? String(row.id) : ""))
    .filter(Boolean);
  if (existingIds.length === 0) return;

  const { error: updateError } = await supabase
    .from("reservation_alerts")
    .update({
      note: payload.note,
      custom_message: payload.customMessage,
      display_surfaces: [...AUTO_ALERT_SURFACES],
      severity: payload.severity,
      is_dismissed: false,
      created_by: AUTO_ALERT_CREATED_BY,
    })
    .in("id", existingIds);
  if (updateError) throw new Error(updateError.message);
}
