"use client";

import { useState, useEffect } from "react";
import PmsModal from "../pms-modal";
import { VehicleType, VehicleColor } from "@/lib/types";
import { THAI_PROVINCES, MALAYSIAN_STATES } from "./province-data";
import { registerVehicle, useInHouseReservationOptions } from "@/lib/use-vehicle-api";

interface VehicleRegisterModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialReservationId?: string;
  initialRoomNumber?: string;
  initialGuestName?: string;
}

export function VehicleRegisterModal({ 
  onClose, 
  onSuccess,
  initialReservationId, 
  initialRoomNumber,
  initialGuestName 
}: VehicleRegisterModalProps) {
  const { reservations, loading: reservationsLoading, error: reservationsError } = useInHouseReservationOptions(!initialReservationId);
  
  const [reservationId, setReservationId] = useState(initialReservationId || "");
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [country, setCountry] = useState<"TH" | "MY">("TH");
  const [plateNumber, setPlateNumber] = useState("");
  const [province, setProvince] = useState(THAI_PROVINCES[0]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState<VehicleColor>("white");
  const [description, setDescription] = useState("");
  
  const [searchTerm, setSearchTerm] = useState(initialRoomNumber ? `Room ${initialRoomNumber}` : "");
  const [showSearch, setShowSearch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync province default when country changes
  useEffect(() => {
    setProvince(country === "TH" ? THAI_PROVINCES[0] : MALAYSIAN_STATES[0]);
  }, [country]);

  // Handle Bicycle special rules (D3)
  useEffect(() => {
    if (vehicleType === 'bicycle') {
      setColor('other');
    }
  }, [vehicleType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validate
    if (!reservationId) {
      setError("Please select a reservation.");
      return;
    }
    if (vehicleType !== 'bicycle' && !plateNumber) {
      setError("Please enter plate number.");
      return;
    }

    try {
      setSubmitting(true);
      await registerVehicle({
        reservation_id: reservationId,
        vehicle_type: vehicleType,
        plate_number: plateNumber || null,
        plate_province: vehicleType === "bicycle" ? null : province,
        plate_country: country,
        vehicle_brand: brand || null,
        vehicle_model: model || null,
        vehicle_color: color,
        description: description || null,
      });

      onSuccess?.();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to register vehicle.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredReservations = reservations.filter(r => 
    r.guest_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.room_number.includes(searchTerm) ||
    r.booking_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PmsModal title="Register Vehicle" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Reservation Search */}
        <div className="relative">
          <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">In-House Reservation *</label>
          <input 
            type="text"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm"
            placeholder="Search by Room or Guest Name..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSearch(true);
            }}
            onFocus={() => setShowSearch(true)}
            required
            readOnly={!!initialReservationId}
          />
          {showSearch && !initialReservationId && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl max-h-48 overflow-y-auto">
              {reservationsLoading ? (
                <div className="p-4 text-center text-sm text-slate-400">Loading in-house guests...</div>
              ) : filteredReservations.length > 0 ? filteredReservations.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0"
                  onClick={() => {
                    setReservationId(r.id);
                    setSearchTerm(`Room ${r.room_number} · ${r.guest_name}`);
                    setShowSearch(false);
                  }}
                >
                  <div className="font-bold">Room {r.room_number}</div>
                  <div className="text-xs text-slate-500">{r.guest_name} ({r.booking_code})</div>
                </button>
              )) : (
                <div className="p-4 text-center text-sm text-slate-400">{reservationsError ? reservationsError : "No guests found"}</div>
              )}
            </div>
          )}
        </div>

        {/* Vehicle Type Toggle */}
        <div>
          <label className="block text-xs font-bold uppercase text-slate-400 mb-2">Vehicle Type *</label>
          <div className="flex gap-2">
            {(['car', 'motorcycle', 'bicycle'] as VehicleType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold capitalize transition-all ${
                  vehicleType === type 
                    ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none" 
                    : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500"
                }`}
                onClick={() => setVehicleType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Country & Plate Info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Country *</label>
            <div className="flex gap-2">
              {(['TH', 'MY'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-sm font-semibold transition-all ${
                    country === c 
                      ? "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white" 
                      : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-400 hover:border-slate-300"
                  }`}
                  onClick={() => setCountry(c)}
                >
                  {c === 'TH' ? '🇹🇭 Thailand' : '🇲🇾 Malaysia'}
                </button>
              ))}
            </div>
          </div>
          <div>
             <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">
               Plate Number {vehicleType !== 'bicycle' && '*'}
             </label>
             <input 
              type="text"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm uppercase placeholder:lowercase"
              placeholder={vehicleType === 'bicycle' ? "n/a" : "e.g. กข 1234"}
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              required={vehicleType !== 'bicycle'}
            />
          </div>
        </div>

        {/* Province & Color */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">
              Province/State {vehicleType !== 'bicycle' && '*'}
            </label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              required={vehicleType !== 'bicycle'}
            >
              {(country === "TH" ? THAI_PROVINCES : MALAYSIAN_STATES).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Color *</label>
            <select
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm capitalize"
              value={color}
              onChange={(e) => setColor(e.target.value as VehicleColor)}
              required
            >
              <option value="white">⚪ ขาว</option>
              <option value="black">⚫ ดำ</option>
              <option value="silver">🔘 เทา/เงิน</option>
              <option value="red">🔴 แดง</option>
              <option value="blue">🔵 น้ำเงิน</option>
              <option value="yellow">🟡 เหลือง</option>
              <option value="other">🌈 อื่นๆ</option>
            </select>
          </div>
        </div>

        {/* Brand & Model */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Brand (Optional)</label>
            <input 
              type="text"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm"
              placeholder="e.g. Toyota"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Model (Optional)</label>
            <input 
              type="text"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm"
              placeholder="e.g. Vios"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Description (Optional)</label>
          <textarea
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm"
            rows={2}
            placeholder="Additional notes..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-500/20"
        >
          {submitting ? "Registering..." : "Register Vehicle"}
        </button>
      </form>
    </PmsModal>
  );
}
