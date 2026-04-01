"use client";

function channelBadgeClass(channel: string | null) {
  if (channel === "booking_folio") return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";
  if (channel === "mobile_checkin") return "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300";
  if (channel === "pos") return "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300";
}

function statusBadgeClass(status: string | null, matchStatus?: string | null) {
  if (matchStatus === "matched") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
  if (matchStatus === "unmatched") return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  if (matchStatus === "ignored") return "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300";
  if (status === "failed") return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
  if (status === "cancelled") return "bg-zinc-100 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300";
}

function formatDateTimeCell(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatAmount(amount: number) {
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ScbTransferTableRow = {
  id: string;
  kind: "transaction" | "request" | "recheck";
  transaction_id: string | null;
  amount: number;
  payer_name: string | null;
  target_code: string | null;
  channel: string | null;
  status: string | null;
  match_status: string | null;
  paid_at: string | null;
  created_at: string;
};

type Props = {
  tab: "matched" | "unmatched" | "expired_failed" | "recheck_history";
  role: string | null;
  rows: ScbTransferTableRow[];
  onDetail: (row: ScbTransferTableRow) => void;
  onAssign: (row: ScbTransferTableRow) => void;
  onIgnore: (row: ScbTransferTableRow) => void;
  onRecheck: (row: ScbTransferTableRow) => void;
};

export function ScbTransferTable({ tab, role, rows, onDetail, onAssign, onIgnore, onRecheck }: Props) {
  const readOnly = role === "supervisor";

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm">
      <table className="data-table table-fixed min-w-[1080px] w-full">
        <thead>
          <tr>
            <th className="w-[90px]">เวลา</th>
            <th className="w-[160px]">TXN ID</th>
            <th className="w-[110px] text-right">ยอด</th>
            <th className="w-[160px]">ผู้โอน</th>
            <th className="w-[160px]">Target</th>
            <th className="w-[120px]">ช่องทาง</th>
            <th className="w-[120px]">สถานะ</th>
            <th className="w-[180px]">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-10 text-center text-sm text-[var(--text-muted)]">
                No records found.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.id}`} className="hover:bg-[var(--bg-surface-hover)]">
              <td>{formatDateTimeCell(row.paid_at || row.created_at)}</td>
              <td>
                <button
                  className="max-w-[140px] truncate text-left font-mono text-xs text-[var(--text-primary)] hover:underline"
                  onClick={() => navigator.clipboard.writeText(row.transaction_id || row.id)}
                  title="Copy ID"
                >
                  {row.transaction_id || row.id}
                </button>
              </td>
              <td className="text-right font-mono font-semibold">฿{formatAmount(Number(row.amount ?? 0))}</td>
              <td className="truncate">{row.payer_name || "—"}</td>
              <td className="truncate">{row.target_code || "—"}</td>
              <td>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${channelBadgeClass(row.channel)}`}>
                  {row.channel === "booking_folio" ? "booking" : row.channel === "mobile_checkin" ? "mobile" : row.channel || "—"}
                </span>
              </td>
              <td>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusBadgeClass(row.status, row.match_status)}`}>
                  {row.match_status || row.status || "—"}
                </span>
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {tab === "matched" && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onDetail(row)}>Detail</button>
                  )}
                  {tab === "unmatched" && (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={readOnly}
                        title={readOnly ? "ต้องใช้สิทธิ์ Admin" : undefined}
                        onClick={() => onAssign(row)}
                      >
                        Assign
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={readOnly}
                        title={readOnly ? "ต้องใช้สิทธิ์ Admin" : undefined}
                        onClick={() => onIgnore(row)}
                      >
                        Ignore
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onDetail(row)}>Detail</button>
                    </>
                  )}
                  {tab === "expired_failed" && (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={readOnly}
                        title={readOnly ? "ต้องใช้สิทธิ์ Admin" : undefined}
                        onClick={() => onRecheck(row)}
                      >
                        Recheck
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onDetail(row)}>Detail</button>
                    </>
                  )}
                  {tab === "recheck_history" && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onDetail(row)}>Detail</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
