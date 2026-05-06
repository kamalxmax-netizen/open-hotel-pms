import { isValidDateString, listNights } from "@/lib/dates";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";
import { MobileCheckinError, requireMobileCheckinAuth } from "@/lib/mobile-checkin";
import { formatPriceQuoteText, MOBILE_TEXT_ROOM_DISPLAY, resolveRoomDisplayConfig } from "@/lib/mobile-text";
import { expandPlannedMoveNights, listOverlappingPlannedRoomHolds } from "@/lib/planned-room-moves";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function round2(value: number) {
  return Number(value.toFixed(2));
}

function toPositiveInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

type QuoteRoomRequest = {
  room_type_key: string;
  quantity: number;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const body = await request.json().catch(() => null);
    const customerName = String(body?.customer_name ?? "").trim();
    const checkin = String(body?.checkin ?? "").trim();
    const checkout = String(body?.checkout ?? "").trim();

    if (!customerName) {
      throw new MobileCheckinError("customer_name is required.", 400, "MISSING_CUSTOMER_NAME");
    }
    if (!checkin || !checkout || !isValidDateString(checkin) || !isValidDateString(checkout)) {
      throw new MobileCheckinError("checkin and checkout are required in YYYY-MM-DD format.", 400, "INVALID_RANGE");
    }
    if (checkout <= checkin) {
      throw new MobileCheckinError("checkout must be after checkin.", 400, "INVALID_CHECKOUT");
    }

    const roomsInput = Array.isArray(body?.rooms) ? body.rooms : [];
    const selectedRooms: QuoteRoomRequest[] = roomsInput
      .map((row: any) => ({
        room_type_key: String(row?.room_type_key ?? "").trim(),
        quantity: toPositiveInt(row?.quantity),
      }))
      .filter((row: QuoteRoomRequest) => row.room_type_key && row.quantity > 0);

    if (selectedRooms.length === 0) {
      throw new MobileCheckinError("At least one room type and quantity is required.", 400, "MISSING_ROOMS");
    }

    const allowedKeys = new Set(MOBILE_TEXT_ROOM_DISPLAY.map((room) => room.key));
    for (const row of selectedRooms) {
      if (!allowedKeys.has(row.room_type_key)) {
        throw new MobileCheckinError(`Unknown room type: ${row.room_type_key}`, 400, "UNKNOWN_ROOM_TYPE");
      }
    }

    const mergedRequestByKey = new Map<string, number>();
    for (const row of selectedRooms) {
      mergedRequestByKey.set(row.room_type_key, (mergedRequestByKey.get(row.room_type_key) ?? 0) + row.quantity);
    }

    const nights = listNights(checkin, checkout);

    const { data: roomsRaw, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_type_id, room_number")
      .eq("is_sellable", true)
      .eq("is_dayuse", false);

    if (roomsError) {
      throw new MobileCheckinError(roomsError.message, 500, "ROOM_QUERY_FAILED");
    }

    const [{ data: roomTypeRows, error: roomTypeError }, { data: oooBlocks, error: oooError }, { data: bookedNights, error: bookedError }] = await Promise.all([
      supabase.from("room_types").select("id, name_en, code"),
      supabase
        .from("room_blocks")
        .select("room_id, start_date, end_date")
        .eq("block_type", "OOO")
        .lt("start_date", checkout)
        .gt("end_date", checkin),
      supabase
        .from("reservation_nights")
        .select(`
          reservation_id,
          room_id,
          room_type_id,
          stay_date,
          reservations!inner(status, is_dayuse)
        `)
        .in("stay_date", nights)
        .is("cancelled_at", null)
        .eq("reservations.status", "active")
        .eq("reservations.is_dayuse", false),
    ]);

    if (roomTypeError) {
      throw new MobileCheckinError(roomTypeError.message, 500, "ROOM_TYPE_QUERY_FAILED");
    }
    if (oooError) {
      throw new MobileCheckinError(oooError.message, 500, "OOO_QUERY_FAILED");
    }
    if (bookedError) {
      throw new MobileCheckinError(bookedError.message, 500, "BOOKED_QUERY_FAILED");
    }

    const displayKeyByTypeId = new Map<number, string>();
    for (const row of roomTypeRows ?? []) {
      const typeId = Number((row as any).id ?? 0);
      const display = resolveRoomDisplayConfig(String((row as any).name_en ?? ""), null);
      if (typeId && display) displayKeyByTypeId.set(typeId, display.key);
    }

    const roomMetaById = new Map<string, { room_type_id: number; display_key: string }>();
    const roomIdsByDisplayKey: Record<string, string[]> = {};
    for (const room of roomsRaw ?? []) {
      const roomNumber = String((room as any).room_number ?? "");
      if (isLegacyDayUseRoom(roomNumber)) continue;
      const roomId = String((room as any).id ?? "");
      const typeId = Number((room as any).room_type_id ?? 0);
      const displayKey = displayKeyByTypeId.get(typeId);
      if (!roomId || !typeId || !displayKey) continue;
      if (!roomIdsByDisplayKey[displayKey]) roomIdsByDisplayKey[displayKey] = [];
      roomIdsByDisplayKey[displayKey].push(roomId);
      roomMetaById.set(roomId, { room_type_id: typeId, display_key: displayKey });
    }

    const blockedRoomIdsByNight = new Map<string, Set<string>>();
    for (const night of nights) blockedRoomIdsByNight.set(night, new Set<string>());
    for (const block of oooBlocks ?? []) {
      const roomId = String((block as any).room_id ?? "");
      const startDate = String((block as any).start_date ?? "");
      const endDate = String((block as any).end_date ?? "");
      if (!roomId || !startDate || !endDate) continue;
      for (const night of nights) {
        if (startDate <= night && endDate > night) blockedRoomIdsByNight.get(night)?.add(roomId);
      }
    }

    const capacityByKeyPerNight: Record<string, Record<string, number>> = {};
    for (const [displayKey, roomIds] of Object.entries(roomIdsByDisplayKey)) {
      capacityByKeyPerNight[displayKey] = {};
      for (const night of nights) {
        const blocked = blockedRoomIdsByNight.get(night) ?? new Set<string>();
        capacityByKeyPerNight[displayKey][night] = roomIds.reduce((count, roomId) => count + (blocked.has(roomId) ? 0 : 1), 0);
      }
    }

    const bookedPerKeyPerNight: Record<string, Record<string, Set<string>>> = {};
    for (const row of bookedNights ?? []) {
      const stayDate = String((row as any).stay_date ?? "");
      const reservationId = String((row as any).reservation_id ?? "");
      if (!stayDate || !reservationId) continue;

      const keys = new Set<string>();
      const roomId = String((row as any).room_id ?? "");
      const roomMeta = roomMetaById.get(roomId);
      if (roomMeta?.display_key) keys.add(roomMeta.display_key);

      const directTypeId = Number((row as any).room_type_id ?? 0);
      const directKey = displayKeyByTypeId.get(directTypeId);
      if (directKey) keys.add(directKey);

      for (const key of keys) {
        if (!roomIdsByDisplayKey[key]) continue;
        if (!bookedPerKeyPerNight[key]) bookedPerKeyPerNight[key] = {};
        if (!bookedPerKeyPerNight[key][stayDate]) bookedPerKeyPerNight[key][stayDate] = new Set<string>();
        bookedPerKeyPerNight[key][stayDate].add(reservationId);
      }
    }

    const plannedRows = await listOverlappingPlannedRoomHolds(supabase as any, {
      checkinDate: checkin,
      checkoutDate: checkout,
      roomIds: Array.from(roomMetaById.keys()),
    });

    const plannedHoldPerKeyPerNight: Record<string, Record<string, number>> = {};
    for (const row of plannedRows) {
      const roomMeta = roomMetaById.get(String(row.to_room_id));
      const displayKey = roomMeta?.display_key ?? displayKeyByTypeId.get(Number(row.to_room_type_id ?? 0));
      if (!displayKey || !roomIdsByDisplayKey[displayKey]) continue;
      if (!plannedHoldPerKeyPerNight[displayKey]) plannedHoldPerKeyPerNight[displayKey] = {};
      for (const stayDate of expandPlannedMoveNights(row)) {
        if (stayDate < checkin || stayDate >= checkout) continue;
        plannedHoldPerKeyPerNight[displayKey][stayDate] = (plannedHoldPerKeyPerNight[displayKey][stayDate] ?? 0) + 1;
      }
    }

    const rateByKeyPerNight: Record<string, Record<string, number>> = {};
    const overnightRoomIds = Array.from(roomMetaById.keys());
    if (overnightRoomIds.length > 0) {
      const { data: rateRows, error: rateError } = await supabase
        .from("rate_templates")
        .select("room_id, stay_date, price")
        .in("room_id", overnightRoomIds)
        .in("stay_date", nights);

      if (rateError) {
        throw new MobileCheckinError(rateError.message, 500, "RATE_QUERY_FAILED");
      }

      const valuesByKeyNight = new Map<string, Map<string, number[]>>();
      for (const row of rateRows ?? []) {
        const roomId = String((row as any).room_id ?? "");
        const stayDate = String((row as any).stay_date ?? "");
        const displayKey = roomMetaById.get(roomId)?.display_key;
        if (!displayKey || !stayDate) continue;
        let byNight = valuesByKeyNight.get(displayKey);
        if (!byNight) {
          byNight = new Map<string, number[]>();
          valuesByKeyNight.set(displayKey, byNight);
        }
        const list = byNight.get(stayDate) ?? [];
        list.push(Number((row as any).price ?? 0));
        byNight.set(stayDate, list);
      }

      for (const display of MOBILE_TEXT_ROOM_DISPLAY) {
        rateByKeyPerNight[display.key] = {};
        const byNight = valuesByKeyNight.get(display.key) ?? new Map<string, number[]>();
        for (const night of nights) {
          const values = byNight.get(night) ?? [];
          rateByKeyPerNight[display.key][night] =
            values.length === 0 ? 0 : round2(values.reduce((sum, value) => sum + value, 0) / values.length);
        }
      }
    }

    const availabilityByKey = new Map<string, { min_available: number; by_night: Record<string, number> }>();
    for (const display of MOBILE_TEXT_ROOM_DISPLAY) {
      const byNight: Record<string, number> = {};
      for (const night of nights) {
        const capacity = capacityByKeyPerNight[display.key]?.[night] ?? 0;
        const booked = bookedPerKeyPerNight[display.key]?.[night]?.size ?? 0;
        const planned = plannedHoldPerKeyPerNight[display.key]?.[night] ?? 0;
        byNight[night] = Math.max(0, capacity - booked - planned);
      }
      availabilityByKey.set(display.key, {
        min_available: nights.length === 0 ? 0 : Math.min(...nights.map((night) => byNight[night] ?? 0)),
        by_night: byNight,
      });
    }

    const violations: Array<{ room_type_key: string; room_type_name: string; requested: number; available: number }> = [];
    const quoteRooms = Array.from(mergedRequestByKey.entries()).map(([roomTypeKey, quantity]) => {
      const display = MOBILE_TEXT_ROOM_DISPLAY.find((room) => room.key === roomTypeKey)!;
      const available = availabilityByKey.get(roomTypeKey)?.min_available ?? 0;
      if (quantity > available) {
        violations.push({
          room_type_key: roomTypeKey,
          room_type_name: display.name,
          requested: quantity,
          available,
        });
      }
      return {
        roomTypeKey,
        roomTypeName: display.name,
        quantity,
        available,
        dailyPrices: nights.map((night) => rateByKeyPerNight[roomTypeKey]?.[night] ?? 0),
      };
    });

    if (violations.length > 0) {
      return NextResponse.json({
        success: false,
        error: "Selected rooms exceed available inventory for this stay range.",
        code: "ROOM_QUANTITY_EXCEEDS_AVAILABILITY",
        data: { violations, availability: Object.fromEntries(availabilityByKey) },
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      data: {
        checkin,
        checkout,
        nights: nights.length,
        rooms: quoteRooms,
        availability: Object.fromEntries(availabilityByKey),
        text: formatPriceQuoteText({
          customerName,
          checkin,
          checkout,
          nights: nights.length,
          rooms: quoteRooms,
        }),
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
