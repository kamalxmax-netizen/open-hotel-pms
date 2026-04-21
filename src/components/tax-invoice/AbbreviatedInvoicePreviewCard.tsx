import React from "react";
import { AbbreviatedInvoiceDraft, ChannelGroup } from "@/lib/abbreviated-tax-invoice/types";

function fmtMoney(num: number) {
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(isoStr: string) {
  if (!isoStr) return "-";
  return new Date(isoStr).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const CHANNEL_GROUP_LABEL: Record<ChannelGroup, string> = {
  ota: "OTA / Agent",
  walkin_direct: "Walk-in / Direct",
};

interface Props {
  draft: AbbreviatedInvoiceDraft;
  variant: "room" | "dayuse" | "pos";
  onShiftRow?: (taxGroup: string, entries: any[], origDate: string) => void;
}

export function AbbreviatedInvoicePreviewCard({ draft, variant, onShiftRow }: Props) {
  // Use POS items if available (variant = pos), else use lines
  const itemsToRender = draft.pos_items && variant === "pos" ? draft.pos_items : draft.lines;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden shadow-sm dark:border-white/10">
      <div className="flex items-center justify-between bg-[var(--bg-muted)]/50 p-3 border-b border-[var(--border)] dark:border-white/10">
        <div className="flex items-center gap-3">
          {draft.channel_group && (
            <span
              className={`text-xs font-bold px-2 py-1 rounded ${
                draft.channel_group === "ota"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              }`}
            >
              {CHANNEL_GROUP_LABEL[draft.channel_group]}
            </span>
          )}
          {!draft.channel_group && (
             <span className="text-xs font-bold px-2 py-1 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
               Walk-in
             </span>
          )}
          <span className="text-sm font-semibold text-[var(--text-primary)] text-mono tracking-wide">
            {draft.predicted_invoice_no}
          </span>
        </div>
        <div className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
          {fmtDate(draft.issue_date)}
        </div>
      </div>

      {draft.warning && (
        <div className="bg-amber-50 text-amber-700 text-xs px-3 py-2 border-b border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800">
          {draft.warning}
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--text-muted)] text-left bg-[var(--bg-surface)] dark:border-white/10">
            {variant === "room" && <th className="p-2 font-medium w-[40px] text-center">Group</th>}
            <th className="p-2 font-medium">รายการ</th>
            <th className="p-2 font-medium text-right">จำนวน</th>
            <th className="p-2 font-medium text-right">ราคา/หน่วย</th>
            <th className="p-2 font-medium text-right">ยอดรวม (Inc.VAT)</th>
            {variant === "room" && <th className="p-2 font-medium w-[40px]"></th>}
          </tr>
        </thead>
        <tbody>
          {itemsToRender.map((line: any, lIdx: number) => (
            <tr key={lIdx} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-muted)]/30 group dark:border-white/10">
              {variant === "room" && <td className="p-2 text-center font-bold text-[var(--text-secondary)]">{line.tax_group}</td>}
              <td className="p-2 font-medium text-[var(--text-primary)]">
                {line.label_th}
                {line.shifted_from_date && (
                  <span className="ml-2 inline-block px-1.5 py-0.5 rounded-sm bg-purple-100 text-purple-700 text-[9px] dark:bg-purple-900/40 dark:text-purple-300">
                    Shifted
                  </span>
                )}
              </td>
              <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{line.quantity}</td>
              <td className="p-2 text-right font-mono text-[var(--text-secondary)]">{fmtMoney(line.unit_price)}</td>
              <td className="p-2 text-right font-mono font-medium text-[var(--text-primary)]">{fmtMoney(line.amount)}</td>
              {variant === "room" && (
                <td className="p-2 text-center">
                  <button
                    title="Shift to another day"
                    onClick={() => {
                      if (onShiftRow) {
                        const entriesToShift = line.source_entries?.map((e: any) => ({ ...e, unit_price: line.unit_price })) || [];
                        onShiftRow(line.tax_group ?? "", entriesToShift, draft.issue_date);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-[10px] rounded border border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-surface-hover)] transition text-[var(--text-secondary)] font-medium"
                  >
                    Shift
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-[var(--bg-muted)]/30 border-t border-[var(--border)] dark:border-white/10">
          <tr>
            <td colSpan={variant === "room" ? 4 : 3} className="p-2 text-right font-bold text-[var(--text-primary)]">Total</td>
            <td className="p-2 text-right font-bold text-blue-600 font-mono text-sm">
              {fmtMoney(draft.subtotal_inc_vat)}
            </td>
            {variant === "room" && <td></td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
