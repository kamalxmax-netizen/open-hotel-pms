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
          className="absolute z-[100] top-full left-0 mt-2 min-w-[280px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="absolute bottom-full left-4 -mb-[1px] h-0 w-0 border-b-[6px] border-b-white border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent dark:border-b-slate-800" />
            <VehicleCard 
              vehicle={vehicle} 
              variant="compact" 
              onUnlink={(id) => {
                onUnlink?.(id);
                setIsOpen(false);
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
