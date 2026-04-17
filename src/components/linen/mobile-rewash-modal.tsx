"use client";

import React, { useState, useEffect, useRef } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { LinenItem } from "@/lib/types";

interface MobileRewashModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (item: any) => void;
    batchId?: string;
}

export function MobileRewashModal({ isOpen, onClose, onAdd, batchId }: MobileRewashModalProps) {
    const [items, setItems] = useState<LinenItem[]>([]);
    const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
    const [qty, setQty] = useState("1");
    const [isDayuse, setIsDayuse] = useState(false);
    const [note, setNote] = useState("");
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [showMoreItems, setShowMoreItems] = useState(false);
    const [photos, setPhotos] = useState<{ url: string; objectKey?: string; uploading: boolean; error?: string; tmpId: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        setShowMoreItems(false);

        async function fetchItems() {
            setIsLoadingItems(true);
            const supabase = createBrowserSupabaseClient();
            const { data, error } = await supabase
                .from("linen_items")
                .select("*")
                .order("sort_order", { ascending: true });

            if (!error && data) {
                setItems(data);
            }
            setIsLoadingItems(false);
        }

        fetchItems();
    }, [isOpen]);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        // Reset input so same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = "";

        const newPhotos = files.map(file => ({
            url: URL.createObjectURL(file), // temporary local URL for preview
            uploading: true,
            tmpId: Math.random().toString(36).substring(7),
            file
        }));

        setPhotos(prev => [...prev, ...newPhotos]);

        // Process each file
        for (const photo of newPhotos) {
            try {
                const resizedBlob = await resizeImage(photo.file);
                
                // Multipart Upload
                const formData = new FormData();
                formData.append("file", resizedBlob, "photo.jpg");
                formData.append("batch_id", batchId || "temporary");
                formData.append("event_tmp_id", photo.tmpId);

                const res = await fetch("/api/linen/rewash/photo", {
                    method: "POST",
                    body: formData,
                });

                if (!res.ok) throw new Error("Failed to upload photo");
                const result = await res.json();
                const objectKey = result.data?.object_key || result.object_key;

                if (!objectKey) throw new Error("No object_key in response");

                // Update photo with object key
                setPhotos(prev => prev.map(p => 
                    p.tmpId === photo.tmpId ? { ...p, objectKey, uploading: false } : p
                ));
            } catch (err) {
                console.error("Upload error:", err);
                setPhotos(prev => prev.map(p => 
                    p.tmpId === photo.tmpId ? { ...p, uploading: false, error: "Upload failed" } : p
                ));
            }
        }
    };

    const resizeImage = (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;
                const maxDim = 1600;

                if (width > height) {
                    if (width > maxDim) {
                        height *= maxDim / width;
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width *= maxDim / height;
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject(new Error("Canvas context failed"));
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Canvas toBlob failed"));
                }, "image/jpeg", 0.75);
            };
            img.onerror = reject;
        });
    };

    const handleAdd = () => {
        const selectedItem = items.find(i => i.id === selectedItemId);
        if (!selectedItem || photos.some(p => p.uploading) || photos.length === 0) return;

        onAdd({
            linen_item_id: selectedItem.id,
            name_th: selectedItem.name_th,
            qty: parseInt(qty, 10),
            is_dayuse: isDayuse,
            photo_keys: photos.map(p => p.objectKey).filter(Boolean),
            preview_url: photos[0]?.url,
            note: note || undefined
        });

        // Reset state
        setSelectedItemId(null);
        setQty("1");
        setIsDayuse(false);
        setNote("");
        setShowMoreItems(false);
        setPhotos([]);
        onClose();
    };

    if (!isOpen) return null;

    const currentQty = Math.max(1, parseInt(qty || "1", 10) || 1);
    const setSafeQty = (nextQty: number) => setQty(String(Math.max(1, nextQty)));
    const primaryItems = items.filter(item => item.item_number >= 1 && item.item_number <= 9);
    const moreItems = items.filter(item => item.item_number < 1 || item.item_number > 9);
    const visibleItems = showMoreItems ? [...primaryItems, ...moreItems] : primaryItems;
    const isUploading = photos.some(p => p.uploading);
    const canSave = selectedItemId && parseInt(qty, 10) > 0 && photos.length > 0 && !isUploading;

    return (
        <>
            <div 
                className={`fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />
            
            <div className={`fixed inset-x-0 bottom-0 z-50 transform transition-transform duration-500 ease-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="bg-white dark:bg-slate-900 rounded-t-[2.5rem] shadow-2xl max-h-[90vh] flex flex-col border-t border-slate-100 dark:border-slate-800 overflow-hidden">
                    <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full mx-auto my-4 shrink-0 shadow-inner" />
                    
                    <div className="px-6 pb-4 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-thai">เพิ่มผ้าซักใหม่ (Rewash)</h2>
                            <p className="text-sm text-slate-400 dark:text-slate-500 font-thai">ส่งซักใหม่ฟรี กรณีพบผ้าสกปรก</p>
                        </div>
                        <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center text-slate-400 active:scale-95 transition-all">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {/* Item Selection */}
                        <section>
	                            <div className="mb-2 flex items-center justify-between gap-3">
	                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest font-thai">เลือกรายการผ้า</label>
	                                {moreItems.length > 0 && (
	                                    <button
	                                        type="button"
	                                        onClick={() => setShowMoreItems(value => !value)}
	                                        className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-500 transition-all active:scale-95"
	                                    >
	                                        {showMoreItems ? "ซ่อนรายการพิเศษ" : `More ${moreItems.length}`}
	                                    </button>
	                                )}
	                            </div>
	                            <div className="grid grid-cols-2 gap-2">
	                                {isLoadingItems ? (
	                                    <div className="col-span-2 py-4 text-center text-slate-400 animate-pulse font-thai text-sm">กำลังโหลด...</div>
	                                ) : (
	                                    visibleItems.map(item => (
		                                        <button
		                                            key={item.id}
		                                            onClick={() => setSelectedItemId(item.id)}
		                                            className={`min-h-[58px] rounded-2xl border px-4 py-3 text-left text-lg font-black leading-snug font-thai transition-all ${
		                                                selectedItemId === item.id
	                                                ? 'bg-purple-50 border-purple-200 text-purple-700 ring-1 ring-purple-200'
	                                                : 'bg-slate-50 border-slate-100 text-slate-700'
	                                            }`}
		                                        >
		                                            {item.name_th}
		                                        </button>
	                                    ))
	                                )}
	                            </div>
                        </section>

                        {/* Quantity & Options */}
                        <div className="grid grid-cols-2 gap-4">
	                            <section>
	                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-thai">จำนวน</label>
	                                <div className="flex items-center gap-1 rounded-2xl border border-slate-200/70 bg-slate-50 p-1.5">
	                                    <button
	                                        type="button"
	                                        onClick={() => setSafeQty(currentQty - 1)}
	                                        className="h-12 w-12 rounded-xl border border-slate-100 bg-white text-slate-600 shadow-sm transition-all active:scale-90 active:bg-slate-100"
	                                    >
	                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mx-auto h-5 w-5"><path d="M5 12h14" /></svg>
	                                    </button>
	                                    <input
	                                        type="number"
	                                        inputMode="numeric"
	                                        pattern="[0-9]*"
	                                        value={qty}
	                                        onChange={(e) => {
	                                            const value = e.target.value;
	                                            if (value === "") {
	                                                setQty("");
	                                                return;
	                                            }
	                                            const next = parseInt(value, 10);
	                                            if (!Number.isNaN(next)) setSafeQty(next);
	                                        }}
	                                        onBlur={() => setSafeQty(currentQty)}
	                                        className="min-w-0 flex-1 border-0 bg-transparent text-center text-2xl font-black text-purple-700 placeholder:text-slate-300 focus:ring-0"
	                                        placeholder="1"
	                                        min="1"
	                                    />
	                                    <button
	                                        type="button"
	                                        onClick={() => setSafeQty(currentQty + 1)}
	                                        className="h-12 w-12 rounded-xl bg-purple-700 text-white shadow-md transition-all active:scale-90 active:bg-purple-800"
	                                    >
	                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mx-auto h-5 w-5"><path d="M12 5v14M5 12h14" /></svg>
	                                    </button>
	                                </div>
	                            </section>
                            <section>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-thai">ประเภท</label>
                                <button
                                    onClick={() => setIsDayuse(!isDayuse)}
                                    className={`w-full p-4 rounded-2xl font-bold font-thai border transition-all flex items-center justify-center gap-2 ${
                                        isDayuse
                                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                                        : 'bg-slate-50 border-slate-100 text-slate-400'
                                    }`}
                                >
                                    {isDayuse ? '✨ Day Use' : 'Standard'}
                                </button>
                            </section>
                        </div>

                        {/* Note */}
                        <section>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-thai">หมายเหตุ (ถ้ามี)</label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-300 transition-all font-thai min-h-[80px]"
                                placeholder="เช่น คราบเลือด, แจ้งร้านแล้ว..."
                            />
                        </section>

                        {/* Photos */}
                        <section>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 font-thai">รูปหลักฐาน (บังคับ ≥1 รูป)</label>
                            <div className="grid grid-cols-3 gap-3">
                                {photos.map((photo, idx) => (
                                    <div key={photo.tmpId} className="relative aspect-square rounded-xl bg-slate-100 border border-slate-200 overflow-hidden group">
                                        {photo.uploading ? (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80">
                                                <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-1" />
                                                <span className="text-[10px] font-bold text-purple-600">Uploading</span>
                                            </div>
                                        ) : (
                                            <>
                                                <img src={photo.url} alt="Rewash proof" className="w-full h-full object-cover" />
                                                <button 
                                                    onClick={() => setPhotos(prev => prev.filter((_, i) => i !== idx))}
                                                    className="absolute top-1 right-1 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg active:scale-95"
                                                >
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))}
                                {photos.length < 5 && (
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="aspect-square rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 active:bg-slate-100 active:border-purple-300 active:text-purple-400 transition-all"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6 mb-1"><path d="M12 5v14M5 12h14" /></svg>
                                        <span className="text-[10px] font-bold font-thai">เพิ่มรูป</span>
                                    </button>
                                )}
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept="image/*"
                                multiple
                                className="hidden"
                            />
                        </section>
                    </div>

                    <div className="p-6 pt-2 pb-10 bg-white dark:bg-slate-900 border-t border-slate-50 dark:border-slate-800">
                        <button
                            onClick={handleAdd}
                            disabled={!canSave}
                            className={`w-full py-4 rounded-2xl font-bold transition-all shadow-lg text-lg flex justify-center items-center gap-2 ${
                                canSave 
                                ? 'bg-purple-600 text-white active:scale-95' 
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                            }`}
                        >
                            {isUploading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    กำลังอัปโหลด...
                                </>
                            ) : (
                                <>บันทึกผ้าซักใหม่</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
