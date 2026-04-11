import { ClipboardList } from "lucide-react";

export default function EmptyState({ message = "ไม่มีรายการในหมวดนี้" }: { message?: string }) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/5 dark:bg-slate-900">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
        <ClipboardList size={32} />
      </div>
      <h3 className="text-xl font-black text-slate-900 dark:text-white">ไม่มีรายการ</h3>
      <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}
