import { AmenityAuditSessionListRow } from "@/lib/types";
import { ArrowDownToLineIcon, AlertTriangleIcon } from "lucide-react";

export function AuditSessionCard({ session }: { session: AmenityAuditSessionListRow }) {
  const overclickTotal = session.total_overclick + session.total_underclick;

  return (
    <div className="card p-4 hover:bg-[var(--bg-body)] transition-colors dark:bg-[var(--bg-surface)]">
      <div className="flex justify-between items-start mb-3">
        <div>
           <h4 className="text-sm font-bold text-[var(--text-primary)]">Floor {session.floor_number}</h4>
           <p className="text-[11px] text-[var(--text-muted)]">
             {new Date(session.created_at).toLocaleString()} | by {session.audited_by}
           </p>
        </div>
        <div className="text-right">
           <span className="text-xs font-semibold text-[var(--text-secondary)]">{session.items_count} items</span>
        </div>
      </div>
      
      <div className="flex gap-4">
         <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <ArrowDownToLineIcon className="w-4 h-4 text-emerald-500" />
            <span>Refilled: <b>{session.total_refill}</b></span>
         </div>
         <div className={`flex items-center gap-1.5 text-xs ${overclickTotal > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-secondary)]"}`}>
            <AlertTriangleIcon className="w-4 h-4" />
            <span>Over/Under: <b>{overclickTotal > 0 ? overclickTotal : "-"}</b></span>
         </div>
      </div>
      {session.session_note && (
         <div className="mt-3 p-2 bg-[var(--bg-muted)]/50 rounded text-[11px] text-[var(--text-muted)] italic border-l-2 border-slate-300 dark:border-slate-600">
           "{session.session_note}"
         </div>
      )}
    </div>
  );
}
