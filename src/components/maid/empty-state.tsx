import React from 'react';
import { ClipboardList } from 'lucide-react';

export default function EmptyState({ message = "No rooms found for this category." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-surface)] rounded-2xl shadow-sm border border-[var(--border-subtle)] min-h-[300px]">
      <div className="w-16 h-16 bg-[var(--bg-surface-hover)] rounded-full flex items-center justify-center mb-4 text-[var(--text-muted)]">
        <ClipboardList size={32} />
      </div>
      <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">All Caught Up!</h3>
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
    </div>
  );
}
