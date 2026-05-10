import assert from "node:assert/strict";
import {
  formatLockedLedgerAmount,
  type FolioPrintDraftData,
  updateFolioPrintLedgerDescription,
  updateFolioPrintReservationField,
} from "./printDraft";

const source: FolioPrintDraftData = {
  reservation: {
    booking_code: "B-100",
    status: "active",
    checkin_date: "2026-05-10",
    checkout_date: "2026-05-11",
    nights: 1,
    room_number: "201",
    guest_name: "Original Guest",
    guest_phone: "0811111111",
    guest_email: "old@example.com",
    guest_address: "Old address",
  },
  ledger_rows: [
    { date: "2026-05-10", description: "Room charge", amount: 1200, kind: "charge" },
    { date: "2026-05-10", description: "Deposit", amount: 500, kind: "payment" },
  ],
  total_charges: 1200,
  total_payments: 500,
  balance_due: 700,
  total_amount: 1200,
};

const editedGuest = updateFolioPrintReservationField(source, "guest_name", "Edited Guest");
assert.equal(editedGuest.reservation.guest_name, "Edited Guest");
assert.equal(source.reservation.guest_name, "Original Guest");
assert.notStrictEqual(editedGuest, source);
assert.notStrictEqual(editedGuest.reservation, source.reservation);
assert.strictEqual(editedGuest.ledger_rows, source.ledger_rows);

const editedDescription = updateFolioPrintLedgerDescription(source, 1, "Deposit via transfer");
assert.equal(editedDescription.ledger_rows[1]?.description, "Deposit via transfer");
assert.equal(editedDescription.ledger_rows[1]?.amount, 500);
assert.equal(source.ledger_rows[1]?.description, "Deposit");
assert.equal(editedDescription.total_charges, source.total_charges);
assert.equal(editedDescription.total_payments, source.total_payments);
assert.equal(editedDescription.balance_due, source.balance_due);

assert.equal(formatLockedLedgerAmount(source.ledger_rows[0]), "1,200.00");
assert.equal(formatLockedLedgerAmount(source.ledger_rows[1]), "(500.00)");
