import assert from "node:assert/strict";
import {
  resolvePermissionPathsForRoute,
  resolveRoleAwarePostLoginPath,
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
