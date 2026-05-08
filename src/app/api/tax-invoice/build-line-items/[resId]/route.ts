import {
  buildLineItemsForReservation,
  buildLineItemsForReservations,
  getBusinessDateFromSettings,
  getSellerSnapshotFromSettings,
  TaxInvoiceError,
} from "@/lib/tax-invoice/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/server-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: { resId: string } }
) {
  try {
    const reservationId = String(params.resId ?? "").trim();
    if (!UUID_RE.test(reservationId)) {
      return NextResponse.json({ success: false, error: "Invalid reservation id." }, { status: 400 });
    }
    const extraReservationIds = String(request.nextUrl.searchParams.get("reservation_ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const reservationIds = Array.from(new Set([reservationId, ...extraReservationIds]));
    if (!reservationIds.every((value) => UUID_RE.test(value))) {
      return NextResponse.json({ success: false, error: "Invalid reservation_ids." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const [result, sellerSnapshot, businessDate] = await Promise.all([
      reservationIds.length > 1
        ? buildLineItemsForReservations(supabase, reservationIds)
        : buildLineItemsForReservation(supabase, reservationId),
      getSellerSnapshotFromSettings(supabase),
      getBusinessDateFromSettings(supabase),
    ]);

    const data = {
      reservation: result.reservation,
      line_items: result.line_items,
      available_extra_items: result.available_extra_items,
      totals: result.totals,
      booking_snapshot: result.booking_snapshot,
    };

    return NextResponse.json({
      success: true,
      data,
      seller_snapshot: sellerSnapshot,
      business_date: businessDate,
    });
  } catch (err) {
    if (err instanceof TaxInvoiceError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
