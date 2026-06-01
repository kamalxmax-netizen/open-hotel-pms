"use client";

import React, { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { MonthlyMegaTable } from "@/components/linen/monthly-mega-table";
import { GenerateVendorLinkButton } from "../../_components/GenerateVendorLinkButton";
import { MonthPicker } from "../../_components/MonthPicker";

export default function MonthlyMegaPage() {
    const params = useParams();
    const router = useRouter();
    const year = parseInt(params.year as string, 10);
    const month = parseInt(params.month as string, 10);
    const selectedDate = useMemo(() => new Date(year, month - 1, 1, 12, 0, 0), [year, month]);

    if (isNaN(year) || isNaN(month)) {
        return <div className="p-8 text-center text-rose-500 font-thai font-bold">ปีหรือเดือนไม่ถูกต้อง</div>;
    }

    const handleMonthChange = (date: Date) => {
        router.push(`/pms/linen/monthly/${date.getFullYear()}/${date.getMonth() + 1}`);
    };

    return (
        <div className="min-h-screen bg-[#f8fafc] dark:bg-[#0f1419] p-4 md:p-8">
            <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 font-thai">
                        Linen Mega Reconciliation Table
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-thai">
                        ประจำเดือน {month}/{year} — สรุปยอดนับคาดการณ์, ยอดส่ง, ยอดรับคืน และส่วนต่างรายวัน
                    </p>
                </div>
                <MonthPicker currentDate={selectedDate} onChange={handleMonthChange} />
            </header>

            <div className="mb-4">
                <GenerateVendorLinkButton year={year} month={month} />
            </div>

            <MonthlyMegaTable year={year} month={month} />
        </div>
    );
}
