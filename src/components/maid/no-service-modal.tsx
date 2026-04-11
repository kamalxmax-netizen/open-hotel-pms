import { useEffect, useState } from "react";
import { Ban, X } from "lucide-react";

export default function NoServiceModal({
  isOpen,
  roomNumber,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  isOpen: boolean;
  roomNumber: string;
  onClose: () => void;
  onSubmit: (note: string) => void;
  isSubmitting: boolean;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (isOpen) {
      setNote("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-rose-200/80 bg-[linear-gradient(180deg,#ede0e5_0%,#f1e6eb_38%,#f7eef2_100%)] shadow-[0_18px_40px_rgba(15,23,42,0.3)] dark:border-rose-500/20 dark:bg-slate-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 dark:hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.22),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.12),transparent_36%),linear-gradient(180deg,#ece1e6_0%,#f1e7eb_36%,#f6eff2_100%)]" />
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:24px_24px]" />
        </div>

        <div className="relative z-10 flex items-start justify-between border-b border-rose-200/60 bg-[linear-gradient(180deg,rgba(244,231,236,0.96),rgba(241,228,234,0.82))] px-5 py-4 backdrop-blur-xl dark:border-white/5 dark:bg-slate-950/95">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg shadow-rose-500/20">
              <Ban size={24} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                งดทำห้อง
              </p>
              <h3 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{roomNumber}</h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X size={22} />
          </button>
        </div>

        <div className="relative z-10 space-y-4 px-5 py-5">
          <div className="rounded-[24px] border border-rose-200 bg-[linear-gradient(180deg,rgba(255,241,242,0.98),rgba(255,228,230,0.84))] p-4 dark:border-rose-500/20 dark:bg-rose-500/10">
            <p className="text-sm font-black leading-relaxed text-rose-700 dark:text-rose-300">
              ลูกค้างดทำความสะอาดหรือแขวนป้ายห้ามรบกวน
            </p>
            <p className="mt-2 text-sm font-bold leading-relaxed text-rose-700/80 dark:text-rose-300/75">
              กดทำต่อเพื่อเปิดเช็กลิสต์และบันทึกของที่เติมจริง
            </p>
          </div>

          <div>
            <label className="mb-2 block text-base font-black text-slate-800 dark:text-slate-200">
              หมายเหตุ
            </label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSubmitting}
              placeholder="เช่น แขวนป้ายหน้าห้อง"
              className="h-28 w-full resize-none rounded-[24px] border border-rose-200/70 bg-[linear-gradient(180deg,rgba(251,241,245,0.96),rgba(254,242,248,0.88))] px-4 py-3 text-base font-bold text-slate-900 outline-none transition focus:border-rose-400 dark:border-white/10 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="relative z-10 flex gap-3 border-t border-rose-200/60 bg-[linear-gradient(180deg,rgba(243,230,236,0.9),rgba(238,224,231,0.82))] px-5 py-4 backdrop-blur-xl dark:border-white/5 dark:bg-slate-950/90">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded-[20px] border border-rose-200/70 bg-[linear-gradient(180deg,rgba(248,239,243,0.96),rgba(242,231,237,0.88))] px-4 py-4 text-base font-black text-slate-700 transition-colors hover:bg-rose-100/70 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onSubmit(note)}
            disabled={isSubmitting}
            className="flex flex-1 items-center justify-center rounded-[20px] bg-rose-500 px-4 py-4 text-base font-black text-white shadow-[0_10px_24px_rgba(225,29,72,0.22)] transition-colors hover:bg-rose-600 disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              "ทำต่อ"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
