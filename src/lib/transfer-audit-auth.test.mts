import assert from "node:assert/strict";
import {
  isTransferAuditReadOnlyRole,
  TRANSFER_AUDIT_READ_ROLES,
  TRANSFER_AUDIT_WRITE_ROLES,
} from "./transfer-audit-auth.ts";

assert.deepEqual([...TRANSFER_AUDIT_READ_ROLES], ["admin", "supervisor", "frontdesk", "owner"]);
assert.deepEqual([...TRANSFER_AUDIT_WRITE_ROLES], ["admin", "supervisor", "frontdesk"]);

const readRoles: readonly string[] = TRANSFER_AUDIT_READ_ROLES;
const writeRoles: readonly string[] = TRANSFER_AUDIT_WRITE_ROLES;

assert.equal(readRoles.includes("owner"), true);
assert.equal(writeRoles.includes("owner"), false);
assert.equal(isTransferAuditReadOnlyRole("owner"), true);
assert.equal(isTransferAuditReadOnlyRole(" Owner "), true);
assert.equal(isTransferAuditReadOnlyRole("admin"), false);
assert.equal(isTransferAuditReadOnlyRole(null), false);
