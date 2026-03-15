import React from 'react';
import { ClipboardList } from 'lucide-react';

export default function EmptyState({ message = "No rooms found for this category." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-2xl shadow-sm border border-slate-100 min-h-[300px]">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
        <ClipboardList size={32} />
      </div>
      <h3 className="text-base font-bold text-slate-900 mb-1">All Caught Up!</h3>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
