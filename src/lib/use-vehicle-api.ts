"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuestVehicle, VehicleColor, VehicleSummary, VehicleType } from "@/lib/types";

export type VehicleRegistryData = {
  activeVehicles: GuestVehicle[];
  checkedOutToday: GuestVehicle[];
  activeCount: number;
  checkedOutTodayCount: number;
};

export type VehicleRegisterPayload = {
  reservation_id: string;
  group_link?: boolean;
  vehicle_type: VehicleType;
  plate_number?: string | null;
  plate_province?: string | null;
  plate_country?: "TH" | "MY";
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: VehicleColor;
  description?: string | null;
};

export type InHouseReservationOption = {
  id: string;
  room_number: string;
  guest_name: string;
  booking_code: string;
  status: string;
  checked_in_at: string | null;
};

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(json?.error ?? "Request failed."));
  }
  return json as T;
}

export async function registerVehicle(payload: VehicleRegisterPayload): Promise<GuestVehicle | null> {
  const json = await readJson<{ vehicle?: GuestVehicle | null }>(
    "/api/vehicles",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return json.vehicle ?? null;
}

export async function unlinkVehicle(vehicleId: string): Promise<GuestVehicle | null> {
  const json = await readJson<{ vehicle?: GuestVehicle | null }>(
    `/api/vehicles/${vehicleId}/unlink`,
    { method: "POST" },
  );
  return json.vehicle ?? null;
}

export async function updateVehicle(
  vehicleId: string,
  payload: Omit<VehicleRegisterPayload, "reservation_id" | "group_link">,
): Promise<GuestVehicle | null> {
  const json = await readJson<{ vehicle?: GuestVehicle | null }>(
    `/api/vehicles/${vehicleId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return json.vehicle ?? null;
}

export async function deleteVehicle(vehicleId: string): Promise<GuestVehicle | null> {
  const json = await readJson<{ vehicle?: GuestVehicle | null }>(
    `/api/vehicles/${vehicleId}`,
    { method: "DELETE" },
  );
  return json.vehicle ?? null;
}

export function useVehicleRegistry(refreshMs = 30_000) {
  const [data, setData] = useState<VehicleRegistryData>({
    activeVehicles: [],
    checkedOutToday: [],
    activeCount: 0,
    checkedOutTodayCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const json = await readJson<{
        summary?: { active_count?: number; checked_out_today_count?: number };
        active_vehicles?: GuestVehicle[];
        checked_out_today?: GuestVehicle[];
      }>("/api/vehicles");
      setData({
        activeVehicles: json.active_vehicles ?? [],
        checkedOutToday: json.checked_out_today ?? [],
        activeCount: Number(json.summary?.active_count ?? (json.active_vehicles ?? []).length),
        checkedOutTodayCount: Number(json.summary?.checked_out_today_count ?? (json.checked_out_today ?? []).length),
      });
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load vehicles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs]);

  const handleUnlink = useCallback(async (vehicleId: string) => {
    await unlinkVehicle(vehicleId);
    await refresh();
  }, [refresh]);

  const handleDelete = useCallback(async (vehicleId: string) => {
    await deleteVehicle(vehicleId);
    await refresh();
  }, [refresh]);

  return {
    ...data,
    loading,
    error,
    refresh,
    unlinkVehicle: handleUnlink,
    deleteVehicle: handleDelete,
  };
}

export function useVehiclesByRoom(roomId: string | null | undefined) {
  const [vehicles, setVehicles] = useState<GuestVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) {
      setVehicles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const json = await readJson<{ vehicles?: GuestVehicle[] }>(`/api/vehicles/by-room?room_id=${encodeURIComponent(roomId)}`);
      setVehicles(json.vehicles ?? []);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load room vehicles.");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUnlink = useCallback(async (vehicleId: string) => {
    await unlinkVehicle(vehicleId);
    await refresh();
  }, [refresh]);

  return {
    vehicles,
    loading,
    error,
    refresh,
    unlinkVehicle: handleUnlink,
  };
}

export function useVehicleSummaryMap(refreshMs = 30_000) {
  const [summaryMap, setSummaryMap] = useState<Record<string, VehicleSummary[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const json = await readJson<{ rooms?: Record<string, VehicleSummary[]> }>("/api/vehicles/active-summary");
      setSummaryMap(json.rooms ?? {});
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load vehicle summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs]);

  return {
    summaryMap,
    loading,
    error,
    refresh,
  };
}

export function useInHouseReservationOptions(enabled = true) {
  const [reservations, setReservations] = useState<InHouseReservationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const json = await readJson<{ reservations?: any[] }>("/api/inhouse");
      setReservations(
        (json.reservations ?? []).map((reservation: any) => ({
          id: String(reservation.id ?? ""),
          room_number: String(reservation.room_number ?? ""),
          guest_name: String(reservation.guest_name ?? ""),
          booking_code: String(reservation.booking_code ?? ""),
          status: String(reservation.status ?? ""),
          checked_in_at: reservation.checked_in_at ? String(reservation.checked_in_at) : null,
        })),
      );
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load in-house reservations.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    reservations,
    loading,
    error,
    refresh,
  };
}
