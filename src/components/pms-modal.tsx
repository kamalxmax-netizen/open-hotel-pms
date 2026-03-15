"use client";

import { useEffect, useRef } from "react";

type ModalSize = "sm" | "md" | "lg" | "xl" | "wide" | "folio";

interface PmsModalProps {
    title: string;
    size?: ModalSize;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export default function PmsModal({
    title,
    size = "md",
    onClose,
    children,
    footer
}: PmsModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    // Close on ESC
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    // Prevent body scroll
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    return (
        <div
            ref={overlayRef}
            className="modal-overlay"
            onMouseDown={(e) => {
                if (e.target === overlayRef.current) onClose();
            }}
        >
            <div className={`modal-panel ${size}`} role="dialog" aria-modal>
                <div className="modal-header">
                    <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                    <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close">
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}
