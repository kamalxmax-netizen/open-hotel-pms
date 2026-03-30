import {
  getBusinessDate,
  getGroupById,
  getGroupReservationLines,
  getWizardDraft,
} from "@/lib/group-checkin-wizard-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function buildDefaultSelection(lines: Array<any>, businessDate: string): string[] {
  return lines
    .filter((line) =>
      !line.is_checked_in &&
      line.has_assigned_room &&
      String(line.checkin_date) === businessDate &&
      (line.hk_status === null || line.hk_status === "approved" || line.hk_status === "cleaned")
    )
    .map((line) => String(line.reservation_id));
}

function getNextDueInDate(lines: Array<any>, businessDate: string): string | null {
  const futureDates = lines
    .filter((line) =>
      !line.is_checked_in &&
      String(line.status) === "active" &&
      typeof line.checkin_date === "string" &&
      line.checkin_date > businessDate
    )
    .map((line) => String(line.checkin_date))
    .sort();

  return futureDates[0] ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServerSupabaseClient();
    const { id: groupId } = await context.params;

    if (!groupId) {
      return NextResponse.json({ success: false, error: "Missing group ID." }, { status: 400 });
    }

    const businessDate = await getBusinessDate(
      supabase,
      request.nextUrl.searchParams.get("business_date")
    );

    const group = await getGroupById(supabase, groupId);
    if (!group) {
      return NextResponse.json({ success: false, error: "Group not found." }, { status: 404 });
    }

    const reservationLines = await getGroupReservationLines(supabase, groupId, businessDate);
    const hasDueInToday = reservationLines.some((line) =>
      !line.is_checked_in &&
      String(line.status) === "active" &&
      String(line.checkin_date) === businessDate
    );

    if (!hasDueInToday) {
      return NextResponse.json(
        {
          success: false,
          error: "Check-in Wizard is available only on the group's due-in date.",
          business_date: businessDate,
          next_due_in_date: getNextDueInDate(reservationLines, businessDate),
        },
        { status: 409 }
      );
    }

    const draft = await getWizardDraft(supabase, groupId, businessDate);

    const selectedReservationIds = Array.isArray((draft?.draft_json as any)?.step1?.selected_reservation_ids)
      ? (draft?.draft_json as any).step1.selected_reservation_ids.map((value: unknown) => String(value)).filter(Boolean)
      : buildDefaultSelection(reservationLines, businessDate);

    const groupFinancials = {
      total_charge: reservationLines.reduce((sum, row) => sum + Number(row.total_price ?? 0), 0),
      payment_received: reservationLines.reduce((sum, row) => sum + Number(row.payment_received ?? 0), 0),
      deposit_received: reservationLines.reduce((sum, row) => sum + Number(row.deposit_received ?? 0), 0),
      remaining_balance: reservationLines.reduce((sum, row) => sum + Number(row.remaining_balance ?? 0), 0),
    };

    return NextResponse.json({
      success: true,
      business_date: businessDate,
      group,
      reservation_lines: reservationLines,
      group_financials: groupFinancials,
      draft,
      selection: {
        selected_reservation_ids: selectedReservationIds,
      },
      resume_hint: {
        start_step: draft?.status === "draft" ? Math.max(1, Math.min(4, Number(draft.current_step ?? 1))) : 1,
        allow_back_navigation: true,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
