"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Copy, Check, QrCode } from "lucide-react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import QRCode from "react-qr-code"

export function LineBindCard({ staffId, onClose }: { staffId: string, onClose: () => void }) {
    const [loading, setLoading] = useState(false)
    const [tokenData, setTokenData] = useState<{
        token: string
        expires_at: string
        expires_in_minutes: number
        instruction: string
    } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [timeLeft, setTimeLeft] = useState<number>(0)

    useEffect(() => {
        async function requestToken() {
            setLoading(true)
            try {
                const supabase = createBrowserSupabaseClient()
                const { data: { session } } = await supabase.auth.getSession()
                const token = session?.access_token

                const res = await fetch("/api/staff/line-bind/request", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token && { Authorization: `Bearer ${token}` })
                    },
                    body: JSON.stringify({ staff_id: staffId })
                })
                const data = await res.json()
                if (data.success) {
                    setTokenData(data.data)
                    setTimeLeft(data.data.expires_in_minutes * 60)
                } else {
                    setError(data.error || "Failed to request token from server")
                }
            } catch (err) {
                setError("Network error communicating with API")
            } finally {
                setLoading(false)
            }
        }
        requestToken()
    }, [staffId])

    useEffect(() => {
        if (timeLeft <= 0) return
        const timer = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000)
        return () => clearInterval(timer)
    }, [timeLeft])

    const handleCopy = () => {
        if (!tokenData) return
        navigator.clipboard.writeText(`BIND ${tokenData.token}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const mins = Math.floor(timeLeft / 60)
    const secs = timeLeft % 60

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <Card className="w-full max-w-md p-6 shadow-xl flex flex-col gap-5 border-t-4 border-t-[#00B900] animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800">
                            <span className="text-[#00B900]"><QrCode className="w-5 h-5" /></span>
                            Bind LINE Account
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Connect this staff profile to their LINE account for push notifications.
                        </p>
                    </div>
                </div>

                {loading && (
                    <div className="py-12 flex flex-col items-center gap-4 text-slate-400">
                        <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#00B900] animate-spin"></div>
                        <p className="text-sm font-medium">Generating secure OTP Token...</p>
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-rose-50 text-rose-700 rounded-lg text-sm border border-rose-100 flex items-start gap-2">
                        <span>⚠️</span>
                        <div className="flex flex-col gap-1">
                            <span className="font-bold">Cannot generate token</span>
                            <span>{error}</span>
                        </div>
                    </div>
                )}

                {tokenData && (
                    <div className="space-y-5">
                        <div className="bg-slate-50 p-5 rounded-xl border flex flex-col items-center justify-center gap-4 relative overflow-hidden">
                            <div className="absolute top-0 w-full h-1 bg-[#00B900]/20"></div>

                            {/* QR Code generated locally */}
                            <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                                <QRCode
                                    value={`BIND ${tokenData.token}`}
                                    size={128}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 128 128`}
                                />
                            </div>
                            <p className="text-xs text-slate-500 text-center px-4 leading-relaxed">
                                Staff can scan this QR with the LINE app, or copy the command below and paste it in the official Hotel PMS LINE Bot chat.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold tracking-wider text-slate-500 uppercase">Manual Command</label>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 bg-slate-100 p-3 rounded-lg text-sm font-mono border text-slate-800 break-all select-all">
                                    BIND {tokenData.token}
                                </code>
                                <Button variant={copied ? "default" : "outline"} onClick={handleCopy} className={`shrink-0 h-12 w-12 ${copied ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`} title="Copy to clipboard">
                                    {copied ? <Check className="w-5 h-5 text-white" /> : <Copy className="w-5 h-5 text-slate-600" />}
                                </Button>
                            </div>
                        </div>

                        <div className={`flex items-center justify-between text-sm px-4 py-3 rounded-lg border transition-colors ${timeLeft < 120 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                            <span className="font-semibold flex items-center gap-2">
                                ⏱️ Token expires in
                            </span>
                            {timeLeft > 0 ? (
                                <span className="font-mono font-bold text-lg">{mins}:{secs.toString().padStart(2, '0')}</span>
                            ) : (
                                <span className="font-bold text-rose-700">EXPIRED</span>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-4 border-t mt-2">
                    <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
                        Close & Return
                    </Button>
                </div>
            </Card>
        </div>
    )
}
