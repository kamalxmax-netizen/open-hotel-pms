import { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { ChecklistItem, MaintenanceChecklistSubmission, LoanCollectionItem } from "@/lib/types";

export default function ChecklistModal({
  isOpen,
  roomNumber,
  items,
  maintenanceAssignments,
  loanCollections,
  hkTraces,
  roomNote,
  onClose,
  onSubmit,
  isSubmitting
}: {
  isOpen: boolean;
  roomNumber: string;
  items: ChecklistItem[];
  maintenanceAssignments: Array<{
    assignment_id: string;
    task_id: string;
    task_name: string;
    sync_to_housekeeper?: boolean;
    checklist_items: string[] | null;
    estimated_minutes: number;
    notes: string | null;
  }>;
  loanCollections?: LoanCollectionItem[];
  hkTraces?: Array<{
    id: string;
    text: string;
  }>;
  roomNote?: string | null;
  onClose: () => void;
  onSubmit: (
    checklist: ChecklistItem[],
    maintenanceChecklist: MaintenanceChecklistSubmission[],
    collectedLoanIds?: string[]
  ) => void;
  isSubmitting: boolean;
}) {
  const [localItems, setLocalItems] = useState<ChecklistItem[]>([]);
  const [amenityUnitChecks, setAmenityUnitChecks] = useState<boolean[][]>([]);
  const [maintenanceChecklist, setMaintenanceChecklist] = useState<MaintenanceChecklistSubmission[]>([]);
  const [loanChecks, setLoanChecks] = useState<boolean[]>([]);

  useEffect(() => {
    // When modal opens, initialize local state directly from props
    // This allows the user to tweak used amounts before submitting
    if (isOpen) {
      setLocalItems(
        items.map(item => ({
          ...item,
          quantity: Math.max(1, Number(item.quantity ?? 1)),
          used: 0,
          checked: item.checked ?? false,
          product_id: item.product_id ?? null,
        }))
      );
      setAmenityUnitChecks(
        items.map((item) => {
          const quantity = Math.max(1, Number(item.quantity ?? 1));
          const checkedCount = Math.min(Math.max(Number(item.used ?? 0), 0), quantity);
          return Array.from({ length: quantity }, (_, idx) => idx < checkedCount);
        })
      );

      setMaintenanceChecklist(
        (maintenanceAssignments ?? [])
          .filter(
            (assignment) =>
              Array.isArray(assignment.checklist_items) &&
              assignment.checklist_items.length > 0 &&
              assignment.sync_to_housekeeper !== false
          )
          .map((assignment) => ({
            assignment_id: assignment.assignment_id,
            items: (assignment.checklist_items ?? []).map((itemName) => ({
              item: itemName,
              checked: false,
            })),
          }))
      );

      setLoanChecks((loanCollections ?? []).map(() => false));
    }
  }, [isOpen, items, maintenanceAssignments, loanCollections]);

  if (!isOpen) return null;

  const toggleAmenityUnit = (itemIndex: number, unitIndex: number) => {
    setAmenityUnitChecks((prev) =>
      prev.map((itemUnits, idx) =>
        idx === itemIndex
          ? itemUnits.map((checked, unitIdx) => (unitIdx === unitIndex ? !checked : checked))
          : itemUnits
      )
    );
  };

  const toggleMaintenanceItemChecked = (assignmentId: string, itemIndex: number) => {
    setMaintenanceChecklist((prev) =>
      prev.map((assignment) => {
        if (assignment.assignment_id !== assignmentId) return assignment;
        return {
          ...assignment,
          items: assignment.items.map((item, idx) =>
            idx === itemIndex ? { ...item, checked: !item.checked } : item
          ),
        };
      })
    );
  };

  const requiredMaintenanceCount = maintenanceChecklist.reduce(
    (sum, assignment) => sum + assignment.items.length,
    0
  );
  const completedMaintenanceCount = maintenanceChecklist.reduce(
    (sum, assignment) => sum + assignment.items.filter((item) => item.checked).length,
    0
  );
  const allMaintenanceChecklistChecked =
    requiredMaintenanceCount === 0 || completedMaintenanceCount === requiredMaintenanceCount;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="w-full sm:max-w-md bg-[var(--bg-surface)] rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-body)] dark:bg-[var(--bg-surface)] sticky top-0 z-10">
          <div>
            <h3 className="font-bold text-[var(--text-primary)] text-lg">Room {roomNumber} Checklist</h3>
            <p className="text-xs text-[var(--text-muted)]">Verify items and log actual usage</p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 -mr-2 rounded-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 flex-1">
          {roomNote && (
            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 dark:bg-sky-500/10 dark:border-sky-500/20">
              <p className="text-xs font-bold text-sky-800 dark:text-sky-400">No Service Note</p>
              <p className="mt-1 text-xs text-sky-700 dark:text-sky-400/80 whitespace-pre-wrap">{roomNote}</p>
            </div>
          )}

          {localItems.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-muted)] text-sm">
              No amenity checklist required for this room type.
            </div>
          ) : (
            <div className="space-y-4">
              {localItems.map((item, index) => (
                <div key={item.item || index} className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.item}</p>
                    <span className="text-[11px] font-bold text-[var(--text-muted)]">
                      {(amenityUnitChecks[index] ?? []).filter(Boolean).length}/{Math.max(1, Number(item.quantity ?? 1))}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Required quantity: {Math.max(1, Number(item.quantity ?? 1))}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(amenityUnitChecks[index] ?? []).map((checked, unitIndex) => (
                      <button
                        key={`${item.item}-${unitIndex}`}
                        type="button"
                        onClick={() => toggleAmenityUnit(index, unitIndex)}
                        className={`h-7 min-w-7 px-1.5 rounded-md border text-[11px] font-bold transition-colors ${checked
                            ? "bg-brand-500 border-brand-500 text-white"
                            : "bg-[var(--bg-body)] border-[var(--border-input)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
                          }`}
                      >
                        {checked ? "✓" : unitIndex + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-[var(--text-muted)]">
                Tick only the units used. Stock is deducted from checked units only.
              </p>
            </div>
          )}

          {maintenanceChecklist.length > 0 && (
            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:bg-indigo-500/10 dark:border-indigo-500/20">
                <p className="text-xs font-bold text-indigo-800 dark:text-indigo-400">Special Maintenance Tasks</p>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-400/80">
                  Checklist must be completed before finishing room ({completedMaintenanceCount}/{requiredMaintenanceCount})
                </p>
              </div>

              {maintenanceChecklist.map((assignment) => {
                const assignmentMeta = maintenanceAssignments.find((m) => m.assignment_id === assignment.assignment_id);
                return (
                  <div key={assignment.assignment_id} className="rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-[var(--bg-surface)] p-3 shadow-sm">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {assignmentMeta?.task_name ?? "Maintenance Task"}
                    </p>
                    {!!assignmentMeta?.estimated_minutes && (
                      <p className="text-[11px] text-[var(--text-muted)]">Estimated: {assignmentMeta.estimated_minutes} min</p>
                    )}

                    <div className="mt-2 space-y-2">
                      {assignment.items.map((item, itemIndex) => (
                        <label
                          key={`${assignment.assignment_id}-${item.item}-${itemIndex}`}
                          className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 bg-[var(--bg-body)]"
                        >
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => toggleMaintenanceItemChecked(assignment.assignment_id, itemIndex)}
                            className="h-4 w-4 rounded border-[var(--border-input)] text-brand-600 focus:ring-brand-500"
                          />
                          <span className={`text-xs ${item.checked ? "text-[var(--text-primary)] font-semibold" : "text-[var(--text-secondary)]"}`}>
                            {item.item}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hkTraces && hkTraces.length > 0 && (
            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:bg-amber-500/10 dark:border-amber-500/20">
                <p className="text-xs font-bold text-amber-800 dark:text-amber-400">HK Trace Reminders</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400/80">Please follow these room instructions while cleaning.</p>
              </div>
              <div className="space-y-2">
                {hkTraces.map((trace) => (
                  <div key={trace.id} className="rounded-xl border border-amber-100 dark:border-amber-500/20 bg-[var(--bg-surface)] px-3 py-2 text-xs text-amber-800 dark:text-amber-400/80 shadow-sm">
                    • {trace.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {loanCollections && loanCollections.length > 0 && (() => {
            const dueItems = loanCollections.filter((l) => l.is_due !== false);
            const notDueItems = loanCollections.filter((l) => l.is_due === false);
            return (
              <div className="mt-5 space-y-3">
                {dueItems.length > 0 && (
                  <>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:bg-amber-500/10 dark:border-amber-500/20">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-400">Items to Collect (Loan Returns)</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-400/80">Please collect these items from the guest or room.</p>
                    </div>
                    <div className="space-y-2">
                      {loanCollections.map((loan, idx) => {
                        if (loan.is_due === false) return null;
                        return (
                          <label key={loan.trace_id} className="flex items-center gap-3 p-3 rounded-xl border border-amber-100 dark:border-amber-500/20 bg-[var(--bg-surface)] shadow-sm cursor-pointer hover:bg-[var(--bg-surface-hover)] transition-colors">
                            <input
                              type="checkbox"
                              checked={loanChecks[idx]}
                              onChange={() => {
                                setLoanChecks(prev => {
                                  const newChecks = [...prev];
                                  newChecks[idx] = !newChecks[idx];
                                  return newChecks;
                                });
                              }}
                              className="h-5 w-5 rounded border-amber-300 dark:border-amber-500/40 text-amber-600 dark:text-amber-500 focus:ring-amber-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                {loan.item_icon} {loan.item_name}
                                <span className="ml-1 text-[var(--text-muted)]">×{loan.quantity}</span>
                              </p>
                              {loan.due_date && <p className="text-[10px] text-[var(--text-muted)]">Due: {loan.due_date}</p>}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
                {notDueItems.length > 0 && (
                  <>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 dark:bg-sky-500/10 dark:border-sky-500/20">
                      <p className="text-xs font-bold text-sky-800 dark:text-sky-400">Loaned Items in Room</p>
                      <p className="text-[11px] text-sky-700 dark:text-sky-400/80">Not yet due for collection. Change covers/cases as needed.</p>
                    </div>
                    <div className="space-y-2">
                      {notDueItems.map((loan) => (
                        <div key={loan.trace_id} className="flex items-center gap-3 p-3 rounded-xl border border-sky-100 dark:border-sky-500/20 bg-sky-50/50 dark:bg-sky-500/5 shadow-sm">
                          <span className="text-sky-400 text-lg">📦</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-sky-700 dark:text-sky-400 truncate">
                              {loan.item_icon} {loan.item_name}
                              <span className="ml-1 text-sky-400 opacity-80">×{loan.quantity}</span>
                            </p>
                            <p className="text-[10px] text-sky-500 dark:text-sky-400/60">Not yet due — collect on {loan.due_date ?? "checkout"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky bottom-0">
          <button
            onClick={() => {
              if (loanCollections && loanCollections.length > 0) {
                // Only warn about due items not checked — not-yet-due items don't need collection
                const dueIndices = loanCollections.map((l, i) => l.is_due !== false ? i : -1).filter(i => i >= 0);
                const allDueChecked = dueIndices.every(i => loanChecks[i]);
                if (dueIndices.length > 0 && !allDueChecked) {
                  if (!confirm("Warning: Some loan items were not marked as collected. Proceed with finishing room anyway?")) {
                    return;
                  }
                }
              }

              const normalizedChecklist = localItems.map((item, index) => {
                const units = amenityUnitChecks[index] ?? [];
                const requiredQty = Math.max(1, Number(item.quantity ?? units.length ?? 1));
                const checkedCount = units.filter(Boolean).length;
                return {
                  ...item,
                  quantity: requiredQty,
                  used: checkedCount,
                  checked: checkedCount >= requiredQty,
                  product_id: item.product_id ?? null,
                };
              });

              // Only collect due items that were checked
              const collectedIds = loanCollections
                ? loanCollections.filter((l, i) => l.is_due !== false && loanChecks[i]).map(l => l.trace_id)
                : [];

              onSubmit(normalizedChecklist, maintenanceChecklist, collectedIds);
            }}
            disabled={isSubmitting || !allMaintenanceChecklistChecked}
            className="w-full h-[52px] rounded-xl font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors text-base shadow-sm disabled:opacity-50 flex justify-center items-center"
          >
            {isSubmitting ? (
              <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : !allMaintenanceChecklistChecked ? (
              "Complete maintenance checklist first"
            ) : (
              "Done & Finish Room"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
