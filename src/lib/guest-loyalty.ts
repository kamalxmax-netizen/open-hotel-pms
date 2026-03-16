export type VipTierCode = "regular" | "loyal" | "vip" | "longest";
export type LoyaltyEmphasis = "regular" | "return" | "loyal" | "vip" | "vip_plus";

export type GuestLoyaltySnapshot = {
  vip_tier: string | null;
  stay_count: number;
  night_count: number;
  main_stay_count: number;
  main_night_count: number;
  accompanying_stay_count: number;
  accompanying_night_count: number;
};

export type ReturnStatsBadge = {
  source: "main" | "accompanying";
  stays: number;
  nights: number;
  text: string;
};

export type GuestLoyaltyVisual = {
  tier: VipTierCode;
  emphasis: LoyaltyEmphasis;
  isReturn: boolean;
  returnStats: ReturnStatsBadge | null;
  tierLabel: string | null;
  tierEmoji: string | null;
  tierBadgeClass: string;
  rowClass: string;
  hoverPanelClass: string;
};

const DEFAULT_LOYALTY: GuestLoyaltySnapshot = {
  vip_tier: "regular",
  stay_count: 0,
  night_count: 0,
  main_stay_count: 0,
  main_night_count: 0,
  accompanying_stay_count: 0,
  accompanying_night_count: 0,
};

export function normalizeVipTier(tier: string | null | undefined): VipTierCode {
  const normalized = String(tier ?? "regular").trim().toLowerCase();
  if (normalized === "loyal" || normalized === "vip" || normalized === "longest") {
    return normalized;
  }
  return "regular";
}

export function normalizeGuestLoyaltySnapshot(
  loyalty: Partial<GuestLoyaltySnapshot> | null | undefined
): GuestLoyaltySnapshot {
  if (!loyalty) return { ...DEFAULT_LOYALTY };
  return {
    vip_tier: loyalty.vip_tier ?? "regular",
    stay_count: Number(loyalty.stay_count ?? 0),
    night_count: Number(loyalty.night_count ?? 0),
    main_stay_count: Number(loyalty.main_stay_count ?? 0),
    main_night_count: Number(loyalty.main_night_count ?? 0),
    accompanying_stay_count: Number(loyalty.accompanying_stay_count ?? 0),
    accompanying_night_count: Number(loyalty.accompanying_night_count ?? 0),
  };
}

export function resolveReturnStatsBadge(
  loyalty: Partial<GuestLoyaltySnapshot> | null | undefined
): ReturnStatsBadge | null {
  const normalized = normalizeGuestLoyaltySnapshot(loyalty);
  const isReturn = normalized.stay_count >= 1 && normalized.night_count >= 1;
  if (!isReturn) return null;

  const hasMain = normalized.main_stay_count >= 1 && normalized.main_night_count >= 1;
  if (hasMain) {
    return {
      source: "main",
      stays: normalized.main_stay_count,
      nights: normalized.main_night_count,
      text: `${normalized.main_night_count}(${normalized.main_stay_count})`,
    };
  }

  const hasAccompanying =
    normalized.accompanying_stay_count >= 1 && normalized.accompanying_night_count >= 1;
  if (hasAccompanying) {
    return {
      source: "accompanying",
      stays: normalized.accompanying_stay_count,
      nights: normalized.accompanying_night_count,
      text: `${normalized.accompanying_night_count}(${normalized.accompanying_stay_count})`,
    };
  }

  return null;
}

export function resolveGuestLoyaltyVisual(
  loyalty: Partial<GuestLoyaltySnapshot> | null | undefined
): GuestLoyaltyVisual {
  const normalized = normalizeGuestLoyaltySnapshot(loyalty);
  const tier = normalizeVipTier(normalized.vip_tier);
  const returnStats = resolveReturnStatsBadge(normalized);
  const isReturn = Boolean(returnStats);

  let emphasis: LoyaltyEmphasis = "regular";
  if (tier === "loyal") emphasis = "loyal";
  else if (tier === "vip") emphasis = "vip";
  else if (tier === "longest") emphasis = "vip_plus";
  else if (isReturn) emphasis = "return";

  if (emphasis === "loyal") {
    return {
      tier,
      emphasis,
      isReturn,
      returnStats,
      tierLabel: "Loyal",
      tierEmoji: "🔹",
      tierBadgeClass: "border-amber-200 bg-amber-100 text-amber-700",
      rowClass: "bg-sky-200/90 [&>td]:bg-sky-100/70 hover:bg-sky-100/70 hover:[&>td]:bg-sky-100/70",
      hoverPanelClass: "border-sky-300 bg-sky-50/95",
    };
  }

  if (emphasis === "vip") {
    return {
      tier,
      emphasis,
      isReturn,
      returnStats,
      tierLabel: "VIP",
      tierEmoji: "🔶",
      tierBadgeClass: "border-violet-200 bg-violet-100 text-violet-700",
      rowClass: "bg-sky-200/90 [&>td]:bg-sky-100/70 hover:bg-sky-100/70 hover:[&>td]:bg-sky-100/70",
      hoverPanelClass: "border-sky-300 bg-sky-50/95",
    };
  }

  if (emphasis === "vip_plus") {
    return {
      tier,
      emphasis,
      isReturn,
      returnStats,
      tierLabel: "VIP+",
      tierEmoji: "💠",
      tierBadgeClass: "border-yellow-300 bg-yellow-100 text-yellow-800",
      rowClass: "bg-sky-200/90 [&>td]:bg-sky-100/70 hover:bg-sky-100/70 hover:[&>td]:bg-sky-100/70",
      hoverPanelClass: "border-rose-300 bg-rose-50/95",
    };
  }

  if (emphasis === "return") {
    return {
      tier,
      emphasis,
      isReturn,
      returnStats,
      tierLabel: null,
      tierEmoji: null,
      tierBadgeClass: "",
      rowClass: "bg-lime-200/70 [&>td]:bg-lime-100/70 hover:bg-lime-100/70 hover:[&>td]:bg--100/70",
      hoverPanelClass: "border-lime-400 bg-lime-100/95",
    };
  }

  return {
    tier,
    emphasis,
    isReturn,
    returnStats,
    tierLabel: null,
    tierEmoji: null,
    tierBadgeClass: "",
    rowClass: "",
    hoverPanelClass: "border-slate-200 bg-white",
  };
}
