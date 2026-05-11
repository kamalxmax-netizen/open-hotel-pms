import { listNights } from "@/lib/dates";
import { fromSatang, toSatang } from "@/lib/money";

export function computeReservationDiscountAmount(input: {
  totalPrice: number | string | null | undefined;
  discountType?: string | null;
  discountValue?: number | string | null;
  discountPercent?: number | string | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
}): number {
  const totalPrice = fromSatang(toSatang(input.totalPrice ?? 0));
  const rawValue = input.discountValue ?? input.discountPercent ?? 0;
  const discountValue = fromSatang(toSatang(rawValue));
  if (totalPrice <= 0 || discountValue <= 0) return 0;

  if (input.discountType === "fixed_total") {
    return Math.min(totalPrice, discountValue);
  }

  if (input.discountType === "fixed_per_night") {
    let nights = 0;
    try {
      nights = listNights(String(input.checkinDate ?? ""), String(input.checkoutDate ?? "")).length;
    } catch {
      nights = 0;
    }
    return Math.min(totalPrice, discountValue * Math.max(0, nights));
  }

  const percent = Math.max(0, Math.min(100, discountValue));
  if (percent <= 0) return 0;
  if (percent >= 100) return totalPrice;

  return Math.min(totalPrice, fromSatang(Math.trunc(toSatang(totalPrice) * (percent / 100))));
}
