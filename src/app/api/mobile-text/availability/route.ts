import { buildDailyPriceMap, formatAvailabilityText, resolveRoomDisplayConfig } from "@/lib/mobile-text";
import { isValidDateString, listNights } from "@/lib/dates";
import { expandPlannedMoveNights, listOverlappingPlannedRoomHolds } from "@/lib/planned-room-moves";
import { MobileCheckinError, requireMobileCheckinAuth } from "@/lib/mobile-checkin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isLegacyDayUseRoom } from "@/lib/dayuse-rooms";
import { getRoomIdsBlockedOnNight, ROOM_UNSELLABLE_BLOCK_TYPES } from "@/lib/room-block-availability";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function round2(value: number) {
  return Number(value.toFixed(2));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireMobileCheckinAuth(supabase, request);

    const checkin = String(request.nextUrl.searchParams.get("checkin") ?? "").trim();
    const checkout = String(request.nextUrl.searchParams.get("checkout") ?? "").trim();

    if (!checkin || !checkout || !isValidDateString(checkin) || !isValidDateString(checkout)) {
      throw new MobileCheckinError("checkin and checkout are required in YYYY-MM-DD format.", 400, "INVALID_RANGE");
    }
    if (checkout <= checkin) {
      throw new MobileCheckinError("checkout must be after checkin.", 400, "INVALID_CHECKOUT");
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

    const rooms = (roomsRaw ?? []).filter((room: any) => !isLegacyDayUseRoom(String(room?.room_number ?? "")));
    const roomIdsByType: Record<number, string[]> = {};
    const roomMetaById = new Map<string, { room_type_id: number }>();
    for (const room of rooms) {
      const typeId = Number((room as any).room_type_id ?? 0);
      const roomId = String((room as any).id ?? "");
      if (!typeId || !roomId) continue;
      if (!roomIdsByType[typeId]) roomIdsByType[typeId] = [];
      roomIdsByType[typeId].push(roomId);
      roomMetaById.set(roomId, { room_type_id: typeId });
    }

    const [{ data: roomTypeRows, error: roomTypeError }, { data: oooBlocks, error: oooError }, { data: bookedNights, error: bookedError }] = await Promise.all([
      supabase.from("room_types").select("id, name_en, code"),
      supabase
        .from("room_blocks")
        .select("room_id, block_type, start_date, end_date")
        .in("block_type", ROOM_UNSELLABLE_BLOCK_TYPES)
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

    const roomTypes = (roomTypeRows ?? []).map((row: any) => ({
      id: Number(row.id),
      name_en: String(row.name_en ?? ""),
      code: row.code ? String(row.code) : null,
    }));

    const blockedRoomIdsByNight = new Map<string, Set<string>>();
    for (const night of nights) blockedRoomIdsByNight.set(night, getRoomIdsBlockedOnNight(oooBlocks, night));

    const capacityByTypePerNight: Record<number, Record<string, number>> = {};
    for (const [typeIdText, roomIds] of Object.entries(roomIdsByType)) {
      const typeId = Number(typeIdText);
      capacityByTypePerNight[typeId] = {};
      for (const night of nights) {
        const blocked = blockedRoomIdsByNight.get(night) ?? new Set<string>();
        const capacity = roomIds.reduce((count, roomId) => count + (blocked.has(roomId) ? 0 : 1), 0);
        capacityByTypePerNight[typeId][night] = capacity;
      }
    }

    const bookedPerTypePerNight: Record<number, Record<string, Set<string>>> = {};
    for (const row of bookedNights ?? []) {
      const stayDate = String((row as any).stay_date ?? "");
      const reservationId = String((row as any).reservation_id ?? "");
      if (!stayDate || !reservationId) continue;

      const typeCandidates = new Set<number>();
      const directTypeId = Number((row as any).room_type_id ?? 0);
      if (directTypeId > 0) typeCandidates.add(directTypeId);

      const roomId = String((row as any).room_id ?? "");
      const roomMeta = roomMetaById.get(roomId);
      if (roomMeta?.room_type_id) typeCandidates.add(roomMeta.room_type_id);

      for (const typeId of typeCandidates) {
        if (!roomIdsByType[typeId]) continue;
        if (!bookedPerTypePerNight[typeId]) bookedPerTypePerNight[typeId] = {};
        if (!bookedPerTypePerNight[typeId][stayDate]) bookedPerTypePerNight[typeId][stayDate] = new Set<string>();
        bookedPerTypePerNight[typeId][stayDate].add(reservationId);
      }
    }

    const plannedRows = await listOverlappingPlannedRoomHolds(supabase as any, {
      checkinDate: checkin,
      checkoutDate: checkout,
      roomIds: rooms.map((row: any) => String(row.id)),
    });

    const plannedHoldPerTypePerNight: Record<number, Record<string, number>> = {};
    for (const row of plannedRows) {
      const roomMeta = roomMetaById.get(String(row.to_room_id));
      const typeId = roomMeta?.room_type_id ?? Number(row.to_room_type_id ?? 0);
      if (!typeId || !roomIdsByType[typeId]) continue;
      if (!plannedHoldPerTypePerNight[typeId]) plannedHoldPerTypePerNight[typeId] = {};
      for (const stayDate of expandPlannedMoveNights(row)) {
        if (stayDate < checkin || stayDate >= checkout) continue;
        plannedHoldPerTypePerNight[typeId][stayDate] = (plannedHoldPerTypePerNight[typeId][stayDate] ?? 0) + 1;
      }
    }

    const overnightRoomIds = Object.values(roomIdsByType).flat();
    const rateByTypePerNight: Record<number, Record<string, number>> = {};
    if (overnightRoomIds.length > 0) {
      const { data: rateRows, error: rateError } = await supabase
        .from("rate_templates")
        .select("room_id, stay_date, price")
        .in("room_id", overnightRoomIds)
        .in("stay_date", nights);

      if (rateError) {
        throw new MobileCheckinError(rateError.message, 500, "RATE_QUERY_FAILED");
      }

      const valuesByTypeNight = new Map<number, Map<string, number[]>>();
      for (const row of rateRows ?? []) {
        const roomId = String((row as any).room_id ?? "");
        const stayDate = String((row as any).stay_date ?? "");
        if (!roomId || !stayDate) continue;
        const roomMeta = roomMetaById.get(roomId);
        const typeId = roomMeta?.room_type_id ?? 0;
        if (!typeId) continue;
        let byNight = valuesByTypeNight.get(typeId);
        if (!byNight) {
          byNight = new Map<string, number[]>();
          valuesByTypeNight.set(typeId, byNight);
        }
        const list = byNight.get(stayDate) ?? [];
        list.push(Number((row as any).price ?? 0));
        byNight.set(stayDate, list);
      }

      for (const typeId of Object.keys(roomIdsByType).map(Number)) {
        rateByTypePerNight[typeId] = {};
        const byNight = valuesByTypeNight.get(typeId) ?? new Map<string, number[]>();
        for (const night of nights) {
          const values = byNight.get(night) ?? [];
          rateByTypePerNight[typeId][night] =
            values.length === 0 ? 0 : round2(values.reduce((sum, value) => sum + value, 0) / values.length);
        }
      }
    }

    const pricesByDay: Record<string, Record<string, { price: number; available: boolean }>> = {};
    for (const roomType of roomTypes) {
      const display = resolveRoomDisplayConfig(roomType.name_en, null);
      if (!display) continue;

      const rows = nights.map((stayDate) => {
        const capacity = capacityByTypePerNight[roomType.id]?.[stayDate] ?? 0;
        const booked = bookedPerTypePerNight[roomType.id]?.[stayDate]?.size ?? 0;
        const planned = plannedHoldPerTypePerNight[roomType.id]?.[stayDate] ?? 0;
        const availableCount = Math.max(0, capacity - booked - planned);
        return {
          stay_date: stayDate,
          price: rateByTypePerNight[roomType.id]?.[stayDate] ?? 0,
          available: availableCount > 0,
        };
      });

      const partialMap = buildDailyPriceMap(display.key, checkin, checkout, rows);
      for (const [stayDate, dayData] of Object.entries(partialMap)) {
        pricesByDay[stayDate] = {
          ...(pricesByDay[stayDate] ?? {}),
          ...dayData,
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        checkin,
        checkout,
        text: formatAvailabilityText(pricesByDay),
      },
    });
  } catch (error) {
    if (error instanceof MobileCheckinError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
