export type BookingGroupStatus = "active" | "completed" | "cancelled";

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function deriveBookingGroupStatus(
  currentStatus: unknown,
  reservationStatuses: Array<unknown>
): BookingGroupStatus {
  const current = normalizeStatus(currentStatus);
  if (current === "cancelled") return "cancelled";

  const hasActive = reservationStatuses.some((status) => normalizeStatus(status) === "active");
  if (hasActive) return "active";

  if (reservationStatuses.length === 0) {
    return current === "completed" ? "completed" : "active";
  }

  return "completed";
}

export async function syncBookingGroupStatusById(
  supabase: any,
  groupId: string | null | undefined
): Promise<BookingGroupStatus | null> {
  if (!groupId) return null;

  const normalizedGroupId = String(groupId);
  const { data: group, error: groupError } = await supabase
    .from("booking_groups")
    .select("id, status")
    .eq("id", normalizedGroupId)
    .maybeSingle();

  if (groupError || !group) return null;

  const { data: reservations, error: reservationsError } = await supabase
    .from("reservations")
    .select("status")
    .eq("booking_group_id", normalizedGroupId);

  if (reservationsError) return null;

  const statuses = (reservations ?? []).map((row: any) => row?.status);
  const nextStatus = deriveBookingGroupStatus(group.status, statuses);
  const current = normalizeStatus(group.status);

  if (current !== nextStatus) {
    const { error: updateError } = await supabase
      .from("booking_groups")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", normalizedGroupId);
    if (updateError) return null;
  }

  return nextStatus;
}
