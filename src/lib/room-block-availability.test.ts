import assert from "node:assert/strict";
import {
  getRoomIdsBlockedForStay,
  getRoomIdsBlockedOnNight,
  ROOM_UNSELLABLE_BLOCK_TYPES,
} from "./room-block-availability";

const blocks = [
  {
    room_id: "room-210",
    block_type: "OOO",
    start_date: "2026-05-18",
    end_date: "2026-05-19",
  },
  {
    room_id: "room-211",
    block_type: "OOS",
    start_date: "2026-05-19",
    end_date: "2026-05-21",
  },
  {
    room_id: "room-212",
    block_type: "INFO",
    start_date: "2026-05-18",
    end_date: "2026-05-21",
  },
];

assert.deepEqual(ROOM_UNSELLABLE_BLOCK_TYPES, ["OOO", "OOS"]);

assert.deepEqual(
  Array.from(getRoomIdsBlockedOnNight(blocks, "2026-05-18")).sort(),
  ["room-210"]
);

assert.deepEqual(
  Array.from(getRoomIdsBlockedOnNight(blocks, "2026-05-19")).sort(),
  ["room-211"]
);

assert.deepEqual(
  Array.from(getRoomIdsBlockedForStay(blocks, ["2026-05-18", "2026-05-19"])).sort(),
  ["room-210", "room-211"]
);
