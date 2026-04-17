import Link from "next/link";
import { LinenRatesSettings } from "./_components/LinenRatesSettings";
import { LinenVarianceSettings } from "./_components/LinenVarianceSettings";

export default function LinenSettingsPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-20 space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Linen Setting</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">ตั้งค่าราคา Vendor และเกณฑ์ Variance สำหรับ Linen & Laundry</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="#vendor-rates" className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-[#1B4038] dark:hover:text-emerald-400 transition-colors">
            Vendor Rates
          </Link>
          <Link href="#variance-thresholds" className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-[#1B4038] dark:hover:text-emerald-400 transition-colors">
            Variance
          </Link>
        </div>
      </div>

      <LinenRatesSettings />
      <LinenVarianceSettings />
    </div>
  );
}
