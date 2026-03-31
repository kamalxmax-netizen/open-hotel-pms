import { useEffect, useMemo, useState } from "react";
import PmsModal from "./pms-modal";

interface AssignRoomModalProps {
    reservationId: string;
    roomTypeId: string;
    roomTypeName: string;
    guestName: string;
    checkinDate: string;
    checkoutDate: string;
    onClose: () => void;
    onAssigned?: (roomId: string, roomNumber: string) => void;
    onSuccess: () => void;
    mode?: "assign" | "swap";
    currentRoomId?: string;
    currentRoomNumber?: string;
}

type Recommendation = {
    room_id: string;
    room_number: string;
    score: number;
    matched_features: string[];
    missing_features: string[];
    status: string;
};

type SwapCandidate = {
    reservation_id: string;
    booking_code: string;
    guest_name: string;
    room_id: string | null;
    room_number: string | null;
    checkin_date: string;
    checkout_date: string;
    nights: number;
    can_swap: boolean;
    reason_code: string | null;
    reason: string | null;
    do_not_move_assigned_room?: boolean;
    do_not_move_reason?: string | null;
    member_count?: number;
};

type SwapSource = {
    reservation_id: string;
    room_id: string | null;
    room_number: string | null;
    do_not_move_assigned_room?: boolean;
    do_not_move_reason?: string | null;
    member_count?: number;
};

function formatStayLine(checkinDate: string, checkoutDate: string, nights: number) {
    return `${checkinDate} → ${checkoutDate} (${nights}N)`;
}

function formatSwapRoomLabel(roomNumber: string | null | undefined) {
    const value = String(roomNumber ?? "").trim();
    if (!value) return "?";
    return value.includes("→") ? value : `Room ${value}`;
}

export default function AssignRoomModal({
    reservationId,
    roomTypeId,
    roomTypeName,
    guestName,
    checkinDate,
    checkoutDate,
    onClose,
    onAssigned,
    onSuccess,
    mode = "assign",
    currentRoomId,
    currentRoomNumber
}: AssignRoomModalProps) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
    const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
    const [preferences, setPreferences] = useState<{ code: string; name: string }[]>([]);
    const [swapOverrideNote, setSwapOverrideNote] = useState("");

    const isSwapMode = mode === "swap";

    useEffect(() => {
        async function fetchRecommendations() {
            setLoading(true);
            setError("");
            try {
                const query = new URLSearchParams();
                if (roomTypeId) query.set("room_type_id", roomTypeId);
                if (checkinDate) query.set("checkin_date", checkinDate);
                if (checkoutDate) query.set("checkout_date", checkoutDate);
                if (isSwapMode) query.set("include_swap", "true");

                const endpoint = `/api/bookings/${reservationId}/recommendations${query.toString() ? `?${query.toString()}` : ""}`;
                const res = await fetch(endpoint);
                const data = await res.json();

                if (data.success) {
                    setRecommendations(data.recommendations || []);
                    setPreferences(data.preferences || []);
                    setSwapCandidates(data.swap_candidates || []);
                    setSwapSource(data.swap_source || null);
                } else {
                    setError(data.error || "Failed to load recommendations.");
                }
            } catch {
                setError("Network error.");
            } finally {
                setLoading(false);
            }
        }

        fetchRecommendations();
    }, [reservationId, roomTypeId, checkinDate, checkoutDate, isSwapMode]);

    const swapCounts = useMemo(() => ({
        allowed: swapCandidates.filter((candidate) => candidate.can_swap).length,
        blocked: swapCandidates.filter((candidate) => !candidate.can_swap).length,
    }), [swapCandidates]);
    const eligibleSwapCandidates = useMemo(
        () => swapCandidates.filter((candidate) => candidate.can_swap),
        [swapCandidates]
    );
    const hasEligibleSwapLock = Boolean(
        swapSource?.do_not_move_assigned_room || eligibleSwapCandidates.some((candidate) => candidate.do_not_move_assigned_room)
    );
    const sourceSwapRoomLabel = formatSwapRoomLabel(swapSource?.room_number ?? currentRoomNumber ?? currentRoomId ?? "?");

    async function handleAssign(roomId: string, roomNumber: string) {
        if (!confirm(`Assign Room ${roomNumber} to ${guestName}?`)) return;

        setSaving(true);
        setError("");

        try {
            const res = await fetch(`/api/bookings/${reservationId}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: roomId })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                onAssigned?.(roomId, roomNumber);
                onSuccess();
            } else {
                setError(data.error || "Assignment failed.");
                setSaving(false);
            }
        } catch {
            setError("Network error.");
            setSaving(false);
        }
    }

    async function handleSwap(candidate: SwapCandidate) {
        if (!candidate.can_swap) return;
        const needsOverride = Boolean(swapSource?.do_not_move_assigned_room || candidate.do_not_move_assigned_room);
        if (needsOverride && !swapOverrideNote.trim()) {
            setError("Override note is required because one of the reservations is locked to its assigned room.");
            return;
        }

        const confirmed = confirm(
            `Swap ${sourceSwapRoomLabel} ↔ ${formatSwapRoomLabel(candidate.room_number ?? "?")}?\n\n` +
            `Source: ${guestName}\n` +
            `Target: ${candidate.guest_name} (${candidate.booking_code})` +
            ((swapSource?.member_count ?? 1) > 1 || (candidate.member_count ?? 1) > 1
                ? `\n\nThis swap will move the full linked path${(swapSource?.member_count ?? 1) > 1 ? ` on source (${swapSource?.member_count} segments)` : ""}${(candidate.member_count ?? 1) > 1 ? `${(swapSource?.member_count ?? 1) > 1 ? " and " : " " }target (${candidate.member_count} segments)` : ""}.`
                : "")
        );
        if (!confirmed) return;

        setSaving(true);
        setError("");

        try {
            const res = await fetch(`/api/bookings/${reservationId}/swap-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target_reservation_id: candidate.reservation_id,
                    override_assigned_note: needsOverride ? swapOverrideNote.trim() : undefined,
                })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                onSuccess();
            } else {
                setError(data.error || "Swap failed.");
                setSaving(false);
            }
        } catch {
            setError("Network error.");
            setSaving(false);
        }
    }

    return (
        <PmsModal
            title={isSwapMode ? "Swap Room" : "Assign Room"}
            size="md"
            onClose={onClose}
        >
            <div className="space-y-4">
                <div className="bg-[var(--bg-body)] border border-[var(--border-default)] rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex justify-between items-start gap-4">
                        <div>
                            <h3 className="font-bold text-[var(--text-primary)] text-lg">{guestName}</h3>
                            <p className="text-sm text-brand-600 font-semibold">{roomTypeName}</p>
                            {isSwapMode && (swapSource?.room_number || currentRoomNumber) && (
                                <p className="text-xs text-[var(--text-secondary)] mt-1">
                                    Current assignment: <span className="font-semibold text-[var(--text-table-cell)]">{sourceSwapRoomLabel}</span>
                                    {(swapSource?.member_count ?? 1) > 1 && (
                                        <span className="ml-2 inline-flex rounded-full border border-indigo-200 bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                                            {swapSource?.member_count} linked segments
                                        </span>
                                    )}
                                </p>
                            )}
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Stay</p>
                            <p className="text-sm font-medium text-[var(--text-table-cell)]">{checkinDate} → {checkoutDate}</p>
                        </div>
                    </div>
                </div>

                {preferences.length > 0 && (
                    <div>
                        <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Guest Preferences</h4>
                        <div className="flex flex-wrap gap-1.5">
                            {preferences.map((p) => (
                                <span key={p.code} className="badge bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-indigo-400">
                                    {p.name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400">
                        {error}
                    </div>
                )}

                <div>
                    <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mt-4 mb-2">
                        Vacant Rooms
                    </h4>

                    {loading ? (
                        <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-16 bg-[var(--bg-muted)] animate-pulse rounded-lg border border-[var(--border-default)]" />
                            ))}
                        </div>
                    ) : recommendations.length === 0 ? (
                        <div className="text-center py-6 bg-[var(--bg-body)] border border-[var(--border-default)] rounded-lg">
                            <p className="text-amber-600 font-medium">No available rooms of type {roomTypeName}</p>
                            <p className="text-xs text-[var(--text-secondary)] mt-1">Check calendar for conflicts or overbookings.</p>
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {recommendations.map((room) => (
                                <div
                                    key={room.room_id}
                                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${room.status === "conflict"
                                        ? "bg-rose-50 border-rose-200 opacity-60 dark:bg-rose-500/10 dark:border-rose-500/20"
                                        : "bg-[var(--bg-surface)] border-[var(--border-default)] hover:border-brand-300 hover:shadow-sm"
                                        }`}
                                >
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-lg text-[var(--text-primary)]">Room {room.room_number}</span>
                                            {room.score > 0 && (
                                                <span className="badge bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30">
                                                    Match {Math.round((room.score / (preferences.length || 1)) * 100)}%
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-4 mt-1 flex-wrap">
                                            {room.matched_features.length > 0 && (
                                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                                    <span className="font-semibold">✓ Has:</span> {room.matched_features.join(", ")}
                                                </div>
                                            )}
                                            {room.missing_features.length > 0 && (
                                                <div className="text-[11px] text-rose-500 dark:text-rose-400">
                                                    <span className="font-semibold">✗ Missing:</span> {room.missing_features.join(", ")}
                                                </div>
                                            )}
                                            {room.matched_features.length === 0 && room.missing_features.length === 0 && preferences.length > 0 && (
                                                <div className="text-[11px] text-[var(--text-muted)]">No matching features</div>
                                            )}
                                        </div>

                                        {room.status === "conflict" && (
                                            <div className="text-xs text-rose-600 font-semibold mt-1 dark:text-rose-400">Dates conflict with another booking</div>
                                        )}
                                    </div>

                                    <button
                                        className="btn btn-primary btn-sm flex-shrink-0"
                                        disabled={saving || room.status === "conflict"}
                                        onClick={() => handleAssign(room.room_id, room.room_number)}
                                    >
                                        Assign
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {isSwapMode && (
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-2 mt-4">
                            <h4 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Swap Candidates</h4>
                            <div className="text-[11px] text-[var(--text-muted)]">
                                {swapCounts.allowed} swappable{swapCounts.blocked > 0 ? ` · ${swapCounts.blocked} hidden` : ""}
                            </div>
                        </div>

                        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 dark:bg-indigo-500/10 dark:border-indigo-500/20">
                            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">Swap works only when</p>
                            <div className="mt-2 grid gap-1 text-xs text-indigo-800 dark:text-indigo-300">
                                <div>Both bookings are active, assigned, and not checked in yet</div>
                                <div>Both rooms use the same room type</div>
                                <div>The booking you opened defines the swap window for the move</div>
                                <div>The other booking must sit fully inside that window, so open the longer stay first</div>
                                <div>Multi-room paths are allowed if the target stay fits fully inside the source window</div>
                                <div>No day-use room and no active planned move on either booking</div>
                            </div>
                        </div>

                        {loading ? (
                            <div className="space-y-2">
                                {[1, 2].map((i) => (
                                    <div key={i} className="h-20 bg-[var(--bg-muted)] animate-pulse rounded-lg border border-[var(--border-default)]" />
                                ))}
                            </div>
                        ) : eligibleSwapCandidates.length === 0 ? (
                            <div className="text-center py-6 bg-[var(--bg-body)] border border-[var(--border-default)] rounded-lg">
                                <p className="text-[var(--text-secondary)] font-medium">No swappable reservations found</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1">Only bookings that already pass all swap rules are shown here. If the stay lengths differ, open the longer booking first.</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {hasEligibleSwapLock && (
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 space-y-2 dark:bg-rose-500/10 dark:border-rose-500/20">
                                        <p className="text-sm font-semibold text-rose-800 dark:text-rose-400">Room Lock Active</p>
                                        {swapSource?.do_not_move_assigned_room && (
                                            <p className="text-xs text-rose-700 dark:text-rose-500/80">
                                                Source reservation is locked to {formatSwapRoomLabel(swapSource.room_number ?? currentRoomNumber ?? "?")}
                                                {swapSource.do_not_move_reason ? ` · ${swapSource.do_not_move_reason}` : ""}
                                            </p>
                                        )}
                                        <label className="form-label !text-rose-800 dark:!text-rose-400">Override Note</label>
                                        <textarea
                                            className="form-input min-h-[72px]"
                                            value={swapOverrideNote}
                                            onChange={(e) => setSwapOverrideNote(e.target.value)}
                                            placeholder="Reason for overriding Do Not Move lock"
                                            disabled={saving}
                                        />
                                    </div>
                                )}
                                {eligibleSwapCandidates.map((candidate) => (
                                    <div
                                        key={candidate.reservation_id}
                                        className="rounded-lg border p-3 transition-all bg-[var(--bg-surface)] border-[var(--border-default)] hover:border-brand-300 hover:shadow-sm"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-semibold text-[var(--text-primary)] truncate">
                                                    [{candidate.room_number ?? "—"}] {candidate.guest_name} <span className="text-[var(--text-muted)]">{candidate.booking_code}</span>
                                                </div>
                                                <div className="text-xs text-[var(--text-secondary)] mt-1">
                                                    {formatStayLine(candidate.checkin_date, candidate.checkout_date, candidate.nights)}
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30">
                                                        ✓ Can Swap
                                                    </span>
                                                    {(candidate.member_count ?? 1) > 1 && (
                                                        <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30">
                                                            {(candidate.member_count ?? 1)} linked segments
                                                        </span>
                                                    )}
                                                    {candidate.do_not_move_assigned_room && (
                                                        <span className="inline-flex rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30">
                                                            🔒 Do Not Move
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                className="btn btn-secondary btn-sm flex-shrink-0"
                                                disabled={saving}
                                                onClick={() => handleSwap(candidate)}
                                            >
                                                Swap ↔
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </PmsModal>
    );
}
