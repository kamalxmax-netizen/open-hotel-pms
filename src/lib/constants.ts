import type { HousekeepingStatus } from "@/lib/types";

export const APP_NAME = "Hotel PMS";

export const HOUSEKEEPING_FLOW: HousekeepingStatus[] = [
  "dirty",
  "in_progress",
  "paused",
  "cleaned",
  "approved"
];

export const BOARD_VIEWS = ["month", "week", "day"] as const;

export const DEFAULT_LANGUAGE = "en";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "transfer", label: "Transfer" },
  { value: "credit_card", label: "Card" },
] as const;

// ── Housekeeping Phase 6 ──

export const MAID_NAMES = ["Jan", "Tan", "Others"] as const;
export type MaidName = (typeof MAID_NAMES)[number];

export const MAX_PRIORITY_SLOTS = 15;

export const WORK_START_HOUR = 8; // 08:00
export const WORK_END_HOUR = 23; // 23:00

export const DEFAULT_CLEANING_DURATION_MIN = 60;

// ── Phase 14: Day Use ──
export const DAYUSE_DURATION_DEFAULT_MIN = 120;
export const DAYUSE_WARNING_YELLOW_MIN = 30;
export const DAYUSE_WARNING_RED_MIN = 10;
