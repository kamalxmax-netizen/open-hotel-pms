"use client";

import React, { useRef, useState, useEffect } from "react";

interface SignatureCanvasProps {
  onSign?: (blob: Blob | null) => void;
  width?: number;
  height?: number;
}

export function SignatureCanvas({ onSign, width = 300, height = 150 }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Clear to white background (important for saving as JPG/PNG to prevent transparent black)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    
    // setup style
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [width, height]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    // Prevent scrolling when touching the canvas on mobile
    if (e.cancelable) {
        // can't preventDefault nicely on React synthetic events without causing passive listener warnings in some browsers, but let's try
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setIsDrawing(true);
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if (e.cancelable) {
        e.preventDefault(); 
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    exportBlob();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    if (onSign) onSign(null);
  };

  const exportBlob = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
        if (onSign) onSign(blob);
    }, 'image/png');
  };

  return (
    <div className="flex flex-col gap-2 items-center w-full">
      <div 
        className="border-2 border-slate-300 dark:border-slate-700 rounded overflow-hidden touch-none bg-white relative w-full max-w-[300px]" 
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="bg-white w-full h-full cursor-crosshair block"
          style={{ touchAction: 'none' }}
        />
        <div className="absolute top-1 left-2 pointer-events-none">
            <span className="text-[10px] text-slate-300 uppercase font-bold tracking-widest">เซ็นชื่อ</span>
        </div>
      </div>
      <div className="flex justify-between items-center w-full max-w-[300px]">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-tight">เซ็นในกรอบสีขาว</span>
          <button 
            type="button" 
            onClick={clearCanvas} 
            className="text-xs text-rose-500 dark:text-rose-400 font-medium hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-2 py-1 rounded transition-colors"
          >
            ล้างลายเซ็น
          </button>
      </div>
    </div>
  );
}
