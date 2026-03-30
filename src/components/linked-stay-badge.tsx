import type { LinkedStaySegment } from "@/lib/types";
import { formatDateRangeDisplay } from "@/lib/date-display";

function statusScore(status: string | null | undefined): number {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "active") return 4;
  if (normalized === "checked_out") return 3;
  if (normalized === "cancelled") return 2;
  if (normalized === "no_show") return 1;
  return 0;
}

function normalizeSegments(segments: LinkedStaySegment[]): LinkedStaySegment[] {
  const byReservationId = new Map<string, LinkedStaySegment>();
  for (const segment of segments) {
    const reservationId = String(segment?.reservation_id ?? "");
    if (!reservationId) continue;
    const previous = byReservationId.get(reservationId);
    if (!previous || statusScore(segment.status) > statusScore(previous.status)) {
      byReservationId.set(reservationId, segment);
    }
  }

  return Array.from(byReservationId.values()).sort((left, right) => {
    const checkinCmp = String(left.checkin_date ?? "").localeCompare(String(right.checkin_date ?? ""));
    if (checkinCmp !== 0) return checkinCmp;
    const checkoutCmp = String(left.checkout_date ?? "").localeCompare(String(right.checkout_date ?? ""));
    if (checkoutCmp !== 0) return checkoutCmp;
    return String(left.reservation_id ?? "").localeCompare(String(right.reservation_id ?? ""));
  });
}

export function LinkedStayBadge({ segments, activeSegmentId }: { segments: LinkedStaySegment[]; activeSegmentId: string }) {
  if (!segments || segments.length === 0) return null;
  const normalizedSegments = normalizeSegments(segments);
  if (normalizedSegments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {normalizedSegments.map((seg) => {
        const isActive = seg.reservation_id === activeSegmentId;
        const dateRangeStr = formatDateRangeDisplay(seg.checkin_date, seg.checkout_date, {
          withYear: false,
          separator: "-",
        });
        
        const sourceCode = String(seg.source ?? "").toLowerCase();
        const sourceLabel = sourceCode === "walkin" ? "WI" : sourceCode ? sourceCode.toUpperCase() : "UNK";
        
        let statusIcon = "";
        if (isActive) statusIcon = "●";
        else if (seg.status === "checked_out") statusIcon = "✓";
        else if (seg.status === "cancelled") statusIcon = "✕";
        
        const badgeClasses = isActive 
          ? "bg-indigo-100 text-indigo-800 border-indigo-200 shadow-sm font-bold dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30" 
          : "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";

        return (
          <span 
            key={seg.reservation_id} 
            className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${badgeClasses}`}
            title={`${sourceLabel} Booking: ${formatDateRangeDisplay(seg.checkin_date, seg.checkout_date)}`}
          >
            <span>{sourceLabel}</span>
            <span>{dateRangeStr}</span>
            {statusIcon && <span className={isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}>{statusIcon}</span>}
          </span>
        );
      })}
    </div>
  );
}
