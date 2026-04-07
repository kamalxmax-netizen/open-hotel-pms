"use client";

import { GuestVehicle } from "@/lib/types";
import { VehicleCard } from "./vehicle-card";
import { useState, useRef, useEffect } from "react";
import { getVehicleColorClasses, getPlateDisplay } from "./vehicle-helpers";

interface VehicleDetailPopoverProps {
  vehicle: GuestVehicle;
  onUnlink?: (id: string) => void;
}

export function VehicleDetailPopover({ vehicle, onUnlink }: VehicleDetailPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const pillClasses = getVehicleColorClasses(vehicle.vehicle_color);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`${pillClasses} shadow-sm transition-transform active:scale-95`}
      >
        {vehicle.short_label ?? getPlateDisplay(vehicle.plate_number, vehicle.vehicle_type)}
      </button>

      {isOpen && (
        <div 
          ref={popoverRef}
          className="absolute z-[100] bottom-full left-0 mb-2 min-w-[280px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
            <VehicleCard 
              vehicle={vehicle} 
              variant="compact" 
              onUnlink={(id) => {
                onUnlink?.(id);
                setIsOpen(false);
              }} 
            />
            {/* Triangle arrow */}
            <div className="absolute top-full left-4 -mt-[1px] w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-white dark:border-t-slate-800" />
          </div>
        </div>
      )}
    </div>
  );
}
