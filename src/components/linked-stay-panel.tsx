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
}

export default function LinkedStayPanel({ linkedStay, currentReservationId, onSwitchTab }: LinkedStayPanelProps) {
  if (!linkedStay || !linkedStay.segments || linkedStay.segments.length === 0) {
    return null;
  }

  const fdCi = formatDateToShort(linkedStay.full_checkin);
  const fdCo = formatDateToShort(linkedStay.full_checkout);

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl px-4 py-3 mb-6 shadow-sm dark:bg-indigo-500/5 dark:border-indigo-500/20">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left section: Title, Dates, and Segments all in one lane */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 mr-2">
            <span className="text-xl">📎</span>
            <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-widest dark:text-indigo-400">Linked Stay</h3>
            <span className="text-xs text-indigo-700 bg-indigo-100/50 px-2 py-0.5 rounded font-medium dark:bg-indigo-500/15 dark:text-indigo-300 whitespace-nowrap">
              {fdCi} → {fdCo} ({linkedStay.full_nights}N)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {linkedStay.segments.map((seg, idx) => {
              const isSelected = seg.reservation_id === currentReservationId;
              const isCurrentlyActiveSegment = seg.reservation_id === linkedStay.active_segment_id;
              
              let statusIcon = "";
              if (isCurrentlyActiveSegment) statusIcon = "●";
              else if (seg.status === "checked_out") statusIcon = "✓ C/O";
              else if (seg.status === "cancelled") statusIcon = "✕ Cancelled";

              const sourceCode = String(seg.source ?? "").toLowerCase();
              const sourceLabel = sourceCode === "walkin" ? "Walk-in" : sourceCode ? sourceCode.toUpperCase() : "Unknown";
              const dCi = formatDateToShort(seg.checkin_date);
              const dCo = formatDateToShort(seg.checkout_date);

              return (
                <div key={seg.reservation_id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSwitchTab(seg.reservation_id)}
                    disabled={isSelected}
                    className={`
                      flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all whitespace-nowrap
                      ${isSelected 
                        ? "bg-white border-2 border-indigo-400 text-indigo-900 shadow-sm font-bold cursor-default dark:bg-slate-900 dark:border-indigo-500 dark:text-indigo-300" 
                        : "bg-white/50 border border-indigo-200 text-indigo-600 hover:bg-white hover:border-indigo-300 hover:shadow-sm dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                      }
                    `}
                  >
                    {statusIcon && (
                      <span className={`${isCurrentlyActiveSegment ? "text-indigo-500 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"} text-xs font-black`}>
                        {statusIcon}
                      </span>
                    )}
                    <span>{sourceLabel}</span>
                    <span className="opacity-75 font-normal text-xs">{dCi}-{dCo}</span>
                  </button>
                  
                  {idx < linkedStay.segments.length - 1 && (
                    <span className="text-indigo-300 font-bold dark:text-indigo-500/50">→</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right section: Combined Total enlarged */}
        <div className="text-lg text-indigo-700 font-bold dark:text-indigo-300 whitespace-nowrap">
          Combined: ฿{formatMoney(linkedStay.combined_total)}
        </div>
      </div>
    </div>
  );
}
