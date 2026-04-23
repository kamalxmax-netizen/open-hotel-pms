"use client";

import { useState } from "react";
import UndoLogModal from "./UndoLogModal";

type UndoStripProps = {
  count: number;
  latestTime: string | null;
};

export default function UndoStrip({ count, latestTime }: UndoStripProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <div className="w-full bg-brand-50 border border-brand-200 dark:bg-brand-900/20 dark:border-brand-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-300">
          <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span className="font-medium">{count} recent rate {count === 1 ? 'apply' : 'applies'}</span>
          <span className="opacity-70 mx-1">&middot;</span>
          <span>undo available until {latestTime}</span>
        </div>
        <button 
          className="btn btn-secondary bg-white text-xs whitespace-nowrap"
          onClick={() => setModalOpen(true)}
        >
          View & Undo Log
        </button>
      </div>

      {modalOpen && (
        <UndoLogModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
