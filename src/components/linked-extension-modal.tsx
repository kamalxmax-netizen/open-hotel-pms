"use client";

import { useEffect, useMemo, useState } from "react";
import PmsModal from "./pms-modal";
import NightCounter from "./night-counter";
import { addDays } from "@/lib/dates";

type LinkedExtensionModalProps = {
  reservationId: string;
  guestName: string;
  currentCheckoutDate: string;
  currentRoomTypeId: string;
  currentRoomNumber: string;
  onClose: () => void;
  onSuccess: (payload: { reservation_id?: string; extension_reservation_id?: string | null; partial?: boolean; pending_fix_action?: string | null }) => void;
};

type RoomTypeOption = {
  id: string;
  name_en: string;
};

type PreviewPayload = {
  success?: boolean;
  can_commit?: boolean;
  warnings?: string[];
  current_room_number?: string;
  blocking_items?: Array<{
    reservation_id: string;
    booking_code: string;
    guest_name: string;
    room_number: string | null;
    checkin_date: string;
    checkout_date: string;
    checked_in: boolean;
    conflict_stay_dates: string[];
    swap_diagnostic?: { can_swap: boolean; reason: string | null } | null;
  }>;
  swap_candidates?: Array<{
    blocker_reservation_id: string;
    candidate_room_id: string;
    candidate_room_number: string;
    move_start_date: string;
    move_checkout_date: string;
  }>;
  impacted_segments?: Array<Record<string, unknown>>;
  price_preview?: { pricing_policy?: string; estimated_delta?: number | null; note?: string };
  current_room_type_name?: string;
  available_target_rooms?: Array<{
    id: string;
    room_number: string;
    room_type_id: number;
    room_type_name: string | null;
  }>;
};

type CommitPayload = {
  success?: boolean;
  error?: string;
  extension_reservation_id?: string | null;
  executed_actions?: Array<Record<string, unknown>>;
  failed_actions?: Array<Record<string, unknown>>;
  pending_fix_action?: string | null;
  warnings?: string[];
  ota_platform_update_required?: boolean;
};

function getBangkokTodayYmd(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export default function LinkedExtensionModal({
  reservationId,
  guestName,
  currentCheckoutDate,
  currentRoomTypeId,
  currentRoomNumber,
  onClose,
  onSuccess,
}: LinkedExtensionModalProps) {
  const [roomTypes, setRoomTypes] = useState<RoomTypeOption[]>([]);
  const [checkoutDate, setCheckoutDate] = useState(addDays(currentCheckoutDate, 1));
  const [extensionNights, setExtensionNights] = useState(1);
  const [copyAccompanying, setCopyAccompanying] = useState(true);
  const [copyPreferences, setCopyPreferences] = useState(true);
  const [note, setNote] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [commitResult, setCommitResult] = useState<CommitPayload | null>(null);

  const [strategy, setStrategy] = useState<"same_room" | "different_room">("same_room");
  const [moveMode, setMoveMode] = useState<"move_now" | "plan_move">("move_now");
  const [targetRoomTypeId, setTargetRoomTypeId] = useState(currentRoomTypeId);
  const [targetRoomId, setTargetRoomId] = useState("");
  const [planStartDate, setPlanStartDate] = useState(currentCheckoutDate);
  const [selectedBlockerReservationId, setSelectedBlockerReservationId] = useState("");
  const [selectedBlockerTargetRoomId, setSelectedBlockerTargetRoomId] = useState("");
  const [otaModificationOption, setOtaModificationOption] = useState<"option_a_keep_ota" | "option_b_shorten_ota">("option_a_keep_ota");
  const [otaShortenCheckoutDate, setOtaShortenCheckoutDate] = useState(() => getBangkokTodayYmd());

  const extensionNightsLabel = useMemo(
    () => `${extensionNights} night${extensionNights !== 1 ? "s" : ""}`,
    [extensionNights]
  );

  const currentRoomTypeName = useMemo(() => {
    const found = roomTypes.find((row) => row.id === currentRoomTypeId);
    return found?.name_en ?? `Room Type #${currentRoomTypeId}`;
  }, [roomTypes, currentRoomTypeId]);

  const bangkokToday = useMemo(() => getBangkokTodayYmd(), []);
  const isEarlyMoveCase = useMemo(
    () => strategy === "different_room" && moveMode === "move_now" && bangkokToday < currentCheckoutDate,
    [strategy, moveMode, bangkokToday, currentCheckoutDate]
  );
  const optionBMaxDate = useMemo(() => addDays(currentCheckoutDate, -1), [currentCheckoutDate]);

  useEffect(() => {
    setExtensionNights(1);
    setCheckoutDate(addDays(currentCheckoutDate, 1));
    setPlanStartDate(currentCheckoutDate);
  }, [currentCheckoutDate]);

  useEffect(() => {
    if (isEarlyMoveCase) return;
    if (otaModificationOption !== "option_a_keep_ota") {
      setOtaModificationOption("option_a_keep_ota");
    }
  }, [isEarlyMoveCase, otaModificationOption]);

  useEffect(() => {
    let active = true;
    async function loadMeta() {
      setLoadingMeta(true);
      try {
        const res = await fetch("/api/booking-meta");
        const payload = await res.json().catch(() => ({}));
        if (active && res.ok && payload.success && Array.isArray(payload.roomTypes)) {
          setRoomTypes(
            payload.roomTypes.map((row: any) => ({
              id: String(row.id),
              name_en: String(row.name_en ?? row.code ?? `Type ${row.id}`),
            }))
          );
        }
      } finally {
        if (active) setLoadingMeta(false);
      }
    }
    void loadMeta();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function runPreview() {
      setPreviewLoading(true);
      setPreviewError("");
      setError("");
      setCommitResult(null);

      const body: Record<string, unknown> = {
        new_checkout_date: checkoutDate,
        strategy,
        pricing_policy: "reprice_grid",
      };

      if (strategy === "different_room") {
        body.move_mode = moveMode;
        body.target_room_type_id = Number(targetRoomTypeId || currentRoomTypeId);
        if (targetRoomId) body.target_room_id = targetRoomId;
        if (moveMode === "plan_move") body.plan_start_date = planStartDate;
        if (isEarlyMoveCase) {
          body.ota_modification_option = otaModificationOption;
          if (otaModificationOption === "option_b_shorten_ota") {
            body.ota_shorten_checkout_date = otaShortenCheckoutDate;
          }
        }
      }

      try {
        const res = await fetch(`/api/bookings/${reservationId}/ota-extend-orchestrator/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !payload.success) {
          setPreview(null);
          setPreviewError(payload.error ?? "Failed to preview orchestrator plan.");
          return;
        }
        setPreview(payload);
      } catch {
        if (!active) return;
        setPreview(null);
        setPreviewError("Network error while loading preview.");
      } finally {
        if (active) setPreviewLoading(false);
      }
    }

    void runPreview();
    return () => {
      active = false;
    };
  }, [
    reservationId,
    checkoutDate,
    strategy,
    moveMode,
    targetRoomTypeId,
    targetRoomId,
    planStartDate,
    currentRoomTypeId,
    isEarlyMoveCase,
    otaModificationOption,
    otaShortenCheckoutDate,
  ]);

  useEffect(() => {
    if (strategy !== "different_room") return;
    const rooms = preview?.available_target_rooms ?? [];
    if (rooms.length === 0) {
      if (targetRoomId) setTargetRoomId("");
      return;
    }
    if (!targetRoomId || !rooms.some((row) => row.id === targetRoomId)) {
      setTargetRoomId(String(rooms[0].id));
    }
  }, [strategy, preview?.available_target_rooms, targetRoomId]);

  useEffect(() => {
    if (strategy !== "same_room") return;
    const blockers = preview?.blocking_items ?? [];
    const candidates = preview?.swap_candidates ?? [];
    if (blockers.length === 0 || candidates.length === 0) {
      if (selectedBlockerReservationId) setSelectedBlockerReservationId("");
      if (selectedBlockerTargetRoomId) setSelectedBlockerTargetRoomId("");
      return;
    }

    const blockerId = selectedBlockerReservationId || blockers[0].reservation_id;
    if (blockerId !== selectedBlockerReservationId) setSelectedBlockerReservationId(blockerId);
    const blockerCandidates = candidates.filter((row) => row.blocker_reservation_id === blockerId);
    const nextTargetRoomId = blockerCandidates.find((row) => row.candidate_room_id === selectedBlockerTargetRoomId)?.candidate_room_id
      ?? blockerCandidates[0]?.candidate_room_id
      ?? "";
    if (nextTargetRoomId !== selectedBlockerTargetRoomId) setSelectedBlockerTargetRoomId(nextTargetRoomId);
  }, [strategy, preview?.blocking_items, preview?.swap_candidates, selectedBlockerReservationId, selectedBlockerTargetRoomId]);

  const activeBlockerCandidates = useMemo(() => {
    const list = preview?.swap_candidates ?? [];
    if (!selectedBlockerReservationId) return [];
    return list.filter((row) => row.blocker_reservation_id === selectedBlockerReservationId);
  }, [preview?.swap_candidates, selectedBlockerReservationId]);

  const canSubmit = useMemo(() => {
    if (saving || previewLoading) return false;
    if (!preview?.can_commit) return false;
    if (strategy === "different_room") {
      if (!targetRoomId) return false;
      if (moveMode === "plan_move" && !planStartDate) return false;
      if (isEarlyMoveCase && otaModificationOption === "option_b_shorten_ota" && !otaShortenCheckoutDate) return false;
    }
    if (strategy === "same_room" && (preview?.blocking_items?.length ?? 0) > 0) {
      if (!selectedBlockerReservationId || !selectedBlockerTargetRoomId) return false;
    }
    return true;
  }, [
    saving,
    previewLoading,
    preview?.can_commit,
    strategy,
    targetRoomId,
    moveMode,
    planStartDate,
    preview?.blocking_items,
    selectedBlockerReservationId,
    selectedBlockerTargetRoomId,
    isEarlyMoveCase,
    otaModificationOption,
    otaShortenCheckoutDate,
  ]);

  async function handleSubmit() {
    if (checkoutDate <= currentCheckoutDate) {
      setError("New checkout date must be after extension check-in date.");
      return;
    }
    if (!preview?.can_commit) {
      setError((preview?.warnings ?? [])[0] ?? "Precheck failed. Please review blocker/warning details.");
      return;
    }

    setSaving(true);
    setError("");
    setCommitResult(null);
    try {
      const body: Record<string, unknown> = {
        new_checkout_date: checkoutDate,
        strategy,
        pricing_policy: "reprice_grid",
        note: note.trim() || undefined,
        copy_accompanying: copyAccompanying,
        copy_preferences: copyPreferences,
      };
      if (strategy === "different_room") {
        body.move_mode = moveMode;
        body.target_room_type_id = Number(targetRoomTypeId || currentRoomTypeId);
        body.target_room_id = targetRoomId || undefined;
        if (moveMode === "plan_move") body.plan_start_date = planStartDate;
        if (isEarlyMoveCase) {
          body.ota_modification_option = otaModificationOption;
          if (otaModificationOption === "option_b_shorten_ota") {
            body.ota_shorten_checkout_date = otaShortenCheckoutDate;
          }
        }
      } else if ((preview.blocking_items ?? []).length > 0) {
        body.selected_blocker_reservation_id = selectedBlockerReservationId || undefined;
        body.selected_blocker_target_room_id = selectedBlockerTargetRoomId || undefined;
      }

      const res = await fetch(`/api/bookings/${reservationId}/ota-extend-orchestrator/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as CommitPayload;
      if (!res.ok) {
        setError(payload.error ?? "Failed to run orchestrator commit.");
        return;
      }

      setCommitResult(payload);
      if (payload.success) {
        onSuccess({
          reservation_id: payload.extension_reservation_id ?? undefined,
          extension_reservation_id: payload.extension_reservation_id ?? null,
        });
      } else if (!payload.extension_reservation_id) {
        setError(payload.error ?? "Commit failed.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PmsModal
      title="OTA Extend Stay Orchestrator"
      size="lg"
      onClose={onClose}
      footer={(
        <div className="flex w-full gap-2">
          <button className="btn btn-secondary flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary flex-1" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Committing…" : "Commit Extension Plan"}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {previewError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {previewError}
          </div>
        )}

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)] font-semibold">Original OTA Reservation</p>
          <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5">{guestName}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Extension source will be Walk-in. For move-now, you can choose keep OTA as-is or shorten OTA first.
          </p>
        </div>

        <div>
          <label className="form-label">Extension Date / Nights</label>
          <NightCounter
            checkinDate={currentCheckoutDate}
            checkoutDate={checkoutDate}
            nights={extensionNights}
            lockCheckin
            disabled={saving}
            onChange={(_checkin, nextCheckout, nextNights) => {
              setCheckoutDate(nextCheckout);
              setExtensionNights(Math.max(1, nextNights || 1));
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Current Room Type</label>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {loadingMeta ? "Loading..." : preview?.current_room_type_name || currentRoomTypeName}
            </div>
          </div>
          <div>
            <label className="form-label">Current Room</label>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-primary)]">
              Room {preview?.current_room_number || currentRoomNumber}
            </div>
          </div>
        </div>

        {isEarlyMoveCase && (
          <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:bg-indigo-500/10 dark:border-indigo-500/20">
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">OTA Early Room-Change Decision</p>
            <div className="space-y-2 text-sm text-indigo-900 dark:text-indigo-300">
              <label className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 dark:bg-slate-900 dark:border-indigo-500/30">
                <input
                  type="radio"
                  name="ota-modification-option"
                  value="option_a_keep_ota"
                  checked={otaModificationOption === "option_a_keep_ota"}
                  onChange={() => setOtaModificationOption("option_a_keep_ota")}
                  disabled={saving}
                />
                <span>
                  <span className="font-semibold">Option A: Keep OTA booking as-is</span>
                  <span className="block text-xs text-indigo-700 dark:text-indigo-400">Move now and keep OTA dates unchanged.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 dark:bg-slate-900 dark:border-indigo-500/30">
                <input
                  type="radio"
                  name="ota-modification-option"
                  value="option_b_shorten_ota"
                  checked={otaModificationOption === "option_b_shorten_ota"}
                  onChange={() => setOtaModificationOption("option_b_shorten_ota")}
                  disabled={saving}
                />
                <span>
                  <span className="font-semibold">Option B: Shorten OTA first</span>
                  <span className="block text-xs text-indigo-700 dark:text-indigo-400">Shorten OTA, create Walk-in segment, then move extension.</span>
                </span>
              </label>
            </div>
            {otaModificationOption === "option_b_shorten_ota" && (
              <div>
                <label className="form-label">OTA Shorten Checkout Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={otaShortenCheckoutDate}
                  max={optionBMaxDate}
                  onChange={(e) => setOtaShortenCheckoutDate(e.target.value)}
                  disabled={saving}
                />
                <p className="mt-1 text-xs text-indigo-800 dark:text-indigo-400">
                  Reminder: after commit, FO must update OTA platform dates manually.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label">Strategy</label>
            <select className="form-select" value={strategy} onChange={(e) => setStrategy(e.target.value === "different_room" ? "different_room" : "same_room")} disabled={saving}>
              <option value="same_room">Same room</option>
              <option value="different_room">Different room</option>
            </select>
          </div>
          {strategy === "different_room" && (
            <div>
              <label className="form-label">Move Mode</label>
              <select className="form-select" value={moveMode} onChange={(e) => setMoveMode(e.target.value === "plan_move" ? "plan_move" : "move_now")} disabled={saving}>
                <option value="move_now">Move now</option>
                <option value="plan_move">Plan move</option>
              </select>
            </div>
          )}
        </div>

        {strategy === "different_room" && (
          <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="form-label">Target Room Type</label>
                <select className="form-select" value={targetRoomTypeId} onChange={(e) => setTargetRoomTypeId(e.target.value)} disabled={saving}>
                  {roomTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name_en}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Target Room</label>
                <select className="form-select" value={targetRoomId} onChange={(e) => setTargetRoomId(e.target.value)} disabled={saving || previewLoading}>
                  {(preview?.available_target_rooms ?? []).length === 0 && <option value="">No available target room</option>}
                  {(preview?.available_target_rooms ?? []).map((room) => (
                    <option key={room.id} value={room.id}>Room {room.room_number}</option>
                  ))}
                </select>
              </div>
            </div>
            {moveMode === "plan_move" && (
              <div>
                <label className="form-label">Plan Start Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={planStartDate}
                  min={currentCheckoutDate}
                  onChange={(e) => setPlanStartDate(e.target.value)}
                  disabled={saving}
                />
              </div>
            )}
          </div>
        )}

        {strategy === "same_room" && (preview?.blocking_items?.length ?? 0) > 0 && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:bg-amber-500/10 dark:border-amber-500/20">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Room is blocked for extension dates</p>
            <div className="space-y-2 text-sm text-amber-800 dark:text-amber-400">
              {(preview?.blocking_items ?? []).map((item) => (
                <div key={item.reservation_id} className="rounded border border-amber-200 bg-white px-3 py-2 dark:bg-slate-900 dark:border-amber-500/30">
                  <div className="font-semibold">{item.booking_code} - {item.guest_name}</div>
                  <div className="text-xs">Room {item.room_number ?? "?"} | {item.checkin_date} to {item.checkout_date}</div>
                  {item.checked_in && <div className="text-xs text-rose-700 dark:text-rose-400 mt-1">Checked-in advisory: please inform guest before moving.</div>}
                  {item.swap_diagnostic?.reason && <div className="text-xs mt-1">Swap diagnostic: {item.swap_diagnostic.reason}</div>}
                </div>
              ))}
            </div>
            {(preview?.swap_candidates?.length ?? 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="form-label">Blocker Reservation</label>
                  <select
                    className="form-select"
                    value={selectedBlockerReservationId}
                    onChange={(e) => setSelectedBlockerReservationId(e.target.value)}
                    disabled={saving}
                  >
                    {(preview?.blocking_items ?? []).map((item) => (
                      <option key={item.reservation_id} value={item.reservation_id}>
                        {item.booking_code} - {item.guest_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Move Blocker To</label>
                  <select
                    className="form-select"
                    value={selectedBlockerTargetRoomId}
                    onChange={(e) => setSelectedBlockerTargetRoomId(e.target.value)}
                    disabled={saving}
                  >
                    {activeBlockerCandidates.map((candidate) => (
                      <option key={`${candidate.blocker_reservation_id}:${candidate.candidate_room_id}`} value={candidate.candidate_room_id}>
                        Room {candidate.candidate_room_number} ({candidate.move_start_date} to {candidate.move_checkout_date})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`rounded-lg px-3 py-2 text-sm ${
          previewLoading
            ? "border border-[var(--border-default)] bg-[var(--bg-body)] text-[var(--text-muted)]"
            : preview?.can_commit
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
              : "border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
        }`}>
          {previewLoading
            ? "Running atomic preview..."
            : preview?.can_commit
              ? "Precheck passed. Plan is ready to commit."
              : "Precheck blocked. Review warnings and blockers before commit."}
        </div>

        {(preview?.warnings ?? []).length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400">
            <ul className="list-disc pl-5 space-y-1">
              {(preview?.warnings ?? []).map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {preview?.price_preview && (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-table-cell)] space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span>Extension nights</span>
              <span className="font-semibold">{extensionNightsLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Pricing policy</span>
              <span className="font-semibold">{preview.price_preview.pricing_policy ?? "reprice_grid"}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">{preview.price_preview.note}</div>
          </div>
        )}

        {commitResult && (
          <div className={`rounded-lg px-3 py-2 text-sm ${
            commitResult.success
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
              : "border border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400"
          }`}>
            <p className="font-semibold">
              {commitResult.success ? "Commit completed successfully." : "Commit completed with pending follow-up."}
            </p>
            {!commitResult.success && commitResult.pending_fix_action && (
              <p className="mt-1">Pending action: {commitResult.pending_fix_action}</p>
            )}
            {commitResult.ota_platform_update_required && (
              <p className="mt-1 text-xs">Reminder: update OTA platform dates to match this reservation change.</p>
            )}
            {(commitResult.executed_actions ?? []).length > 0 && (
              <p className="mt-1 text-xs">Executed actions: {(commitResult.executed_actions ?? []).length}</p>
            )}
            {(commitResult.failed_actions ?? []).length > 0 && (
              <p className="mt-1 text-xs">Failed actions: {(commitResult.failed_actions ?? []).length}</p>
            )}
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-table-cell)]">
            <input type="checkbox" checked={copyAccompanying} onChange={(e) => setCopyAccompanying(e.target.checked)} disabled={saving} />
            Copy accompanying guests to the new reservation
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-table-cell)]">
            <input type="checkbox" checked={copyPreferences} onChange={(e) => setCopyPreferences(e.target.checked)} disabled={saving} />
            Copy preferences / reservation notes context
          </label>
        </div>

        <div>
          <label className="form-label">Extension Note</label>
          <textarea
            className="form-input min-h-[96px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
            placeholder="Optional note for the walk-in extension reservation"
          />
        </div>
      </div>
    </PmsModal>
  );
}
