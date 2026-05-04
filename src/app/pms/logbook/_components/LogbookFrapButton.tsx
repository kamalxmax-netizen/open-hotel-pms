"use client";

import React from "react";
import { Plus } from "lucide-react";

type Props = {
  onClick: () => void;
};

export function LogbookFrapButton({ onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--logbook-cta-fill)] text-[var(--logbook-cta-text)] shadow-[var(--logbook-frap-shadow)] transition-transform duration-[var(--logbook-duration-press)] ease-[var(--logbook-ease-press)] hover:scale-105 active:scale-95"
      aria-label="Create New Note"
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
