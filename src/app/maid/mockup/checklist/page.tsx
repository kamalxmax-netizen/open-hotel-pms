"use client";

import { IBM_Plex_Sans_Thai } from "next/font/google";
import { Suspense, useState } from "react";
import { ArrowLeft, Check, Package, Wrench, AlertCircle, Sun, Moon, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const thaiUi = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

interface Amenity {
  id: string;
  name: string;
  count: number;
  checks: boolean[];
}

interface Maintenance {
  id: string;
  name: string;
  checked: boolean;
}

interface Loan {
  id: string;
  icon: string;
  name: string;
  quantity: number;
}

function ChecklistMockupContent() {
  const searchParams = useSearchParams();
  const roomNumber = searchParams?.get("room") || "304";
  
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [amenities, setAmenities] = useState<Amenity[]>([
    { id: "1", name: "น้ำดื่ม", count: 2, checks: [false, false] },
    { id: "2", name: "ผ้าขนหนู", count: 2, checks: [false, false] },
    { id: "3", name: "แชมพู", count: 1, checks: [false] },
    { id: "4", name: "ทิชชู่ม้วน", count: 2, checks: [false, false] },
  ]);

  const [maintenance, setMaintenance] = useState<Maintenance[]>([
    { id: "1", name: "เช็กไฟหัวเตียง", checked: false },
    { id: "2", name: "ล้างแอร์ (งานประจำ)", checked: true },
  ]);

  const [loans] = useState<Loan[]>([
    { id: "1", icon: "🧺", name: "เตารีด", quantity: 1 },
    { id: "2", icon: "🧊", name: "ถังน้ำแข็ง", quantity: 1 },
  ]);

  const toggleAmenity = (amenityId: string, index: number) => {
    setAmenities(prev => prev.map(a => {
      if (a.id === amenityId) {
        const newChecks = [...a.checks];
        newChecks[index] = !newChecks[index];
        return { ...a, checks: newChecks };
      }
      return a;
    }));
  };

  const toggleMaintenance = (id: string) => {
    setMaintenance(prev => prev.map(m => m.id === id ? { ...m, checked: !m.checked } : m));
  };

  const isAllMaintenanceDone = maintenance.every(m => m.checked);

  return (
    <div className={`${isDarkMode ? 'dark' : ''} ${thaiUi.className}`}>
      <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white pb-40 transition-colors duration-300">
        
        {/* Header */}
        <div className="bg-white dark:bg-slate-950/90 backdrop-blur-md border-b dark:border-white/5 border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm dark:shadow-none">
          <div className="flex items-center justify-between max-w-screen-md mx-auto w-full">
            <div className="flex items-center gap-4">
              <Link href="/maid/mockup" className="p-2 -ml-2 dark:text-slate-400 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                <ArrowLeft size={28} />
              </Link>
              <div>
                 <h1 className="text-2xl font-black">เช็กลิสต์ห้อง {roomNumber}</h1>
                 <p className="dark:text-slate-400 text-slate-500 text-sm font-bold">กรุณาตรวจสอบให้ครบถ้วน</p>
              </div>
            </div>
            <button 
               onClick={() => setIsDarkMode(!isDarkMode)} 
               className="p-2 rounded-full dark:bg-white/10 bg-slate-200 hover:bg-slate-300 dark:hover:bg-white/20 transition-colors text-slate-600 dark:text-white"
            >
               {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-indigo-600" />}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-8 max-w-screen-md mx-auto w-full">
          {/* Amenity Section */}
          <section className="space-y-4">
            <div className="flex justify-between items-end">
               <h2 className="text-xl font-black dark:text-slate-400 text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Package size={20} className="text-indigo-500" /> ของเติมในห้อง
               </h2>
               <p className="text-xs font-bold dark:text-slate-500 text-slate-400">ติ๊กตามจำนวนขวด/ชิ้นที่เติม</p>
            </div>
            
            <div className="space-y-3">
              {amenities.map((item) => (
                <div key={item.id} className="dark:bg-slate-900 bg-white rounded-[24px] border dark:border-white/5 border-slate-200 p-5 shadow-sm dark:shadow-none">
                  <div className="flex justify-between items-center mb-4">
                     <p className="text-xl font-black">{item.name}</p>
                     <p className="text-sm font-bold dark:text-slate-500 text-slate-400">เติม {item.checks.filter(Boolean).length} / {item.count}</p>
                  </div>
                  <div className="flex gap-3">
                    {item.checks.map((checked, idx) => (
                      <button
                        key={idx}
                        onClick={() => toggleAmenity(item.id, idx)}
                        className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all active:scale-90 ${
                          checked 
                          ? 'bg-indigo-600 border-indigo-500 shadow-lg shadow-indigo-600/30 text-white' 
                          : 'dark:bg-white/5 bg-slate-50 dark:border-white/10 border-slate-300 dark:text-slate-500 text-slate-400 hover:bg-slate-100 hover:border-slate-400'
                        }`}
                      >
                        {checked ? <Check size={28} strokeWidth={4} /> : <span className="text-xl font-black">{idx + 1}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Loan Section */}
          {loans.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
                 <AlertCircle size={20} /> ของที่ต้องเก็บคืน
              </h2>
              <div className="space-y-2">
                {loans.map(loan => (
                  <div key={loan.id} className="dark:bg-amber-500/10 bg-amber-50 border dark:border-amber-500/20 border-amber-200 rounded-[24px] p-4 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <span className="text-3xl">{loan.icon}</span>
                        <p className="font-black text-lg dark:text-amber-500 text-amber-700">{loan.name}</p>
                     </div>
                     <p className="font-black dark:text-amber-500 text-amber-700 text-lg">จำนวน {loan.quantity}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm font-bold dark:text-amber-500/60 text-amber-600/70">* จบงานแล้วระบบจะบันทึกการส่งคืนอัตโนมัติ</p>
            </section>
          )}

          {/* Maintenance Section */}
          {maintenance.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-black text-sky-500 uppercase tracking-widest flex items-center gap-2">
                 <Wrench size={20} /> งานซ่อมบำรุง
              </h2>
              <div className="space-y-3">
                {maintenance.map(m => (
                  <button
                    key={m.id}
                    onClick={() => toggleMaintenance(m.id)}
                    className={`w-full p-5 rounded-[24px] border-2 transition-all flex items-center justify-between text-left ${
                      m.checked 
                      ? 'dark:bg-sky-600/20 bg-sky-50 border-sky-400 dark:text-sky-400 text-sky-700' 
                      : 'dark:bg-slate-900 bg-white dark:border-white/5 border-slate-200 dark:text-slate-300 text-slate-600'
                    }`}
                  >
                     <span className="text-lg font-black">{m.name}</span>
                     <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${m.checked ? 'bg-sky-500 border-sky-500 text-slate-100' : 'dark:border-white/10 border-slate-300'}`}>
                        {m.checked && <Check size={20} strokeWidth={4} />}
                     </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer Actions */}
        <div className="fixed inset-x-0 bottom-0 dark:bg-slate-950/80 bg-white/80 backdrop-blur-xl border-t dark:border-white/10 border-slate-200 p-5 z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
           <div className="max-w-screen-md mx-auto w-full flex flex-col sm:flex-row gap-3">
             <button 
               className={`flex-1 h-[64px] rounded-[20px] font-black text-xl flex items-center justify-center gap-2 transition-all shadow-xl border-transparent ${
                 isAllMaintenanceDone 
                 ? 'bg-emerald-600 hover:bg-emerald-700 text-white dark:shadow-[0_4px_16px_rgba(5,150,105,0.3)] shadow-[0_4px_16px_rgba(5,150,105,0.2)]' 
                 : 'dark:bg-slate-800 bg-slate-200 dark:text-slate-500 text-slate-400 cursor-not-allowed opacity-60'
               }`}
             >
               {isAllMaintenanceDone ? (
                 <>✅ ยืนยันเสร็จงาน</>
               ) : (
                 <>⚠️ ทำงานซ่อมให้ครบก่อน</>
               )}
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistMockupPage() {
  return (
    <Suspense
      fallback={
        <div className={`${thaiUi.className} flex min-h-screen items-center justify-center bg-slate-950 text-white`}>
          <p className="text-lg font-black">กำลังโหลดเช็กลิสต์...</p>
        </div>
      }
    >
      <ChecklistMockupContent />
    </Suspense>
  );
}
