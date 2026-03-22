"use client";

import { useState } from "react";
import type { LinkedStay } from "@/lib/types";

function formatMoney(amount: number) {
  return amount.toLocaleString("th-TH");
}

function formatDateToShort(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

interface LinkedStayPanelProps {
  linkedStay: LinkedStay;
  currentReservationId: string;
  onSwitchTab: (id: string) => void;
  /** Called after successful unlink — parent should refetch data */
  onUnlinked?: () => void;
  /** Called after successful link — parent should refetch data */
  onLinked?: () => void;
}

export default function LinkedStayPanel({
  linkedStay,
  currentReservationId,
  onSwitchTab,
  onUnlinked,
}: LinkedStayPanelProps) {
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState("");

  if (!linkedStay || !linkedStay.segments || linkedStay.segments.length === 0) {
    return null;
  }

  const fdCi = formatDateToShort(linkedStay.full_checkin);
  const fdCo = formatDateToShort(linkedStay.full_checkout);

  // Current segment info
  const currentSegment = linkedStay.segments.find(
    (seg) => seg.reservation_id === currentReservationId
  );
  // is_parent = false means this is a child (linked extension)
  const isChild = currentSegment ? !currentSegment.is_parent : false;
  // Can unlink: must be a child segment, and not checked_out/cancelled
  const canUnlink =
    isChild &&
    currentSegment?.status !== "checked_out" &&
    currentSegment?.status !== "cancelled";

  async function handleUnlink() {
    if (!currentReservationId) return;
    setUnlinking(true);
    setUnlinkError("");

    try {
      const res = await fetch(
        `/api/bookings/${currentReservationId}/link-stay`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note: "Manual unlink from LinkedStayPanel",
          }),
        }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setUnlinkError(data?.error || "Failed to unlink reservation.");
        return;
      }

      setConfirmUnlink(false);
      onUnlinked?.();
    } catch (err) {
      setUnlinkError(String(err));
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl px-4 py-3 mb-6 shadow-sm dark:bg-indigo-500/5 dark:border-indigo-500/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left section: Title, Dates, and Segments all in one lane */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xl">📎</span>
            <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-widest dark:text-indigo-400">
              Linked Stay
            </h3>
            <span className="text-xs text-indigo-700 bg-indigo-100/50 px-2 py-0.5 rounded font-medium dark:bg-indigo-500/15 dark:text-indigo-300 whitespace-nowrap">
              {fdCi} → {fdCo} ({linkedStay.full_nights}N)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {linkedStay.segments.map((seg, idx) => {
              const isSelected = seg.reservation_id === currentReservationId;
              const isCurrentlyActiveSegment =
                seg.reservation_id === linkedStay.active_segment_id;

              let statusIcon = "";
              if (isCurrentlyActiveSegment) statusIcon = "●";
              else if (seg.status === "checked_out") statusIcon = "✓ C/O";
              else if (seg.status === "cancelled") statusIcon = "✕ Cancelled";

              const sourceCode = String(seg.source ?? "").toLowerCase();
              const sourceLabel =
                sourceCode === "walkin"
                  ? "Walk-in"
                  : sourceCode
                    ? sourceCode.toUpperCase()
                    : "Unknown";
              const dCi = formatDateToShort(seg.checkin_date);
              const dCo = formatDateToShort(seg.checkout_date);

              return (
                <div
                  key={seg.reservation_id}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={() => onSwitchTab(seg.reservation_id)}
                    disabled={isSelected}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap
                      ${
                        isSelected
                          ? "bg-white border-2 border-indigo-400 text-indigo-900 shadow-sm font-bold cursor-default dark:bg-slate-900 dark:border-indigo-500 dark:text-indigo-300"
                          : "bg-white/50 border border-indigo-200 text-indigo-600 hover:bg-white hover:border-indigo-300 hover:shadow-sm dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                      }
                    `}
                  >
                    {statusIcon && (
                      <span
                        className={`${isCurrentlyActiveSegment ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} text-xs font-black`}
                      >
                        {statusIcon}
                      </span>
                    )}
                    <span>{sourceLabel}</span>
                    <span className="opacity-75 font-normal text-xs">
                      {dCi}-{dCo}
                    </span>
                  </button>

                  {idx < linkedStay.segments.length - 1 && (
                    <span className="text-indigo-300 font-bold dark:text-indigo-500/50">
                      →
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right section: Combined Total + Unlink */}
        <div className="flex items-center gap-3">
          <div className="text-lg text-indigo-700 font-bold dark:text-indigo-300 whitespace-nowrap">
            Combined: ฿{formatMoney(linkedStay.combined_total)}
          </div>

          {canUnlink && !confirmUnlink && (
            <button
              type="button"
              onClick={() => setConfirmUnlink(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 hover:border-amber-300 transition-all dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30 dark:hover:bg-amber-500/20"
              title="Unlink this segment from linked stay"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.181 8.68a4.503 4.503 0 011.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 006.364 6.365l.136-.137m7.58-13.068a4.5 4.5 0 00-6.365-6.364l-.136.136"
                />
              </svg>
              Unlink
            </button>
          )}
        </div>
      </div>

      {/* Unlink confirmation inline */}
      {confirmUnlink && (
        <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-500/20">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Unlink this segment from linked stay?
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400/70 mt-0.5">
                This booking will become a standalone reservation. You can
                re-link it later.
              </p>
              {unlinkError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-medium">
                  {unlinkError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setConfirmUnlink(false);
                  setUnlinkError("");
                }}
                disabled={unlinking}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-all dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnlink}
                disabled={unlinking}
                className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 border border-amber-700 rounded-lg hover:bg-amber-700 transition-all disabled:opacity-50 dark:bg-amber-600 dark:border-amber-500"
              >
                {unlinking ? "Unlinking..." : "Confirm Unlink"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
