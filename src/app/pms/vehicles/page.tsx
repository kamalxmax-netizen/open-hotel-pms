"use client";

import { useState } from "react";
import { useVehicleRegistry } from "@/lib/use-vehicle-api";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { VehicleRegisterModal } from "@/components/vehicles/vehicle-register-modal";
import type { GuestVehicle } from "@/lib/types";
import { Search, Plus } from "lucide-react";

export default function VehicleRegistryPage() {
  const { activeVehicles, checkedOutToday, activeCount, unlinkVehicle, refresh, loading, error } = useVehicleRegistry();
  const [showRegister, setShowRegister] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<GuestVehicle | null>(null);
  const [search, setSearch] = useState("");

  const loweredSearch = search.toLowerCase();
  const active = activeVehicles.filter(v => 
    v.plate_number?.toLowerCase().includes(loweredSearch) ||
    v.guest_name?.toLowerCase().includes(loweredSearch) ||
    v.effective_room_number?.includes(search) ||
    v.room_number?.includes(search) ||
    v.short_label?.toLowerCase().includes(loweredSearch)
  );
  const checkedOut = checkedOutToday.filter(v =>
    !search ||
    v.plate_number?.toLowerCase().includes(loweredSearch) ||
    v.guest_name?.toLowerCase().includes(loweredSearch) ||
    v.effective_room_number?.includes(search) ||
    v.room_number?.includes(search) ||
    v.short_label?.toLowerCase().includes(loweredSearch)
  );

  const activeCars = active.filter(v => v.vehicle_type === 'car');
  const activeOthers = active.filter(v => v.vehicle_type !== 'car');

  const coCars = checkedOut.filter(v => v.vehicle_type === 'car');
  const coOthers = checkedOut.filter(v => v.vehicle_type !== 'car');

  return (
    <div className="p-6 space-y-6 max-w-[90rem]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Operations</p>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">Vehicle Registry</h1>
          <p className="text-sm text-slate-500 mt-1">
            Active: <span className="font-bold text-slate-900 dark:text-slate-100">{activeCount}</span> vehicles at the hotel
          </p>
        </div>
        <div className="flex items-center gap-3">
           <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search plate, guest, room..."
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm w-64 focus:ring-2 focus:ring-blue-500 transition-all outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 transition-all"
          >
            <Plus className="w-5 h-5" /> Register Vehicle
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Main Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        
        {/* Column 1: Cars */}
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b-2 border-slate-100 dark:border-slate-800">
            <h2 className="font-black text-xl uppercase tracking-tight text-slate-800 dark:text-slate-200 flex items-center gap-2">
              🚗 Cars <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs px-2 py-0.5 rounded-full">{activeCars.length}</span>
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                Loading vehicles...
              </div>
            ) : activeCars.length > 0 ? activeCars.map(v => (
              <VehicleCard key={v.id} vehicle={v} onUnlink={unlinkVehicle} onEdit={setEditingVehicle} />
            )) : (
              <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                No active cars
              </div>
            )}
          </div>

          {coCars.length > 0 && (
            <div className="pt-6 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Checked Out Today</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {coCars.map(v => (
                  <VehicleCard key={v.id} vehicle={v} onEdit={setEditingVehicle} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Motorcycles & Bicycles */}
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b-2 border-slate-100 dark:border-slate-800">
            <h2 className="font-black text-xl uppercase tracking-tight text-slate-800 dark:text-slate-200 flex items-center gap-2">
              🛵 Motorcycles & 🚲 Bicycles <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs px-2 py-0.5 rounded-full">{activeOthers.length}</span>
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                Loading vehicles...
              </div>
            ) : activeOthers.length > 0 ? activeOthers.map(v => (
              <VehicleCard key={v.id} vehicle={v} onUnlink={unlinkVehicle} onEdit={setEditingVehicle} />
            )) : (
              <div className="col-span-full p-8 text-center bg-slate-50 dark:bg-slate-950 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
                No active motorcycles or bicycles
              </div>
            )}
          </div>

          {coOthers.length > 0 && (
            <div className="pt-6 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Checked Out Today</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {coOthers.map(v => (
                  <VehicleCard key={v.id} vehicle={v} onEdit={setEditingVehicle} />
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      {showRegister && (
        <VehicleRegisterModal onClose={() => setShowRegister(false)} onSuccess={refresh} />
      )}

      {editingVehicle && (
        <VehicleRegisterModal
          vehicle={editingVehicle}
          onClose={() => setEditingVehicle(null)}
          onSuccess={() => {
            setEditingVehicle(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
