import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminCorrectionError,
  isAdminCorrectionError,
  voidPayment,
} from "@/lib/admin-corrections";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await assertAdminOrSupervisor(supabase, user.id);

    const body = await request.json().catch(() => null);
    const normalizedBody = {
      payment_id:
        typeof body?.payment_id === "string"
          ? body.payment_id
          : typeof body?.paymentId === "string"
            ? body.paymentId
            : typeof body?.id === "string"
              ? body.id
              : "",
      reason:
        typeof body?.reason === "string"
          ? body.reason
          : typeof body?.correction_reason === "string"
            ? body.correction_reason
            : typeof body?.note === "string"
              ? body.note
              : "",
    };
    const parsed = bodySchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await voidPayment(supabase as any, user.id, parsed.data.payment_id, parsed.data.reason);
    return NextResponse.json(result);
  } catch (err) {
    if (isAdminCorrectionError(err) || err instanceof AdminCorrectionError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
