import assert from "node:assert/strict";
import {
  resolvePostLoginPath,
  resolvePermissionPathsForRoute,
  resolveRoleAwarePostLoginPath,
  sanitizePostLoginPath,
} from "./auth-routing.ts";

const frontdeskPages = [
  "/pms/board",
  "/pms/calendar",
  "/pms/arrivals",
  "/pms/inhouse",
  "/pms/departures",
  "/pms/reservations",
  "/pms/groups",
];

assert.deepEqual(resolvePermissionPathsForRoute("/pms/folio/preview/reservation-1"), [
  "/pms/reservations",
  "/pms/board",
  "/pms/arrivals",
  "/pms/inhouse",
  "/pms/departures",
  "/pms/groups",
]);

assert.equal(
  resolveRoleAwarePostLoginPath(
    "/pms/folio/preview/reservation-1",
    "frontdesk",
    frontdeskPages
  ),
  "/pms/folio/preview/reservation-1"
);

assert.equal(
  resolveRoleAwarePostLoginPath(
    "/pms/folio/preview/reservation-1",
    "frontdesk",
    ["/pms/payment-daily"]
  ),
  "/pms/payment-daily"
);

assert.equal(resolvePostLoginPath("frontdesk", frontdeskPages), "/pms/board");
assert.equal(sanitizePostLoginPath(null), "/pms/board");
assert.equal(sanitizePostLoginPath("/pms"), "/pms/board");
