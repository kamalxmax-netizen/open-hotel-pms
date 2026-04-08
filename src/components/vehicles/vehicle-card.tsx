"use client";

import { GuestVehicle } from "@/lib/types";
import { getVehicleColorClasses, getVehicleColorStyle, getPlateDisplay } from "./vehicle-helpers";
import { VehicleCountryFlag } from "./vehicle-country-flag";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";

interface VehicleCardProps {
  vehicle: GuestVehicle;
  variant?: "default" | "compact";
  onUnlink?: (id: string) => void;
  onEdit?: (vehicle: GuestVehicle) => void;
}

export function VehicleCard({ vehicle, variant = "default", onUnlink, onEdit }: VehicleCardProps) {
  const isCompact = variant === "compact";
  const isActive = vehicle.is_active ?? !vehicle.checked_out_at;
  const dotClasses = getVehicleColorClasses(vehicle.vehicle_color, true);
  const swatchStyle = getVehicleColorStyle(vehicle.vehicle_color);
  const countryCode = vehicle.plate_country === "MY" ? "MY" : "TH";
  const roomLabel = vehicle.effective_room_number ?? vehicle.current_room_number ?? vehicle.room_number;
  const primaryTitle = vehicle.title ?? getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type);
  const fullPlateLabel = vehicle.plate_display ?? vehicle.plate_number ?? primaryTitle;
  const brandModel = [vehicle.vehicle_brand, vehicle.vehicle_model].filter(Boolean).join(" ") || null;
  const subtitle = vehicle.subtitle ?? brandModel;
  const plateLine = [vehicle.plate_province, vehicle.description].filter(Boolean).join(" · ");

  function handleUnlinkClick() {
    if (!onUnlink) return;
    const confirmed = window.confirm(`Unlink ${vehicle.plate_number || vehicle.short_label || "this vehicle"}?`);
    if (!confirmed) return;
    onUnlink(vehicle.id);
  }

  if (isCompact) {
    return (
      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 space-y-2 max-w-[280px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`${dotClasses} w-4 h-4`} title={vehicle.vehicle_color} />
            <span className="font-bold text-sm tracking-tight">
              {fullPlateLabel}
            </span>
          </div>
          <Link 
            href={`/pms/calendar?focus_reservation_id=${vehicle.reservation_id}`}
            className="text-blue-600 hover:underline flex items-center gap-1 text-xs font-semibold"
          >
            View Calendar <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-200">
            {subtitle || primaryTitle}
          </p>
          <p className="flex items-center gap-1.5">
            <span>{vehicle.plate_province}</span>
            <VehicleCountryFlag country={countryCode} />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-xl border transition-all ${
      isActive 
        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm" 
        : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-900 opacity-75 grayscale-[0.5]"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div
              className="h-10 w-10 rounded-lg border shadow-sm ring-1 ring-white/10"
              style={swatchStyle}
              title={`Vehicle color: ${vehicle.vehicle_color}`}
            />
            {isActive && onUnlink ? (
              <button 
                onClick={handleUnlinkClick}
                className="px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-md transition-colors border border-transparent hover:border-rose-200"
              >
                Unlink
              </button>
            ) : null}
            {!isActive ? (
              <div className="text-xs font-semibold text-slate-500">
                ✓
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-bold text-lg leading-tight uppercase tracking-tight">
                {fullPlateLabel}
              </h3>
              <VehicleCountryFlag country={countryCode} className="shrink-0" />
            </div>
            <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
              {plateLine || primaryTitle}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {[vehicle.guest_name ?? null].filter(Boolean).join(" · ") || subtitle || primaryTitle}
            </p>
          </div>
        </div>
        
        <div className="flex shrink-0 items-center gap-2">
          {onEdit && (
            <button
              onClick={() => onEdit(vehicle)}
              className="px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors border border-transparent hover:border-slate-200"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>{roomLabel ? `Room ${roomLabel}` : "No Room"}</span>
        <span>{vehicle.guest_name ?? "Unknown Guest"}</span>
        <span>{brandModel || "No brand/model"}</span>
        <span>{vehicle.vehicle_color}</span>
        <span>
          {isActive
            ? `CI: ${format(new Date(vehicle.registered_at), "dd MMM HH:mm")}`
            : `CO: ${vehicle.checked_out_at ? format(new Date(vehicle.checked_out_at), "dd MMM HH:mm") : "N/A"}`
          }
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
         <Link 
          href={`/pms/calendar?focus_reservation_id=${vehicle.reservation_id}`}
          className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1 uppercase tracking-widest"
        >
          View Calendar <ArrowRight className="w-3 h-3" />
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
