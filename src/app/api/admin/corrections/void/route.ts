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

function findFirstUuidLike(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
      return trimmed;
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUuidLike(item);
      if (found) return found;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const candidateKey of [
      "payment_id",
      "paymentId",
      "id",
      "payment",
      "row",
      "selectedPayment",
      "selectedPaymentId",
    ]) {
      if (candidateKey in value) {
        const found = findFirstUuidLike((value as Record<string, unknown>)[candidateKey]);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findFirstUuidLike(nested);
      if (found) return found;
    }
  }
  return "";
}

function findReasonText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  for (const candidateKey of ["reason", "correction_reason", "note", "message", "comment"]) {
    const raw = (value as Record<string, unknown>)[candidateKey];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return "";
}

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
      payment_id: findFirstUuidLike(body),
      reason: findReasonText(body),
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
