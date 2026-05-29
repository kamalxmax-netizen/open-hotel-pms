import assert from "node:assert/strict";
import {
  canUseGeneralLineCommand,
  classifyLineStaffAccess,
} from "./line-staff-access.ts";

assert.deepEqual(classifyLineStaffAccess(null), {
  isBound: false,
  isFrontdeskOnly: false,
  departmentCode: null,
  role: null,
});

assert.equal(canUseGeneralLineCommand(classifyLineStaffAccess(null)), false);

const adminInFo = classifyLineStaffAccess({
  id: "admin-user",
  department: { code: "FO" },
  profiles: { role: "admin" },
});
assert.equal(adminInFo.isBound, true);
assert.equal(adminInFo.departmentCode, "FO");
assert.equal(adminInFo.role, "admin");
assert.equal(adminInFo.isFrontdeskOnly, false);
assert.equal(canUseGeneralLineCommand(adminInFo), true);

const frontdeskInFo = classifyLineStaffAccess({
  id: "fo-user",
  department: [{ code: "FO" }],
  profiles: [{ role: "frontdesk" }],
});
assert.equal(frontdeskInFo.isBound, true);
assert.equal(frontdeskInFo.isFrontdeskOnly, true);
assert.equal(canUseGeneralLineCommand(frontdeskInFo), false);

const legacyFoWithoutRole = classifyLineStaffAccess({
  id: "legacy-fo",
  department: { code: "FO" },
  profiles: null,
});
assert.equal(legacyFoWithoutRole.isFrontdeskOnly, true);
