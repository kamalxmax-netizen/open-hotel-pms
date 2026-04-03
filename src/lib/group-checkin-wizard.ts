import { fromSatang, toSatang } from "@/lib/money";
import type { PaymentMethod } from "@/lib/group-checkin-service";

export type WizardDraftStatus = "draft" | "completed" | "cancelled";

export type WizardDraftRow = {
  id: string;
  booking_group_id: string;
  business_date: string;
  status: WizardDraftStatus;
  current_step: number;
  draft_json: Record<string, unknown>;
  last_committed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WizardFailCode =
  | "profile_incomplete"
  | "hk_not_ready"
  | "room_not_assigned"
  | "room_occupied"
  | "already_checked_in"
  | "primary_guest_duplicate"
  | "runtime_error";

export type WizardRoomResult = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  status: "ok" | "failed" | "skipped";
  codes: WizardFailCode[];
  error?: string;
  missing_fields?: string[];
  checked_in_at?: string;
  checkin_time?: string;
  payments_recorded?: number;
  payment_amount?: number;
};

export type MasterPaymentLine = {
  method: PaymentMethod;
  amount: number;
  note?: string | null;
};

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function mergeDraftJson(
  currentDraftJson: Record<string, unknown> | null | undefined,
  patchDraftJson: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base = currentDraftJson && typeof currentDraftJson === "object" ? currentDraftJson : {};
  const patch = patchDraftJson && typeof patchDraftJson === "object" ? patchDraftJson : {};
  return {
    ...base,
    ...patch,
    step1: {
      ...((base as any).step1 ?? {}),
      ...((patch as any).step1 ?? {}),
    },
    step2: {
      ...((base as any).step2 ?? {}),
      ...((patch as any).step2 ?? {}),
    },
    step3: {
      ...((base as any).step3 ?? {}),
      ...((patch as any).step3 ?? {}),
    },
    step4: {
      ...((base as any).step4 ?? {}),
      ...((patch as any).step4 ?? {}),
    },
  };
}

export function pickBusinessDate(override: unknown, fallback: string): string {
  const value = typeof override === "string" ? override.trim() : "";
  if (value && isValidDateString(value)) return value;
  return fallback;
}

export function ensureWizardStep(step: unknown, fallback = 1): number {
  const value = Number(step);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(4, Math.trunc(value)));
}

export function toRoundedMoney(value: unknown): number {
  const satang = toSatang(value);
  return fromSatang(satang);
}

export function allocateMasterLineByRemaining(params: {
  totalAmount: number;
  reservations: Array<{ reservation_id: string; booking_code: string; remaining_balance: number }>;
}): Map<string, number> {
  const result = new Map<string, number>();
  const totalSubmittedSatang = toSatang(params.totalAmount);
  if (totalSubmittedSatang <= 0 || params.reservations.length === 0) {
    return result;
  }

  const sorted = [...params.reservations].sort((a, b) => a.booking_code.localeCompare(b.booking_code));
  const totalRemainingSatang = sorted.reduce((sum, row) => sum + Math.max(0, toSatang(row.remaining_balance)), 0);
  if (totalRemainingSatang <= 0) {
    return result;
  }

  let allocatedSatang = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (i === sorted.length - 1) {
      const remainder = Math.max(0, totalSubmittedSatang - allocatedSatang);
      result.set(row.reservation_id, fromSatang(remainder));
      allocatedSatang += remainder;
      continue;
    }

    const rowRemainingSatang = Math.max(0, toSatang(row.remaining_balance));
    const provisional = Math.floor((totalSubmittedSatang * rowRemainingSatang) / totalRemainingSatang);
    result.set(row.reservation_id, fromSatang(provisional));
    allocatedSatang += provisional;
  }

  if (allocatedSatang !== totalSubmittedSatang && sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    const current = toSatang(result.get(last.reservation_id) ?? 0);
    const fix = totalSubmittedSatang - allocatedSatang;
    result.set(last.reservation_id, fromSatang(current + fix));
  }

  return result;
}

export function mapMassCheckinCodeToWizardCodes(code: string | null | undefined, error: string | null | undefined): WizardFailCode[] {
  const normalizedCode = String(code ?? "").trim();
  const normalizedError = String(error ?? "").toLowerCase();

  if (normalizedCode === "BACK_TO_BACK_DUE_OUT_PENDING_CHECKOUT" || normalizedCode === "ROOM_OCCUPIED_INHOUSE") {
    return ["room_occupied"];
  }
  if (normalizedCode === "hk_not_ready" || normalizedError.includes("hk status") || normalizedError.includes("not ready")) {
    return ["hk_not_ready"];
  }
  if (normalizedError.includes("not assigned")) {
    return ["room_not_assigned"];
  }
  if (normalizedError.includes("already checked in")) {
    return ["already_checked_in"];
  }
  if (normalizedCode === "primary_guest_already_checked_in" || normalizedError.includes("primary guest is already checked in")) {
    return ["primary_guest_duplicate"];
  }
  return ["runtime_error"];
}
