"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { LinenMonthlySummary, LinenMonthlyDaily, LinenMonthlyVariance } from "@/lib/types";

interface ExportButtonProps {
  summary?: LinenMonthlySummary;
  dailyData?: LinenMonthlyDaily;
  varianceData?: LinenMonthlyVariance;
}

export function ExportButton({ summary, dailyData, varianceData }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!summary || !dailyData) return;
    setIsExporting(true);

    try {
      const res = await fetch(`/api/linen/monthly/export?year=${summary.year}&month=${summary.month}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Export failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Linen_Monthly_${summary.year}-${String(summary.month).padStart(2, "0")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExporting || !summary}
      className="flex items-center gap-2 font-bold text-[#1B4038] dark:text-emerald-500 border-[#1B4038]/20 dark:border-emerald-500/20 hover:bg-[#1B4038]/5"
    >
      {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      Export Excel
    </Button>
  );
}
