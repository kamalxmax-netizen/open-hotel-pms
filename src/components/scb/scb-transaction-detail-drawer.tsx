"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { copyToClipboardWithHistory } from "@/lib/copy-board";

type DrawerItem = {
  id: string;
  kind: "transaction" | "request" | "recheck";
};

type Props = {
  item: DrawerItem | null;
  onClose: () => void;
  onRefresh?: () => void;
};

export function ScbTransactionDetailDrawer({ item, onClose, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const requestId = useMemo(() => {
    if (!detail) return null;
    if (detail.request?.id) return detail.request.id as string;
    if (detail.request_id) return detail.request_id as string;
    return null;
  }, [detail]);

  useEffect(() => {
    if (!item) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/integrations/scb/inbox/${item.id}?kind=${item.kind}&_ts=${Date.now()}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to load transaction detail.");
        }
        if (active) setDetail(json.detail);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load transaction detail.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [item]);

  if (!item) return null;

  const handleRecheck = async () => {
    if (!requestId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/scb/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ request_id: requestId, source: "manual" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to recheck transaction.");
      }
      onRefresh?.();
      const refresh = await fetch(`/api/integrations/scb/inbox/${item.id}?kind=${item.kind}&_ts=${Date.now()}`, {
        cache: "no-store",
      });
      const refreshJson = await refresh.json().catch(() => null);
      if (refresh.ok && refreshJson?.success) {
        setDetail(refreshJson.detail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recheck transaction.");
    } finally {
      setLoading(false);
    }
  };

  const headerTitle = item.kind === "recheck" ? "Recheck Detail" : "Transaction Detail";

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer-panel" style={{ maxWidth: 480 }}>
        <div className="drawer-header">
          <div>
            <h3 className="text-xl font-bold text-[var(--text-primary)]">{headerTitle}</h3>
            <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">SCB Transfer Audit</p>
          </div>
          <button type="button" className="rounded-full p-2 hover:bg-[var(--bg-surface-hover)]" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="drawer-body space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">
              {error}
            </div>
          )}
          {!loading && !error && detail && (
            <>
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">ข้อมูล SCB</h4>
                <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                  <span>TXN ID</span>
                  <button
                    className="text-left font-mono hover:underline"
                    onClick={() => {
                      void copyToClipboardWithHistory(
                        detail.transaction?.transaction_id || detail.request?.partner_reference_no || detail.id || "",
                        { sourceLabel: "SCB Detail Ref" }
                      );
                    }}
                  >
                    {detail.transaction?.transaction_id || detail.request?.partner_reference_no || "—"}
                  </button>
                  <span>ยอด</span>
                  <span>฿{Number(detail.transaction?.amount ?? detail.request?.request_amount_total ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span>ผู้โอน</span>
                  <span>{detail.transaction?.payer_name || "—"}</span>
                  <span>บัญชี</span>
                  <span>{detail.transaction?.payer_account || "—"}</span>
                  <span>เวลาโอน</span>
                  <span>{detail.transaction?.paid_at ? new Date(detail.transaction.paid_at).toLocaleString("en-GB") : "—"}</span>
                  <span>สถานะ SCB</span>
                  <span>{detail.transaction?.status || detail.request?.status || "—"}</span>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">การจับคู่</h4>
                <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                  <span>สถานะ</span>
                  <span>{detail.transaction?.match_status || detail.request?.status || "—"}</span>
                  <span>Target</span>
                  <span>{detail.target?.code || "—"}</span>
                  <span>ช่องทาง</span>
                  <span>{detail.request?.channel || "—"}</span>
                  <span>Request ID</span>
                  <span className="font-mono text-xs">{detail.request?.partner_reference_no || detail.request?.id || "—"}</span>
                  <span>Error</span>
                  <span className="break-words text-rose-600 dark:text-rose-400">
                    {detail.transaction?.error_message || detail.request?.error_message || "—"}
                  </span>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">การ Post</h4>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-muted)] p-3 text-sm">
                  <div className="flex justify-between py-1"><span>Room Payment</span><span>฿{Number(detail.posting?.room_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between py-1"><span>Deposit</span><span>฿{Number(detail.posting?.deposit_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="mt-2 flex justify-between border-t border-[var(--border-default)] pt-2 font-semibold">
                    <span>Total</span>
                    <span>฿{Number(detail.posting?.total_amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Callback History</h4>
                <div className="space-y-2 text-sm">
                  {(detail.callback_history ?? []).map((entry: any, index: number) => (
                    <div key={`${entry.source}-${index}`} className="flex items-center justify-between rounded-lg border border-[var(--border-default)] px-3 py-2">
                      <span>{entry.source}</span>
                      <span>{entry.status}</span>
                      <span className="text-[var(--text-muted)]">{new Date(entry.created_at).toLocaleString("en-GB")}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Raw Payload</h4>
                <details className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-muted)]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Show raw payload</summary>
                  <pre className="max-h-[200px] overflow-auto p-3 text-xs">{JSON.stringify(detail.raw_payload ?? {}, null, 2)}</pre>
                </details>
              </section>
            </>
          )}
        </div>
        <div className="drawer-footer justify-between">
          <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={handleRecheck} disabled={!requestId || loading}>
            <RefreshCw className="h-4 w-4" /> Recheck
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </>
  );
}
