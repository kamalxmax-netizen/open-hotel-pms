import assert from "node:assert/strict";
import { pickCheckinRoomNight } from "./checkin-room-selection";

const plannedMoveNights = [
  { stay_date: "2026-05-14", room_id: "room-236" },
  { stay_date: "2026-05-11", room_id: "room-302" },
  { stay_date: "2026-05-12", room_id: "room-236" },
];

assert.equal(
  pickCheckinRoomNight(plannedMoveNights, "2026-05-11")?.room_id,
  "room-302"
);

assert.equal(
  pickCheckinRoomNight(plannedMoveNights, "2026-05-10")?.room_id,
  "room-302"
);

assert.equal(
  pickCheckinRoomNight(plannedMoveNights, "2026-05-15")?.room_id,
  "room-236"
);

assert.equal(
  pickCheckinRoomNight([{ stay_date: "not-a-date", room_id: "room-1" }], "2026-05-11"),
  null
);
