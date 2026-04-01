"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TargetType = "reservation" | "pos_order";

type SearchRow = {
  target_id: string;
  target_code: string;
  guest_name: string | null;
  outstanding_amount?: number;
  total_amount?: number;
  has_pending_request: boolean;
};

type Props = {
  open: boolean;
  role: string | null;
  transaction: {
    id: string;
    transaction_id: string | null;
    amount: number;
    payer_name: string | null;
  } | null;
  onClose: () => void;
  onResolved: () => void;
};

export function ScbUnmatchedResolveModal({ open, role, transaction, onClose, onResolved }: Props) {
  const readOnly = role === "supervisor";
  const [targetType, setTargetType] = useState<TargetType>("reservation");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [roomAmount, setRoomAmount] = useState("0");
  const [depositAmount, setDepositAmount] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !transaction) return;
    setTargetType("reservation");
    setQuery(transaction.payer_name || "");
    setSelected(null);
    setResults([]);
    setRoomAmount(String(Number(transaction.amount ?? 0)));
    setDepositAmount("0");
    setNote("");
    setError("");
  }, [open, transaction]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/integrations/scb/inbox/search-targets?type=${targetType}&q=${encodeURIComponent(query.trim())}`);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "Failed to search targets.");
        }
        setResults(json.rows ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to search targets.");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query, targetType]);

  const total = useMemo(() => Number(roomAmount || 0) + Number(depositAmount || 0), [roomAmount, depositAmount]);
  const exactMatch = Math.abs(total - Number(transaction?.amount ?? 0)) <= 0.009;

  const chooseTarget = (row: SearchRow) => {
    setSelected(row);
    if (targetType === "reservation") {
      const outstanding = Number(row.outstanding_amount ?? 0);
      const txAmount = Number(transaction?.amount ?? 0);
      const defaultRoom = Math.min(outstanding, txAmount);
      const defaultDeposit = Math.max(0, txAmount - defaultRoom);
      setRoomAmount(String(defaultRoom));
      setDepositAmount(String(defaultDeposit));
    } else {
      setRoomAmount(String(Number(transaction?.amount ?? 0)));
      setDepositAmount("0");
    }
  };

  const handleSubmit = async () => {
    if (!transaction || !selected) return;
    if (!exactMatch) {
      setError("ยอดไม่ตรง — ไม่สามารถจับคู่ได้");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/integrations/scb/inbox/${transaction.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: selected.target_id,
          room_amount: Number(roomAmount || 0),
          deposit_amount: Number(depositAmount || 0),
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to assign transaction.");
      }
      onResolved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign transaction.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>จับคู่รายการโอน</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-muted)] px-4 py-3 text-sm">
            ยอดโอน: <span className="font-semibold">฿{Number(transaction?.amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {" · "}
            ผู้โอน: <span className="font-semibold">{transaction?.payer_name || "—"}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              className={`rounded-xl border px-4 py-3 text-sm font-semibold ${targetType === "reservation" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-[var(--border-default)]"}`}
              onClick={() => setTargetType("reservation")}
              disabled={readOnly}
            >
              Booking
            </button>
            <button
              className={`rounded-xl border px-4 py-3 text-sm font-semibold ${targetType === "pos_order" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-[var(--border-default)]"}`}
              onClick={() => setTargetType("pos_order")}
              disabled={readOnly}
            >
              POS Order
            </button>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">ค้นหา</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="form-input h-11 w-full pl-10"
                placeholder={targetType === "reservation" ? "R-0412 / ชื่อแขก" : "POS order / ชื่อลูกค้า"}
                disabled={readOnly}
              />
            </div>
          </label>

          <div className="rounded-xl border border-[var(--border-default)]">
            {loading && (
              <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-4 py-6 text-sm text-[var(--text-muted)]">No results</div>
            )}
            {!loading && results.map((row) => {
              const amount = Number(row.outstanding_amount ?? 0);
              const highlight = Math.abs(amount - Number(transaction?.amount ?? 0)) <= 0.009;
              const checked = selected?.target_id === row.target_id;
              return (
                <label
                  key={row.target_id}
                  className={`flex cursor-pointer items-start gap-3 border-b border-[var(--border-default)] px-4 py-3 last:border-b-0 ${checked ? "bg-brand-50" : ""}`}
                >
                  <input
                    type="radio"
                    checked={checked}
                    onChange={() => chooseTarget(row)}
                    disabled={readOnly}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{row.target_code}</span>
                      {highlight && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Exact match</span>}
                      {row.has_pending_request && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending QR</span>}
                    </div>
                    <div className="truncate text-sm text-[var(--text-secondary)]">{row.guest_name || "—"}</div>
                  </div>
                  <div className="text-sm font-semibold">฿{amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </label>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">ค่าห้อง</span>
              <input
                type="number"
                min="0"
                value={roomAmount}
                onChange={(e) => setRoomAmount(e.target.value)}
                className="form-input h-11 w-full"
                disabled={readOnly}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">มัดจำ</span>
              <input
                type="number"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="form-input h-11 w-full"
                disabled={readOnly || targetType === "pos_order"}
              />
            </label>
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm ${exactMatch ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            รวม: ฿{total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            {" · "}
            {exactMatch ? "ตรงกับยอดโอน" : "ยอดไม่ตรง — ไม่สามารถจับคู่ได้"}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-black uppercase tracking-widest text-[var(--text-muted)]">หมายเหตุ</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="form-textarea min-h-[90px] w-full"
              placeholder="Manual match by FO"
              disabled={readOnly}
            />
          </label>

          {selected?.has_pending_request && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Booking นี้มี QR request อยู่แล้ว
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn btn-primary"
            disabled={readOnly || !selected || !exactMatch || saving}
            title={readOnly ? "ต้องใช้สิทธิ์ Admin" : undefined}
            onClick={handleSubmit}
          >
            {saving ? "กำลังบันทึก..." : "ยืนยันจับคู่"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
