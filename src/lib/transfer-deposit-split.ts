export type ExactTransferDepositSplitInput = {
  folioAmount: unknown;
  actualTransferAmount: unknown;
  depositTargetAmount: unknown;
};

export type ExactTransferDepositSplit =
  | {
      ok: true;
      folioAmount: number;
      depositAmount: number;
      actualTransferAmount: number;
    }
  | { ok: false };

export type TransferDepositSplitPayload = {
  deposit_amount: number;
};

export type TransferDepositSplitCarrier = {
  transfer_deposit_split?: unknown;
};

function toSatang(value: unknown): number {
  if (typeof value === "string") {
    const text = value.trim().replace(/,/g, "");
    if (!text) return 0;
    const matched = text.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
    if (matched) {
      const sign = matched[1] === "-" ? -1 : 1;
      const intPart = Number(matched[2]) || 0;
      const fracRaw = matched[3] ?? "";
      const fracTwo = `${fracRaw}00`.slice(0, 2);
      const fracPart = Number(fracTwo) || 0;
      return sign * (intPart * 100 + fracPart);
    }
  }

  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * Math.trunc(Math.abs(n) * 100);
}

function fromSatang(satang: number): number {
  if (!Number.isFinite(satang)) return 0;
  return satang / 100;
}

export function getTransferDepositSplitAmount(input: unknown): number {
  if (!input || typeof input !== "object") return 0;
  const depositSatang = toSatang((input as { deposit_amount?: unknown }).deposit_amount);
  if (depositSatang <= 0) return 0;
  return fromSatang(depositSatang);
}

export function getTransferDepositSplitTotal(items: TransferDepositSplitCarrier[]): number {
  return fromSatang(
    items.reduce(
      (sum, item) => sum + toSatang(getTransferDepositSplitAmount(item.transfer_deposit_split)),
      0
    )
  );
}

export function getExactTransferDepositSplit(
  input: ExactTransferDepositSplitInput
): ExactTransferDepositSplit {
  const folioSatang = toSatang(input.folioAmount);
  const actualSatang = toSatang(input.actualTransferAmount);
  const depositSatang = toSatang(input.depositTargetAmount);

  if (folioSatang <= 0 || actualSatang <= 0 || depositSatang <= 0) {
    return { ok: false };
  }
  if (actualSatang <= folioSatang) {
    return { ok: false };
  }
  if (actualSatang !== folioSatang + depositSatang) {
    return { ok: false };
  }

  return {
    ok: true,
    folioAmount: fromSatang(folioSatang),
    depositAmount: fromSatang(depositSatang),
    actualTransferAmount: fromSatang(actualSatang),
  };
}
