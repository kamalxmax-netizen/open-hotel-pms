"use client"

import { LogbookNoteLink } from "@/lib/types"

type BoardRoomSummary = {
  room_number: string
  reservation_id?: string | null
  due_in_reservation_id?: string | null
  diary_state?: "available" | "due_in" | "inhouse" | "back_to_back" | "due_out" | null
}

function getRoomCode(link: LogbookNoteLink): string {
  return String(link.ref_code || link.label || "").replace(/^Room\s+/i, "").trim()
}

export async function resolveRoomLinkModeAtCreation(roomCodeRaw: string): Promise<"static" | "dynamic"> {
  const roomCode = String(roomCodeRaw ?? "").replace(/^Room\s+/i, "").trim()
  if (!roomCode) return "static"

  try {
    const res = await fetch("/api/board", { cache: "no-store" })
    const data = await res.json().catch(() => null)
    const rooms = Array.isArray(data?.rooms) ? (data.rooms as BoardRoomSummary[]) : []
    const target = rooms.find((room) => String(room.room_number) === roomCode)
    if (!target || target.diary_state === "available") return "static"
    return "dynamic"
  } catch (error) {
    console.error("Failed to resolve room link mode at creation", error)
    return "static"
  }
}

export async function resolveLogbookLinkHref(link: LogbookNoteLink): Promise<string> {
  if (link.link_type === "guest") {
    return link.ref_id ? `/pms/guests/${link.ref_id}` : `/pms/guests?q=${encodeURIComponent(link.label)}`
  }
  if (link.link_type === "stock") return "/pms/inventory/stock"
  if (link.link_type === "staff") {
    return link.ref_id ? `/pms/team?staff_id=${encodeURIComponent(link.ref_id)}` : "/pms/team"
  }

  const roomCode = getRoomCode(link)
  const roomHref = `/pms/board?room=${encodeURIComponent(roomCode)}`

  if (link.room_link_mode !== "dynamic") {
    return roomHref
  }

  if (link.ref_id) {
    return `/pms/reservations?open=${encodeURIComponent(link.ref_id)}`
  }

  try {
    const res = await fetch("/api/board", { cache: "no-store" })
    const data = await res.json().catch(() => null)
    const rooms = Array.isArray(data?.rooms) ? (data.rooms as BoardRoomSummary[]) : []
    const target = rooms.find((room) => String(room.room_number) === roomCode)
    if (!target) return roomHref

    const currentReservationId =
      target.reservation_id ||
      target.due_in_reservation_id ||
      null

    if (!currentReservationId || target.diary_state === "available") {
      return roomHref
    }

    return `/pms/reservations?open=${encodeURIComponent(currentReservationId)}`
  } catch (error) {
    console.error("Failed to resolve dynamic room link", error)
    return roomHref
  }
}
