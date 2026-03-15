"use client"

import { Button } from "@/components/ui/button"

export function LogbookCreateButton({ onClick }: { onClick: () => void }) {
    return (
        <Button
            onClick={onClick}
            className="bg-brand-600 hover:bg-brand-700 text-white shadow-sm gap-2"
        >
            <span className="text-lg leading-none">+</span> New Note
        </Button>
    )
}
