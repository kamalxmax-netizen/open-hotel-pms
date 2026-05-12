import assert from "node:assert/strict";
import {
  getLoanCollectionDueState,
  mergeLoanCollectionReservationContexts,
  shouldShowLoanCollectionForReservation,
} from "./hk-loan-collections.ts";

const activeDueIn = { reservation_id: "new-arrival", status: "active" };
const checkedOut = { reservation_id: "checked-out-guest", status: "checked_out" };

assert.deepEqual(
  mergeLoanCollectionReservationContexts(activeDueIn, checkedOut),
  [activeDueIn, checkedOut],
  "checked-out loan collection context must survive when a same-room due-in booking exists"
);

assert.equal(
  shouldShowLoanCollectionForReservation({
    reservationStatus: "checked_out",
    isCollectionVisibleStatus: true,
    dueDate: null,
    date: "2026-05-12",
  }),
  true,
  "checked-out loan collections should remain visible even when the room has a due-in guest name"
);

assert.equal(
  getLoanCollectionDueState({
    reservationStatus: "checked_out",
    dueDate: null,
    date: "2026-05-12",
  }),
  true,
  "checked-out loan collections are due immediately"
);

assert.equal(
  shouldShowLoanCollectionForReservation({
    reservationStatus: "active",
    isCollectionVisibleStatus: true,
    dueDate: null,
    date: "2026-05-12",
  }),
  false,
  "active stayover loan collections with checkout-default due dates should not show before checkout"
);

assert.equal(
  shouldShowLoanCollectionForReservation({
    reservationStatus: "active",
    isCollectionVisibleStatus: true,
    dueDate: "2026-05-12",
    date: "2026-05-12",
  }),
  true,
  "active stayover loan collections should show when an explicit due date has arrived"
);
