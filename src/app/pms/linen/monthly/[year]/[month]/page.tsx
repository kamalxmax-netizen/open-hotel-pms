"use client";

import React from "react";
import { useParams } from "next/navigation";
import { MonthlyMegaTable } from "@/components/linen/monthly-mega-table";

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

            <MonthlyMegaTable year={year} month={month} />
        </div>
    );
}
