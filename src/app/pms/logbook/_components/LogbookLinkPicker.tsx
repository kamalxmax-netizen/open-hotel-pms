"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LogbookMention, LogbookNoteLink } from "@/lib/types"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

interface LinkPickerProps {
    onAddLink: (link: Omit<LogbookNoteLink, "id" | "note_id" | "created_at">) => void
    onAddMention: (mention: Pick<LogbookMention, "mention_type" | "staff_id">) => void
    disabled?: boolean
    align?: "left" | "right"
}

type LinkTab = "room" | "guest" | "staff" | "stock"

type Option = {
    id: string
    label: string
}

export function LogbookLinkPicker({ onAddLink, onAddMention, disabled, align = "left" }: LinkPickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<LinkTab>("room")
    const [inputValue, setInputValue] = useState("")
    const [options, setOptions] = useState<Option[]>([])
    const [selected, setSelected] = useState<Option | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [errorText, setErrorText] = useState<string | null>(null)
    const [popupNudgeX, setPopupNudgeX] = useState(0)
    const [roomLinkMode, setRoomLinkMode] = useState<"dynamic" | "static">("dynamic")

    const supabaseRef = useRef(createBrowserSupabaseClient())
    const popupRef = useRef<HTMLDivElement | null>(null)

    const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
        const { data: { session } } = await supabaseRef.current.auth.getSession()
        const token = session?.access_token
        return token ? { Authorization: `Bearer ${token}` } : {}
    }, [])

    const resetTransient = useCallback(() => {
        setOptions([])
        setSelected(null)
        setErrorText(null)
    }, [])

    const closePicker = useCallback(() => {
        setIsOpen(false)
        setInputValue("")
        resetTransient()
        setPopupNudgeX(0)
    }, [resetTransient])

    useEffect(() => {
        if (!isOpen) return
        const raf = window.requestAnimationFrame(() => {
            if (!popupRef.current) return
            const rect = popupRef.current.getBoundingClientRect()
            const viewportPadding = 8
            let dx = 0
            if (rect.right > window.innerWidth - viewportPadding) {
                dx = (window.innerWidth - viewportPadding) - rect.right
            } else if (rect.left < viewportPadding) {
                dx = viewportPadding - rect.left
            }
            setPopupNudgeX(dx)
        })
        return () => window.cancelAnimationFrame(raf)
    }, [isOpen, activeTab, options.length, isLoading])

    const fetchGuestOptions = useCallback(async (query: string) => {
        const headers = await getAuthHeader()
        const res = await fetch(`/api/guests?q=${encodeURIComponent(query)}&limit=8`, { headers })
        const data = await res.json()
        if (!res.ok || !data?.success) {
            throw new Error(data?.error || "Failed to search guests")
        }

        const rows = Array.isArray(data.profiles) ? data.profiles : []
        return rows.map((row: Record<string, unknown>) => {
            const first = String(row.first_name ?? "").trim()
            const last = String(row.last_name ?? "").trim()
            const label = [first, last].filter(Boolean).join(" ").trim() || "Guest"
            return { id: String(row.id), label }
        }) as Option[]
    }, [getAuthHeader])

    const fetchStaffOptions = useCallback(async (query: string) => {
        const headers = await getAuthHeader()
        const res = await fetch(`/api/staff?is_active=true`, { headers })
        const data = await res.json()
        if (!res.ok || !data?.success) {
            throw new Error(data?.error || "Failed to load staff")
        }

        const rows = Array.isArray(data.data) ? data.data : []
        const normalizedQuery = query.trim().toLowerCase()

        return rows
            .map((row: Record<string, unknown>) => ({
                id: String(row.id),
                label: String(row.display_name ?? "").trim() || "Staff"
            }))
            .filter((row: Option) =>
                normalizedQuery.length === 0
                    ? true
                    : row.label.toLowerCase().includes(normalizedQuery)
            )
            .slice(0, 8)
    }, [getAuthHeader])

    useEffect(() => {
        if (!isOpen) return
        if (activeTab === "room" || activeTab === "stock") return

        const query = inputValue.trim()
        setSelected(null)
        setErrorText(null)

        if (query.length < 1) {
            setOptions([])
            return
        }

        const timer = setTimeout(async () => {
            try {
                setIsLoading(true)
                const nextOptions = activeTab === "guest"
                    ? await fetchGuestOptions(query)
                    : await fetchStaffOptions(query)
                setOptions(nextOptions)
            } catch (e) {
                console.error("link picker search failed", e)
                setOptions([])
                setErrorText("Search failed. Please try again.")
            } finally {
                setIsLoading(false)
            }
        }, 250)

        return () => clearTimeout(timer)
    }, [activeTab, fetchGuestOptions, fetchStaffOptions, inputValue, isOpen])

    const canSubmit = useMemo(() => {
        if (activeTab === "stock") return true
        if (activeTab === "room") return inputValue.trim().length > 0
        return selected !== null
    }, [activeTab, inputValue, selected])

    const handleAdd = async () => {
        if (!canSubmit) return

        if (activeTab === "room") {
            const roomCode = inputValue.trim()
            onAddLink({
                link_type: "room",
                ref_id: null,
                ref_code: roomCode,
                room_link_mode: roomLinkMode,
                label: `Room ${roomCode}`
            })
            closePicker()
            return
        }

        if (activeTab === "stock") {
            onAddLink({
                link_type: "stock",
                ref_id: null,
                ref_code: "stock",
                label: "Stock"
            })
            closePicker()
            return
        }

        if (!selected) return

        if (activeTab === "guest") {
            onAddLink({
                link_type: "guest",
                ref_id: selected.id,
                ref_code: null,
                label: selected.label
            })
            closePicker()
            return
        }

        onAddLink({
            link_type: "staff",
            ref_id: selected.id,
            ref_code: null,
            label: selected.label
        })
        closePicker()
    }

    const handleAddMentionGroup = (mentionType: "group_all" | "group_frontdesk") => {
        onAddMention({
            mention_type: mentionType,
            staff_id: null
        })
        closePicker()
    }

    if (!isOpen) {
        return (
            <button
                type="button"
                className="h-4 w-4 text-[14px] leading-none font-black text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                title="Add Link"
                onClick={() => setIsOpen(true)}
                disabled={disabled}
            >
                +
            </button>
        )
    }

    return (
        <div
            ref={popupRef}
            className={`flex flex-col gap-2 p-2 bg-[var(--bg-surface)] border shadow-lg rounded-md absolute z-50 bottom-full mb-1 w-72 max-w-[min(18rem,calc(100vw-1rem))] ${
                align === "right" ? "right-0" : "left-0"
            }`}
            style={{ transform: popupNudgeX === 0 ? undefined : `translateX(${popupNudgeX}px)` }}
        >
            <div className="flex justify-between items-center border-b pb-1">
                <span className="text-xs font-bold text-[var(--text-table-cell)]">Add Link / Mention</span>
                <button onClick={closePicker} className="text-[var(--text-muted)] hover:text-[var(--text-table-cell)] text-xs">
                    Cancel
                </button>
            </div>

            <div className="flex gap-1 flex-wrap">
                {(["room", "guest", "staff", "stock"] as LinkTab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => {
                            setActiveTab(tab)
                            setInputValue("")
                            resetTransient()
                        }}
                        className={`text-[10px] px-2 py-1 rounded capitalize ${activeTab === tab ? "bg-brand-100 text-brand-700 font-bold" : "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"}`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {activeTab === "room" && (
                <div className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-body)] p-1">
                    <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                        Link Mode
                    </span>
                    <button
                        type="button"
                        onClick={() => setRoomLinkMode("dynamic")}
                        className={`rounded px-2 py-1 text-[11px] font-semibold ${
                            roomLinkMode === "dynamic"
                                ? "bg-brand-100 text-brand-700"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                        }`}
                    >
                        Lock
                    </button>
                    <button
                        type="button"
                        onClick={() => setRoomLinkMode("static")}
                        className={`rounded px-2 py-1 text-[11px] font-semibold ${
                            roomLinkMode === "static"
                                ? "bg-[var(--bg-muted)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                        }`}
                    >
                        No Lock
                    </button>
                </div>
            )}

            {activeTab === "staff" && (
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleAddMentionGroup("group_all")}
                    >
                        @all
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleAddMentionGroup("group_frontdesk")}
                    >
                        @Front Desk
                    </Button>
                </div>
            )}

            {activeTab !== "stock" ? (
                <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                        <Input
                            value={inputValue}
                            onChange={e => {
                                setInputValue(e.target.value)
                                setSelected(null)
                            }}
                            onKeyDown={e => e.key === "Enter" && void handleAdd()}
                            placeholder={
                                activeTab === "room"
                                    ? "Room number (e.g. 301)"
                                    : activeTab === "guest"
                                        ? "Search guest name"
                                        : "Search staff name"
                            }
                            className="h-7 text-xs"
                            autoFocus
                        />
                        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void handleAdd()} disabled={!canSubmit}>
                            Add
                        </Button>
                    </div>

                    {(activeTab === "guest" || activeTab === "staff") && (
                        <div className="max-h-28 overflow-auto border rounded-md p-1 bg-[var(--bg-body)]">
                            {isLoading && <div className="text-[10px] text-[var(--text-secondary)] px-1 py-0.5">Loading...</div>}
                            {!isLoading && errorText && <div className="text-[10px] text-rose-600 px-1 py-0.5">{errorText}</div>}
                            {!isLoading && !errorText && options.length === 0 && (
                                <div className="text-[10px] text-[var(--text-secondary)] px-1 py-0.5">No results</div>
                            )}
                            {options.map(option => (
                                <button
                                    key={option.id}
                                    onClick={() => setSelected(option)}
                                    className={`w-full text-left text-[11px] px-2 py-1 rounded ${selected?.id === option.id ? "bg-brand-100 text-brand-700" : "hover:bg-[var(--bg-surface-hover)] text-[var(--text-table-cell)]"}`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <Button size="sm" className="h-7 px-2 text-xs w-full bg-blue-600 hover:bg-blue-700 text-white" onClick={() => void handleAdd()}>
                    Add Stock Link
                </Button>
            )}
        </div>
    )
}
