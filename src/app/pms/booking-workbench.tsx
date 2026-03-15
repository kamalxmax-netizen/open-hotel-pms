"use client";

import { FormEvent, useMemo, useState } from "react";

type BookingSource = "walkin" | "ota" | "direct" | "agent";

type ReservationNight = {
  stay_date: string;
  nightly_price: number;
  room_number?: string;
};

type ReservationRecord = {
  id: string;
  booking_code: string;
  guest_name: string;
  room_number: string;
  source: BookingSource;
  checkin_date: string;
  checkout_date: string;
  checkin_time?: string | null;
  phone?: string | null;
  note?: string | null;
  status?: string;
  total_price: number;
  total_nights?: number;
  nightly_prices?: number[];
  nights?: ReservationNight[];
  rooms?: string[];
};

type BookingFormState = {
  guest_name: string;
  room_number: string;
  checkin_date: string;
  checkout_date: string;
  source: BookingSource;
  phone: string;
  checkin_time: string;
  note: string;
  ota_prices_input: string;
};

type LookupFormState = {
  room_number: string;
  date: string;
};

function ymd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function plusDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return ymd(date);
}

function makeDefaultBookingForm(): BookingFormState {
  const checkinDate = ymd(new Date());
  return {
    guest_name: "",
    room_number: "202",
    checkin_date: checkinDate,
    checkout_date: plusDays(checkinDate, 1),
    source: "walkin",
    phone: "",
    checkin_time: "",
    note: "",
    ota_prices_input: ""
  };
}

function makeDefaultLookupForm(): LookupFormState {
  return {
    room_number: "202",
    date: ymd(new Date())
  };
}

function parseOtaPrices(input: string): { values: number[]; error?: string } {
  const chunks = input
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return { values: [], error: "OTA prices are required when source = OTA." };
  }

  const values: number[] = [];
  for (const item of chunks) {
    const num = Number(item);
    if (!Number.isFinite(num)) {
      return { values: [], error: `Invalid OTA price value: ${item}` };
    }
    values.push(Math.round(num * 100) / 100);
  }

  return { values };
}

function toFormState(record: ReservationRecord): BookingFormState {
  const nightlyPrices = record.nightly_prices ?? record.nights?.map((night) => Number(night.nightly_price)) ?? [];
  return {
    guest_name: record.guest_name ?? "",
    room_number: record.room_number ?? "",
    checkin_date: record.checkin_date ?? "",
    checkout_date: record.checkout_date ?? "",
    source: record.source ?? "walkin",
    phone: record.phone ?? "",
    checkin_time: record.checkin_time ?? "",
    note: record.note ?? "",
    ota_prices_input: nightlyPrices.length > 0 ? nightlyPrices.join(", ") : ""
  };
}

function normalizeReservation(record: ReservationRecord): ReservationRecord {
  if (record.room_number) return record;
  const roomNumberFromRooms = record.rooms && record.rooms.length > 0 ? record.rooms[0] : "";
  const roomNumberFromNights = record.nights && record.nights.length > 0 ? record.nights[0].room_number ?? "" : "";
  return {
    ...record,
    room_number: roomNumberFromRooms || roomNumberFromNights
  };
}

type JsonMap = Record<string, unknown>;

function readError(payload: JsonMap | null): string {
  if (!payload) return "Request failed.";
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  return "Request failed.";
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default function BookingWorkbench({
  onReservationChanged
}: {
  onReservationChanged?: () => void;
}) {
  const [createForm, setCreateForm] = useState<BookingFormState>(() => makeDefaultBookingForm());
  const [editForm, setEditForm] = useState<BookingFormState>(() => makeDefaultBookingForm());
  const [lookupForm, setLookupForm] = useState<LookupFormState>(() => makeDefaultLookupForm());
  const [lookupByName, setLookupByName] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");

  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);
  const [nameResults, setNameResults] = useState<ReservationRecord[]>([]);

  const [createMessage, setCreateMessage] = useState<string>("");
  const [createError, setCreateError] = useState<string>("");
  const [lookupMessage, setLookupMessage] = useState<string>("");
  const [lookupError, setLookupError] = useState<string>("");
  const [editMessage, setEditMessage] = useState<string>("");
  const [editError, setEditError] = useState<string>("");

  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [nameSearchLoading, setNameSearchLoading] = useState<boolean>(false);
  const [editLoading, setEditLoading] = useState<boolean>(false);
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);
  const [showCreateValidation, setShowCreateValidation] = useState<boolean>(false);
  const [showLookupValidation, setShowLookupValidation] = useState<boolean>(false);
  const [showNameLookupValidation, setShowNameLookupValidation] = useState<boolean>(false);
  const [showEditValidation, setShowEditValidation] = useState<boolean>(false);

  const canEdit = useMemo(() => selectedReservation !== null, [selectedReservation]);
  const lookupRoomInvalid = showLookupValidation && !lookupForm.room_number.trim();
  const lookupDateInvalid = showLookupValidation && !lookupForm.date.trim();
  const lookupNameInvalid = showNameLookupValidation && !lookupByName.trim();
  const createGuestNameInvalid = showCreateValidation && !createForm.guest_name.trim();
  const createRoomInvalid = showCreateValidation && !createForm.room_number.trim();
  const createCheckinInvalid = showCreateValidation && !createForm.checkin_date;
  const createCheckoutInvalid = showCreateValidation && !createForm.checkout_date;
  const createOtaInvalid = showCreateValidation && createForm.source === "ota" && !createForm.ota_prices_input.trim();
  const editGuestNameInvalid = showEditValidation && !editForm.guest_name.trim();
  const editRoomInvalid = showEditValidation && !editForm.room_number.trim();
  const editCheckinInvalid = showEditValidation && !editForm.checkin_date;
  const editCheckoutInvalid = showEditValidation && !editForm.checkout_date;
  const editOtaInvalid = showEditValidation && editForm.source === "ota" && !editForm.ota_prices_input.trim();

  async function createReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowCreateValidation(true);
    setCreateMessage("");
    setCreateError("");

    if (!createForm.guest_name.trim()) {
      setCreateError("Guest name is required.");
      return;
    }
    if (!createForm.room_number.trim()) {
      setCreateError("Room number is required.");
      return;
    }
    if (!createForm.checkin_date || !createForm.checkout_date) {
      setCreateError("Check-in and check-out dates are required.");
      return;
    }
    if (createForm.checkout_date <= createForm.checkin_date) {
      setCreateError("Checkout date must be after check-in date.");
      return;
    }

    const payload: JsonMap = {
      guest_name: createForm.guest_name.trim(),
      room_number: createForm.room_number.trim(),
      checkin_date: createForm.checkin_date,
      checkout_date: createForm.checkout_date,
      source: createForm.source,
      phone: createForm.phone.trim() || undefined,
      checkin_time: createForm.checkin_time.trim() || undefined,
      note: createForm.note.trim() || undefined
    };

    if (createForm.source === "ota") {
      const parsed = parseOtaPrices(createForm.ota_prices_input);
      if (parsed.error) {
        setCreateError(parsed.error);
        return;
      }
      payload.ota_prices = parsed.values;
    }

    setCreateLoading(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => null)) as JsonMap | null;
      if (!response.ok || !data) {
        setCreateError(readError(data));
        return;
      }

      const reservation = normalizeReservation(data.reservation as ReservationRecord);
      setSelectedReservation(reservation);
      setEditForm(toFormState(reservation));
      setCancelReason("");
      setCreateMessage(
        `Created ${reservation.booking_code} for room ${reservation.room_number} (${reservation.checkin_date} → ${reservation.checkout_date}).`
      );
      setCreateForm(makeDefaultBookingForm());
      setShowCreateValidation(false);
      onReservationChanged?.();
    } catch (error) {
      setCreateError((error as Error).message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function lookupByRoomAndDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowLookupValidation(true);
    setLookupMessage("");
    setLookupError("");

    const room = lookupForm.room_number.trim();
    const date = lookupForm.date.trim();
    if (!room || !date) {
      setLookupError("room_number and date are required.");
      return;
    }

    setLookupLoading(true);
    try {
      const query = new URLSearchParams({ room_number: room, date }).toString();
      const response = await fetch(`/api/bookings?${query}`);
      const data = (await response.json().catch(() => null)) as JsonMap | null;
      if (!response.ok || !data) {
        setLookupError(readError(data));
        return;
      }

      const reservation = normalizeReservation(data.reservation as ReservationRecord);
      setSelectedReservation(reservation);
      setEditForm(toFormState(reservation));
      setCancelReason("");
      setLookupMessage(
        `Loaded ${reservation.booking_code} (${reservation.guest_name}) for room ${reservation.room_number}.`
      );
      setShowLookupValidation(false);
    } catch (error) {
      setLookupError((error as Error).message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function lookupReservationsByName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowNameLookupValidation(true);
    setLookupMessage("");
    setLookupError("");

    const keyword = lookupByName.trim();
    if (!keyword) {
      setLookupError("Guest name is required.");
      return;
    }

    setNameSearchLoading(true);
    try {
      const query = new URLSearchParams({ name: keyword, limit: "10" }).toString();
      const response = await fetch(`/api/bookings/search-by-name?${query}`);
      const data = (await response.json().catch(() => null)) as JsonMap | null;
      if (!response.ok || !data) {
        setLookupError(readError(data));
        return;
      }

      const reservations = ((data.reservations as ReservationRecord[]) ?? []).map((item) =>
        normalizeReservation(item)
      );
      setNameResults(reservations);
      setLookupMessage(`Found ${reservations.length} active reservation(s).`);
      setShowNameLookupValidation(false);
    } catch (error) {
      setLookupError((error as Error).message);
    } finally {
      setNameSearchLoading(false);
    }
  }

  async function updateReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReservation) return;

    setShowEditValidation(true);
    setEditMessage("");
    setEditError("");

    if (!editForm.guest_name.trim()) {
      setEditError("Guest name is required.");
      return;
    }
    if (!editForm.room_number.trim()) {
      setEditError("Room number is required.");
      return;
    }
    if (!editForm.checkin_date || !editForm.checkout_date) {
      setEditError("Check-in and check-out dates are required.");
      return;
    }
    if (editForm.checkout_date <= editForm.checkin_date) {
      setEditError("Checkout date must be after check-in date.");
      return;
    }

    const payload: JsonMap = {
      guest_name: editForm.guest_name.trim(),
      room_number: editForm.room_number.trim(),
      checkin_date: editForm.checkin_date,
      checkout_date: editForm.checkout_date,
      source: editForm.source,
      phone: editForm.phone.trim() || undefined,
      checkin_time: editForm.checkin_time.trim() || undefined,
      note: editForm.note.trim() || undefined
    };

    if (editForm.source === "ota") {
      const parsed = parseOtaPrices(editForm.ota_prices_input);
      if (parsed.error) {
        setEditError(parsed.error);
        return;
      }
      payload.ota_prices = parsed.values;
    }

    setEditLoading(true);
    try {
      const response = await fetch(`/api/bookings/${selectedReservation.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => null)) as JsonMap | null;
      if (!response.ok || !data) {
        setEditError(readError(data));
        return;
      }

      const reservation = normalizeReservation(data.reservation as ReservationRecord);
      setSelectedReservation(reservation);
      setEditForm(toFormState(reservation));
      setEditMessage(`Updated ${reservation.booking_code} successfully.`);
      setShowEditValidation(false);
      onReservationChanged?.();

      setNameResults((current) =>
        current.map((item) => (item.id === reservation.id ? reservation : item))
      );
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setEditLoading(false);
    }
  }

  async function cancelReservation() {
    if (!selectedReservation) return;
    setEditMessage("");
    setEditError("");

    setCancelLoading(true);
    try {
      const response = await fetch(`/api/bookings/${selectedReservation.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cancel_reason: cancelReason.trim() || undefined
        })
      });

      const data = (await response.json().catch(() => null)) as JsonMap | null;
      if (!response.ok || !data) {
        setEditError(readError(data));
        return;
      }

      const cancelled = data.reservation as JsonMap;
      const bookingCode =
        typeof cancelled.booking_code === "string" ? cancelled.booking_code : selectedReservation.booking_code;
      const cancelledNights = toNumber(cancelled.cancelled_nights);

      setEditMessage(`Cancelled ${bookingCode}. Nights released: ${cancelledNights}.`);
      setSelectedReservation(null);
      setEditForm(makeDefaultBookingForm());
      setNameResults((current) => current.filter((item) => item.id !== selectedReservation.id));
      setCancelReason("");
      onReservationChanged?.();
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setCancelLoading(false);
    }
  }

  function selectFromSearch(item: ReservationRecord) {
    const reservation = normalizeReservation(item);
    setSelectedReservation(reservation);
    setEditForm(toFormState(reservation));
    setCancelReason("");
    setShowEditValidation(false);
    setLookupMessage(`Loaded ${reservation.booking_code} into editor.`);
    setLookupError("");
  }

  const sourceOptions: BookingSource[] = ["walkin", "direct", "agent", "ota"];

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Booking Operations</p>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Create, Search, Edit, Cancel</h2>
          <p className="text-sm text-slate-600">Connected to live APIs and Supabase booking workflows.</p>
        </div>
        <span className="badge bg-slate-100 text-slate-700">English UI (phase 1)</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Lookup by Room + Date</h3>
            <form onSubmit={lookupByRoomAndDate} className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                value={lookupForm.room_number}
                onChange={(event) =>
                  setLookupForm((current) => ({ ...current, room_number: event.target.value }))
                }
                placeholder="Room Number"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                required
                aria-invalid={lookupRoomInvalid ? "true" : "false"}
              />
              <input
                type="date"
                value={lookupForm.date}
                onChange={(event) => setLookupForm((current) => ({ ...current, date: event.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                required
                aria-invalid={lookupDateInvalid ? "true" : "false"}
              />
              <button
                type="submit"
                disabled={lookupLoading}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {lookupLoading ? "Searching..." : "Search"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Lookup by Guest Name</h3>
            <form onSubmit={lookupReservationsByName} className="mt-3 flex gap-2">
              <input
                value={lookupByName}
                onChange={(event) => setLookupByName(event.target.value)}
                placeholder="Guest Name"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
                required
                aria-invalid={lookupNameInvalid ? "true" : "false"}
              />
              <button
                type="submit"
                disabled={nameSearchLoading}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {nameSearchLoading ? "..." : "Find"}
              </button>
            </form>

            {nameResults.length > 0 ? (
              <div className="mt-3 space-y-2">
                {nameResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectFromSearch(item)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-brand-300 hover:bg-brand-50/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{item.guest_name}</span>
                      <span className="text-xs text-slate-500">{item.booking_code}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      Room {item.room_number || "-"} | {item.checkin_date} → {item.checkout_date}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {lookupMessage ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {lookupMessage}
            </p>
          ) : null}
          {lookupError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{lookupError}</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Create Reservation</h3>
          <form onSubmit={createReservation} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={createForm.guest_name}
              onChange={(event) => setCreateForm((current) => ({ ...current, guest_name: event.target.value }))}
              placeholder="Guest Name"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring sm:col-span-2"
              required
              aria-invalid={createGuestNameInvalid ? "true" : "false"}
            />
            <input
              value={createForm.room_number}
              onChange={(event) => setCreateForm((current) => ({ ...current, room_number: event.target.value }))}
              placeholder="Room Number"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
              required
              aria-invalid={createRoomInvalid ? "true" : "false"}
            />
            <select
              value={createForm.source}
              onChange={(event) =>
                setCreateForm((current) => ({ ...current, source: event.target.value as BookingSource }))
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
            >
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={createForm.checkin_date}
              onChange={(event) => setCreateForm((current) => ({ ...current, checkin_date: event.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
              required
              aria-invalid={createCheckinInvalid ? "true" : "false"}
            />
            <input
              type="date"
              value={createForm.checkout_date}
              onChange={(event) => setCreateForm((current) => ({ ...current, checkout_date: event.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
              required
              aria-invalid={createCheckoutInvalid ? "true" : "false"}
            />
            <input
              value={createForm.phone}
              onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="Phone"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
            />
            <input
              value={createForm.checkin_time}
              onChange={(event) => setCreateForm((current) => ({ ...current, checkin_time: event.target.value }))}
              placeholder="Check-in Time (optional)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
            />
            <textarea
              value={createForm.note}
              onChange={(event) => setCreateForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="Note"
              className="min-h-[80px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring sm:col-span-2"
            />
            {createForm.source === "ota" ? (
              <textarea
                value={createForm.ota_prices_input}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, ota_prices_input: event.target.value }))
                }
                placeholder="OTA prices per night (comma/space separated). Example: 1200, 1300"
                className="min-h-[70px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring sm:col-span-2"
                aria-invalid={createOtaInvalid ? "true" : "false"}
              />
            ) : null}
            <button
              type="submit"
              disabled={createLoading}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2"
            >
              {createLoading ? "Creating..." : "Create Booking"}
            </button>
          </form>

          {createMessage ? (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {createMessage}
            </p>
          ) : null}
          {createError ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {createError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Reservation Editor</h3>
          <span className="text-xs text-slate-500">
            {selectedReservation ? selectedReservation.booking_code : "No reservation selected"}
          </span>
        </div>

        <form onSubmit={updateReservation} className="grid gap-2 sm:grid-cols-2">
          <input
            value={editForm.guest_name}
            onChange={(event) => setEditForm((current) => ({ ...current, guest_name: event.target.value }))}
            placeholder="Guest Name"
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100 sm:col-span-2"
            required
            aria-invalid={editGuestNameInvalid ? "true" : "false"}
          />
          <input
            value={editForm.room_number}
            onChange={(event) => setEditForm((current) => ({ ...current, room_number: event.target.value }))}
            placeholder="Room Number"
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
            required
            aria-invalid={editRoomInvalid ? "true" : "false"}
          />
          <select
            value={editForm.source}
            onChange={(event) => setEditForm((current) => ({ ...current, source: event.target.value as BookingSource }))}
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source.toUpperCase()}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={editForm.checkin_date}
            onChange={(event) => setEditForm((current) => ({ ...current, checkin_date: event.target.value }))}
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
            required
            aria-invalid={editCheckinInvalid ? "true" : "false"}
          />
          <input
            type="date"
            value={editForm.checkout_date}
            onChange={(event) => setEditForm((current) => ({ ...current, checkout_date: event.target.value }))}
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
            required
            aria-invalid={editCheckoutInvalid ? "true" : "false"}
          />
          <input
            value={editForm.phone}
            onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))}
            placeholder="Phone"
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
          />
          <input
            value={editForm.checkin_time}
            onChange={(event) => setEditForm((current) => ({ ...current, checkin_time: event.target.value }))}
            placeholder="Check-in Time"
            disabled={!canEdit}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
          />
          <textarea
            value={editForm.note}
            onChange={(event) => setEditForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="Note"
            disabled={!canEdit}
            className="min-h-[80px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100 sm:col-span-2"
          />
          {editForm.source === "ota" ? (
            <textarea
              value={editForm.ota_prices_input}
              onChange={(event) => setEditForm((current) => ({ ...current, ota_prices_input: event.target.value }))}
              placeholder="OTA prices per night"
              disabled={!canEdit}
              className="min-h-[70px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100 sm:col-span-2"
              aria-invalid={editOtaInvalid ? "true" : "false"}
            />
          ) : null}

          <div className="mt-1 grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <button
              type="submit"
              disabled={!canEdit || editLoading}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editLoading ? "Saving..." : "Save Changes"}
            </button>
            <div className="flex gap-2">
              <input
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Cancel reason"
                disabled={!canEdit || cancelLoading}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-brand-300 focus:ring disabled:cursor-not-allowed disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={cancelReservation}
                disabled={!canEdit || cancelLoading}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelLoading ? "..." : "Cancel"}
              </button>
            </div>
          </div>
        </form>

        {editMessage ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {editMessage}
          </p>
        ) : null}
        {editError ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{editError}</p>
        ) : null}
      </div>
    </section>
  );
}
