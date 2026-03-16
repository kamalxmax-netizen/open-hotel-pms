"use client";

import { useState, useCallback } from "react";
import NightCounter from "@/components/night-counter";

type RoomTypeAvailability = {
    room_type_id: number;
    name: string;
    code: string;
    total_rooms: number;
    available_rooms: number;
    is_available: boolean;
    rate_per_night: number;
    total_for_stay: number;
    nights: number;
};

type AvailabilityResult = {
    checkin: string;
    checkout: string;
    nights: number;
    availability: RoomTypeAvailability[];
};

type Props = {
    /** Called when user clicks book on a room type */
    onSelect?: (roomTypeId: number, roomTypeName: string, checkin: string, checkout: string) => void;
    /** Pre-fill dates (optional) */
    defaultCheckin?: string;
    defaultCheckout?: string;
};

function formatDisplayDate(d: string) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${parseInt(day, 10)} ${months[parseInt(m, 10)]} ${y}`;
}

function formatMoney(n: number) {
    return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function AvailabilityWidget({ onSelect, defaultCheckin = "", defaultCheckout = "" }: Props) {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const [checkin, setCheckin] = useState(defaultCheckin || today);
    const [checkout, setCheckout] = useState(defaultCheckout || tomorrow);
    const [nights, setNights] = useState(() => {
        const start = new Date(defaultCheckin || today).getTime();
        const end = new Date(defaultCheckout || tomorrow).getTime();
        const diff = Math.ceil((end - start) / 86400000);
        return Math.max(1, Number.isFinite(diff) ? diff : 1);
    });
    const [result, setResult] = useState<AvailabilityResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const search = useCallback(async () => {
        if (!checkin || !checkout || checkout <= checkin) {
            setError("Please select a valid Check-in / Check-out range.");
            return;
        }
        setLoading(true);
        setError("");
        setResult(null);
        try {
            const res = await fetch(`/api/availability?checkin=${checkin}&checkout=${checkout}`);
            const data = await res.json();
            if (data.success) setResult(data);
            else setError(data.error || "Unable to load availability.");
        } catch {
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }, [checkin, checkout]);

    const availCount = result?.availability.filter(r => r.is_available).length ?? 0;

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <label className="form-label">Stay Range</label>
                <NightCounter
                    checkinDate={checkin}
                    checkoutDate={checkout}
                    nights={nights}
                    onChange={(nextCheckin, nextCheckout, nextNights) => {
                        setCheckin(nextCheckin);
                        setCheckout(nextCheckout);
                        setNights(nextNights);
                        setResult(null);
                    }}
                />
            </div>

            <div className="flex justify-end">
                <button
                    className="btn btn-primary px-6 h-[38px]"
                    onClick={search}
                    disabled={loading}
                >
                    {loading ? <span className="btn-spinner border-white" /> : "Search Availability"}
                </button>
            </div>

            {error && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-700">{error}</div>
            )}

            {/* Results */}
            {result && (
                <div className="space-y-2">
                    {/* Summary bar */}
                    <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] px-1">
                        <span>
                            <span className="font-semibold text-[var(--text-table-cell)]">{formatDisplayDate(result.checkin)}</span>
                            {" → "}
                            <span className="font-semibold text-[var(--text-table-cell)]">{formatDisplayDate(result.checkout)}</span>
                            {" · "}{result.nights} night{result.nights !== 1 ? "s" : ""}
                        </span>
                        <span>
                            {availCount > 0
                                ? <span className="text-emerald-600 font-semibold">Available in {availCount} room type{availCount !== 1 ? "s" : ""}</span>
                                : <span className="text-rose-600 font-semibold">Fully booked for this stay</span>
                            }
                        </span>
                    </div>

                    {/* Available types table */}
                    <div className="border border-[var(--border-default)] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-[var(--bg-body)] border-b border-[var(--border-subtle)]">
                                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Room Type</th>
                                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Available</th>
                                    <th className="text-right px-3 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Rate / Night</th>
                                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Stay Total ({result.nights}N)</th>
                                    {onSelect && <th className="px-3 py-2.5" />}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                                {result.availability.map(rt => (
                                    <tr
                                        key={rt.room_type_id}
                                        className={rt.is_available ? "hover:bg-[var(--bg-body)]/60 transition-colors" : "opacity-50"}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-[var(--text-primary)]">{rt.name}</div>
                                            <div className="text-xs text-[var(--text-muted)] mt-0.5">{rt.total_rooms} total rooms</div>
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            {rt.is_available ? (
                                                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                                                    {rt.available_rooms}
                                                </span>
                                            ) : (
                                                <span className="text-rose-500 font-semibold text-xs">FULL</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-right text-[var(--text-table-cell)]">
                                            {rt.rate_per_night > 0
                                                ? <span>฿{formatMoney(rt.rate_per_night)}</span>
                                                : <span className="text-[var(--text-muted)] text-xs">No rate</span>
                                            }
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold text-[var(--text-primary)]">
                                            {rt.rate_per_night > 0 ? `฿${formatMoney(rt.total_for_stay)}` : "—"}
                                        </td>
                                        {onSelect && (
                                            <td className="px-3 py-3 text-right">
                                                <button
                                                className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-30"
                                                disabled={!rt.is_available}
                                                onClick={() => onSelect(rt.room_type_id, rt.name, checkin, checkout)}
                                            >
                                                Book
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Tips */}
                    {availCount === 0 && (
                        <p className="text-xs text-[var(--text-muted)] text-center pt-1">
                            Try another date range or shorten the stay.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
