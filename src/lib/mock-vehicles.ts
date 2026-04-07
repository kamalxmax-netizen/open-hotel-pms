"use client";

import { useState, useEffect } from "react";
import { GuestVehicle, VehicleSummary, VehicleType, VehicleColor } from "./types";

const STORAGE_KEY = "pms_mock_vehicles";

// Initial seed data for demonstration
const SEED_DATA: GuestVehicle[] = [
  {
    id: "v1",
    reservation_id: "res-1",
    guest_profile_id: "prof-1",
    room_id: "room-201",
    room_number: "201",
    booking_code: "BK-1001",
    guest_name: "J. Smith",
    vehicle_type: "car",
    plate_number: "กข 1234",
    plate_province: "กรุงเทพมหานคร",
    plate_country: "TH",
    vehicle_brand: "Toyota",
    vehicle_model: "Vios",
    vehicle_color: "red",
    description: "",
    registered_at: new Date().toISOString(),
    registered_by: "Admin",
    checked_out_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "v2",
    reservation_id: "res-2",
    guest_profile_id: "prof-2",
    room_id: "room-305",
    room_number: "305",
    booking_code: "BK-1002",
    guest_name: "K. Lee",
    vehicle_type: "motorcycle",
    plate_number: "ขค 789",
    plate_province: "กระบี่",
    plate_country: "TH",
    vehicle_brand: "Honda",
    vehicle_model: "Click 125",
    vehicle_color: "black",
    description: "",
    registered_at: new Date().toISOString(),
    registered_by: "Admin",
    checked_out_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
];

export function useVehicles() {
  const [vehicles, setVehicles] = useState<GuestVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  // Load from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      setVehicles(JSON.parse(raw));
    } else {
      setVehicles(SEED_DATA);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
    }
    setLoading(false);
  }, []);

  // Save to localStorage
  const saveVehicles = (newVehicles: GuestVehicle[]) => {
    setVehicles(newVehicles);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newVehicles));
  };

  const registerVehicle = async (data: Partial<GuestVehicle>) => {
    const newVehicle: GuestVehicle = {
      id: Math.random().toString(36).substr(2, 9),
      reservation_id: data.reservation_id || "",
      guest_profile_id: data.guest_profile_id || null,
      room_id: data.room_id || null,
      room_number: data.room_number || null,
      booking_code: data.booking_code || null,
      guest_name: data.guest_name || null,
      vehicle_type: data.vehicle_type || "car",
      plate_number: data.plate_number || null,
      plate_province: data.plate_province || null,
      plate_country: data.plate_country || "TH",
      vehicle_brand: data.vehicle_brand || null,
      vehicle_model: data.vehicle_model || null,
      vehicle_color: data.vehicle_color || "white",
      description: data.description || null,
      registered_at: new Date().toISOString(),
      registered_by: "Current User",
      checked_out_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const next = [...vehicles, newVehicle];
    saveVehicles(next);
    return newVehicle;
  };

  const unlinkVehicle = async (id: string) => {
    const next = vehicles.map(v => 
      v.id === id ? { ...v, checked_out_at: new Date().toISOString(), updated_at: new Date().toISOString() } : v
    );
    saveVehicles(next);
  };

  const checkoutReservationVehicles = async (reservationId: string) => {
    const now = new Date().toISOString();
    const next = vehicles.map(v => 
      (v.reservation_id === reservationId && !v.checked_out_at) 
        ? { ...v, checked_out_at: now, updated_at: now } 
        : v
    );
    saveVehicles(next);
  };

  const getActiveVehicles = () => vehicles.filter(v => !v.checked_out_at);
  const getCheckedOutToday = () => {
    const today = new Date().toISOString().split('T')[0];
    return vehicles.filter(v => v.checked_out_at && v.checked_out_at.startsWith(today));
  };

  const getActiveVehicleSummary = (): Record<string, VehicleSummary[]> => {
    const active = getActiveVehicles();
    const summary: Record<string, VehicleSummary[]> = {};
    
    active.forEach(v => {
      if (!v.room_id) return;
      if (!summary[v.room_id]) summary[v.room_id] = [];
      summary[v.room_id].push({
        id: v.id,
        vehicle_type: v.vehicle_type,
        vehicle_color: v.vehicle_color,
        plate_number: v.plate_number
      });
    });
    
    return summary;
  };

  return {
    vehicles,
    loading,
    registerVehicle,
    unlinkVehicle,
    checkoutReservationVehicles,
    getActiveVehicles,
    getCheckedOutToday,
    getActiveVehicleSummary,
    getVehiclesByRoom: (roomId: string) => getActiveVehicles().filter(v => v.room_id === roomId),
    getVehiclesByReservation: (resId: string) => vehicles.filter(v => v.reservation_id === resId),
  };
}
