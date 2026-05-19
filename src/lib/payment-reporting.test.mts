import assert from "node:assert/strict";
import { isPaymentReportLinkedDepositTransferEntry } from "./payment-reporting.ts";

assert.equal(
  isPaymentReportLinkedDepositTransferEntry(
    {
      tx_type: "deposit",
      revenue_category: "deposit",
      method: "credit_card",
      amount: 200,
      note: "Mobile check-in deposit",
      cashier_name: "SYSTEM",
    } as any,
    {
      source: "ota",
      parent_reservation_id: "parent-reservation",
      deposit_note:
        '{"note":"Top-up from OTA BK-20260518060844396-1EA1E9","lines":[{"method":"credit_card","amount":200}]}',
    }
  ),
  true,
  "incoming OTA linked-stay deposit transfer should be excluded from Payment Daily cashflow"
);

assert.equal(
  isPaymentReportLinkedDepositTransferEntry(
    {
      tx_type: "deposit",
      revenue_category: "deposit",
      method: "cash",
      amount: 200,
      note: "Mobile check-in deposit",
      cashier_name: "SYSTEM",
    } as any,
    {
      source: "walkin",
      parent_reservation_id: "parent-reservation",
      deposit_note:
        '{"note":"Top-up from OTA BK-20260518065634316-F1B27D","lines":[{"method":"cash","amount":200}]}',
    }
  ),
  true,
  "incoming walk-in extension deposit transfer from OTA should also be excluded"
);

assert.equal(
  isPaymentReportLinkedDepositTransferEntry(
    {
      tx_type: "refund",
      revenue_category: "deposit",
      method: "credit_card",
      amount: 200,
      note: "Deposit refund",
      cashier_name: "SYSTEM",
    } as any,
    {
      source: "ota",
      parent_reservation_id: null,
      deposit_note:
        '{"note":"Transferred to linked walk-in BK-20260519143021804-45C9D2","lines":[]}',
    }
  ),
  true,
  "outgoing OTA linked-stay deposit transfer should be excluded from Payment Daily cashflow"
);

assert.equal(
  isPaymentReportLinkedDepositTransferEntry(
    {
      tx_type: "deposit",
      revenue_category: "deposit",
      method: "credit_card",
      amount: 200,
      note: "Mobile check-in deposit",
      cashier_name: "FO Mobile",
    } as any,
    {
      source: "ota",
      parent_reservation_id: null,
      deposit_note: '{"lines":[{"method":"credit_card","amount":200}]}',
    }
  ),
  false,
  "original OTA deposit collection should remain counted once on the collection date"
);
