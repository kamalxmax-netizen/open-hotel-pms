"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import { MonthlyMegaTable } from "@/components/linen/monthly-mega-table";
import { Loader2, Link2, Copy, Check } from "lucide-react";

function GenerateVendorLinkButton({ year, month }: { year: number; month: number }) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState<{ token: string; url: string; expires_at: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState("");

    const handleGenerate = async () => {
        setIsGenerating(true);
        setError("");
        try {
            const res = await fetch("/api/linen/vendor/monthly/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ year, month }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                throw new Error(payload?.error ?? "Failed to generate link");
            }
            const payload = await res.json();
            setResult(payload.data ?? payload);
        } catch (err) {
            setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = async () => {
        if (!result?.url) return;
        try {
            await navigator.clipboard.writeText(result.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* silent */ }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 font-thai">ลิงก์สรุปรายเดือนสำหรับร้าน</h3>
                    <p className="text-xs text-slate-400 mt-0.5">สร้างลิงก์เพื่อส่งให้ร้านซักรีดดูยอดประจำเดือน</p>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[#1B4038] text-white rounded-xl font-bold text-xs hover:bg-[#122b26] transition-all disabled:opacity-50"
                >
                    {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Generate Link
                </button>
            </div>

            {error && (
                <p className="text-xs text-rose-500 mt-2 font-thai">{error}</p>
            )}

            {result && (
                <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-800">
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-xs text-emerald-700 dark:text-emerald-400 truncate select-all">{result.url}</span>
                        <button onClick={handleCopy} className="shrink-0 p-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-800 transition-colors">
                            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-emerald-500" />}
                        </button>
                    </div>
                    {result.expires_at && (
                        <p className="text-[10px] text-emerald-500 mt-1">หมดอายุ: {new Date(result.expires_at).toLocaleDateString("th-TH")}</p>
                    )}
                </div>
            )}
        </div>
    );
}

export default function MonthlyMegaPage() {
    const params = useParams();
    const year = parseInt(params.year as string, 10);
    const month = parseInt(params.month as string, 10);

    if (isNaN(year) || isNaN(month)) {
        return <div className="p-8 text-center text-rose-500 font-thai font-bold">ปีหรือเดือนไม่ถูกต้อง</div>;
    }

    return (
        <div className="min-h-screen bg-[#f8fafc] dark:bg-[#0f1419] p-4 md:p-8">
            <header className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-thai">
                    Linen Mega Reconciliation Table
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-thai">
                    ประจำเดือน {month}/{year} — สรุปยอดนับคาดการณ์, ยอดส่ง, ยอดรับคืน และส่วนต่างรายวัน
                </p>
            </header>

            <div className="mb-4">
                <GenerateVendorLinkButton year={year} month={month} />
            </div>

            <MonthlyMegaTable year={year} month={month} />
        </div>
    );
}
