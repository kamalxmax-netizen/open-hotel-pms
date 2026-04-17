"use client";

import React from "react";
import Link from "next/link";
import { History, BarChart3, Settings, ClipboardList, Smartphone } from "lucide-react";

export function LinenQuickLinks() {
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const links = [
        {
            title: "ประวัติการส่งซัก",
            href: "/pms/linen/history",
            icon: History,
            subtitle: "Management",
            color: "text-blue-600 dark:text-blue-400",
            bg: "bg-blue-50 dark:bg-blue-500/10",
            border: "border-blue-100 dark:border-blue-500/20"
        },
        {
            title: "สรุปรายเดือน",
            href: `/pms/linen/monthly/${currentYear}/${currentMonth}`,
            icon: BarChart3,
            subtitle: "Management",
            color: "text-emerald-600 dark:text-emerald-400",
            bg: "bg-emerald-50 dark:bg-emerald-500/10",
            border: "border-emerald-100 dark:border-emerald-500/20"
        },
        {
            title: "Linen App",
            href: "/linen-mobile",
            icon: Smartphone,
            subtitle: "Operation",
            color: "text-cyan-600 dark:text-cyan-400",
            bg: "bg-cyan-50 dark:bg-cyan-500/10",
            border: "border-cyan-100 dark:border-cyan-500/20"
        },
        {
            title: "Linen Setting",
            href: "/pms/linen/settings",
            icon: Settings,
            subtitle: "Management",
            color: "text-slate-600 dark:text-slate-400",
            bg: "bg-slate-50 dark:bg-slate-500/10",
            border: "border-slate-100 dark:border-slate-500/20"
        },
        {
            title: "รายการแก้ไข (Audit)",
            href: "/pms/linen/history?has_edits=1",
            icon: ClipboardList,
            subtitle: "Management",
            color: "text-purple-600 dark:text-purple-400",
            bg: "bg-purple-50 dark:bg-purple-500/10",
            border: "border-purple-100 dark:border-purple-500/20"
        }
    ];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
            {links.map((link) => (
                <Link
                    key={link.title}
                    href={link.href}
                    className={`card p-4 flex items-center gap-3 hover:bg-white dark:hover:bg-slate-800 hover:shadow-md transition-all group border ${link.border}`}
                >
                    <div className={`w-10 h-10 rounded-xl ${link.bg} flex items-center justify-center ${link.color} group-hover:scale-110 transition-transform`}>
                        <link.icon className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 font-thai">{link.title}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-500 uppercase tracking-wider font-bold">{link.subtitle}</p>
                    </div>
                </Link>
            ))}
        </div>
    );
}
