"use client";

import React, { useState } from "react";
import useSWR from "@/hooks/use-simple-swr";
import { LinenVarianceConfig } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";
import { Loader2, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const ENABLE_REAL_API = true;

export function LinenVarianceSettings() {
  const url = "/api/linen/variance-config";
  const { data: config, isLoading, mutate } = useSWR<LinenVarianceConfig>(
    ENABLE_REAL_API ? url : null,
    apiDataFetcher
  );

  const [localConfig, setLocalConfig] = useState<LinenVarianceConfig>({
    id: 1,
    green_min: 90,
    green_max: 110,
    yellow_min: 70,
    yellow_max: 130,
    updated_at: new Date().toISOString(),
    updated_by: null,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  React.useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          green_min: localConfig.green_min,
          green_max: localConfig.green_max,
          yellow_min: localConfig.yellow_min,
          yellow_max: localConfig.yellow_max,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error ?? "Failed to save variance config");
      }
      if (payload?.config) setLocalConfig(payload.config);
      await mutate();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section id="variance-thresholds" className="scroll-mt-8 space-y-6">
      <div>
        <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">Variance Thresholds</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">กำหนดเกณฑ์การวัดผลส่วนต่าง (Actual vs Expected) เพื่อแสดงสีสถานะ</p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-20 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Loader2 className="animate-spin" size={32} />
            <p className="font-bold text-xs uppercase tracking-widest">กำลังโหลดค่าคอนฟิก...</p>
          </div>
        ) : (
          <div className="p-6 space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Normal Zone (Green)</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Minimum %</label>
                  <input
                    type="number"
                    value={localConfig.green_min}
                    onChange={(e) => setLocalConfig({ ...localConfig, green_min: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-0 rounded-xl p-3 font-black text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Maximum %</label>
                  <input
                    type="number"
                    value={localConfig.green_max}
                    onChange={(e) => setLocalConfig({ ...localConfig, green_max: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-0 rounded-xl p-3 font-black text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Warning Zone (Yellow)</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Minimum %</label>
                  <input
                    type="number"
                    value={localConfig.yellow_min}
                    onChange={(e) => setLocalConfig({ ...localConfig, yellow_min: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-0 rounded-xl p-3 font-black text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Maximum %</label>
                  <input
                    type="number"
                    value={localConfig.yellow_max}
                    onChange={(e) => setLocalConfig({ ...localConfig, yellow_max: parseInt(e.target.value) || 0 })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-0 rounded-xl p-3 font-black text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 italic">
                * ช่วงที่เป็น Warning คือค่าที่อยู่นอกเขต Green แต่อยู่ภายในเขต Yellow (เช่น 70-90% และ 110-130%)
              </p>
            </div>

            <div className="bg-rose-50 dark:bg-rose-950/20 rounded-xl p-4 border border-rose-100 dark:border-rose-900/50 flex items-start gap-4">
              <AlertTriangle className="text-rose-500 shrink-0 mt-1" size={20} />
              <div>
                <p className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-tight mb-1">Review Zone (Red)</p>
                <p className="text-xs text-rose-600 dark:text-rose-500 opacity-80 leading-relaxed">
                  ค่าใดๆ ที่ต่ำกว่า {localConfig.yellow_min}% หรือสูงกว่า {localConfig.yellow_max}% จะถูกจัดอยู่ในกลุ่ม Review (Red) โดยอัตโนมัติ ซึ่งต้องการการตรวจสอบสาเหตุเชิงลึก
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-4">
          {showSuccess && (
            <span className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
              <CheckCircle2 size={16} />
              บันทึกเรียบร้อย
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="min-w-[140px] bg-[#1B4038] hover:bg-[#122b26] text-white flex items-center gap-2 font-bold shadow-lg shadow-[#1B4038]/20"
          >
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            บันทึกการตั้งค่า
          </Button>
        </div>
      </div>
    </section>
  );
}
