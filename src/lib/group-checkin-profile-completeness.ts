import {
  checkProfileCompleteness,
  type GuestProfileLike,
  type ProfileCompletenessResult,
} from "./guest-profile-completeness";

function firstNonBlank(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

export function checkGroupWizardPrimaryCompleteness(
  profile: GuestProfileLike | null | undefined,
  options: {
    reservationPhone?: unknown;
    groupContactPhone?: unknown;
  }
): ProfileCompletenessResult {
  const effectivePhone = firstNonBlank(
    profile?.phone,
    options.reservationPhone,
    options.groupContactPhone
  );

  return checkProfileCompleteness({
    ...(profile ?? {}),
    phone: effectivePhone,
  });
}
