"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"

type Shift = {
    id: string
    staff_id: string
    shift_date: string
    shift_type: "morning" | "afternoon" | "night" | "off"
    started_at: string | null
    ended_at: string | null
    is_on_duty: boolean
    staff?: {
        display_name: string
        employee_code: string
        department?: { code: string }
    }
}

export function RosterTab() {
    const [shifts, setShifts] = useState<Shift[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [processingId, setProcessingId] = useState<string | null>(null)

    const fetchShifts = async () => {
        try {
            setLoading(true)
            const supabase = createBrowserSupabaseClient()
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const res = await fetch("/api/staff/shifts", {
                headers: {
                    ...(token && { Authorization: `Bearer ${token}` })
                }
            })
            const data = await res.json()
            if (data.success) {
                setShifts(data.data || [])
            } else {
                setError(data.error || "Failed to load shifts")
            }
        } catch (err) {
            setError("Network error fetching shifts")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchShifts()
    }, [])

    const handleClockAction = async (shiftId: string, action: "clock_in" | "clock_out") => {
        try {
            setProcessingId(shiftId)
            const supabase = createBrowserSupabaseClient()
            const { data: { session } } = await supabase.auth.getSession()
            const token = session?.access_token

            const res = await fetch(`/api/staff/shifts/${shiftId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...(token && { Authorization: `Bearer ${token}` })
                },
                body: JSON.stringify({ action })
            })
            const data = await res.json()
            if (data.success) {
                // Optimistic refresh
                fetchShifts()
            } else {
                const label = action === "clock_in" ? "clock in" : "clock out"
                alert("Failed to " + label + ": " + data.error)
            }
        } catch (err) {
            alert("Network error processing clock action")
        } finally {
            setProcessingId(null)
        }
    }

    if (error) return <div className="text-red-500">{error}</div>

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center mt-2">
                <h2 className="text-lg font-semibold text-slate-800">Daily Roster</h2>
                <div className="flex gap-2">
                    {/* Mock Button for creating a shift, actual impl. depends on modal */}
                    <Button size="sm" className="bg-brand-600 hover:bg-brand-700 text-white">
                        + Assign Shift
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchShifts}>
                        ↻ Refresh
                    </Button>
                </div>
            </div>

            {loading ? (
                <Card className="p-8 text-center text-slate-500">Loading roster...</Card>
            ) : shifts.length === 0 ? (
                <Card className="p-12 text-center text-slate-500 flex flex-col items-center gap-3 border-dashed bg-slate-50 border-2">
                    <p className="text-4xl mb-2">📋</p>
                    <h3 className="font-semibold text-slate-700">No shifts scheduled</h3>
                    <p className="text-sm max-w-sm">
                        There are no shifts scheduled for today. Use the Assign Shift button to create one.
                    </p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {shifts.map(shift => (
                        <Card key={shift.id} className={`p-4 flex flex-col gap-4 border-l-4 ${shift.is_on_duty ? 'border-l-emerald-500' : 'border-l-slate-300'}`}>
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-bold text-slate-800">{shift.staff?.display_name || "Unknown Staff"}</h3>
                                    <div className="flex gap-2 items-center mt-1">
                                        <Badge variant="outline" className="text-[10px] bg-slate-50">
                                            {shift.staff?.department?.code || "N/A"}
                                        </Badge>
                                        <span className="text-xs font-mono text-slate-500">{shift.staff?.employee_code}</span>
                                    </div>
                                </div>
                                <Badge variant={
                                    shift.shift_type === 'morning' ? 'default' :
                                        shift.shift_type === 'afternoon' ? 'secondary' :
                                            shift.shift_type === 'night' ? 'destructive' : 'outline'
                                } className="capitalize shadow-sm">
                                    {shift.shift_type}
                                </Badge>
                            </div>

                            <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-md border flex flex-col gap-1">
                                <div className="flex justify-between">
                                    <span>Clock In:</span>
                                    <span className="font-medium text-slate-700">{shift.started_at ? new Date(shift.started_at).toLocaleTimeString() : "--:--"}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Clock Out:</span>
                                    <span className="font-medium text-slate-700">{shift.ended_at ? new Date(shift.ended_at).toLocaleTimeString() : "--:--"}</span>
                                </div>
                            </div>

                            <div className="mt-auto pt-2 flex gap-2">
                                {!shift.started_at ? (
                                    <Button
                                        size="sm"
                                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                                        onClick={() => handleClockAction(shift.id, "clock_in")}
                                        disabled={processingId === shift.id}
                                    >
                                        {processingId === shift.id ? "Processing..." : "Clock In"}
                                    </Button>
                                ) : !shift.ended_at ? (
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="w-full"
                                        onClick={() => handleClockAction(shift.id, "clock_out")}
                                        disabled={processingId === shift.id}
                                    >
                                        {processingId === shift.id ? "Processing..." : "Clock Out"}
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="secondary" className="w-full opacity-50 cursor-not-allowed" disabled>
                                        Shift Completed
                                    </Button>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
