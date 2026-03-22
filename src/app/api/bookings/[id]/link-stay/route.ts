import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  linkStay,
  unlinkStay,
  LinkedStayManagementError,
} from "@/lib/linked-stay-management";

const paramsSchema = z.object({
  id: z.string().uuid("Invalid reservation id."),
});

// ─── POST: Link two reservations ────────────────────────────────────────

const linkBodySchema = z.object({
  child_reservation_id: z.string().uuid("Invalid child reservation id."),
  note: z.string().optional().nullable(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => null);
    const parsedBody = linkBodySchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const result = await linkStay({
      supabase: supabase as any,
      parentReservationId: parsedParams.data.id,
      payload: {
        child_reservation_id: parsedBody.data.child_reservation_id,
        note: parsedBody.data.note ?? null,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LinkedStayManagementError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// ─── DELETE: Unlink this reservation from its parent ────────────────────

const unlinkBodySchema = z.object({
  note: z.string().optional().nullable(),
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { success: false, error: parsedParams.error.issues[0]?.message ?? "Invalid reservation id." },
        { status: 400 }
      );
    }

    const json = await request.json().catch(() => ({}));
    const parsedBody = unlinkBodySchema.safeParse(json);

    const supabase = createServerSupabaseClient();
    const result = await unlinkStay({
      supabase: supabase as any,
      reservationId: parsedParams.data.id,
      payload: {
        note: parsedBody.success ? (parsedBody.data.note ?? null) : null,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LinkedStayManagementError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
