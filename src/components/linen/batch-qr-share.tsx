"use client";

import React, { useState, useEffect } from "react";
import QRCode from "react-qr-code";

interface BatchQrShareProps {
  token: string;
  summaryText?: string;
  monthlyLink?: string;
}

export function BatchQrShare({ token, summaryText, monthlyLink }: BatchQrShareProps) {
  const [copied, setCopied] = useState(false);
  const [monthlyCopied, setMonthlyCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
        setOrigin(window.location.origin);
    }
  }, []);

  const vendorLink = origin ? `${origin}/linen-vendor/${token}` : `https://pms.example.com/linen-vendor/${token}`;

  const handleCopy = async () => {
    try {
      const fullContent = summaryText 
        ? `${summaryText}\n\nเปิดดูรายละเอียด/ยืนยันได้ที่: ${vendorLink}` 
        : vendorLink;
        
      await navigator.clipboard.writeText(fullContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleCopyMonthly = async () => {
    if (!monthlyLink) return;
    try {
      await navigator.clipboard.writeText(monthlyLink);
      setMonthlyCopied(true);
      setTimeout(() => setMonthlyCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy monthly link", err);
    }
  };

  if (!origin) return null; // Avoid render mismatch during SSR

  return (
    <div className="flex flex-col items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm text-center">
      <div className="text-emerald-600 dark:text-emerald-400 mb-2">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-12 h-12 mx-auto">
            <polyline points="20 6 9 17 4 12" />
         </svg>
      </div>
      <div>
         <h3 className="font-semibold text-lg text-slate-800 dark:text-slate-100">เสร็จสิ้นกระบวนการรับ-ส่งผ้า</h3>
         <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            โปรดส่งลิงก์ด้านล่าง หรือให้ร้านซักรีดสแกน QR Code เพื่อให้ทางร้านเปิดดูรายละเอียดและยืนยัน
         </p>
      </div>

      <div className="bg-white p-4 rounded-xl border-2 border-slate-100 dark:border-slate-800 mt-2 inline-block shadow-sm">
        <QRCode value={vendorLink} size={180} />
      </div>

      <div className="w-full mt-2">
        <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm mb-3 border border-slate-100 dark:border-slate-800">
           <span className="truncate flex-1 text-slate-600 dark:text-slate-400 text-left select-all">{vendorLink}</span>
        </div>
        <button 
           onClick={handleCopy}
           className="w-full bg-[#1B4038] hover:bg-[#122b26] text-white font-medium p-3 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {copied ? (
            <>
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12" /></svg>
               คัดลอกสำเร็จแล้ว
            </>
          ) : (
            <>
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
               คัดลอกลิงก์ส่งให้ร้าน
            </>
          )}
        </button>
      </div>

      {monthlyLink && (
        <div className="w-full border-t border-slate-100 dark:border-slate-800 pt-4 mt-2">
          <div className="flex items-center gap-2 mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-emerald-600">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-thai">สรุปรายเดือน (สำหรับร้าน)</span>
          </div>
          <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-sm mb-2 border border-emerald-100 dark:border-emerald-800">
            <span className="truncate flex-1 text-emerald-700 dark:text-emerald-400 text-left select-all text-xs">{monthlyLink}</span>
          </div>
          <button
            onClick={handleCopyMonthly}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium p-3 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
          >
            {monthlyCopied ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12" /></svg>
                คัดลอกสำเร็จแล้ว
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                คัดลอกลิงก์สรุปรายเดือน
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
