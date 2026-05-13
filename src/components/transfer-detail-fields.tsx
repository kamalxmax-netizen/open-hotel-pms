"use client";

import { Landmark } from "lucide-react";
import {
  buildManualTransferDetailPayloadFromDraft,
  normalizeTransferSenderName,
  type ManualTransferDetailPayload,
} from "@/lib/transfer-detail";

export type TransferDetailDraft = {
  actualAmount: string;
  senderName: string;
  bankRef: string;
  transferAt: string;
  note: string;
};

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function createDefaultTransferDetailDraft(amount = "", senderName = ""): TransferDetailDraft {
  return {
    actualAmount: amount,
    senderName: normalizeTransferSenderName(senderName),
    bankRef: "",
    transferAt: toLocalDateTimeInput(new Date()),
    note: "",
  };
}

export function buildTransferDetailPayload(
  draft: TransferDetailDraft
): ManualTransferDetailPayload | undefined {
  return buildManualTransferDetailPayloadFromDraft(draft);
}

type TransferDetailFieldsProps = {
  value: TransferDetailDraft;
  onChange: (next: TransferDetailDraft) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function TransferDetailFields({
  value,
  onChange,
  disabled = false,
  compact = false,
}: TransferDetailFieldsProps) {
  const update = (patch: Partial<TransferDetailDraft>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className={`w-full rounded-lg border border-sky-200/70 bg-sky-50/70 dark:border-sky-500/20 dark:bg-sky-500/10 ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-200">
          <Landmark className="h-4 w-4" />
          Transfer Detail
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-700/70 dark:text-sky-300/70">
          Manual
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="form-label">Actual transfer amount</span>
          <input
            className="form-input h-9 font-mono"
            type="number"
            min="0.01"
            step="0.01"
            value={value.actualAmount}
            onChange={(event) => update({ actualAmount: event.target.value })}
            disabled={disabled}
            placeholder="0.00"
          />
        </label>

        <label className="block">
          <span className="form-label">Transfer time</span>
          <input
            className="form-input h-9"
            type="datetime-local"
            value={value.transferAt}
            onChange={(event) => update({ transferAt: event.target.value })}
            disabled={disabled}
          />
        </label>

        <label className="block">
          <span className="form-label">Sender / account name</span>
          <input
            className="form-input h-9"
            type="text"
            value={value.senderName}
            onChange={(event) => update({ senderName: event.target.value })}
            disabled={disabled}
            placeholder="Optional"
          />
        </label>

        <label className="block">
          <span className="form-label">Reference no.</span>
          <input
            className="form-input h-9"
            type="text"
            value={value.bankRef}
            onChange={(event) => update({ bankRef: event.target.value })}
            disabled={disabled}
            placeholder="Bank ref / slip no."
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="form-label">Additional note</span>
        <input
          className="form-input h-9"
          type="text"
          value={value.note}
          onChange={(event) => update({ note: event.target.value })}
          disabled={disabled}
          placeholder="Optional context"
        />
      </label>
    </div>
  );
}
