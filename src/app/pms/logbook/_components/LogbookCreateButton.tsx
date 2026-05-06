"use client"

import { Button } from "@/components/ui/button"

export function LogbookCreateButton({ onClick }: { onClick: () => void }) {
    return (
        <Button
            onClick={onClick}
            className="h-9 gap-2 rounded-[var(--logbook-pill-radius)] bg-[var(--logbook-cta-fill)] px-4 font-semibold text-[var(--logbook-cta-text)] shadow-sm hover:bg-[var(--logbook-cta-fill)]/90"
        >
            <span className="text-lg leading-none">+</span> New Note
        </Button>
    )
}
