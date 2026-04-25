// Phase 75 — L0 type contracts
// Consumed by: src/lib/server-auth.ts (requireStaffAuth), all API route handlers in Batch 1-2.
// Owner: Lead. Do not modify without Lead review.

import type { NextResponse } from "next/server";
import type { UserRole } from "@/lib/types";
import type { AuthUser } from "@/lib/server-auth";

/**
 * Options for requireStaffAuth.
 *
 * Default behavior (no options): reject anonymous AND reject owner role.
 * Most API routes in Phase 75 Batch 2 use defaults — they are staff-operational
 * endpoints (booking folio, guest PII, etc.) where owner-role has no business.
 */
export interface RequireStaffAuthOptions {
  /**
   * If set, only these roles pass. Overrides denyRoles.
   * Example: `['admin', 'supervisor']` for management-only endpoints.
   */
  allowRoles?: UserRole[];

  /**
   * If set (and allowRoles is not), reject these roles.
   * Default: `['owner']` — owner is a billing-level role with no operational access.
   */
  denyRoles?: UserRole[];
}

/**
 * Result tuple from requireStaffAuth.
 *
 * Discriminated union on `error`:
 * - Success: `{ user, role, error: null }` — proceed with handler logic.
 * - Failure: `{ user: null, role: null, error: NextResponse }` — return error directly.
 *
 * Usage in a handler:
 * ```ts
 * const auth = await requireStaffAuth(supabase, request);
 * if (auth.error) return auth.error;
 * // auth.user and auth.role now safe to use
 * ```
 */
export type StaffAuthResult =
  | { user: AuthUser; role: UserRole; error: null }
  | { user: null; role: null; error: NextResponse };

/**
 * Canonical set of roles recognized by Phase 75 auth gates.
 *
 * Mirror of `UserRole` from `@/lib/types` — re-exported here to keep the Phase 75
 * L0 contract self-contained. If `UserRole` gains a new member, add it here too
 * and revisit `requireStaffAuth` defaults.
 */
export const KNOWN_USER_ROLES: readonly UserRole[] = [
  "admin",
  "frontdesk",
  "maid",
  "supervisor",
  "mobile",
  "owner",
] as const;

/**
 * Default deny list for `requireStaffAuth`. Owner is a billing/admin-scope role;
 * operational endpoints (booking data, guest PII, housekeeping state) should
 * reject it explicitly. Override via `denyRoles: []` if a route legitimately
 * needs owner access.
 */
export const DEFAULT_DENY_ROLES: readonly UserRole[] = ["owner"] as const;
