"use client";

import React, { useState } from "react";
interface SignatureDisplayProps {
    src: string;
    label: string;
}

function toSignatureProxySrc(src: string): string {
    if (src.startsWith("http") || src.startsWith("/")) return src;
    return `/api/linen/signature/${src.split("/").map(encodeURIComponent).join("/")}`;
}

export function SignatureDisplay({ src, label }: SignatureDisplayProps) {
    const [isOpen, setIsOpen] = useState(false);
    const imageSrc = toSignatureProxySrc(src);

    return (
        <div className="flex flex-col items-center">
            <div 
                onClick={() => setIsOpen(true)}
                className="w-24 h-12 bg-white border border-slate-200 rounded-lg overflow-hidden relative cursor-zoom-in active:scale-95 transition-all shadow-sm"
            >
                <img 
                    src={imageSrc} 
                    alt={label}
                    className="w-full h-full object-contain p-1"
                />
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase mt-1 tracking-wider">{label}</span>

            {isOpen && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
                    onClick={() => setIsOpen(false)}
                >
                    <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col items-center">
                        <div className="w-full flex justify-between items-center mb-4">
                            <span className="font-bold text-slate-900">{label}</span>
                            <button className="p-2 text-slate-400">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                        <div className="w-full bg-slate-50 border border-slate-100 rounded-xl overflow-hidden aspect-[2/1] relative">
                             <img 
                                src={imageSrc} 
                                alt={label}
                                className="w-full h-full object-contain p-4"
                            />
                        </div>
                        <p className="mt-4 text-xs text-slate-400 font-thai">แตะเพื่อปิด</p>
                    </div>
                </div>
            )}
        </div>
    );
}
