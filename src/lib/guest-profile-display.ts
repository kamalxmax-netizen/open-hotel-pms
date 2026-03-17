import type { GuestProfile, GuestProfileListItem, GuestHistoryStay } from "@/lib/types";

export const VIP_TIER_META: Record<string, { label: string; tone: string }> = {
  regular: { label: "Regular", tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  loyal: { label: "Loyal", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" },
  vip: { label: "VIP", tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400" },
  longest: { label: "VIP+", tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" },
};

export function getVipTierMeta(tier: string | null | undefined) {
  return VIP_TIER_META[tier ?? "regular"] ?? VIP_TIER_META.regular;
}

export function getProfileStatusMeta(
  profileStatus: GuestProfile["profile_status"] | null | undefined,
  blacklisted?: boolean | null
) {
  if (blacklisted) {
    return {
      label: "Blacklisted",
      tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400",
    };
  }

  switch (profileStatus) {
    case "verified":
      return { label: "Verified", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" };
    case "draft":
      return { label: "Draft", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400" };
    case "merged":
      return { label: "Merged", tone: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" };
    case "blacklisted":
      return { label: "Blacklisted", tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400" };
    default:
      return { label: "Draft", tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
  }
}

export function getRoleMeta(role: GuestHistoryStay["role"]) {
  if (role === "primary") {
    return {
      label: "Main",
      tone: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
      dot: "bg-blue-500",
    };
  }

  return {
    label: "Acc",
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-400",
  };
}

export function formatGuestDisplayName(
  profile: Pick<GuestProfile | GuestProfileListItem, "first_name" | "last_name">
) {
  const first = String(profile.first_name ?? "").trim();
  const last = String(profile.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "Unknown";
}

export function isVipBucket(tier: string | null | undefined) {
  return !!tier && tier !== "regular";
}
