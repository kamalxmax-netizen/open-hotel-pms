"use client";

import { GuestVehicle } from "@/lib/types";
import { getVehicleColorClasses, getVehicleToneClasses, getPlateDisplay } from "./vehicle-helpers";
import Link from "next/link";
import { format } from "date-fns";
import { X, ArrowRight } from "lucide-react";

interface VehicleCardProps {
  vehicle: GuestVehicle;
  variant?: "default" | "compact";
  onUnlink?: (id: string) => void;
}

export function VehicleCard({ vehicle, variant = "default", onUnlink }: VehicleCardProps) {
  const isCompact = variant === "compact";
  const isActive = vehicle.is_active ?? !vehicle.checked_out_at;
  const dotClasses = getVehicleColorClasses(vehicle.vehicle_color, true);
  const toneClasses = getVehicleToneClasses(vehicle.vehicle_color);
  const countryFlag = vehicle.plate_country === "TH" ? "🇹🇭" : "🇲🇾";
  const roomLabel = vehicle.effective_room_number ?? vehicle.current_room_number ?? vehicle.room_number;
  const primaryTitle = vehicle.title ?? getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type);
  const subtitle = vehicle.subtitle ?? [vehicle.vehicle_brand, vehicle.vehicle_model].filter(Boolean).join(" ") || null;

  if (isCompact) {
    return (
      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 space-y-2 max-w-[280px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`${dotClasses} w-4 h-4`} title={vehicle.vehicle_color} />
            <span className="font-bold text-sm tracking-tight">
              {vehicle.short_label ?? getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type)}
            </span>
          </div>
          {isActive && onUnlink && (
            <button 
              onClick={() => onUnlink(vehicle.id)}
              className="p-1 hover:bg-rose-50 hover:text-rose-600 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-200">
            {subtitle || primaryTitle}
          </p>
          <p>{vehicle.plate_province} {countryFlag}</p>
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 mt-2 flex items-center justify-between">
            <span>{roomLabel ? `Room ${roomLabel}` : "No Room"}</span>
            <Link 
              href={`/pms/reservations/${vehicle.reservation_id}`}
              className="text-blue-600 hover:underline flex items-center gap-1"
            >
              View Booking <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border transition-all ${
      isActive 
        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm" 
        : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-900 opacity-75 grayscale-[0.5]"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`${toneClasses} w-10 h-10 rounded-lg border flex items-center justify-center text-xl`}>
            {isActive ? (vehicle.vehicle_type === 'car' ? '🚗' : vehicle.vehicle_type === 'motorcycle' ? '🛵' : '🚲') : '✓'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg leading-tight uppercase tracking-tight">
                {vehicle.short_label ?? getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type)}
              </h3>
              <span className="text-xl leading-none" title={vehicle.plate_country}>
                {countryFlag}
              </span>
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {subtitle || primaryTitle}
            </p>
          </div>
        </div>
        
        {isActive && onUnlink && (
          <button 
            onClick={() => onUnlink(vehicle.id)}
            className="px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-md transition-colors border border-transparent hover:border-rose-200"
          >
            Unlink
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-sm">
        <div className="space-y-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Location</p>
          <p className="font-medium">{vehicle.plate_display ?? vehicle.plate_number ?? vehicle.description ?? "No plate"}</p>
          <p className="font-medium text-blue-600">{roomLabel ? `Room ${roomLabel}` : "No Room"}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Guest / Time</p>
          <p className="font-medium truncate">{vehicle.guest_name}</p>
          <p className="text-xs text-slate-500">
            {isActive 
              ? `CI: ${format(new Date(vehicle.registered_at), "dd MMM HH:mm")}`
              : `CO: ${vehicle.checked_out_at ? format(new Date(vehicle.checked_out_at), "dd MMM HH:mm") : "N/A"}`
            }
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
         <Link 
          href={`/pms/reservations/${vehicle.reservation_id}`}
          className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1 uppercase tracking-widest"
        >
          View Booking <ArrowRight className="w-3 h-3" />
        </Link>
        {vehicle.description && (
           <p className="text-xs italic text-slate-400 truncate max-w-[150px]">
           "{vehicle.description}"
         </p>
        )}
      </div>
    </div>
  );
}
