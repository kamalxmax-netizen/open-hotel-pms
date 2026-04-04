"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_TRANSPORT_ALERT_LEAD_MINUTES, getTransportAlertLevel, normalizeTransportAlertLeadMinutes } from "@/lib/transport-alert-settings";

// ─── Types ────────────────────────────────────────────
interface TransferRow {
    id: string;
    guest_name: string;
    booking_code?: string;
    room_number?: string;
    transfer_type: string;
    service_mode: string;
    pickup_datetime: string;
    pickup_location: string;
    dropoff_location: string;
    pax: number;
    driver_id?: string | null;
    driver_name?: string;
    driver_phone?: string;
    boat_company_name?: string;
    boat_company_id?: string | null;
    boat_route_id?: string | null;
    selling_price: number | null;
    cost_price?: number | null;
    driver_fee?: number | null;
    driver_commission?: number | null;
    net_commission: number | null;
    payment_status: string;
    status: string;
    staff_note?: string | null;
}

interface DashboardData {
    date: string;
    summary: {
        total: number;
        pending: number;
        confirmed: number;
        in_progress: number;
        completed: number;
        cancelled: number;
    };
    transfers: TransferRow[];
}

interface Reservation {
    id: string;
    guest_name: string;
    booking_code: string;
    status?: string;
    checkin_date: string;
    checkout_date: string;
    room_number?: string;
}

interface Driver { id: string; name: string; phone: string | null; }
interface BoatCompany { id: string; name: string; }
interface BoatRoute { id: string; company_id: string; company_name?: string | null; origin: string; destination: string; boat_type: string; departure_times: string[]; ticket_price: number | null; cost_price: number | null; includes_pickup: boolean; pickup_fee: number | null; }

// ─── Constants ────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-amber-500/10 dark:text-amber-400",
    confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-500/10 dark:text-blue-400",
    driver_assigned: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-400",
    in_progress: "bg-green-100 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-400",
    completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    cancelled: "bg-red-100 text-red-800 dark:bg-rose-500/10 dark:text-rose-400",
    no_show: "bg-gray-100 text-gray-800 dark:bg-white/5 dark:text-white/40",
};

const PAYMENT_COLORS: Record<string, string> = {
    unpaid: "bg-orange-100 text-orange-800 dark:bg-orange-500/10 dark:text-orange-400",
    paid_to_hotel: "bg-green-100 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-400",
    paid_to_driver: "bg-blue-100 text-blue-800 dark:bg-blue-500/10 dark:text-blue-400",
    settled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
};

const TYPE_ICONS: Record<string, string> = {
    airport_pickup: "✈️", airport_dropoff: "✈️", hotel_to_anywhere: "🚗", bus_ferry_pickup: "⛵", ticket_only: "🎫",
};

const NEXT_STATUS: Record<string, string> = {
    pending: "confirmed", confirmed: "driver_assigned", driver_assigned: "in_progress", in_progress: "completed",
};
const IN_PROGRESS_LEAD_MINUTES = 30;

// ─── Helpers ──────────────────────────────────────────
function formatTime(dt: string) {
    try { return new Date(dt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }); }
    catch { return "—"; }
}

function toBangkokDateOnly(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) return iso.slice(0, 10);
    return `${year}-${month}-${day}`;
}

function isTransferCandidateReservation(row: Reservation, businessDate: string): boolean {
    if (row.status === "active") return true;
    return row.status === "checked_out" && row.checkout_date === businessDate;
}

function transferIcon(row: TransferRow): string {
    if (row.boat_route_id || row.boat_company_id || row.boat_company_name) return "⛵";
    return TYPE_ICONS[row.transfer_type] ?? "🚗";
}

function getUrgencyClass(dt: string, status: string, transportAlertLeadMin: number): string {
    if (["completed", "cancelled"].includes(status)) return "";
    const diffMin = (new Date(dt).getTime() - Date.now()) / 60000;
    if (diffMin < 0) return "border-l-4 border-l-red-500 bg-red-50 dark:bg-rose-500/5";
    const alertLevel = getTransportAlertLevel(Math.floor(diffMin * 60), transportAlertLeadMin);
    if (alertLevel === "red") return "border-l-4 border-l-orange-400 bg-orange-50 dark:bg-amber-500/5";
    if (alertLevel === "yellow") return "border-l-4 border-l-blue-300 dark:bg-blue-500/5";
    return "";
}

function canStartInProgressNow(pickupDatetime: string): boolean {
    const pickupMs = new Date(pickupDatetime).getTime();
    if (Number.isNaN(pickupMs)) return false;
    return Date.now() >= pickupMs - IN_PROGRESS_LEAD_MINUTES * 60 * 1000;
}

function formatBangkokDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

function earliestInProgressLabel(pickupDatetime: string): string {
    const pickupMs = new Date(pickupDatetime).getTime();
    if (Number.isNaN(pickupMs)) return "invalid pickup time";
    return formatBangkokDateTime(new Date(pickupMs - IN_PROGRESS_LEAD_MINUTES * 60 * 1000).toISOString());
}

function toDateTimeLocalValue(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

// ─── Status updater ───────────────────────────────────
async function updateStatus(transferId: string, newStatus: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/transportation/transfers/${transferId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
    });
    const json = await res.json();
    return {
        success: json.success === true,
        error: json.error,
    };
}

// ─── 5-Step Transfer Booking Modal ───────────────────
type Step = 1 | 2 | 3 | 4 | 5;
type TripMode = "car" | "boat";
const PAYMENT_METHODS = ["cash", "transfer", "credit_card"];

function TransferBookingModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (pickupDate: string | null) => void }) {
    const [step, setStep] = useState<Step>(1);

    // Step 1 — Reservation
    const [resSearch, setResSearch] = useState("");
    const [resResults, setResResults] = useState<Reservation[]>([]);
    const [selectedRes, setSelectedRes] = useState<Reservation | null>(null);
    const [resLoading, setResLoading] = useState(false);
    const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

    // Step 2 — Trip
    const [tripMode, setTripMode] = useState<TripMode>("car");
    const [transferType, setTransferType] = useState("airport_pickup");
    const [serviceMode, setServiceMode] = useState("hotel_arrange");
    const [pickupDatetime, setPickupDatetime] = useState(() => {
        const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0);
        return d.toISOString().slice(0, 16);
    });
    const [pickupLocation, setPickupLocation] = useState("");
    const [dropoffLocation, setDropoffLocation] = useState("");
    const [pax, setPax] = useState("1");
    const [luggage, setLuggage] = useState("0");
    const [staffNote, setStaffNote] = useState("");

    // Step 3 — Provider
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [companies, setCompanies] = useState<BoatCompany[]>([]);
    const [routes, setRoutes] = useState<BoatRoute[]>([]);
    const [providersLoading, setProvidersLoading] = useState(false);
    const [providersError, setProvidersError] = useState("");
    const [selectedDriverId, setSelectedDriverId] = useState("");
    const [selectedCompanyId, setSelectedCompanyId] = useState("");
    const [selectedRouteId, setSelectedRouteId] = useState("");
    const [selectedDepartureTime, setSelectedDepartureTime] = useState("");

    // Step 4 — Pricing
    const [sellingPrice, setSellingPrice] = useState("");
    const [costPrice, setCostPrice] = useState("");
    const [driverFee, setDriverFee] = useState("");
    const [driverCommission, setDriverCommission] = useState("0");
    const [paymentMethod, setPaymentMethod] = useState("");

    // Step 5 — result
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [showValidation, setShowValidation] = useState(false);
    const [voucherNumber, setVoucherNumber] = useState("");
    const [createdPickupDate, setCreatedPickupDate] = useState<string | null>(null);

    // Reservation search
    useEffect(() => {
        clearTimeout(searchTimeout.current);
        if (!resSearch.trim() || resSearch.length < 2) { setResResults([]); return; }
        searchTimeout.current = setTimeout(async () => {
            setResLoading(true);
            try {
                const res = await fetch(`/api/reservations?q=${encodeURIComponent(resSearch)}&status=all`);
                const json = await res.json();
                const businessDate = toBangkokDateOnly(new Date().toISOString());
                const rawRows = (json.reservations ?? json.data ?? []) as Reservation[];
                const filteredRows = rawRows
                    .filter((row) => isTransferCandidateReservation(row, businessDate))
                    .sort((a, b) => {
                        const aPriority = a.status === "active" ? 0 : 1;
                        const bPriority = b.status === "active" ? 0 : 1;
                        return aPriority - bPriority;
                    })
                    .slice(0, 10);
                setResResults(filteredRows);
            } catch { setResResults([]); } finally { setResLoading(false); }
        }, 350);
    }, [resSearch]);

    // Load providers on step 3
    useEffect(() => {
        if (step !== 3) return;
        let alive = true;
        (async () => {
            setProvidersLoading(true);
            setProvidersError("");
            const [driversRes, companiesRes, routesRes] = await Promise.allSettled([
                fetch("/api/transportation/drivers?is_active=all", { cache: "no-store" }).then(async (r) => {
                    const json = await r.json();
                    if (!r.ok || !json?.success) throw new Error(json?.error ?? "drivers API failed");
                    return json;
                }),
                fetch("/api/transportation/companies?is_active=all", { cache: "no-store" }).then(async (r) => {
                    const json = await r.json();
                    if (!r.ok || !json?.success) throw new Error(json?.error ?? "companies API failed");
                    return json;
                }),
                fetch("/api/transportation/routes?is_active=all", { cache: "no-store" }).then(async (r) => {
                    const json = await r.json();
                    if (!r.ok || !json?.success) throw new Error(json?.error ?? "routes API failed");
                    return json;
                }),
            ]);

            if (!alive) return;
            const failed: string[] = [];

            if (driversRes.status === "fulfilled") setDrivers(driversRes.value.drivers ?? []);
            else {
                setDrivers([]);
                failed.push("drivers");
            }

            if (companiesRes.status === "fulfilled") setCompanies(companiesRes.value.companies ?? []);
            else {
                setCompanies([]);
                failed.push("boat companies");
            }

            if (routesRes.status === "fulfilled") setRoutes(routesRes.value.routes ?? []);
            else {
                setRoutes([]);
                failed.push("boat routes");
            }

            if (failed.length > 0) {
                setProvidersError(`Failed to load: ${failed.join(", ")}. Please refresh or check setup.`);
            }
            setProvidersLoading(false);
        })();

        return () => {
            alive = false;
        };
    }, [step]);

    // Auto-fill pricing from route
    useEffect(() => {
        if (!selectedRouteId) return;
        const route = routes.find(r => r.id === selectedRouteId);
        if (route) {
            setSelectedCompanyId(route.company_id);
            setPickupLocation(route.origin ?? "");
            setDropoffLocation(route.destination ?? "");
            if (route.ticket_price != null) setSellingPrice(String(route.ticket_price));
            if (route.cost_price != null) setCostPrice(String(route.cost_price));
            const firstTime = route.departure_times?.[0] ?? "";
            setSelectedDepartureTime(firstTime);
            if (tripMode === "boat") {
                setTransferType(route.includes_pickup ? "bus_ferry_pickup" : "ticket_only");
                setServiceMode(route.includes_pickup ? "company_pickup" : "ticket_only");
                if (firstTime) {
                    const datePart = pickupDatetime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
                    setPickupDatetime(`${datePart}T${firstTime}`);
                }
            }
        }
    }, [selectedRouteId, routes, tripMode]);

    useEffect(() => {
        if (tripMode === "boat") {
            if (!["bus_ferry_pickup", "ticket_only"].includes(transferType)) {
                setTransferType("ticket_only");
            }
            if (!["ticket_only", "company_pickup"].includes(serviceMode)) {
                setServiceMode("ticket_only");
            }
            setSelectedDriverId("");
            return;
        }

        if (["bus_ferry_pickup", "ticket_only"].includes(transferType)) {
            setTransferType("hotel_to_anywhere");
        }
        if (serviceMode === "ticket_only") {
            setServiceMode("hotel_arrange");
        }
        setSelectedCompanyId("");
        setSelectedRouteId("");
        setSelectedDepartureTime("");
    }, [tripMode]);

    const filteredRoutes = routes.filter(r => !selectedCompanyId || r.company_id === selectedCompanyId);
    const isBoatType = tripMode === "boat";

    async function handleSubmit() {
        if (!selectedRes) return;
        setShowValidation(true);
        setSubmitting(true); setSubmitError("");
        try {
            const selectedRoute = selectedRouteId ? routes.find((r) => r.id === selectedRouteId) : null;
            const departureNote = isBoatType && selectedDepartureTime ? `Boat departure: ${selectedDepartureTime}` : null;
            const mergedStaffNote = [staffNote.trim(), departureNote].filter(Boolean).join(" | ") || null;

            let resolvedTransferType = transferType;
            let resolvedServiceMode = serviceMode;
            let resolvedPickupDatetimeIso = "";
            let resolvedPickupLocation = pickupLocation.trim();
            let resolvedDropoffLocation = dropoffLocation.trim();
            let resolvedDriverId: string | null = selectedDriverId || null;
            let resolvedBoatCompanyId: string | null = selectedCompanyId || null;
            let resolvedBoatRouteId: string | null = selectedRouteId || null;

            if (isBoatType) {
                if (!selectedRoute) throw new Error("Please select boat route.");
                if (!selectedDepartureTime) throw new Error("Please select departure time.");
                const datePart = pickupDatetime?.slice(0, 10);
                if (!datePart) throw new Error("Please select travel date.");
                const composedLocal = `${datePart}T${selectedDepartureTime}`;
                const composedDate = new Date(composedLocal);
                if (Number.isNaN(composedDate.getTime())) throw new Error("Boat departure date/time is invalid.");

                resolvedPickupDatetimeIso = composedDate.toISOString();
                resolvedPickupLocation = selectedRoute.origin;
                resolvedDropoffLocation = selectedRoute.destination;
                resolvedTransferType = selectedRoute.includes_pickup ? "bus_ferry_pickup" : "ticket_only";
                resolvedServiceMode = selectedRoute.includes_pickup ? "company_pickup" : "ticket_only";
                resolvedDriverId = null;
                resolvedBoatCompanyId = selectedRoute.company_id;
                resolvedBoatRouteId = selectedRoute.id;
            } else {
                const manualDate = new Date(pickupDatetime);
                if (Number.isNaN(manualDate.getTime())) throw new Error("Pickup date/time is invalid.");
                if (!resolvedPickupLocation || !resolvedDropoffLocation) {
                    throw new Error("Pickup and drop-off locations are required.");
                }
                resolvedPickupDatetimeIso = manualDate.toISOString();
                resolvedBoatCompanyId = null;
                resolvedBoatRouteId = null;
            }

            const body = {
                reservation_id: selectedRes.id,
                transfer_type: resolvedTransferType,
                service_mode: resolvedServiceMode,
                pickup_datetime: resolvedPickupDatetimeIso,
                pickup_location: resolvedPickupLocation,
                dropoff_location: resolvedDropoffLocation,
                pax: parseInt(pax) || 1,
                luggage_count: parseInt(luggage) || 0,
                driver_id: resolvedDriverId,
                boat_company_id: resolvedBoatCompanyId,
                boat_route_id: resolvedBoatRouteId,
                selling_price: sellingPrice ? parseFloat(sellingPrice) : null,
                cost_price: costPrice ? parseFloat(costPrice) : null,
                driver_fee: driverFee ? parseFloat(driverFee) : null,
                driver_commission: parseFloat(driverCommission) || 0,
                payment_method: paymentMethod || null,
                staff_note: mergedStaffNote,
                created_by: "Front Desk",
            };
            const res = await fetch("/api/transportation/transfers", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error ?? "Failed to create transfer");
            setVoucherNumber(json.voucher_number ?? "");
            setCreatedPickupDate(toBangkokDateOnly(resolvedPickupDatetimeIso));
            setShowValidation(false);
            setStep(5);
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : "Unexpected error");
        } finally { setSubmitting(false); }
    }

    const inputCls = "w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
    const invalidCls = "border-rose-300 bg-rose-50 focus:ring-rose-200 focus:border-rose-400";
    const canNext1 = selectedRes !== null;
    const canNext2 = isBoatType
        ? Boolean(pickupDatetime?.slice(0, 10))
        : Boolean(pickupLocation.trim() && dropoffLocation.trim() && pickupDatetime);
    const canSubmit = canNext1 && canNext2 && (!isBoatType || Boolean(selectedRouteId && selectedDepartureTime));
    const boatTravelDateInvalid = showValidation && isBoatType && !pickupDatetime?.slice(0, 10);
    const boatRouteInvalid = showValidation && isBoatType && !selectedRouteId;
    const boatDepartureInvalid = showValidation && isBoatType && !selectedDepartureTime;
    const carPickupDatetimeInvalid = showValidation && !isBoatType && !pickupDatetime;
    const carPickupLocationInvalid = showValidation && !isBoatType && !pickupLocation.trim();
    const carDropoffLocationInvalid = showValidation && !isBoatType && !dropoffLocation.trim();

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={step < 5 ? onClose : undefined}>
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-default)] px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-[var(--text-primary)]">New Transfer Booking</h2>
                        {step < 5 && <p className="text-xs text-[var(--text-muted)] mt-0.5">Step {step} of 4</p>}
                    </div>
                    {step < 5 && <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xl">×</button>}
                </div>

                {/* Progress bar */}
                {step < 5 && (
                    <div className="h-1 bg-[var(--bg-muted)]">
                        <div className="h-1 bg-blue-500 transition-all duration-300" style={{ width: `${(step / 4) * 100}%` }} />
                    </div>
                )}

                <div className="p-6">
                    {/* ── Step 1: Guest ── */}
                    {step === 1 && (
                        <div>
                            <h3 className="font-semibold text-[var(--text-primary)] mb-4">Find Reservation</h3>
                            <input autoFocus type="text" placeholder="Search by guest name or booking code…" value={resSearch} onChange={e => setResSearch(e.target.value)}
                                className={inputCls} />
                            {resLoading && <p className="text-xs text-[var(--text-muted)] mt-2">Searching…</p>}
                            {resResults.length > 0 && (
                                <div className="mt-2 border border-[var(--border-default)] rounded-xl overflow-hidden">
                                    {resResults.map(r => (
                                        <button key={r.id} type="button" onClick={() => setSelectedRes(r)}
                                            className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-[var(--border-subtle)] last:border-0 ${selectedRes?.id === r.id ? "bg-blue-50" : ""}`}>
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-[var(--text-primary)]">{r.guest_name}</p>
                                                    <p className="text-xs text-[var(--text-muted)] font-mono">{r.booking_code}</p>
                                                </div>
                                                <div className="text-right text-xs text-[var(--text-muted)]">
                                                    <p>{r.checkin_date} → {r.checkout_date}</p>
                                                    {r.room_number && <p>Room {r.room_number}</p>}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {selectedRes && (
                                <div className="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                                    <p className="text-xs font-semibold text-blue-700">Selected Guest</p>
                                    <p className="font-bold text-[var(--text-primary)]">{selectedRes.guest_name}</p>
                                    <p className="text-xs font-mono text-[var(--text-secondary)]">{selectedRes.booking_code}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Step 2: Trip ── */}
                    {step === 2 && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-[var(--text-primary)]">✈️ Trip Details — {selectedRes?.guest_name}</h3>
                            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
                                <p className="text-xs font-semibold text-[var(--text-secondary)]">Transport Mode</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tripMode === "car" ? "border-blue-400 bg-blue-50 text-blue-700" : "border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`}>
                                        <input
                                            type="radio"
                                            name="trip-mode"
                                            checked={tripMode === "car"}
                                            onChange={() => setTripMode("car")}
                                        />
                                        Car
                                    </label>
                                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tripMode === "boat" ? "border-blue-400 bg-blue-50 text-blue-700" : "border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`}>
                                        <input
                                            type="radio"
                                            name="trip-mode"
                                            checked={tripMode === "boat"}
                                            onChange={() => setTripMode("boat")}
                                        />
                                        Boat
                                    </label>
                                </div>
                            </div>

                            {isBoatType ? (
                                <>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Travel Date *</label>
                                        <input
                                            type="date"
                                            value={pickupDatetime?.slice(0, 10) ?? ""}
                                            onChange={(e) => {
                                                const datePart = e.target.value;
                                                const timePart = selectedDepartureTime || "08:00";
                                                setPickupDatetime(datePart ? `${datePart}T${timePart}` : "");
                                            }}
                                            className={`${inputCls} ${boatTravelDateInvalid ? invalidCls : ""}`}
                                            required
                                            aria-invalid={boatTravelDateInvalid ? "true" : "false"}
                                        />
                                        {boatTravelDateInvalid && <p className="mt-1 text-xs text-rose-600">Please select travel date.</p>}
                                    </div>
                                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                        Boat route/time will be selected in Step 3 from saved ticket schedules.
                                        {selectedRouteId && (
                                            <div className="mt-1 text-blue-800">
                                                {(() => {
                                                    const route = routes.find((r) => r.id === selectedRouteId);
                                                    if (!route) return null;
                                                    return (
                                                        <span>
                                                            Selected: {route.origin} → {route.destination}
                                                            {selectedDepartureTime ? ` at ${selectedDepartureTime}` : ""}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Transfer Type</label>
                                            <select value={transferType} onChange={e => setTransferType(e.target.value)} className={inputCls}>
                                                {["airport_pickup", "airport_dropoff", "hotel_to_anywhere"].map(t => (
                                                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Service Mode</label>
                                            <select value={serviceMode} onChange={e => setServiceMode(e.target.value)} className={inputCls}>
                                                {["company_pickup", "hotel_arrange", "driver_only"].map(m => (
                                                    <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pickup Date & Time *</label>
                                        <input
                                            type="datetime-local"
                                            value={pickupDatetime}
                                            onChange={e => setPickupDatetime(e.target.value)}
                                            className={`${inputCls} ${carPickupDatetimeInvalid ? invalidCls : ""}`}
                                            required
                                            aria-invalid={carPickupDatetimeInvalid ? "true" : "false"}
                                        />
                                        {carPickupDatetimeInvalid && <p className="mt-1 text-xs text-rose-600">Pickup date/time is required.</p>}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pickup Location *</label>
                                        <input
                                            type="text"
                                            value={pickupLocation}
                                            onChange={e => setPickupLocation(e.target.value)}
                                            placeholder="e.g. Hotel Lobby / Example Airport"
                                            className={`${inputCls} ${carPickupLocationInvalid ? invalidCls : ""}`}
                                            required
                                            aria-invalid={carPickupLocationInvalid ? "true" : "false"}
                                        />
                                        {carPickupLocationInvalid && <p className="mt-1 text-xs text-rose-600">Pickup location is required.</p>}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Drop-off Location *</label>
                                        <input
                                            type="text"
                                            value={dropoffLocation}
                                            onChange={e => setDropoffLocation(e.target.value)}
                                            placeholder="e.g. Example Pier / Island C"
                                            className={`${inputCls} ${carDropoffLocationInvalid ? invalidCls : ""}`}
                                            required
                                            aria-invalid={carDropoffLocationInvalid ? "true" : "false"}
                                        />
                                        {carDropoffLocationInvalid && <p className="mt-1 text-xs text-rose-600">Drop-off location is required.</p>}
                                    </div>
                                </>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Passengers</label>
                                    <input type="number" min="1" max="50" value={pax} onChange={e => setPax(e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Luggage</label>
                                    <input type="number" min="0" max="20" value={luggage} onChange={e => setLuggage(e.target.value)} className={inputCls} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Staff Note</label>
                                <textarea rows={2} value={staffNote} onChange={e => setStaffNote(e.target.value)} placeholder="Internal notes…" className={inputCls} />
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Provider ── */}
                    {step === 3 && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-[var(--text-primary)]">🚗 Provider</h3>
                            {providersLoading && (
                                <p className="text-xs text-[var(--text-secondary)]">Loading provider data…</p>
                            )}
                            {providersError && (
                                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                                    {providersError}
                                </p>
                            )}
                            {isBoatType ? (
                                <>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Boat Company</label>
                                        <select value={selectedCompanyId} onChange={e => { setSelectedCompanyId(e.target.value); setSelectedRouteId(""); }} className={inputCls}>
                                            <option value="">— Select company —</option>
                                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Route / Schedule</label>
                                        <select
                                            value={selectedRouteId}
                                            onChange={e => setSelectedRouteId(e.target.value)}
                                            className={`${inputCls} ${boatRouteInvalid ? invalidCls : ""}`}
                                            required
                                            aria-invalid={boatRouteInvalid ? "true" : "false"}
                                        >
                                            <option value="">— Select route —</option>
                                            {filteredRoutes.map(r => (
                                                <option key={r.id} value={r.id}>
                                                    {r.origin} → {r.destination} ({r.departure_times.join(", ")})
                                                    {!selectedCompanyId && r.company_name ? ` · ${r.company_name}` : ""}
                                                </option>
                                            ))}
                                        </select>
                                        {!providersLoading && filteredRoutes.length === 0 && (
                                            <p className="mt-1 text-xs text-amber-700">
                                                No route schedule found for this company.
                                            </p>
                                        )}
                                        {boatRouteInvalid && <p className="mt-1 text-xs text-rose-600">Please select boat route.</p>}
                                    </div>
                                    {selectedRouteId && (() => {
                                        const route = routes.find(r => r.id === selectedRouteId);
                                        return route ? (
                                            <div>
                                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Departure Time</label>
                                                <select
                                                    value={selectedDepartureTime}
                                                    onChange={e => {
                                                        const nextTime = e.target.value;
                                                        setSelectedDepartureTime(nextTime);
                                                        const datePart = pickupDatetime?.slice(0, 10) || new Date().toISOString().slice(0, 10);
                                                        setPickupDatetime(`${datePart}T${nextTime}`);
                                                    }}
                                                    className={`${inputCls} ${boatDepartureInvalid ? invalidCls : ""}`}
                                                    required
                                                    aria-invalid={boatDepartureInvalid ? "true" : "false"}
                                                >
                                                    {route.departure_times.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                                {boatDepartureInvalid && <p className="mt-1 text-xs text-rose-600">Please select departure time.</p>}
                                            </div>
                                        ) : null;
                                    })()}
                                </>
                            ) : (
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Assign Driver (optional)</label>
                                    <select value={selectedDriverId} onChange={e => setSelectedDriverId(e.target.value)} className={inputCls}>
                                        <option value="">— Unassigned —</option>
                                        {drivers.filter(d => (d as any).is_active !== false).map(d => <option key={d.id} value={d.id}>{d.name}{d.phone ? ` · ${d.phone}` : ""}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Step 4: Pricing ── */}
                    {step === 4 && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-[var(--text-primary)]">💰 Pricing</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Selling Price ฿</label>
                                    <input type="number" min="0" value={sellingPrice} onChange={e => setSellingPrice(e.target.value)} placeholder="0" className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Cost Price ฿</label>
                                    <input type="number" min="0" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="0" className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Driver Fee ฿</label>
                                    <input type="number" min="0" value={driverFee} onChange={e => setDriverFee(e.target.value)} placeholder="0" className={inputCls} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Commission ฿</label>
                                    <input type="number" min="0" value={driverCommission} onChange={e => setDriverCommission(e.target.value)} placeholder="0" className={inputCls} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Payment Method</label>
                                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={inputCls}>
                                    <option value="">unpaid</option>
                                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
                                </select>
                            </div>

                            {/* Summary */}
                            <div className="bg-[var(--bg-body)] rounded-xl p-4 text-sm space-y-1">
                                <p className="font-semibold text-[var(--text-table-cell)] mb-2">Summary</p>
                                <p><span className="text-[var(--text-secondary)]">Guest:</span> <strong>{selectedRes?.guest_name}</strong></p>
                                <p><span className="text-[var(--text-secondary)]">Mode:</span> {isBoatType ? "Boat" : "Car"}</p>
                                <p><span className="text-[var(--text-secondary)]">Type:</span> {transferType.replace(/_/g, " ")}</p>
                                <p><span className="text-[var(--text-secondary)]">Pickup:</span> {pickupDatetime ? new Date(pickupDatetime).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) : "—"}</p>
                                <p><span className="text-[var(--text-secondary)]">Route:</span> {pickupLocation} → {dropoffLocation}</p>
                                <p><span className="text-[var(--text-secondary)]">Pax:</span> {pax} · Luggage: {luggage}</p>
                                {sellingPrice && <p><span className="text-[var(--text-secondary)]">Sell:</span> <strong className="text-green-700">฿{parseFloat(sellingPrice).toLocaleString()}</strong></p>}
                                {costPrice && <p><span className="text-[var(--text-secondary)]">Net commission:</span> <strong className="text-blue-700">฿{(parseFloat(sellingPrice || "0") - parseFloat(costPrice || "0")).toLocaleString()}</strong></p>}
                            </div>
                            {submitError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{submitError}</p>}
                        </div>
                    )}

                    {/* ── Step 5: Success ── */}
                    {step === 5 && (
                        <div className="text-center py-6">
                            <div className="text-5xl mb-4">✅</div>
                            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-1">Transfer Booked!</h3>
                            {voucherNumber && (
                                <div className="mt-3 inline-block px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                                    <p className="text-xs text-blue-500 font-semibold">VOUCHER</p>
                                    <p className="text-lg font-mono font-bold text-blue-700">{voucherNumber}</p>
                                </div>
                            )}
                            <p className="text-sm text-[var(--text-secondary)] mt-3">
                                Transfer logged · Alert & Trace created · Folio posted
                            </p>
                            <div className="flex gap-3 mt-6 justify-center">
                                <button onClick={() => { onSuccess(createdPickupDate); onClose(); }}
                                    className="px-5 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">Done</button>
                                {voucherNumber && (
                                    <a href={`/pms/transportation?print=${voucherNumber}`} target="_blank"
                                        className="px-5 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">
                                        🖨️ Print Voucher
                                    </a>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer nav */}
                {step < 5 && (
                    <div className="sticky bottom-0 bg-[var(--bg-surface)] border-t border-[var(--border-default)] px-6 py-4 flex gap-3 rounded-b-2xl">
                        {step > 1 && (
                            <button onClick={() => setStep(s => (s - 1) as Step)} className="px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">← Back</button>
                        )}
                        <div className="flex-1" />
                        {step < 4 ? (
                            <button
                                onClick={() => setStep(s => (s + 1) as Step)}
                                disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
                                className="px-5 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                Next →
                            </button>
                        ) : (
                            <button onClick={handleSubmit} disabled={submitting || !canSubmit}
                                className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50">
                                {submitting ? "Booking…" : "✓ Confirm Booking"}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function EditTransferModal({
    transfer,
    onClose,
    onSaved,
}: {
    transfer: TransferRow;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const [loadingDrivers, setLoadingDrivers] = useState(false);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [saving, setSaving] = useState(false);

    const [pickupDatetime, setPickupDatetime] = useState(() => toDateTimeLocalValue(transfer.pickup_datetime));
    const [driverId, setDriverId] = useState(transfer.driver_id ?? "");
    const [sellingPrice, setSellingPrice] = useState(transfer.selling_price != null ? String(transfer.selling_price) : "");
    const [costPrice, setCostPrice] = useState(transfer.cost_price != null ? String(transfer.cost_price) : "");
    const [driverFee, setDriverFee] = useState(transfer.driver_fee != null ? String(transfer.driver_fee) : "");
    const [driverCommission, setDriverCommission] = useState(
        transfer.driver_commission != null ? String(transfer.driver_commission) : "0"
    );
    const [staffNote, setStaffNote] = useState(transfer.staff_note ?? "");
    const [error, setError] = useState("");
    const [showValidation, setShowValidation] = useState(false);

    useEffect(() => {
        let active = true;
        setLoadingDrivers(true);
        fetch("/api/transportation/drivers?is_active=all&sort=name")
            .then((r) => r.json())
            .then((json) => {
                if (!active) return;
                if (json.success) setDrivers(json.drivers ?? []);
            })
            .catch(() => { })
            .finally(() => {
                if (active) setLoadingDrivers(false);
            });
        return () => { active = false; };
    }, []);

    function parseMoneyInput(label: string, raw: string, fallback: number | null = null): number | null {
        const trimmed = raw.trim();
        if (trimmed.length === 0) return fallback;
        const value = Number(trimmed);
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label} must be a number >= 0`);
        }
        return Number(value.toFixed(2));
    }

    async function saveChanges() {
        setShowValidation(true);
        setError("");
        if (!pickupDatetime) {
            setError("Pickup date/time is required.");
            return;
        }
        const pickup = new Date(pickupDatetime);
        if (Number.isNaN(pickup.getTime())) {
            setError("Pickup date/time is invalid.");
            return;
        }

        setSaving(true);
        try {
            const payload = {
                pickup_datetime: pickup.toISOString(),
                driver_id: driverId || null,
                selling_price: parseMoneyInput("Selling price", sellingPrice, null),
                cost_price: parseMoneyInput("Cost price", costPrice, null),
                driver_fee: parseMoneyInput("Driver fee", driverFee, null),
                driver_commission: parseMoneyInput("Driver commission", driverCommission, 0) ?? 0,
                staff_note: staffNote.trim() || null,
            };

            const res = await fetch(`/api/transportation/transfers/${transfer.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error ?? "Failed to save booking changes.");
                return;
            }

            setShowValidation(false);
            await onSaved();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save booking changes.");
        } finally {
            setSaving(false);
        }
    }

    const fieldCls = "w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
    const fieldInvalidCls = "border-rose-300 bg-rose-50 focus:ring-rose-200 focus:border-rose-400";
    const pickupDatetimeInvalid = showValidation && !pickupDatetime;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[var(--bg-surface)] rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-default)] px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-[var(--text-primary)]">Edit Booking</h2>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            {transfer.guest_name} {transfer.booking_code ? `(${transfer.booking_code})` : ""}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xl">×</button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Pickup Date & Time</label>
                            <input
                                type="datetime-local"
                                value={pickupDatetime}
                                onChange={(e) => setPickupDatetime(e.target.value)}
                                className={`${fieldCls} ${pickupDatetimeInvalid ? fieldInvalidCls : ""}`}
                                required
                                aria-invalid={pickupDatetimeInvalid ? "true" : "false"}
                            />
                            {pickupDatetimeInvalid && <p className="mt-1 text-xs text-rose-600">Pickup date/time is required.</p>}
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Driver</label>
                            <select
                                value={driverId}
                                onChange={(e) => setDriverId(e.target.value)}
                                className={fieldCls}
                                disabled={loadingDrivers}
                            >
                                <option value="">— Unassigned —</option>
                                {drivers.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {d.name}{d.phone ? ` · ${d.phone}` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Selling Price ฿</label>
                            <input type="number" min="0" step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} className={fieldCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Cost Price ฿</label>
                            <input type="number" min="0" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} className={fieldCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Driver Fee ฿</label>
                            <input type="number" min="0" step="0.01" value={driverFee} onChange={(e) => setDriverFee(e.target.value)} className={fieldCls} />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Driver Commission ฿</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={driverCommission}
                                onChange={(e) => setDriverCommission(e.target.value)}
                                className={fieldCls}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Staff Note</label>
                        <textarea rows={3} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} className={fieldCls} />
                    </div>

                    {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                </div>

                <div className="sticky bottom-0 bg-[var(--bg-surface)] border-t border-[var(--border-default)] px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
                    <button onClick={onClose} disabled={saving} className="px-4 py-2 border border-[var(--border-input)] rounded-xl text-[var(--text-table-cell)] hover:bg-[var(--bg-body)]">
                        Cancel
                    </button>
                    <button onClick={saveChanges} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Daily Board Page ────────────────────────────
export default function TransportationDailyBoard() {
    const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [data, setData] = useState<DashboardData | null>(null);
    const [transportAlertLeadMin, setTransportAlertLeadMin] = useState(DEFAULT_TRANSPORT_ALERT_LEAD_MINUTES);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingTransfer, setEditingTransfer] = useState<TransferRow | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/transportation/dashboard?date=${date}`);
            const json = await res.json();
            if (json.success) setData(json);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, [date]);

    const handleTransferCreated = useCallback((pickupDate: string | null) => {
        if (pickupDate && pickupDate !== date) {
            setDate(pickupDate);
            return;
        }
        fetchData();
    }, [date, fetchData]);

    const fetchTransportSettings = useCallback(async () => {
        try {
            const res = await fetch("/api/settings", { cache: "no-store" });
            const json = await res.json();
            if (json.success) {
                setTransportAlertLeadMin(normalizeTransportAlertLeadMinutes(json.settings?.transport_alert_lead_min));
            }
        } catch {
            setTransportAlertLeadMin(DEFAULT_TRANSPORT_ALERT_LEAD_MINUTES);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { fetchTransportSettings(); }, [fetchTransportSettings]);
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                fetchData();
            }
        };
        const t = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchData();
            }
        }, 30000);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearInterval(t);
        };
    }, [fetchData]);

    async function advanceStatus(t: TransferRow) {
        const next = NEXT_STATUS[t.status];
        if (!next) return;
        if (next === "in_progress" && !canStartInProgressNow(t.pickup_datetime)) {
            alert(`In Progress allowed from ${earliestInProgressLabel(t.pickup_datetime)} (Asia/Bangkok). Edit pickup time if schedule changed.`);
            return;
        }
        setUpdatingId(t.id);
        try {
            const result = await updateStatus(t.id, next);
            if (!result.success) {
                alert(result.error ?? "Failed to update status.");
            }
            await fetchData();
        } catch {
            alert("Network error while updating status.");
        } finally {
            setUpdatingId(null);
        }
    }

    return (
        <div className="p-6 max-w-[1400px] mx-auto">
            {showModal && <TransferBookingModal onClose={() => setShowModal(false)} onSuccess={handleTransferCreated} />}
            {editingTransfer && (
                <EditTransferModal
                    transfer={editingTransfer}
                    onClose={() => setEditingTransfer(null)}
                    onSaved={fetchData}
                />
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Transportation — Daily Board</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Transfer schedule sorted by pickup time · Auto-refreshes every 30s</p>
                </div>
                <div className="flex items-center gap-3">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 border border-[var(--border-input)] rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                    <button onClick={fetchData} className="px-4 py-2 border border-[var(--border-input)] text-[var(--text-table-cell)] rounded-xl text-sm hover:bg-[var(--bg-body)]">↺ Refresh</button>
                    <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
                        + New Transfer
                    </button>
                </div>
            </div>

            {/* Summary cards */}
            {data?.summary && (
                <div className="grid grid-cols-6 gap-3 mb-6">
                    {[
                        { label: "Total", value: data.summary.total, color: "bg-[var(--bg-muted)] text-[var(--text-primary)]" },
                        { label: "Pending", value: data.summary.pending, color: "bg-yellow-100 text-yellow-800 dark:bg-amber-500/10 dark:text-amber-400" },
                        { label: "Confirmed", value: data.summary.confirmed, color: "bg-blue-100 text-blue-800 dark:bg-blue-500/10 dark:text-blue-400" },
                        { label: "In Progress", value: data.summary.in_progress, color: "bg-green-100 text-green-800 dark:bg-emerald-500/10 dark:text-emerald-400" },
                        { label: "Completed", value: data.summary.completed, color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
                        { label: "Cancelled", value: data.summary.cancelled, color: "bg-red-100 text-red-800 dark:bg-rose-500/10 dark:text-rose-400" },
                    ].map(({ label, value, color }) => (
                        <div key={label} className={`rounded-xl p-4 ${color}`}>
                            <p className="text-xs font-medium opacity-70">{label}</p>
                            <p className="text-2xl font-bold mt-1">{value}</p>
                        </div>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                </div>
            ) : !data?.transfers?.length ? (
                <div className="text-center py-20 text-[var(--text-muted)]">
                    <p className="text-lg">No transfers for {date}</p>
                    <button onClick={() => setShowModal(true)} className="mt-3 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm">+ New Transfer</button>
                </div>
            ) : (
                <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] overflow-hidden shadow-sm">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-[var(--bg-body)] border-b border-[var(--border-default)] dark:bg-white/5">
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Time</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Guest</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Room</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Route</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Driver / Boat</th>
                                <th className="px-4 py-3 text-right font-semibold text-[var(--text-secondary)]">฿ Sell</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Payment</th>
                                <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Status</th>
                                <th className="px-4 py-3 text-center font-semibold text-[var(--text-secondary)]">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.transfers.map(t => (
                                <tr key={t.id} className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-body)] ${getUrgencyClass(t.pickup_datetime, t.status, transportAlertLeadMin)}`}>
                                    <td className="px-4 py-3 font-mono font-bold">{formatTime(t.pickup_datetime)}</td>
                                    <td className="px-4 py-3 text-lg">{transferIcon(t)}</td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-[var(--text-primary)]">{t.guest_name}</p>
                                        {t.booking_code && <p className="text-xs text-[var(--text-muted)] font-mono">{t.booking_code}</p>}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{t.room_number ?? "—"}</td>
                                    <td className="px-4 py-3">
                                        <p className="text-[var(--text-table-cell)] truncate max-w-[180px]">{t.pickup_location} → {t.dropoff_location}</p>
                                        {t.boat_company_name && <p className="text-xs text-blue-600 dark:text-blue-400">{t.boat_company_name}</p>}
                                    </td>
                                    <td className="px-4 py-3">
                                        {t.driver_name ? (
                                            <div>
                                                <p className="text-[var(--text-table-cell)] font-medium">{t.driver_name}</p>
                                                {t.driver_phone && <p className="text-xs text-[var(--text-muted)]">{t.driver_phone}</p>}
                                            </div>
                                        ) : <span className="text-[var(--text-muted)] italic">Unassigned</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">{t.selling_price != null ? `฿${t.selling_price.toLocaleString()}` : "—"}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_COLORS[t.payment_status] ?? "bg-gray-100 dark:bg-white/5"}`}>
                                            {t.payment_status.replace(/_/g, " ")}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? "bg-gray-100 dark:bg-white/5"}`}>
                                            {t.status.replace(/_/g, " ")}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => setEditingTransfer(t)}
                                                disabled={["completed", "cancelled", "no_show"].includes(t.status)}
                                                className="px-2 py-1 text-xs bg-[var(--bg-body)] border border-[var(--border-input)] text-[var(--text-table-cell)] rounded-lg hover:bg-[var(--bg-surface-hover)] dark:bg-white/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={["completed", "cancelled", "no_show"].includes(t.status) ? "Closed bookings cannot be edited" : "Edit booking"}
                                            >
                                                Edit
                                            </button>
                                            {(() => {
                                                const nextStatus = NEXT_STATUS[t.status];
                                                if (!nextStatus) return null;
                                                const blockedByStartWindow =
                                                    nextStatus === "in_progress" && !canStartInProgressNow(t.pickup_datetime);
                                                const disabled = updatingId === t.id || blockedByStartWindow;
                                                const title = blockedByStartWindow
                                                    ? `Can start from ${earliestInProgressLabel(t.pickup_datetime)} (Asia/Bangkok)`
                                                    : undefined;
                                                return (
                                                    <button
                                                        disabled={disabled}
                                                        onClick={() => advanceStatus(t)}
                                                        title={title}
                                                        className="px-2 py-1 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 dark:bg-blue-500/10 dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {updatingId === t.id ? "…" : nextStatus.replace(/_/g, " ") + " →"}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
