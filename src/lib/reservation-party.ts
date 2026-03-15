type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export class ReservationPartyError extends Error {
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, status = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "ReservationPartyError";
    this.status = status;
    this.details = details;
  }
}

function isMissingRpc(message?: string | null): boolean {
  if (!message) return false;
  return message.includes("Could not find the function public.link_primary_guest")
    || message.includes("Could not find the function public.unlink_primary_guest");
}

export async function assertGuestProfileLinkable(supabase: SupabaseLike, guestProfileId: string) {
  const { data: profile, error } = await supabase
    .from("guest_profiles")
    .select("id, profile_status, merged_into")
    .eq("id", guestProfileId)
    .maybeSingle();

  if (error) {
    throw new ReservationPartyError(error.message ?? "Failed to load guest profile.", 500);
  }
  if (!profile) {
    throw new ReservationPartyError("Guest profile not found.", 404);
  }
  if (profile.profile_status === "merged") {
    throw new ReservationPartyError("Cannot link merged guest profile.", 409, {
      merged_into: profile.merged_into ?? null,
    });
  }

  return profile;
}

export async function linkPrimaryGuestToReservation(
  supabase: SupabaseLike,
  reservationId: string,
  guestProfileId: string
) {
  await assertGuestProfileLinkable(supabase, guestProfileId);

  const { data, error } = await supabase.rpc("link_primary_guest", {
    p_reservation_id: reservationId,
    p_guest_profile_id: guestProfileId,
  });

  if (error) {
    const message = error.message ?? "Failed to link primary guest.";
    if (isMissingRpc(message)) {
      throw new ReservationPartyError(
        "DB migration required: apply accompanying guest invariant migration before linking primary guest.",
        500
      );
    }
    if (message.includes("Reservation not found")) {
      throw new ReservationPartyError("Reservation not found.", 404);
    }
    if (message.includes("Guest profile not found")) {
      throw new ReservationPartyError("Guest profile not found.", 404);
    }
    if (message.includes("Cannot link merged guest profile")) {
      throw new ReservationPartyError("Cannot link merged guest profile.", 409);
    }
    throw new ReservationPartyError(message, 500);
  }

  return data;
}

export async function unlinkPrimaryGuestFromReservation(
  supabase: SupabaseLike,
  reservationId: string
) {
  const { data, error } = await supabase.rpc("unlink_primary_guest", {
    p_reservation_id: reservationId,
  });

  if (error) {
    const message = error.message ?? "Failed to unlink primary guest.";
    if (isMissingRpc(message)) {
      throw new ReservationPartyError(
        "DB migration required: apply accompanying guest invariant migration before unlinking primary guest.",
        500
      );
    }
    if (message.includes("Reservation not found")) {
      throw new ReservationPartyError("Reservation not found.", 404);
    }
    throw new ReservationPartyError(message, 500);
  }

  return data;
}
