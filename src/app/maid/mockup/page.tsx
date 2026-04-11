"use client";

import { IBM_Plex_Sans_Thai } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { Check, Pause, Play, Wrench, Package, AlertCircle, Clock as ClockIcon, Sun, Moon, Search, X, Camera, Info, Sparkles, ClipboardList } from "lucide-react";
import Link from "next/link";

const thaiUi = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

type RoomStatus = "dirty" | "in_progress" | "paused" | "no_service" | "done";

interface RoomItem {
  id: string;
  room_number: string;
  guest_name: string;
  status: RoomStatus;
  started_at?: number;
  accumulated_ms: number;
  target_ms: number;
  has_loan: boolean;
  has_maintenance: boolean;
  note?: string;
}

interface ExtraTaskItem {
  id: string;
  task_name: string;
  location: string;
  status: RoomStatus;
  started_at?: number;
  accumulated_ms: number;
  target_ms: number;
  priority: number;
  note?: string;
}

export default function MaidMockupPage() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  
  // LF Report Sheet State
  const [isLfModalOpen, setIsLfModalOpen] = useState(false);
  const [lfRoomId, setLfRoomId] = useState("");
  const [lfDescription, setLfDescription] = useState("");
  const [lfCategory, setLfCategory] = useState("general");
  const [lfLocation, setLfLocation] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rooms, setRooms] = useState<RoomItem[]>([
    {
      id: "1",
      room_number: "304",
      guest_name: "คุณวรรณวิสา พ.",
      status: "dirty",
      accumulated_ms: 0,
      target_ms: 45 * 60000,
      has_loan: true,
      has_maintenance: false,
      note: "ขอผ้าขนหนูเพิ่ม",
    },
    {
      id: "2",
      room_number: "305",
      guest_name: "คุณศิริวัฒน์ น.",
      status: "in_progress",
      started_at: Date.now() - 300000,
      accumulated_ms: 300000,
      target_ms: 30 * 60000,
      has_loan: false,
      has_maintenance: true,
    },
    {
      id: "3",
      room_number: "401",
      guest_name: "คุณณรงค์ชัย ส.",
      status: "paused",
      accumulated_ms: 1200000,
      target_ms: 40 * 60000,
      has_loan: true,
      has_maintenance: true,
    },
    {
      id: "4",
      room_number: "402",
      guest_name: "ไม่ประสงค์รับบริการ",
      status: "no_service",
      accumulated_ms: 0,
      target_ms: 0,
      has_loan: false,
      has_maintenance: false,
      note: "ลูกค้าแขวนป้ายตัดกวน (DND)",
    },
    {
      id: "5",
      room_number: "405",
      guest_name: "คุณจิราภรณ์ ม.",
      status: "done",
      accumulated_ms: 1540000,
      target_ms: 30 * 60000,
      has_loan: false,
      has_maintenance: false,
    }
  ]);

  const [extraTasks, setExtraTasks] = useState<ExtraTaskItem[]>([
    {
      id: "e1",
      task_name: "แพ็คเซ็ตผ้าห่มเสริม",
      location: "จุดประจำชั้น 3",
      status: "dirty", // works same as pending
      accumulated_ms: 0,
      target_ms: 15 * 60000,
      priority: 1,
    },
    {
      id: "e2",
      task_name: "ทำความสะอาดล็อบบี้",
      location: "โซนด้านหน้า",
      status: "in_progress",
      started_at: Date.now() - 600000,
      accumulated_ms: 120000,
      target_ms: 20 * 60000,
      priority: 2,
      note: "เน้นเช็ดกระจกทางเข้าเป็นพิเศษ",
    }
  ]);

  const [now, setNow] = useState(Date.now());
  const [timeStr, setTimeStr] = useState("");

  // Persistent Dark Mode
  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem("maidMockupDarkMode");
    if (saved !== null) {
      setIsDarkMode(saved === "true");
    }
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      localStorage.setItem("maidMockupDarkMode", String(next));
      return next;
    });
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      const d = new Date();
      setTimeStr(d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    const d = new Date();
    setTimeStr(d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }));
    return () => clearInterval(timer);
  }, []);

  const handleStartRoom = (id: string) => {
    setRooms(rooms.map(r => r.id === id ? { ...r, status: r.status === 'no_service' ? 'no_service' : 'in_progress', started_at: Date.now() } : r));
  };

  const handlePauseRoom = (id: string) => {
    setRooms(rooms.map(r => {
      if (r.id === id && r.started_at) {
         return { ...r, status: "paused", accumulated_ms: r.accumulated_ms + (Date.now() - r.started_at), started_at: undefined };
      }
      return r;
    }));
  };

  const handleStartExtra = (id: string) => {
    setExtraTasks(extraTasks.map(t => t.id === id ? { ...t, status: 'in_progress', started_at: Date.now() } : t));
  };

  const handlePauseExtra = (id: string) => {
    setExtraTasks(extraTasks.map(t => {
      if (t.id === id && t.started_at) {
         return { ...t, status: "paused", accumulated_ms: t.accumulated_ms + (Date.now() - t.started_at), started_at: undefined };
      }
      return t;
    }));
  };

  const handleFinishExtra = (id: string) => {
    setExtraTasks(extraTasks.map(t => {
      if (t.id === id) {
         let finalMs = t.accumulated_ms;
         if (t.started_at) finalMs += (Date.now() - t.started_at);
         return { ...t, status: "done", accumulated_ms: finalMs, started_at: undefined };
      }
      return t;
    }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submitLfReport = (e: React.FormEvent) => {
    e.preventDefault();
    alert("จำลองการส่งข้อมูล Lost & Found สำเร็จ!");
    setIsLfModalOpen(false);
    setLfRoomId("");
    setLfDescription("");
    setLfLocation("");
    setPhotoPreview(null);
  };

  const getCountdown = (item: { status: RoomStatus, target_ms: number, accumulated_ms: number, started_at?: number }) => {
    if (item.target_ms === 0) return { text: "-", isOvertime: false };
    
    let elapsed = item.accumulated_ms;
    if (item.status === "in_progress" && item.started_at) {
      elapsed += now - item.started_at;
    }
    const remaining = item.target_ms - elapsed;
    const isOvertime = remaining < 0;
    const absRemaining = Math.abs(remaining);
    
    const mins = Math.floor(absRemaining / 60000);
    const secs = Math.floor((absRemaining % 60000) / 1000);
    const sign = isOvertime ? "+" : "";
    
    return {
       text: `${sign}${mins}:${secs.toString().padStart(2, "0")}`,
       isOvertime
    };
  };

  const getCardStyle = (status: RoomStatus) => {
     switch (status) {
        case "dirty": return "dark:bg-rose-950/40 bg-rose-50 border border-rose-200 border-l-[12px] border-l-rose-500 dark:border-rose-500/40 dark:shadow-[0_4px_20px_rgba(225,29,72,0.1)] shadow-xl shadow-rose-900/5";
        case "in_progress": return "dark:bg-amber-900/40 bg-amber-50 border border-amber-200 border-l-[12px] border-l-amber-500 dark:border-amber-500/40 dark:shadow-[0_4px_20px_rgba(245,158,11,0.1)] shadow-xl shadow-amber-900/5";
        case "no_service": return "dark:bg-sky-950/40 bg-sky-50 border border-sky-200 border-l-[12px] border-l-sky-500 dark:border-sky-500/40 dark:shadow-[0_4px_20px_rgba(14,165,233,0.1)] shadow-xl shadow-sky-900/5";
        case "paused": return "dark:bg-purple-950/40 bg-purple-50 border border-purple-200 border-l-[12px] border-l-purple-500 dark:border-purple-500/40 dark:shadow-[0_4px_20px_rgba(168,85,247,0.1)] shadow-xl shadow-purple-900/5";
        case "done": return "dark:bg-emerald-950/40 bg-emerald-50 border border-emerald-200 border-l-[12px] border-l-emerald-500 dark:border-emerald-500/40 dark:shadow-[0_4px_20px_rgba(16,185,129,0.1)] shadow-xl shadow-emerald-900/5";
        default: return "dark:bg-slate-900 bg-slate-50 border-slate-200 shadow-sm";
     }
  };

  const getNumberColor = (status: RoomStatus) => {
     switch (status) {
        case "dirty": return "text-rose-600 dark:text-rose-400";
        case "in_progress": return "text-amber-500 dark:text-amber-400";
        case "no_service": return "text-sky-600 dark:text-sky-400";
        case "paused": return "text-purple-600 dark:text-purple-400";
        case "done": return "text-emerald-600 dark:text-emerald-400";
        default: return "dark:text-slate-200 text-slate-800";
     }
  };

  if (!isMounted) return null; // Avoid hydration mismatch for dark mode

  return (
    <div className={`${isDarkMode ? 'dark' : ''} ${thaiUi.className}`}>
      <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white pb-32 transition-colors duration-300 relative overflow-hidden">
        
        {/* Top Header */}
        <div className="bg-white dark:bg-slate-950/90 backdrop-blur-md border-b dark:border-white/5 border-slate-200 px-4 py-3 sticky top-0 z-30 flex justify-between items-center shadow-sm dark:shadow-none">
          <div className="flex items-center gap-3">
             <div className="flex items-center gap-2 dark:bg-white/5 bg-slate-100 px-3 py-1.5 rounded-full border dark:border-white/10 border-slate-200">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
                <span className="font-bold dark:text-slate-300 text-slate-700 text-xs mt-0.5">ONLINE</span>
             </div>
             
             <button 
                onClick={toggleDarkMode} 
                className="p-1.5 rounded-full dark:bg-white/10 bg-slate-200 hover:bg-slate-300 dark:hover:bg-white/20 transition-colors text-slate-600 dark:text-white"
             >
                {isDarkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-indigo-600" />}
             </button>
          </div>
          <div className="flex flex-col items-end">
             <p className="text-xs font-bold dark:text-slate-400 text-slate-500 uppercase tracking-widest leading-none">พิมพลอย (Lane 1)</p>
             <div className="flex items-center gap-1.5 font-black dark:text-slate-200 text-slate-800 text-sm mt-1">
                <ClockIcon size={14} className="dark:text-slate-400 text-slate-500" strokeWidth={2.5} />
                {timeStr}
             </div>
          </div>
        </div>

        {/* --- MAIN TAB SECTIONS --- */}
        <div className="max-w-screen-2xl mx-auto px-4 py-4 space-y-6">

          {/* EXTRA TASKS LIST */}
          {extraTasks.length > 0 && (
          <section>
            <h3 className="text-xl font-black mb-4 flex items-center gap-2 text-indigo-500 dark:text-indigo-400">
               <Sparkles size={24} /> งานพิเศษ / งานเสริม
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {extraTasks.map((task) => {
                const timer = getCountdown(task);
                const color = getNumberColor(task.status);
                
                return (
                <div key={task.id} className={`rounded-[28px] overflow-hidden transition-all flex flex-col ${getCardStyle(task.status)}`}>
                  {/* Info Container */}
                  <div className="p-5 pb-3 flex-1 flex flex-col">
                    <div className="flex gap-4 items-start h-full">
                      
                      {/* LEFT: Task Name instead of Room Number */}
                      <div className="flex-[1.2] pt-1 min-w-[50%]">
                        <h2 className={`text-3xl sm:text-[32px] font-black leading-snug tracking-tight ${color} break-words pr-2`}>
                           {task.task_name}
                        </h2>
                      </div>
                      
                      {/* RIGHT: Location, Timer */}
                      <div className="flex-1 flex flex-col justify-start items-end text-right h-full">
                        <p className="text-[18px] font-bold dark:text-slate-200 text-slate-800 leading-tight">
                           {task.location}
                        </p>
                        
                        <div className="flex flex-wrap justify-end gap-2 mt-2">
                           <span className="dark:bg-white/10 bg-black/5 dark:text-slate-300 text-slate-700 border dark:border-white/20 border-slate-300/50 px-2.5 py-1 rounded-full text-[11px] font-black flex items-center gap-1">
                             P{task.priority}
                           </span>
                        </div>

                        <div className="mt-auto pt-4">
                           {(task.status === "in_progress" || task.status === "paused" || task.status === "dirty") && task.target_ms > 0 && (
                              <div className={`text-[36px] sm:text-[40px] leading-none font-black font-mono tracking-tighter ${timer.isOvertime ? 'dark:text-rose-400 text-rose-600' : 'dark:text-slate-200 text-slate-700'}`}>
                                 {timer.text}
                              </div>
                           )}
                        </div>
                      </div>
                    </div>

                    {task.note && (
                      <div className="mt-5 dark:bg-black/40 bg-slate-100 rounded-[20px] p-4 border dark:border-white/10 border-slate-200/60 flex gap-3 items-start relative z-10 shadow-inner">
                        <AlertCircle size={18} className="dark:text-white text-slate-800 shrink-0 mt-0.5 opacity-80" strokeWidth={2.5} />
                        <p className="text-sm font-bold dark:text-white text-slate-800 leading-snug tracking-wide">{task.note}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions for Extra Task */}
                  <div className="p-4 flex flex-wrap gap-3 w-full shrink-0">
                    {task.status === "dirty" && (
                      <button 
                        onClick={() => handleStartExtra(task.id)}
                        className="flex-1 min-w-[150px] h-[68px] dark:bg-rose-600 bg-rose-500 hover:bg-rose-600 dark:hover:bg-rose-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-3 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(225,29,72,0.3)] shadow-[0_4px_16px_rgba(225,29,72,0.2)] text-white border-transparent"
                      >
                        <Play size={28} fill="currentColor" /> เริ่มงานพิเศษ
                      </button>
                    )}

                    {task.status === "in_progress" && (
                      <>
                        <button 
                          onClick={() => handlePauseExtra(task.id)}
                          className="w-[84px] shrink-0 h-[68px] dark:bg-white/10 bg-slate-100/80 hover:bg-slate-200 rounded-[20px] font-black flex items-center justify-center active:scale-95 transition-all dark:border-white/20 border-slate-300"
                          aria-label="พัก"
                        >
                          <Pause size={28} fill="currentColor" className="dark:text-white text-slate-700" />
                        </button>
                        <button 
                          onClick={() => handleFinishExtra(task.id)}
                          className="flex-1 min-w-[150px] h-[68px] dark:bg-emerald-600 bg-emerald-500 hover:bg-emerald-600 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(5,150,105,0.3)] shadow-[0_4px_16px_rgba(5,150,105,0.2)] text-white text-center border-transparent"
                        >
                          <Check size={28} strokeWidth={3} /> เสร็จงาน
                        </button>
                      </>
                    )}

                    {task.status === "paused" && (
                      <>
                        <button 
                          onClick={() => handleStartExtra(task.id)}
                          className="flex-1 min-w-[130px] h-[68px] dark:bg-purple-600 bg-purple-500 hover:bg-purple-600 dark:hover:bg-purple-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(147,51,234,0.3)] shadow-md border-transparent text-white"
                        >
                          <Play size={28} fill="currentColor" /> ทำต่อ
                        </button>
                        <button 
                          onClick={() => handleFinishExtra(task.id)}
                          className="flex-[1.5] min-w-[130px] h-[68px] dark:bg-emerald-600 bg-emerald-500 hover:bg-emerald-600 dark:hover:bg-emerald-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(5,150,105,0.3)] shadow-md text-center border-transparent text-white"
                        >
                          <Check size={28} strokeWidth={3} /> เสร็จงาน
                        </button>
                      </>
                    )}

                    {task.status === "done" && (
                      <div className="flex-1 h-[56px] flex items-center justify-center rounded-[20px] dark:bg-black/30 bg-emerald-50 dark:text-emerald-400 text-emerald-700 font-black text-sm border dark:border-emerald-500/20 border-emerald-200 w-full">
                        ทำงานพิเศษเรียบร้อย
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </section>
          )}

          <hr className="border-t-2 dark:border-white/5 border-slate-200 w-1/2 mx-auto" />

          {/* ROOMS LIST */}
          <section>
            <h3 className="text-xl font-black mb-4 flex items-center gap-2 text-slate-500 dark:text-slate-400">
               รายการห้องในกะ
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {rooms.map((room) => {
                const timer = getCountdown(room);
                const numColor = getNumberColor(room.status);
                
                return (
                <div key={room.id} className={`rounded-[28px] overflow-hidden transition-all flex flex-col ${getCardStyle(room.status)}`}>
                  {/* Info Container */}
                  <div className="p-5 pb-3 flex-1 flex flex-col">
                    <div className="flex gap-4 items-start h-full">
                      {/* LEFT: Huge Room Number */}
                      <div className="shrink-0 flex items-center justify-center pt-2">
                        <h2 className={`text-[100px] sm:text-[120px] font-black leading-[0.75] tracking-tighter ${numColor}`}>
                          {room.room_number}
                        </h2>
                      </div>
                      
                      {/* RIGHT: Name, Tags, Timer */}
                      <div className="flex-1 flex flex-col justify-start items-end text-right min-w-0 h-full">
                        <p className="text-[17px] font-bold dark:text-slate-200 text-slate-800 truncate w-full leading-tight">{room.guest_name}</p>
                        
                        <div className="flex flex-wrap justify-end gap-2 mt-2">
                          {room.has_loan && (
                            <span className="dark:bg-black/30 bg-amber-100 dark:text-amber-400 text-amber-700 border dark:border-amber-500/30 border-amber-300/50 px-2.5 py-1 rounded-full text-[11px] font-black flex items-center gap-1">
                              <Package size={12} strokeWidth={2.5} /> เก็บคืน
                            </span>
                          )}
                          {room.has_maintenance && (
                            <span className="dark:bg-black/30 bg-sky-100 dark:text-sky-400 text-sky-700 border dark:border-sky-500/30 border-sky-300/50 px-2.5 py-1 rounded-full text-[11px] font-black flex items-center gap-1">
                              <Wrench size={12} strokeWidth={2.5} /> งานซ่อม
                            </span>
                          )}
                        </div>

                        <div className="mt-auto pt-4">
                          {(room.status === "in_progress" || room.status === "paused" || room.status === "dirty") && room.target_ms > 0 && (
                              <div className={`text-[36px] sm:text-[40px] leading-none font-black font-mono tracking-tighter ${timer.isOvertime ? 'dark:text-rose-400 text-rose-600' : 'dark:text-slate-200 text-slate-700'}`}>
                                {timer.text}
                              </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NOTE FOR ALL TYPES INCLUDING NO SERVICE */}
                    {room.note && (
                      <div className="mt-5 dark:bg-black/40 bg-slate-100 rounded-[20px] p-4 border dark:border-white/10 border-slate-200/60 flex gap-3 items-start relative z-10 shadow-inner">
                        <AlertCircle size={18} className="dark:text-white text-slate-800 shrink-0 mt-0.5 opacity-80" strokeWidth={2.5} />
                        <p className="text-sm font-bold dark:text-white text-slate-800 leading-snug tracking-wide">{room.note}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="p-4 flex flex-wrap gap-3 w-full shrink-0">
                    {room.status === "dirty" && (
                      <button 
                        onClick={() => handleStartRoom(room.id)}
                        className="flex-1 min-w-[150px] h-[68px] dark:bg-rose-600 bg-rose-500 hover:bg-rose-600 dark:hover:bg-rose-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-3 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(225,29,72,0.3)] shadow-[0_4px_16px_rgba(225,29,72,0.2)] text-white border-transparent"
                      >
                        <Play size={28} fill="currentColor" /> เริ่มงาน
                      </button>
                    )}
                    
                    {room.status === "no_service" && (
                      <Link 
                        href={`/maid/mockup/checklist?room=${room.room_number}`}
                        className="flex-1 min-w-[150px] h-[68px] dark:bg-sky-600 bg-sky-500 hover:bg-sky-600 dark:hover:bg-sky-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-3 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(2,132,199,0.3)] shadow-[0_4px_16px_rgba(2,132,199,0.2)] text-white border-transparent"
                      >
                        <Play size={28} fill="currentColor" /> เริ่มดำเนินการ
                      </Link>
                    )}

                    {room.status === "in_progress" && (
                      <>
                        <button 
                          onClick={() => handlePauseRoom(room.id)}
                          className="w-[84px] shrink-0 h-[68px] dark:bg-white/10 bg-slate-100/80 hover:bg-slate-200 rounded-[20px] font-black flex items-center justify-center active:scale-95 transition-all dark:border-white/20 border-slate-300"
                          aria-label="พัก"
                        >
                          <Pause size={28} fill="currentColor" className="dark:text-white text-slate-700" />
                        </button>
                        <Link 
                          href={`/maid/mockup/checklist?room=${room.room_number}`}
                          className="flex-1 min-w-[150px] h-[68px] dark:bg-emerald-600 bg-emerald-500 hover:bg-emerald-600 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(5,150,105,0.3)] shadow-[0_4px_16px_rgba(5,150,105,0.2)] text-white text-center border-transparent"
                        >
                          <Check size={28} strokeWidth={3} /> เสร็จ
                        </Link>
                      </>
                    )}

                    {room.status === "paused" && (
                      <>
                        <button 
                          onClick={() => handleStartRoom(room.id)}
                          className="flex-1 min-w-[130px] h-[68px] dark:bg-purple-600 bg-purple-500 hover:bg-purple-600 dark:hover:bg-purple-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(147,51,234,0.3)] shadow-md border-transparent text-white"
                        >
                          <Play size={28} fill="currentColor" /> ทำต่อ
                        </button>
                        <Link 
                          href={`/maid/mockup/checklist?room=${room.room_number}`}
                          className="flex-[1.5] min-w-[130px] h-[68px] dark:bg-emerald-600 bg-emerald-500 hover:bg-emerald-600 dark:hover:bg-emerald-700 rounded-[20px] font-black text-2xl flex items-center justify-center gap-2 active:scale-95 transition-all dark:shadow-[0_4px_16px_rgba(5,150,105,0.3)] shadow-md text-center border-transparent text-white"
                        >
                          <Check size={28} strokeWidth={3} /> เสร็จ
                        </Link>
                      </>
                    )}

                    {room.status === "done" && (
                      <div className="flex-1 h-[56px] flex items-center justify-center rounded-[20px] dark:bg-black/30 bg-emerald-50 dark:text-emerald-400 text-emerald-700 font-black text-sm border dark:border-emerald-500/20 border-emerald-200 w-full">
                        ทำความสะอาดเรียบร้อย
                      </div>
                    )}
                  </div>
                </div>
              )})}
            </div>
          </section>

        </div>

        {/* Floating Action Button for Lost and Found */}
        <button 
           onClick={() => setIsLfModalOpen(true)}
           className="fixed bottom-6 left-6 z-40 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white rounded-full w-[72px] h-[72px] shadow-[0_10px_25px_rgba(245,158,11,0.5)] active:scale-95 transition-all"
        >
           <span className="font-black text-2xl">ลืม</span>
        </button>

        {/* LF Report Sheet Modal */}
        <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isLfModalOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsLfModalOpen(false)} />
            
            <div className={`absolute bottom-0 left-0 right-0 max-w-screen-md mx-auto dark:bg-slate-950 bg-white rounded-t-[32px] min-h-[50vh] max-h-[90vh] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.2)] transition-transform duration-300 ${isLfModalOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                
                {/* Drag Handle & Header */}
                <div className="flex justify-center p-3 shrink-0">
                    <div className="w-12 h-1.5 dark:bg-white/20 bg-slate-200 rounded-full"></div>
                </div>

                <div className="px-6 pb-4 flex items-center justify-between shrink-0 border-b dark:border-white/10 border-slate-200">
                    <h2 className="text-2xl font-black dark:text-white text-slate-900 flex items-center gap-2">
                       <Search size={28} className="text-amber-500" /> แจ้งพบของลืม
                    </h2>
                    <button onClick={() => setIsLfModalOpen(false)} className="p-2 rounded-full dark:hover:bg-white/10 hover:bg-slate-100 dark:text-slate-400 text-slate-500 transition-colors">
                        <X className="w-7 h-7" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="bg-sky-50 dark:bg-sky-900/20 text-sky-800 dark:text-sky-300 p-4 rounded-2xl flex gap-3 text-sm mb-6 border border-sky-100 dark:border-sky-900/50">
                        <Info className="w-5 h-5 shrink-0 mt-0.5" />
                        <p className="font-bold">หากพบสิ่งของที่ลูกค้าลืมทิ้งไว้ กรุณาถ่ายภาพและระบุรายละเอียดเพื่อแจ้ง Front Desk ทันที</p>
                    </div>

                    <form id="lf-report-form" onSubmit={submitLfReport} className="space-y-5">
                        {/* Room Selection */}
                        <div>
                            <label className="block text-base font-bold dark:text-slate-200 text-slate-800 mb-2">พบที่ห้องไหน? <span className="text-rose-500">*</span></label>
                            <select 
                                className="w-full dark:bg-slate-900 bg-slate-50 border dark:border-white/10 border-slate-200 rounded-2xl px-5 py-4 text-lg dark:text-white text-slate-900 font-bold focus:ring-2 focus:ring-amber-500 outline-none appearance-none"
                                value={lfRoomId}
                                onChange={e => setLfRoomId(e.target.value)}
                                required
                            >
                                <option value="" disabled>เลือกห้อง...</option>
                                <option value="1">ห้อง 304 - คุณวรรณวิสา พ.</option>
                                <option value="2">ห้อง 305 - คุณศิริวัฒน์ น.</option>
                                <option value="3">ห้อง 401 - คุณณรงค์ชัย ส.</option>
                                <option value="4">ห้อง 402 - ลูกค้างดทำ</option>
                                <option value="5">ห้อง 405 - คุณจิราภรณ์ ม.</option>
                            </select>
                        </div>

                        {/* Photo Upload */}
                        <div>
                            <label className="block text-base font-bold dark:text-slate-200 text-slate-800 mb-2">ถ่ายรูป <span className="dark:text-slate-500 text-slate-400 font-normal">(ไม่บังคับแต่แนะนำ)</span></label>
                            
                            <input 
                                type="file"
                                accept="image/*"
                                capture="environment" 
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handlePhotoChange}
                            />

                            {photoPreview ? (
                                <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border dark:border-white/10 border-slate-200">
                                    <img src={photoPreview} alt="Preview" className="w-full h-full object-contain" />
                                    <button 
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="absolute bottom-4 right-4 bg-black/70 backdrop-blur-md text-white px-5 py-3 rounded-xl text-base font-bold flex items-center shadow-lg active:scale-95 transition-transform"
                                    >
                                        <Camera className="w-5 h-5 mr-2" />
                                        ถ่ายใหม่
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full aspect-video rounded-2xl border-4 border-dashed dark:border-slate-800 border-slate-200 dark:bg-slate-900/50 bg-slate-50 flex flex-col items-center justify-center dark:text-slate-400 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                                >
                                    <div className="w-16 h-16 dark:bg-slate-800 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                                        <Camera className="w-8 h-8" />
                                    </div>
                                    <span className="font-black text-xl">กดเพื่อถ่ายรูป</span>
                                </button>
                            )}
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-base font-bold dark:text-slate-200 text-slate-800 mb-2">ระบุสิ่งของ <span className="text-rose-500">*</span></label>
                            <textarea 
                                className="w-full dark:bg-slate-900 bg-slate-50 border dark:border-white/10 border-slate-200 rounded-2xl px-5 py-4 text-lg dark:text-white text-slate-900 font-bold focus:ring-2 focus:ring-amber-500 outline-none resize-none min-h-[120px]"
                                placeholder="เช่น กระเป๋าตังค์สีดำ, ที่ชาร์จ iPhone, กุญแจรถ..."
                                value={lfDescription}
                                onChange={e => setLfDescription(e.target.value)}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-base font-bold dark:text-slate-200 text-slate-800 mb-2">หมวดหมู่</label>
                                <select 
                                    className="w-full dark:bg-slate-900 bg-slate-50 border dark:border-white/10 border-slate-200 rounded-2xl px-4 py-3.5 text-base dark:text-white text-slate-900 font-bold focus:ring-2 focus:ring-amber-500 outline-none appearance-none"
                                    value={lfCategory}
                                    onChange={e => setLfCategory(e.target.value)}
                                >
                                    <option value="general">ทั่วไป</option>
                                    <option value="electronics">อุปกรณ์ไฟฟ้า</option>
                                    <option value="clothing">เสื้อผ้า</option>
                                    <option value="documents">เอกสารสำคัญ</option>
                                    <option value="valuables">ของมีค่า</option>
                                    <option value="other">อื่นๆ</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-base font-bold dark:text-slate-200 text-slate-800 mb-2">จุดที่พบ</label>
                                <input 
                                    type="text"
                                    className="w-full dark:bg-slate-900 bg-slate-50 border dark:border-white/10 border-slate-200 rounded-2xl px-4 py-3.5 text-base dark:text-white text-slate-900 font-bold focus:ring-2 focus:ring-amber-500 outline-none"
                                    placeholder="เช่น บนเตียง, ลิ้นชัก"
                                    value={lfLocation}
                                    onChange={e => setLfLocation(e.target.value)}
                                />
                            </div>
                        </div>
                    </form>
                </div>

                <div className="p-5 border-t dark:border-white/10 border-slate-200 dark:bg-slate-950 bg-white shrink-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                    <button 
                        type="submit" 
                        form="lf-report-form"
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-2xl rounded-2xl h-[68px] flex items-center justify-center shadow-lg shadow-amber-500/30 active:scale-95 transition-transform"
                    >
                        แจ้งพบของลืม
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
