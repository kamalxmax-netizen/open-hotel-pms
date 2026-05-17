import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function resolveWithSrcAlias(request: string, ...rest: unknown[]) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(process.cwd(), "src", request.slice(2)), ...rest);
  }
  return originalResolveFilename.call(this, request, ...rest);
};

const { checkGroupWizardPrimaryCompleteness } = require("./group-checkin-profile-completeness") as typeof import("./group-checkin-profile-completeness");

const thaiProfileWithoutPhone = {
  first_name: "Somchai",
  last_name: "Chokchai",
  gender: "M",
  nationality_code: "THA",
  id_type: "thai_id",
  id_number: "1234567890123",
  country: "Thailand",
  province: "Bangkok",
  phone: null,
};

assert.deepEqual(
  checkGroupWizardPrimaryCompleteness(thaiProfileWithoutPhone, {
    reservationPhone: "000-000-0000",
    groupContactPhone: null,
  }).missing_fields,
  []
);

assert.deepEqual(
  checkGroupWizardPrimaryCompleteness(thaiProfileWithoutPhone, {
    reservationPhone: null,
    groupContactPhone: "000-000-0000",
  }).missing_fields,
  []
);

assert.deepEqual(
  checkGroupWizardPrimaryCompleteness(thaiProfileWithoutPhone, {
    reservationPhone: null,
    groupContactPhone: null,
  }).missing_fields,
  ["phone"]
);

assert.deepEqual(
  checkGroupWizardPrimaryCompleteness(
    {
      ...thaiProfileWithoutPhone,
      nationality_code: "GBR",
      country: "United Kingdom",
      province: null,
    },
    {
      reservationPhone: null,
      groupContactPhone: null,
    }
  ).missing_fields,
  []
);
