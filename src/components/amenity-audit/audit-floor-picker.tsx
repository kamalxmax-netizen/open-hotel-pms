import { AmenityAuditFloorStatus } from "@/lib/types";
import { AlertCircleIcon, CheckCircle2Icon, ClockIcon } from "lucide-react";
import Link from "next/link";

export function AuditFloorPicker({ floors }: { floors: AmenityAuditFloorStatus[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      {floors.map(floor => (
        <div key={floor.floor_number} className="card p-5 hover:shadow-md transition-shadow relative overflow-hidden dark:bg-[var(--bg-surface)]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-extrabold text-[var(--text-primary)]">Floor {floor.floor_number}</h3>
              <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 mt-1">
                <ClockIcon className="w-3 h-3" /> 
                {floor.last_audit_at 
                  ? `Last: ${new Date(floor.last_audit_at).toLocaleDateString()} (${floor.days_since_last}d ago)` 
                  : "Never audited"}
              </p>
            </div>
            {floor.is_stale ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-amber-700 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400">
                <AlertCircleIcon className="w-3 h-3" /> Stale
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-emerald-700 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400">
                <CheckCircle2Icon className="w-3 h-3" /> Fresh
              </span>
            )}
          </div>
          <Link 
            href={`/pms/inventory/amenity-audit/new?floor=${floor.floor_number}`}
            className="block w-full text-center bg-[var(--bg-body)] hover:bg-slate-100 dark:hover:bg-white/5 border border-[var(--border-default)] rounded-md py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors"
          >
            Start Audit
          </Link>
          {floor.is_stale && (
            <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden">
               <div className="absolute top-[8px] right-[-24px] bg-amber-500 text-white text-[8px] font-bold py-0.5 px-6 rotate-45">!</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
