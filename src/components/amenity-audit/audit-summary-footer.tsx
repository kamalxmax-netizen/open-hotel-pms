import { Button } from "@/components/ui/button";

interface AuditSummaryFooterProps {
  totalOverclick: number;
  totalUnderclick: number;
  totalRefill: number;
  isValid: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  sessionNote: string;
  setSessionNote: (val: string) => void;
  submitError?: string | null;
}

export function AuditSummaryFooter({
  totalOverclick, totalUnderclick, totalRefill, 
  isValid, isSubmitting, onSubmit,
  sessionNote, setSessionNote, submitError
}: AuditSummaryFooterProps) {
  return (
    <div className="card p-6 mt-6 flex flex-col md:flex-row gap-6 justify-between items-start dark:bg-[var(--bg-surface)]">
      <div className="flex-1 w-full space-y-4">
         <h3 className="text-base font-bold text-[var(--text-primary)]">Audit Summary</h3>
         <div className="flex gap-6 text-base">
            <div>
               <p className="text-[var(--text-secondary)]">Total Refill units</p>
               <p className="text-3xl font-extrabold text-sky-600 dark:text-sky-400">{totalRefill}</p>
            </div>
            <div>
               <p className="text-[var(--text-secondary)]">Total Overclicks</p>
               <p className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">{totalOverclick}</p>
            </div>
            <div>
               <p className="text-[var(--text-secondary)]">Total Underclicks</p>
               <p className="text-3xl font-extrabold hover:text-amber-600 focus:text-amber-600 text-amber-600 dark:text-amber-400">{Math.abs(totalUnderclick)}</p>
            </div>
         </div>
      </div>
      
      <div className="w-full md:w-96">
         <label className="text-sm font-semibold text-[var(--text-secondary)]">Session Note (Optional)</label>
         <textarea 
            className="w-full mt-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-base focus:ring-2 focus:ring-[var(--brand-ring)] outline-none"
            rows={2}
            placeholder="e.g., General replenishment for Floor"
            value={sessionNote}
            onChange={e => setSessionNote(e.target.value)}
         />
         
         <div className="mt-4">
            <Button 
               onClick={onSubmit} 
               disabled={!isValid || isSubmitting} 
               className="w-full h-14 text-lg font-bold bg-brand-600 hover:bg-brand-700 text-white"
            >
               {isSubmitting ? "Submitting..." : "ยืนยัน Submit Audit"}
            </Button>
            {!isValid && (
               <p className="text-center text-xs text-rose-500 mt-2">
                 Please resolve all notes or invalid Refill quantities to submit.
               </p>
            )}
            {submitError && (
               <p className="text-center text-xs text-rose-500 mt-2 font-semibold">
                 {submitError}
               </p>
            )}
         </div>
      </div>
    </div>
  );
}
