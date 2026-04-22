import type {
  OtaChannelCode,
  OtaMarkupType,
  OtaSyncAckRequest,
  OtaSyncAckResponse,
  OtaSyncListResponse,
  OtaSyncTask,
  OtaSyncTaskStatus,
} from "@/lib/ota/types";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const listQuerySchema = z.object({
  channel_code: z.enum(["BOOKING"]).optional(),
  status: z.enum(["pending", "synced", "superseded", "skipped", "all"]).optional(),
  from_date: z.string().date().optional(),
  to_date: z.string().date().optional(),
});

const ackSchema = z.object({
  task_id: z.string().uuid(),
  action: z.enum(["synced", "skipped"]),
  staff_note: z.string().trim().max(1000).optional(),
});

async function requireOtaActor(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const actor = await getAuthenticatedUser(supabase, request);
  if (!actor) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }) };
  }

  const role = await getUserRole(supabase, actor.id);
  const allowed = role === "admin" || role === "supervisor" || role === "frontdesk" || role === "manager";
  if (!allowed) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }) };
  }

  return { ok: true as const, supabase, actor: { userId: actor.id, role } };
}

function minutesSince(iso: string | null) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / 60000);
}

function mapTask(row: any): OtaSyncTask {
  const roomTypeJoin = Array.isArray(row?.room_types) ? row.room_types[0] : row?.room_types;
  return {
    id: String(row?.id ?? ""),
    channel_code: String(row?.channel_code ?? "BOOKING") as OtaChannelCode,
    room_type_id: String(row?.room_type_id ?? ""),
    room_type_name: roomTypeJoin?.name_en ? String(roomTypeJoin.name_en) : undefined,
    stay_date: String(row?.stay_date ?? ""),
    old_price: row?.old_price == null ? null : Number(row.old_price),
    new_price: Number(row?.new_price ?? 0),
    calculated_ota_price: Number(row?.calculated_ota_price ?? 0),
    markup_snapshot: {
      type: String((row?.markup_snapshot as any)?.type ?? "none") as OtaMarkupType,
      value: Number((row?.markup_snapshot as any)?.value ?? 0),
    },
    status: String(row?.status ?? "pending") as OtaSyncTaskStatus,
    superseded_by: row?.superseded_by ? String(row.superseded_by) : null,
    reason: row?.reason ? String(row.reason) : null,
    created_at: String(row?.created_at ?? ""),
    created_by: row?.created_by ? String(row.created_by) : null,
    acked_at: row?.acked_at ? String(row.acked_at) : null,
    acked_by: row?.acked_by ? String(row.acked_by) : null,
    staff_note: row?.staff_note ? String(row.staff_note) : null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireOtaActor(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = listQuerySchema.safeParse({
      channel_code: request.nextUrl.searchParams.get("channel_code") ?? undefined,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      from_date: request.nextUrl.searchParams.get("from_date") ?? undefined,
      to_date: request.nextUrl.searchParams.get("to_date") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { channel_code, status = "pending", from_date, to_date } = parsed.data;

    let query = auth.supabase
      .from("ota_rate_sync_tasks")
      .select(
        "id, channel_code, room_type_id, stay_date, old_price, new_price, calculated_ota_price, markup_snapshot, status, superseded_by, reason, created_at, created_by, acked_at, acked_by, staff_note, room_types(name_en)"
      )
      .order("stay_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (channel_code) query = query.eq("channel_code", channel_code);
    if (status !== "all") query = query.eq("status", status);
    if (from_date) query = query.gte("stay_date", from_date);
    if (to_date) query = query.lte("stay_date", to_date);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    let pendingQuery = auth.supabase
      .from("ota_rate_sync_tasks")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (channel_code) pendingQuery = pendingQuery.eq("channel_code", channel_code);
    if (from_date) pendingQuery = pendingQuery.gte("stay_date", from_date);
    if (to_date) pendingQuery = pendingQuery.lte("stay_date", to_date);

    const { data: pendingRows, error: pendingError } = await pendingQuery;
    if (pendingError) {
      return NextResponse.json({ success: false, error: pendingError.message }, { status: 500 });
    }

    const response: OtaSyncListResponse = {
      success: true,
      tasks: (data ?? []).map(mapTask),
      total_pending: Number(pendingRows?.length ?? 0),
      oldest_pending_minutes:
        pendingRows && pendingRows.length > 0 ? minutesSince(String((pendingRows[0] as any).created_at ?? "")) : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireOtaActor(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = ackSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data as OtaSyncAckRequest;
    const { data: existing, error: existingError } = await auth.supabase
      .from("ota_rate_sync_tasks")
      .select(
        "id, channel_code, room_type_id, stay_date, old_price, new_price, calculated_ota_price, markup_snapshot, status, superseded_by, reason, created_at, created_by, acked_at, acked_by, staff_note, room_types(name_en)"
      )
      .eq("id", payload.task_id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    }
    if (String((existing as any).status) !== "pending") {
      return NextResponse.json({ success: false, error: "Only pending tasks can be acknowledged." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await auth.supabase
      .from("ota_rate_sync_tasks")
      .update({
        status: payload.action,
        acked_at: nowIso,
        acked_by: auth.actor.userId,
        staff_note: payload.staff_note?.trim() || null,
      })
      .eq("id", payload.task_id)
      .eq("status", "pending")
      .select(
        "id, channel_code, room_type_id, stay_date, old_price, new_price, calculated_ota_price, markup_snapshot, status, superseded_by, reason, created_at, created_by, acked_at, acked_by, staff_note, room_types(name_en)"
      )
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ success: false, error: "Task was updated by another session." }, { status: 409 });
    }

    const response: OtaSyncAckResponse = {
      success: true,
      task: mapTask(updated),
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
