import type { RoundingMode, RuleActionType } from "@/lib/rates/dynamic-types";

function roundHalfUp(value: number, step: number) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundNearest(value: number, step: number) {
  return roundMoney(roundHalfUp(value, step));
}

export function roundPrice(value: number, mode: RoundingMode) {
  switch (mode) {
    case "nearest_100":
      return roundNearest(value, 100);
    case "nearest_50":
      return roundNearest(value, 50);
    case "nearest_10":
      return roundNearest(value, 10);
    case "none":
    default:
      return roundMoney(value);
  }
}

export function applyAction(basePrice: number, actionType: RuleActionType, actionValue: number) {
  if (!Number.isFinite(basePrice)) return 0;
  if (!Number.isFinite(actionValue)) return roundMoney(basePrice);

  switch (actionType) {
    case "percent":
      return roundMoney(basePrice * (1 + actionValue / 100));
    case "fixed_thb":
      return roundMoney(basePrice + actionValue);
    case "step":
      return roundMoney(basePrice + actionValue);
    case "override":
      return roundMoney(actionValue);
    default:
      return roundMoney(basePrice);
  }
}

export function clampDynamicPrice(params: {
  suggestedPrice: number;
  basePrice: number;
  floorPrice?: number | null;
  maxMultiplier: number;
  rounding: RoundingMode;
}) {
  let nextPrice = roundMoney(params.suggestedPrice);
  let clampedToMax = false;
  let clampedToFloor = false;

  const maxPrice = roundMoney(params.basePrice * params.maxMultiplier);
  if (Number.isFinite(maxPrice) && nextPrice > maxPrice) {
    nextPrice = roundPrice(maxPrice, params.rounding);
    clampedToMax = true;
  }

  if (params.floorPrice != null && Number.isFinite(params.floorPrice) && nextPrice < params.floorPrice) {
    nextPrice = roundMoney(params.floorPrice);
    clampedToFloor = true;
  }

  return {
    price: roundMoney(nextPrice),
    clampedToFloor,
    clampedToMax,
  };
}

export function getDirection(basePrice: number, nextPrice: number) {
  if (nextPrice > basePrice) return "up" as const;
  if (nextPrice < basePrice) return "down" as const;
  return "same" as const;
}
