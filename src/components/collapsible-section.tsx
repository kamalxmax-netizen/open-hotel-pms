"use client";

import { useState, type ReactNode } from "react";

interface CollapsibleSectionProps {
    /** Unique ID for accessibility */
    id: string;
    /** Icon + title displayed in the header */
    title: string;
    /** Optional icon before title */
    icon?: string;
    /** Badge shown after title (e.g. "Return 🔄") */
    badge?: ReactNode;
    /** Whether section starts open */
    defaultOpen?: boolean;
    /** Force open externally */
    forceOpen?: boolean;
    /** Content inside the collapsible */
    children: ReactNode;
    /** Extra class on wrapper */
    className?: string;
}

export default function CollapsibleSection({
    id,
    title,
    icon,
    badge,
    defaultOpen = false,
    forceOpen,
    children,
    className = "",
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);
    const isOpen = forceOpen ?? open;

    return (
        <div
            className={`relative rounded-xl bg-white after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:border after:border-slate-200 after:content-[''] ${className}`}
        >
            <button
                type="button"
                id={`${id}-header`}
                aria-expanded={isOpen}
                aria-controls={`${id}-panel`}
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left bg-white hover:bg-slate-50 transition group"
            >
                {/* Chevron */}
                <svg
                    className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>

                {icon && <span className="text-sm">{icon}</span>}
                <span className="text-sm font-semibold text-slate-700 flex-1">{title}</span>
                {badge}
            </button>

            {isOpen && (
                <div
                    id={`${id}-panel`}
                    role="region"
                    aria-labelledby={`${id}-header`}
                    className="px-4 pb-4 pt-1 border-t border-slate-100 bg-white"
                >
                    {children}
                </div>
            )}
        </div>
    );
}
