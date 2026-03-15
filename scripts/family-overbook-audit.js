const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function byRoomNumber(a, b) {
  return String(a.room_number ?? "").localeCompare(String(b.room_number ?? ""), "en");
}

async function run() {
  const { data: settings, error: settingsError } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) throw new Error(`hotel_settings error: ${settingsError.message}`);
  const businessDate = String(settings?.business_date ?? new Date().toISOString().slice(0, 10));

  const { data: anchorRooms, error: anchorError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .in("room_number", ["106", "108"]);
  if (anchorError) throw new Error(`anchor rooms error: ${anchorError.message}`);
  if (!anchorRooms || anchorRooms.length === 0) {
    throw new Error("Cannot resolve Family room_type_id from rooms 106/108.");
  }
  const familyRoomTypeId = Number(anchorRooms[0].room_type_id);

  const { data: roomType, error: roomTypeError } = await supabase
    .from("room_types")
    .select("id, code, name_en")
    .eq("id", familyRoomTypeId)
    .maybeSingle();
  if (roomTypeError) throw new Error(`room_types error: ${roomTypeError.message}`);

  const { data: familyRooms, error: familyRoomsError } = await supabase
    .from("rooms")
    .select("id, room_number, room_type_id, is_sellable, is_dayuse")
    .eq("room_type_id", familyRoomTypeId)
    .order("room_number", { ascending: true });
  if (familyRoomsError) throw new Error(`family rooms error: ${familyRoomsError.message}`);

  const familyRoomIds = (familyRooms ?? []).map((row) => String(row.id));
  const overnightFamilyRoomIds = (familyRooms ?? [])
    .filter((row) => Boolean(row.is_sellable) && !Boolean(row.is_dayuse))
    .map((row) => String(row.id));

  const { data: oooBlocks, error: oooError } = await supabase
    .from("room_blocks")
    .select("room_id, start_date, end_date, reason")
    .eq("block_type", "OOO")
    .in("room_id", overnightFamilyRoomIds)
    .lte("start_date", businessDate)
    .gt("end_date", businessDate);
  if (oooError) throw new Error(`OOO blocks error: ${oooError.message}`);

  const blockedRoomIdSet = new Set((oooBlocks ?? []).map((row) => String(row.room_id)));
  const hardenedCapacity = overnightFamilyRoomIds.filter((id) => !blockedRoomIdSet.has(id)).length;
  const legacyCapacity = (familyRooms ?? []).filter((row) => Boolean(row.is_sellable)).length;

  const { data: nights, error: nightsError } = await supabase
    .from("reservation_nights")
    .select(`
      reservation_id,
      stay_date,
      room_id,
      room_type_id,
      cancelled_at,
      reservations!inner(id, booking_code, guest_name, status, is_dayuse, checkin_date, checkout_date),
      rooms(id, room_number, room_type_id, is_dayuse)
    `)
    .eq("stay_date", businessDate)
    .is("cancelled_at", null);
  if (nightsError) throw new Error(`reservation_nights error: ${nightsError.message}`);

  const legacyReservationIds = new Set();
  const hardenedReservationIds = new Set();
  const familyRows = [];
  const unknownFloatingRows = [];

  for (const row of nights ?? []) {
    const reservation = row.reservations;
    const resId = String(row.reservation_id);
    const reservationIsDayuse = Boolean(reservation?.is_dayuse);
    const reservationStatus = String(reservation?.status ?? "");
    const rowRoomTypeId = row.room_type_id != null ? Number(row.room_type_id) : null;
    const rowRoomId = row.room_id ? String(row.room_id) : null;
    const rowRoom = row.rooms ?? null;
    const rowRoomNumber = rowRoom?.room_number ? String(rowRoom.room_number) : null;
    const rowRoomIsDayuse = Boolean(rowRoom?.is_dayuse);

    const belongsLegacy = rowRoomTypeId === familyRoomTypeId;
    const belongsHardened =
      rowRoomTypeId === familyRoomTypeId ||
      (rowRoomId && overnightFamilyRoomIds.includes(rowRoomId));

    if (belongsLegacy) {
      legacyReservationIds.add(resId);
    }

    if (belongsHardened && reservationStatus === "active" && !reservationIsDayuse) {
      hardenedReservationIds.add(resId);
      familyRows.push({
        booking_code: String(reservation?.booking_code ?? ""),
        guest_name: String(reservation?.guest_name ?? ""),
        status: reservationStatus,
        is_dayuse: reservationIsDayuse,
        room_id: rowRoomId,
        room_number: rowRoomNumber,
        room_type_id: rowRoomTypeId,
        room_is_dayuse: rowRoomIsDayuse,
      });
    }

    if (!rowRoomId && rowRoomTypeId == null && reservationStatus === "active" && !reservationIsDayuse) {
      unknownFloatingRows.push({
        reservation_id: resId,
        booking_code: String(reservation?.booking_code ?? ""),
        guest_name: String(reservation?.guest_name ?? ""),
        checkin_date: String(reservation?.checkin_date ?? ""),
        checkout_date: String(reservation?.checkout_date ?? ""),
      });
    }
  }

  const targetCodeSuffix = "48E6253F";
  const { data: suspectReservations, error: suspectError } = await supabase
    .from("reservations")
    .select("id, booking_code, guest_name, status, is_dayuse, checkin_date, checkout_date, created_at")
    .ilike("booking_code", `%${targetCodeSuffix}`);
  if (suspectError) throw new Error(`suspect booking lookup error: ${suspectError.message}`);

  let suspectNights = [];
  if ((suspectReservations ?? []).length > 0) {
    const ids = suspectReservations.map((row) => row.id);
    const { data, error } = await supabase
      .from("reservation_nights")
      .select("reservation_id, stay_date, room_id, room_type_id, cancelled_at, rooms(room_number, room_type_id, is_dayuse)")
      .in("reservation_id", ids)
      .order("stay_date", { ascending: true });
    if (error) throw new Error(`suspect nights lookup error: ${error.message}`);
    suspectNights = data ?? [];
  }

  const report = {
    business_date: businessDate,
    family_room_type: {
      id: familyRoomTypeId,
      code: String(roomType?.code ?? ""),
      name_en: String(roomType?.name_en ?? ""),
    },
    family_rooms: (familyRooms ?? []).sort(byRoomNumber),
    ooo_blocks_today: oooBlocks ?? [],
    capacity: {
      legacy_sellable_all_rooms: legacyCapacity,
      hardened_sellable_non_dayuse_minus_ooo: hardenedCapacity,
    },
    occupancy_today: {
      legacy_count_by_room_type_id: legacyReservationIds.size,
      hardened_count_non_dayuse_active: hardenedReservationIds.size,
      hardened_rows: familyRows,
      unknown_active_floating_rows_any_type: unknownFloatingRows,
    },
    suspect_booking_suffix: targetCodeSuffix,
    suspect_reservations: suspectReservations ?? [],
    suspect_reservation_nights: suspectNights,
  };

  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error("family-overbook-audit failed");
  console.error(error);
  process.exit(1);
});
