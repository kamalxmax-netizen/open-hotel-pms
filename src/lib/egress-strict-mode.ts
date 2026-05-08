export const EGRESS_STRICT_MODE =
  process.env.NEXT_PUBLIC_EGRESS_STRICT_MODE !== "false";

export const STRICT_POLLING = {
  scbNotificationMs: 120_000,
  vehicleSummaryMs: 180_000,
  vehicleRegistryMs: 180_000,
  boardDayUseMs: 180_000,
} as const;

export function strictPollInterval(defaultMs: number, strictMs: number): number {
  return EGRESS_STRICT_MODE ? strictMs : defaultMs;
}

export function canPollVisibleTab(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}
