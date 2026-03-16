"use client";

import { useState } from "react";

const CHAPTERS = [
    {
        id: "chapter1",
        src: "/manual-chapter1.html",
        num: "01",
        title: "ทำความรู้จักโปรแกรม",
        desc: "ภาพรวม PMS, การล็อกอิน, และเมนูต่างๆ",
        icon: "🖥️",
        color: "blue",
    },
    {
        id: "chapter2",
        src: "/manual-chapter2.html",
        num: "02",
        title: "การจอง → เช็คอิน → เช็คเอาท์",
        desc: "ขั้นตอนงาน Front Desk ตั้งแต่ต้นจนจบ",
        icon: "🏨",
        color: "green",
    },
    {
        id: "chapter3",
        src: "/manual-chapter3.html",
        num: "03",
        title: "งานแม่บ้าน (Housekeeping)",
        desc: "การรับงาน, อัพเดทสถานะห้อง, Extra Tasks",
        icon: "🧹",
        color: "purple",
    },
    {
        id: "chapter4",
        src: "/manual-chapter4.html",
        num: "04",
        title: "การชำระเงินและ Folio",
        desc: "การรับชำระ, แก้ไข Folio, ออกใบเสร็จ",
        icon: "💳",
        color: "amber",
    },
] as const;

type ColorKey = "blue" | "green" | "purple" | "amber";

const COLOR_STYLES: Record<ColorKey, { card: string; badge: string; btn: string }> = {
    blue: {
        card: "border-blue-200 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600",
        badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
        btn: "bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600",
    },
    green: {
        card: "border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 dark:hover:border-emerald-600",
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
        btn: "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600",
    },
    purple: {
        card: "border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600",
        badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
        btn: "bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600",
    },
    amber: {
        card: "border-amber-200 dark:border-amber-800 hover:border-amber-400 dark:hover:border-amber-600",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
        btn: "bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600",
    },
};

export default function TrainingPage() {
    const [activeChapter, setActiveChapter] = useState<(typeof CHAPTERS)[number] | null>(null);

    if (activeChapter) {
        return (
            <div className="flex flex-col h-full">
                {/* Viewer header */}
                <div
                    className="flex items-center gap-3 px-4 py-2.5 border-b"
                    style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
                >
                    <button
                        onClick={() => setActiveChapter(null)}
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
                        style={{ color: "var(--text-muted)", background: "var(--bg-surface-hover)" }}
                    >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                        กลับ
                    </button>
                    <span className="text-lg">{activeChapter.icon}</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                            หมวด {activeChapter.num} — {activeChapter.title}
                        </p>
                    </div>
                    {/* Chapter nav pills */}
                    <div className="hidden sm:flex items-center gap-1">
                        {CHAPTERS.map((ch) => (
                            <button
                                key={ch.id}
                                onClick={() => setActiveChapter(ch)}
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                                    ch.id === activeChapter.id
                                        ? "bg-[var(--brand)] text-white"
                                        : "hover:bg-[var(--bg-surface-hover)]"
                                }`}
                                style={ch.id !== activeChapter.id ? { color: "var(--text-muted)" } : {}}
                            >
                                {ch.num}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Iframe */}
                <iframe
                    src={activeChapter.src}
                    className="flex-1 w-full border-0"
                    title={`Training Chapter ${activeChapter.num}`}
                />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--brand)" }}>
                    ADMIN
                </p>
                <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                    Training
                </h1>
                <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    คู่มือการใช้งานระบบ Hotel PMS สำหรับพนักงาน — {CHAPTERS.length} หมวด
                </p>
            </div>

            {/* Progress indicator */}
            <div
                className="rounded-xl border p-4 mb-6 flex items-center gap-4"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
            >
                <div className="flex items-center gap-2">
                    {CHAPTERS.map((ch, i) => (
                        <div key={ch.id} className="flex items-center gap-2">
                            <div className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-[var(--brand)] text-white">
                                {ch.num}
                            </div>
                            {i < CHAPTERS.length - 1 && (
                                <div className="w-6 h-px" style={{ background: "var(--border-default)" }} />
                            )}
                        </div>
                    ))}
                </div>
                <p className="text-sm ml-2" style={{ color: "var(--text-muted)" }}>
                    เลือก หมวดที่ต้องการอ่านได้เลย
                </p>
            </div>

            {/* Chapter cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {CHAPTERS.map((ch) => {
                    const styles = COLOR_STYLES[ch.color];
                    return (
                        <button
                            key={ch.id}
                            onClick={() => setActiveChapter(ch)}
                            className={`group relative text-left rounded-2xl border-2 p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${styles.card}`}
                            style={{ background: "var(--bg-surface)" }}
                        >
                            <div className="flex items-start gap-4">
                                <div className="text-3xl leading-none mt-0.5">{ch.icon}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${styles.badge}`}>
                                            หมวด {ch.num}
                                        </span>
                                    </div>
                                    <h3 className="font-bold text-base leading-snug mb-1" style={{ color: "var(--text-primary)" }}>
                                        {ch.title}
                                    </h3>
                                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                                        {ch.desc}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <span className={`text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors ${styles.btn}`}>
                                    เปิดอ่าน →
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Footer note */}
            <p className="text-xs text-center mt-8" style={{ color: "var(--text-muted)" }}>
                คู่มือนี้ใช้ภายในโรงแรมเท่านั้น • OpenHotel PMS
            </p>
        </div>
    );
}
