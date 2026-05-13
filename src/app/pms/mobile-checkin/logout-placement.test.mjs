import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layoutSource = readFileSync("src/app/pms/mobile-checkin/layout.tsx", "utf8");
const landingSource = readFileSync("src/app/pms/mobile-checkin/page.tsx", "utf8");

assert.equal(
  layoutSource.includes("MobileCheckinLogout"),
  false,
  "mobile check-in layout must not render logout across check-in steps"
);

assert.equal(
  landingSource.includes("MobileCheckinLogout"),
  true,
  "mobile check-in logout should stay on the landing page only"
);

console.log("mobile-checkin logout placement test passed");
