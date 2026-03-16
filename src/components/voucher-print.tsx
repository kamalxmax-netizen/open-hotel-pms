"use client";

import { useEffect, useState } from "react";
import type { TransferVoucher } from "@/lib/types";

interface VoucherPrintProps {
    transferId: string;
    onClose?: () => void;
}

export default function VoucherPrint({ transferId, onClose }: VoucherPrintProps) {
    const [voucher, setVoucher] = useState<TransferVoucher | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch(`/api/transportation/vouchers?transfer_id=${transferId}`);
                const json = await res.json();
                if (json.success) setVoucher(json.voucher);
            } catch (err) {
                console.error("Failed to load voucher:", err);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [transferId]);

    function handlePrint() {
        window.print();
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!voucher) {
        return (
            <div className="p-8 text-center text-[var(--text-muted)]">
                <p>Voucher not found</p>
                {onClose && <button onClick={onClose} className="mt-4 text-blue-600">Close</button>}
            </div>
        );
    }

    return (
        <div>
            {/* No-print controls */}
            <div className="flex items-center gap-3 mb-4 print:hidden">
                <button
                    onClick={handlePrint}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                    🖨️ Print Voucher
                </button>
                {onClose && (
                    <button onClick={onClose} className="px-4 py-2 border border-[var(--border-input)] rounded-lg text-sm hover:bg-[var(--bg-body)]">
                        Close
                    </button>
                )}
            </div>

            {/* Printable voucher */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-8 max-w-[600px] mx-auto print:border-black print:rounded-none print:shadow-none">
                {/* Header */}
                <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
                    <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-wide">TRANSFER VOUCHER</h1>
                    <p className="text-lg font-mono font-bold text-blue-700 mt-1">{voucher.voucher_number}</p>
                </div>

                {/* Guest */}
                <div className="mb-6">
                    <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Guest Name</h2>
                    <p className="text-lg font-bold text-[var(--text-primary)]">{voucher.guest_name}</p>
                </div>

                {/* Route info */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                    {voucher.route_description && (
                        <div className="col-span-2">
                            <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Route</h2>
                            <p className="font-medium text-[var(--text-primary)]">{voucher.route_description}</p>
                        </div>
                    )}
                    {voucher.departure_time && (
                        <div>
                            <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Departure Time</h2>
                            <p className="font-mono font-bold text-lg text-[var(--text-primary)]">{voucher.departure_time}</p>
                        </div>
                    )}
                    {voucher.pier_name && (
                        <div>
                            <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Pier</h2>
                            <p className="font-medium text-[var(--text-primary)]">{voucher.pier_name}</p>
                        </div>
                    )}
                    {voucher.boat_company_name && (
                        <div>
                            <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Boat Company</h2>
                            <p className="font-medium text-blue-700">{voucher.boat_company_name}</p>
                        </div>
                    )}
                </div>

                {/* Pickup info */}
                <div className="bg-[var(--bg-body)] rounded-lg p-4 mb-6 print:bg-[var(--bg-surface)] print:border print:border-[var(--border-input)]">
                    <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-3">Pickup Details</h2>
                    <div className="grid grid-cols-2 gap-3">
                        {voucher.pickup_time && (
                            <div>
                                <p className="text-xs text-[var(--text-muted)]">Time</p>
                                <p className="font-mono font-bold text-lg">{voucher.pickup_time}</p>
                            </div>
                        )}
                        {voucher.pickup_location && (
                            <div>
                                <p className="text-xs text-[var(--text-muted)]">Location</p>
                                <p className="font-medium text-[var(--text-primary)]">{voucher.pickup_location}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Driver info */}
                {voucher.driver_name && (
                    <div className="mb-6">
                        <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-2">Driver</h2>
                        <div className="flex items-center gap-4">
                            <div>
                                <p className="font-medium text-[var(--text-primary)]">{voucher.driver_name}</p>
                                {voucher.driver_phone && <p className="text-sm text-[var(--text-muted)]">{voucher.driver_phone}</p>}
                            </div>
                            {voucher.vehicle_info && (
                                <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                    {voucher.vehicle_info}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {/* Special instructions */}
                {voucher.special_instructions && (
                    <div className="border-t border-[var(--border-default)] pt-4 mb-4">
                        <h2 className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Special Instructions</h2>
                        <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{voucher.special_instructions}</p>
                    </div>
                )}

                {/* Footer */}
                <div className="border-t-2 border-slate-800 pt-4 mt-6 text-center">
                    <p className="text-xs text-[var(--text-muted)]">Hotel PMS — Transportation Module</p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">Printed {new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}</p>
                </div>
            </div>
        </div>
    );
}
