const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const TARGET_ROOMS = [
  { room_number: "118", sort_order: 4 },
  { room_number: "120", sort_order: 5 },
  { room_number: "122", sort_order: 6 },
];

async function resolveRoomTypeId() {
  const { data: preferredRows, error: preferredError } = await supabase
    .from("rooms")
    .select("room_type_id, room_number")
    .in("room_number", ["106", "108"])
    .order("room_number", { ascending: true });

  if (preferredError) throw preferredError;
  if (preferredRows && preferredRows.length > 0 && preferredRows[0].room_type_id) {
    return Number(preferredRows[0].room_type_id);
  }

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("room_types")
    .select("id, code, sort_order")
    .neq("code", "CLOSED")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (fallbackError) throw fallbackError;
  if (!fallbackRows || fallbackRows.length === 0) {
    throw new Error("No usable room_type found for day-use seed.");
  }
  return Number(fallbackRows[0].id);
}

async function upsertRooms(roomTypeId) {
  const rows = TARGET_ROOMS.map((room) => ({
    room_number: room.room_number,
    room_type_id: roomTypeId,
    is_sellable: true,
    is_visible_on_board: true,
    closure_reason: null,
    sort_order: room.sort_order,
    floor_number: 1,
    wing: "R",
    is_dayuse: true,
  }));

  const { error } = await supabase.from("rooms").upsert(rows, { onConflict: "room_number" });
  if (error) throw error;
}

async function upsertLayouts() {
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, sort_order")
    .in(
      "room_number",
      TARGET_ROOMS.map((r) => r.room_number)
    );

  if (roomsError) throw roomsError;

  const byRoomNumber = new Map((rooms ?? []).map((r) => [String(r.room_number), r]));
  const viewTypes = ["month", "week", "day"];

  const layoutRows = [];
  for (const target of TARGET_ROOMS) {
    const room = byRoomNumber.get(target.room_number);
    if (!room) continue;
    for (const viewType of viewTypes) {
      layoutRows.push({
        room_id: room.id,
        view_type: viewType,
        grid_x: null,
        grid_y: null,
        zone: "building",
        sort_order: Number(room.sort_order ?? target.sort_order),
      });
    }
  }

  if (layoutRows.length === 0) return;
  const { error: layoutError } = await supabase
    .from("room_layouts")
    .upsert(layoutRows, { onConflict: "room_id,view_type" });
  if (layoutError) throw layoutError;
}

async function verify() {
  const { data, error } = await supabase
    .from("rooms")
    .select("room_number, floor_number, wing, is_dayuse, is_visible_on_board, is_sellable, sort_order")
    .in(
      "room_number",
      TARGET_ROOMS.map((r) => r.room_number)
    )
    .order("room_number", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function main() {
  const roomTypeId = await resolveRoomTypeId();
  await upsertRooms(roomTypeId);
  await upsertLayouts();
  const rows = await verify();
  console.log(JSON.stringify({ success: true, room_type_id: roomTypeId, rooms: rows }, null, 2));
}

main().catch((err) => {
  console.error("seed-dayuse-rooms failed:", err.message ?? err);
  process.exit(1);
});
