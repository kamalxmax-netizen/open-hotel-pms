export const DEFAULT_TRANSPORT_ALERT_LEAD_MINUTES = 60;
export const TRANSPORT_ALERT_RED_MINUTES = 15;
export const MAX_TRANSPORT_ALERT_LEAD_MINUTES = 240;

export function normalizeTransportAlertLeadMinutes(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_TRANSPORT_ALERT_LEAD_MINUTES;
    return Math.max(
        TRANSPORT_ALERT_RED_MINUTES,
        Math.min(MAX_TRANSPORT_ALERT_LEAD_MINUTES, Math.round(parsed))
    );
}

export function getTransportAlertLevel(
    secondsToPickup: number | null | undefined,
    leadMinutes: unknown
): "yellow" | "red" | null {
    if (typeof secondsToPickup !== "number" || !Number.isFinite(secondsToPickup)) return null;
    if (secondsToPickup < 0) return "red";
    if (secondsToPickup <= TRANSPORT_ALERT_RED_MINUTES * 60) return "red";
    if (secondsToPickup <= normalizeTransportAlertLeadMinutes(leadMinutes) * 60) return "yellow";
    return null;
}
