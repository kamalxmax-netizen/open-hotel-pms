import {
  createBookingAlarm,
  listBookingAlarms,
  requireAlertsReadAccess,
  softDeleteBookingAlarm,
  updateBookingAlarm,
} from "@/lib/alerts/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const createSchema = z.object({
  alarm_date: z.string().date(),
  note: z.string().trim().min(5).max(2000),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  alarm_date: z.string().date().optional(),
  note: z.string().trim().min(5).max(2000).optional(),
  action: z.enum(["complete"]).optional(),
  completion_note: z.string().trim().min(1).max(2000).optional(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  try {
    const alarms = await listBookingAlarms(auth.supabase, params.id);
    return NextResponse.json({ success: true, alarms });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const alarm = await createBookingAlarm(auth.supabase, auth.actor.userId, {
      reservation_id: params.id,
      ...parsed.data,
    });
    return NextResponse.json({ success: true, alarm }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unexpected error." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const alarm = await updateBookingAlarm(auth.supabase, auth.actor.userId, parsed.data.id, parsed.data);
    return NextResponse.json({ success: true, alarm, reservation_id: params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAlertsReadAccess(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.error === "Unauthorized." ? 401 : 403 });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const alarm = await softDeleteBookingAlarm(auth.supabase, auth.actor.userId, parsed.data.id);
    return NextResponse.json({ success: true, alarm, reservation_id: params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ success: false, error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
