import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Package, Wrench, X } from "lucide-react";
import type {
  ChecklistItem,
  LoanCollectionItem,
  MaintenanceChecklistSubmission,
  ReturnableStockItem,
} from "@/lib/types";
import { getAmenityLabel } from "@/components/maid/maid-ui";
import { compareReturnableAmenityOrder } from "@/lib/maid-amenities";

export default function ChecklistModal({
  isOpen,
  roomNumber,
  items,
  maintenanceAssignments,
  loanCollections,
  hkTraces,
  returnableStock,
  canReturnStock,
  roomNote,
  onClose,
  onSubmit,
  isSubmitting,
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
  returnableStock?: ReturnableStockItem[];
  canReturnStock?: boolean;
  roomNote?: string | null;
  onClose: () => void;
  onSubmit: (
    checklist: ChecklistItem[],
    maintenanceChecklist: MaintenanceChecklistSubmission[],
    collectedLoanIds?: string[],
    returnedStock?: Array<{ product_id: string; quantity: number }>
  ) => void;
  isSubmitting: boolean;
}) {
  const [localItems, setLocalItems] = useState<ChecklistItem[]>([]);
  const [amenityUnitChecks, setAmenityUnitChecks] = useState<boolean[][]>([]);
  const [maintenanceChecklist, setMaintenanceChecklist] = useState<MaintenanceChecklistSubmission[]>([]);
  const [isReturnSectionOpen, setIsReturnSectionOpen] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isOpen) return;

    setLocalItems(
      items.map((item) => ({
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
    setIsReturnSectionOpen(false);
    setReturnQuantities(
      Object.fromEntries(
        (returnableStock ?? []).map((item) => [item.product_id, 0])
      )
    );
  }, [isOpen, items, maintenanceAssignments, returnableStock]);

  const toggleAmenityUnit = (itemIndex: number, unitIndex: number) => {
    setAmenityUnitChecks((prev) =>
      prev.map((itemUnits, idx) =>
        idx === itemIndex
          ? itemUnits.map((checked, currentUnit) => (currentUnit === unitIndex ? !checked : checked))
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

  const dueLoanItems = (loanCollections ?? []).filter((item) => item.is_due !== false);
  const activeLoanItems = (loanCollections ?? []).filter((item) => item.is_due === false);
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

  const selectedAmenityCount = useMemo(
    () => amenityUnitChecks.flat().filter(Boolean).length,
    [amenityUnitChecks]
  );
  const dueLoanUnitCount = useMemo(
    () => dueLoanItems.reduce((sum, loan) => sum + Math.max(1, Number(loan.quantity ?? 1)), 0),
    [dueLoanItems]
  );
  const selectedReturnCount = useMemo(
    () => Object.values(returnQuantities).reduce((sum, qty) => sum + Math.max(Number(qty ?? 0), 0), 0),
    [returnQuantities]
  );
  const visibleReturnableStock = useMemo(
    () =>
      (returnableStock ?? [])
        .filter((item) => Math.max(Number(item.available_to_return ?? 0), 0) > 0)
        .sort(compareReturnableAmenityOrder),
    [returnableStock]
  );

  const adjustReturnQuantity = (productId: string, delta: number, maxQty: number) => {
    setReturnQuantities((prev) => {
      const current = Math.max(Number(prev[productId] ?? 0), 0);
      const next = Math.min(Math.max(current + delta, 0), maxQty);
      return { ...prev, [productId]: next };
    });
  };

  const canRenderBody =
    roomNumber ||
    localItems.length > 0 ||
    maintenanceChecklist.length > 0 ||
    dueLoanItems.length > 0 ||
    activeLoanItems.length > 0 ||
    visibleReturnableStock.length > 0 ||
    Boolean(roomNote);

  return (
    <div
      className={`fixed inset-0 z-[120] transition-all duration-300 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      <div
        className={`absolute inset-x-0 bottom-0 top-0 flex justify-center transition-transform duration-300 ease-out ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div
          className="relative flex h-full w-full max-w-screen-md flex-col overflow-hidden rounded-t-[32px] border border-indigo-200/70 bg-[linear-gradient(180deg,#d7dfee_0%,#e4e9f4_38%,#edf1f7_100%)] shadow-[0_-18px_40px_rgba(15,23,42,0.25)] dark:border-white/5 dark:bg-none dark:bg-slate-950"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-0 dark:hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_26%),radial-gradient(circle_at_50%_100%,rgba(14,165,233,0.16),transparent_32%),linear-gradient(180deg,#d9e0ea_0%,#e6ecf3_32%,#eef2f6_100%)]" />
            <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:26px_26px]" />
            <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent)]" />
          </div>

          <div className="flex justify-center pt-3">
            <div className="h-1.5 w-14 rounded-full bg-slate-300 dark:bg-white/15" />
          </div>

          <div className="sticky top-0 z-10 border-b border-indigo-200/60 bg-[linear-gradient(180deg,rgba(227,233,245,0.96),rgba(230,236,247,0.82))] px-4 pb-4 pt-3 backdrop-blur-xl dark:border-white/5 dark:bg-none dark:bg-slate-950/95">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="mt-1 rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <ArrowLeft size={22} />
                </button>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
                    เช็กลิสต์ห้อง
                  </p>
                  <h2 className="mt-1 text-3xl font-black text-slate-900 dark:text-white">{roomNumber}</h2>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X size={22} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-indigo-500 px-3 py-3 text-white shadow-lg shadow-indigo-500/20">
                <p className="text-2xl font-black leading-none">{selectedAmenityCount}</p>
                <p className="mt-1 text-xs font-black">ของเติม</p>
              </div>
              <div className="rounded-2xl bg-amber-500 px-3 py-3 text-slate-950 shadow-lg shadow-amber-500/20">
                <p className="text-2xl font-black leading-none">{dueLoanUnitCount}</p>
                <p className="mt-1 text-xs font-black">เก็บคืน</p>
              </div>
              <div className="rounded-2xl bg-sky-500 px-3 py-3 text-white shadow-lg shadow-sky-500/20">
                <p className="text-2xl font-black leading-none">
                  {completedMaintenanceCount}/{requiredMaintenanceCount}
                </p>
                <p className="mt-1 text-xs font-black">งานซ่อม</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-36 pt-4">
            {!canRenderBody ? (
              <div className="rounded-[28px] border border-indigo-200/70 bg-[linear-gradient(180deg,rgba(234,239,248,0.92),rgba(242,245,250,0.84))] p-6 text-center shadow-sm dark:border-white/5 dark:bg-none dark:bg-slate-900">
                <p className="text-base font-black text-slate-800 dark:text-white">ไม่มีรายการสำหรับห้องนี้</p>
              </div>
            ) : (
              <div className="space-y-8">
                {roomNote && (
                  <section className="rounded-[28px] border border-sky-200 bg-[linear-gradient(180deg,rgba(224,242,254,0.96),rgba(240,249,255,0.88))] p-5 shadow-sm dark:border-sky-500/20 dark:bg-none dark:bg-sky-500/10">
                    <p className="text-base font-black text-sky-700 dark:text-sky-300">หมายเหตุงดทำ</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-relaxed text-sky-700/85 dark:text-sky-300/80">
                      {roomNote}
                    </p>
                  </section>
                )}

                {localItems.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-end justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-xl font-black text-slate-500 dark:text-slate-400">
                        <Package size={20} className="text-indigo-500" />
                        ของเติมในห้อง
                      </h3>
                      <p className="text-xs font-bold text-slate-400 dark:text-slate-500">ติ๊กตามจำนวนที่เติม</p>
                    </div>

                    <div className="space-y-3">
                      {localItems.map((item, index) => {
                        const quantity = Math.max(1, Number(item.quantity ?? 1));
                        const checkedCount = (amenityUnitChecks[index] ?? []).filter(Boolean).length;
                        return (
                          <div
                            key={`${item.product_id ?? item.item}-${index}`}
                            className="rounded-[28px] border border-indigo-200/80 bg-[linear-gradient(180deg,rgba(232,238,249,0.96),rgba(242,246,252,0.9))] p-5 shadow-sm dark:border-white/5 dark:bg-none dark:bg-slate-900"
                          >
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <p className="text-xl font-black text-slate-900 dark:text-white">
                                {getAmenityLabel(item)}
                              </p>
                              <p className="text-sm font-black text-slate-400 dark:text-slate-500">
                                เติม {checkedCount} / {quantity}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              {(amenityUnitChecks[index] ?? []).map((checked, unitIndex) => (
                                <button
                                  key={`${item.product_id ?? item.item}-${unitIndex}`}
                                  type="button"
                                  onClick={() => toggleAmenityUnit(index, unitIndex)}
                                  className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 text-xl font-black transition-all active:scale-90 ${
                                    checked
                                      ? "border-indigo-500 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                                      : "border-indigo-200 bg-indigo-50/70 text-slate-500 hover:border-indigo-300 hover:bg-indigo-100/70 dark:border-white/10 dark:bg-white/5 dark:text-slate-500"
                                  }`}
                                >
                                  {checked ? <Check size={28} strokeWidth={4} /> : unitIndex + 1}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {dueLoanItems.length > 0 && (
                  <section className="space-y-4">
                    <h3 className="text-xl font-black text-amber-500">ของที่ต้องเก็บคืน</h3>
                    <div className="space-y-3">
                      {dueLoanItems.map((loan) => (
                        <div
                          key={loan.trace_id}
                          className="flex items-center justify-between gap-4 rounded-[28px] border border-amber-200 bg-[linear-gradient(180deg,rgba(255,247,237,0.96),rgba(254,243,199,0.75))] p-4 shadow-sm dark:border-amber-500/20 dark:bg-none dark:bg-amber-500/10"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="text-3xl">{loan.item_icon}</span>
                            <div className="min-w-0">
                              <p className="truncate text-lg font-black text-amber-700 dark:text-amber-300">
                                {loan.item_name}
                              </p>
                              {loan.due_date && (
                                <p className="text-xs font-bold text-amber-600/80 dark:text-amber-300/70">
                                  ครบกำหนด {loan.due_date}
                                </p>
                              )}
                            </div>
                          </div>
                          <p className="shrink-0 text-base font-black text-amber-700 dark:text-amber-300">
                            จำนวน {loan.quantity}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm font-bold text-amber-600/80 dark:text-amber-300/70">
                      จบงานแล้วระบบจะบันทึกการเก็บคืนให้อัตโนมัติ
                    </p>
                  </section>
                )}

                {activeLoanItems.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-lg font-black text-slate-500 dark:text-slate-400">ของยืมที่ยังไม่ครบกำหนด</h3>
                    <div className="space-y-2">
                      {activeLoanItems.map((loan) => (
                        <div
                          key={loan.trace_id}
                          className="rounded-[24px] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(235,245,251,0.94),rgba(241,247,252,0.88))] px-4 py-3 shadow-sm dark:border-white/5 dark:bg-none dark:bg-slate-900"
                        >
                          <p className="text-base font-black text-slate-900 dark:text-white">
                            {loan.item_icon} {loan.item_name}
                          </p>
                          <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                            จำนวน {loan.quantity}
                            {loan.due_date ? ` · เก็บคืน ${loan.due_date}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {maintenanceChecklist.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-xl font-black text-sky-500">
                        <Wrench size={20} />
                        งานซ่อมบำรุง
                      </h3>
                      <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
                        {completedMaintenanceCount}/{requiredMaintenanceCount}
                      </p>
                    </div>

                    <div className="space-y-4">
                      {maintenanceChecklist.map((assignment) => {
                        const assignmentMeta = maintenanceAssignments.find(
                          (entry) => entry.assignment_id === assignment.assignment_id
                        );
                        return (
                          <div key={assignment.assignment_id} className="space-y-3">
                            <div>
                              <p className="text-lg font-black text-slate-900 dark:text-white">
                                {assignmentMeta?.task_name ?? "งานเพิ่ม"}
                              </p>
                              {!!assignmentMeta?.estimated_minutes && (
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
                                  ใช้เวลา {assignmentMeta.estimated_minutes} นาที
                                </p>
                              )}
                            </div>

                            <div className="space-y-3">
                              {assignment.items.map((item, itemIndex) => (
                                <button
                                  key={`${assignment.assignment_id}-${item.item}-${itemIndex}`}
                                  type="button"
                                  onClick={() => toggleMaintenanceItemChecked(assignment.assignment_id, itemIndex)}
                                  className={`flex w-full items-center justify-between gap-4 rounded-[24px] border-2 px-5 py-5 text-left transition-all ${
                                    item.checked
                                      ? "border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/15 dark:text-sky-300"
                                      : "border-sky-200/70 bg-[linear-gradient(180deg,rgba(237,247,252,0.94),rgba(244,249,253,0.88))] text-slate-700 dark:border-white/5 dark:bg-none dark:bg-slate-900 dark:text-slate-300"
                                  }`}
                                >
                                  <span className="text-lg font-black">{item.item}</span>
                                  <span
                                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                                      item.checked
                                        ? "border-sky-500 bg-sky-500 text-white"
                                        : "border-slate-300 dark:border-white/10"
                                    }`}
                                  >
                                    {item.checked && <Check size={20} strokeWidth={4} />}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {visibleReturnableStock.length > 0 && (
                  <section className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setIsReturnSectionOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-[28px] border border-emerald-200 bg-[linear-gradient(180deg,rgba(231,248,239,0.96),rgba(242,251,246,0.9))] px-5 py-4 text-left shadow-sm transition-all dark:border-emerald-500/20 dark:bg-none dark:bg-emerald-500/10"
                    >
                      <div>
                        <p className="text-xl font-black text-emerald-700 dark:text-emerald-300">คืนของเข้าชั้น</p>
                        <p className="mt-1 text-sm font-bold text-emerald-700/75 dark:text-emerald-300/70">
                          {selectedReturnCount > 0
                            ? `เลือกคืนแล้ว ${selectedReturnCount} ชิ้น`
                            : "กดเพื่อเลือกของที่จะคืน"}
                        </p>
                      </div>
                      <span className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                        {isReturnSectionOpen ? "ปิด" : "เปิด"}
                      </span>
                    </button>

                    {isReturnSectionOpen && (
                      <div className="space-y-3">
                        {visibleReturnableStock.map((item) => {
                          const selectedQty = Math.max(Number(returnQuantities[item.product_id] ?? 0), 0);
                          return (
                            <div
                              key={item.product_id}
                              className="rounded-[28px] border border-emerald-200 bg-[linear-gradient(180deg,rgba(235,249,241,0.96),rgba(244,252,247,0.9))] p-5 shadow-sm dark:border-white/5 dark:bg-none dark:bg-slate-900"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xl font-black text-slate-900 dark:text-white">{item.item}</p>
                                  <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                                    ค้างในห้อง {item.available_to_return} · เติมสะสม {item.delivered_total} · คืนแล้ว {item.returned_total}
                                  </p>
                                </div>
                                <p className="text-lg font-black text-emerald-700 dark:text-emerald-300">
                                  คืน {selectedQty}
                                </p>
                              </div>

                              <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => adjustReturnQuantity(item.product_id, -1, item.available_to_return)}
                                  className="flex h-12 min-w-[64px] items-center justify-center rounded-2xl border-2 border-emerald-200 bg-white/80 px-4 text-xl font-black text-emerald-700 transition-all active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-emerald-300"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => adjustReturnQuantity(item.product_id, 1, item.available_to_return)}
                                  className="flex h-12 min-w-[64px] items-center justify-center rounded-2xl border-2 border-emerald-500 bg-emerald-600 px-4 text-xl font-black text-white transition-all active:scale-95"
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  onClick={() => adjustReturnQuantity(item.product_id, 5, item.available_to_return)}
                                  className="flex h-12 min-w-[82px] items-center justify-center rounded-2xl border-2 border-emerald-500 bg-emerald-100 px-4 text-lg font-black text-emerald-700 transition-all active:scale-95 dark:bg-emerald-500/15 dark:text-emerald-300"
                                >
                                  +5
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                {hkTraces && hkTraces.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-lg font-black text-slate-500 dark:text-slate-400">เตือนก่อนจบงาน</h3>
                    <div className="space-y-2">
                      {hkTraces.map((trace) => (
                        <div
                          key={trace.id}
                          className="rounded-[24px] border border-indigo-100/70 bg-[linear-gradient(180deg,rgba(237,241,249,0.94),rgba(243,246,252,0.88))] px-4 py-3 text-sm font-bold leading-relaxed text-slate-700 shadow-sm dark:border-white/5 dark:bg-none dark:bg-slate-900 dark:text-slate-300"
                        >
                          {trace.text}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 border-t border-indigo-200/60 bg-[linear-gradient(180deg,rgba(228,234,246,0.9),rgba(221,228,242,0.84))] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl dark:border-white/10 dark:bg-none dark:bg-slate-950/90">
            <div className="mx-auto flex max-w-screen-md flex-col gap-3">
              <button
                type="button"
                onClick={() => {
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

                  const collectedIds = dueLoanItems.map((loan) => loan.trace_id);
                  const returnedStock = visibleReturnableStock
                    .map((item) => ({
                      product_id: item.product_id,
                      quantity: Math.max(Number(returnQuantities[item.product_id] ?? 0), 0),
                    }))
                    .filter((item) => item.quantity > 0);
                  onSubmit(normalizedChecklist, maintenanceChecklist, collectedIds, returnedStock);
                }}
                disabled={isSubmitting || !allMaintenanceChecklistChecked}
                className={`flex h-16 items-center justify-center gap-2 rounded-[20px] border-transparent text-xl font-black text-white shadow-xl transition-all ${
                  isSubmitting || !allMaintenanceChecklistChecked
                    ? "cursor-not-allowed bg-slate-300 shadow-none dark:bg-slate-800 dark:text-slate-500"
                    : "bg-emerald-600 shadow-[0_10px_24px_rgba(5,150,105,0.25)] hover:bg-emerald-700"
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={22} className="animate-spin" />
                    กำลังบันทึก
                  </>
                ) : allMaintenanceChecklistChecked ? (
                  <>
                    <Check size={24} strokeWidth={3} />
                    ยืนยันเสร็จงาน
                  </>
                ) : (
                  <>
                    <X size={22} />
                    ทำงานซ่อมให้ครบก่อน
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
