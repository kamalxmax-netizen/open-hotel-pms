import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "reservation-detail-page.tsx"),
  "utf8"
);

const optionsPanelBlock = source.match(
  /\{showOptions && reservationId && \([\s\S]*?<ReservationOptionsPanel([\s\S]*?)\/>\s*\)\}/
);

assert.ok(optionsPanelBlock, "Reservation detail options panel render block should exist");
assert.match(
  optionsPanelBlock[1],
  /\blayer="modal"/,
  "Reservation detail should open options above the booking modal layer"
);
