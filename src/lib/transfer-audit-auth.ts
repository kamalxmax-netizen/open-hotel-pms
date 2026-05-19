import type { UserRole } from "@/lib/types";

export const TRANSFER_AUDIT_READ_ROLES = [
  "admin",
  "supervisor",
  "frontdesk",
  "owner",
] as const satisfies readonly UserRole[];

export const TRANSFER_AUDIT_WRITE_ROLES = [
  "admin",
  "supervisor",
  "frontdesk",
] as const satisfies readonly UserRole[];

export function isTransferAuditReadOnlyRole(role: string | null | undefined): boolean {
  return String(role ?? "").trim().toLowerCase() === "owner";
}
