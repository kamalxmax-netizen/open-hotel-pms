"use client";

import { useEffect, useMemo, useState } from "react";
import { MaintenanceTask } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PlusIcon, TrashIcon, AlertCircleIcon } from "lucide-react";

// For Maintenance Tasks, room types are specific codes:
const ROOM_TYPES = ["TS", "DS", "DQ", "DT", "JS", "TB", "FR"];

type TimeEstimateInput = {
    room_type_code: string;
    estimated_minutes: number;
};

export interface MaintenanceTaskFormPayload extends Partial<MaintenanceTask> {
    times?: TimeEstimateInput[];
}

interface TaskFormModalProps {
    task?: MaintenanceTask | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: MaintenanceTaskFormPayload) => Promise<void>;
}

export function MaintenanceTaskFormModal({ task, isOpen, onOpenChange, onSave }: TaskFormModalProps) {
    const isEditing = !!task;

    const buildInitialTimeMap = (sourceTask?: MaintenanceTask | null) => {
        const map: Record<string, string> = {};
        for (const code of ROOM_TYPES) map[code] = "";
        for (const time of sourceTask?.maintenance_task_times ?? []) {
            map[time.room_type_code] = String(time.estimated_minutes);
        }
        return map;
    };

    const [name, setName] = useState(task?.name || "");
    const [description, setDescription] = useState(task?.description || "");
    const [thresholdCount, setThresholdCount] = useState<number>(task?.threshold_count || 100);
    const [warningCount, setWarningCount] = useState<number>(task?.warning_count || 80);
    const [applicableTypes, setApplicableTypes] = useState<string[]>(
        Array.isArray(task?.applicable_room_types) && task.applicable_room_types.length > 0
            ? task.applicable_room_types
            : [...ROOM_TYPES]
    );
    const [syncToHK, setSyncToHK] = useState(task?.sync_to_housekeeper || false);
    const [checklistItems, setChecklistItems] = useState<string[]>(task?.checklist_items || []);
    const [timeByRoomType, setTimeByRoomType] = useState<Record<string, string>>(() => buildInitialTimeMap(task));

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showValidation, setShowValidation] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(task?.name || "");
        setDescription(task?.description || "");
        setThresholdCount(task?.threshold_count || 100);
        setWarningCount(task?.warning_count || 80);
        setApplicableTypes(
            Array.isArray(task?.applicable_room_types) && task.applicable_room_types.length > 0
                ? task.applicable_room_types
                : [...ROOM_TYPES]
        );
        setSyncToHK(task?.sync_to_housekeeper || false);
        setChecklistItems(task?.checklist_items || []);
        setTimeByRoomType(buildInitialTimeMap(task));
        setError(null);
        setShowValidation(false);
        setIsSubmitting(false);
    }, [task, isOpen]);

    const normalizedApplicableTypes = useMemo(
        () =>
            applicableTypes
                .map((code) => String(code).toUpperCase())
                .filter((code) => ROOM_TYPES.includes(code)),
        [applicableTypes]
    );

    // Note: Times aren't handled inline here since they require a separate PUT API, 
    // but we can pass basic details for phase 9. It is handled on a separate API endpoint.

    const toggleRoomType = (code: string) => {
        setApplicableTypes((prev) => {
            if (prev.includes(code)) {
                const next = prev.filter((c) => c !== code);
                // Keep at least one selected to avoid accidental "none"
                return next.length > 0 ? next : prev;
            }
            return [...prev, code];
        });
    };

    const handleSave = async () => {
        setShowValidation(true);
        setError(null);
        if (!name.trim()) return setError("Task name is required");
        if (thresholdCount <= 0) return setError("Overdue threshold must be greater than 0");
        if (warningCount && warningCount >= thresholdCount) return setError("Warning threshold must be less than Overdue threshold");

        try {
            setIsSubmitting(true);
            const times = normalizedApplicableTypes.map((roomTypeCode) => ({
                room_type_code: roomTypeCode,
                estimated_minutes: Number(timeByRoomType[roomTypeCode] || 0),
            })).filter((row) => Number.isFinite(row.estimated_minutes) && row.estimated_minutes > 0);

            await onSave({
                name: name.trim(),
                description: description.trim() || null,
                threshold_count: thresholdCount,
                warning_count: warningCount || null,
                applicable_room_types:
                    normalizedApplicableTypes.length === ROOM_TYPES.length
                        ? null
                        : normalizedApplicableTypes, // null means all
                sync_to_housekeeper: syncToHK,
                checklist_items: syncToHK && checklistItems.length > 0 ? checklistItems.filter(i => i.trim()) : null,
                times: syncToHK ? times : [],
            });
            setShowValidation(false);
            onOpenChange(false);
        } catch (err: any) {
            setError(err.message || "Error saving data");
        } finally {
            setIsSubmitting(false);
        }
    };

    const updateChecklistItem = (index: number, val: string) => {
        const arr = [...checklistItems];
        arr[index] = val;
        setChecklistItems(arr);
    };

    const removeChecklistItem = (index: number) => {
        setChecklistItems(checklistItems.filter((_, i) => i !== index));
    };

    const updateTimeEstimate = (roomTypeCode: string, value: string) => {
        setTimeByRoomType((prev) => ({
            ...prev,
            [roomTypeCode]: value,
        }));
    };
    const taskNameInvalid = showValidation && !name.trim();
    const thresholdInvalid = showValidation && thresholdCount <= 0;
    const warningInvalid = showValidation && Boolean(warningCount && warningCount >= thresholdCount);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEditing ? "Edit Maintenance Task" : "Create New Maintenance Task"}</DialogTitle>
                </DialogHeader>

                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-md flex items-center gap-2 text-sm border border-red-200">
                        <AlertCircleIcon className="w-4 h-4" /> {error}
                    </div>
                )}

                <div className="space-y-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b pb-6">
                        <div className="space-y-2 md:col-span-2">
                            <Label>Task Name <span className="text-red-500">*</span></Label>
                            <Input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g., AC Cleaning, Pipe Flushing"
                                required
                                aria-invalid={taskNameInvalid}
                            />
                            {taskNameInvalid && <p className="text-xs text-rose-600">Task name is required.</p>}
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <Label>Description <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                            <Textarea value={description} onChange={e => setDescription(e.target.value)} />
                        </div>

                        <div className="space-y-2">
                            <Label>Overdue Threshold (Stays) <span className="text-red-500">*</span></Label>
                            <Input
                                type="number"
                                min={1}
                                value={thresholdCount}
                                onChange={e => setThresholdCount(Number(e.target.value))}
                                required
                                aria-invalid={thresholdInvalid}
                            />
                            {thresholdInvalid && <p className="text-xs text-rose-600">Overdue threshold must be greater than 0.</p>}
                            <p className="text-xs text-muted-foreground">Maximum number of stays before overdue</p>
                        </div>

                        <div className="space-y-2">
                            <Label>Warning Threshold (Stays)</Label>
                            <Input
                                type="number"
                                min={1}
                                value={warningCount}
                                onChange={e => setWarningCount(Number(e.target.value))}
                                aria-invalid={warningInvalid}
                            />
                            {warningInvalid && (
                                <p className="text-xs text-rose-600">Warning threshold must be less than overdue threshold.</p>
                            )}
                            <p className="text-xs text-muted-foreground">Alerts before Overdue (must be less than Overdue threshold)</p>
                        </div>

                        <div className="space-y-3 md:col-span-2">
                            <Label>Applicable Room Types</Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {ROOM_TYPES.map(code => (
                                    <BadgeButton
                                        key={code}
                                        active={normalizedApplicableTypes.includes(code)}
                                        onClick={() => toggleRoomType(code)}
                                    >
                                        {code}
                                    </BadgeButton>
                                ))}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 min-h-[44px] text-xs px-2"
                                onClick={() => setApplicableTypes([...ROOM_TYPES])}
                                disabled={normalizedApplicableTypes.length === ROOM_TYPES.length}
                            >
                                Select all rooms (Default)
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex flex-row items-center justify-between border rounded-lg p-4 bg-[var(--bg-body)]">
                            <div className="space-y-0.5">
                                <Label className="text-base">Housekeeping Sync</Label>
                                <p className="text-xs text-muted-foreground">
                                    Enable this to require housekeeper checklist during cleaning
                                </p>
                            </div>
                            <Switch checked={syncToHK} onCheckedChange={setSyncToHK} />
                        </div>

                        {syncToHK && (
                            <div className="space-y-3 bg-[var(--bg-surface)] p-4 border rounded-lg">
                                <Label className="flex justify-between items-center">
                                    Sub-checklist Items
                                    <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => setChecklistItems([...checklistItems, ""])}>
                                        <PlusIcon className="w-3.5 h-3.5 mr-1" /> Add
                                    </Button>
                                </Label>

                                {checklistItems.length === 0 && (
                                    <p className="text-center text-sm text-muted-foreground py-2 border border-dashed rounded bg-[var(--bg-body)]">Not set</p>
                                )}

                                <div className="space-y-2">
                                    {checklistItems.map((item, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <span className="text-xs text-[var(--text-muted)] font-mono">{idx + 1}.</span>
                                            <Input value={item} onChange={e => updateChecklistItem(idx, e.target.value)} placeholder="Step description" className="h-8" />
                                            <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-red-500" onClick={() => removeChecklistItem(idx)}>
                                                <TrashIcon className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-3 border-t space-y-3">
                                    <Label>Estimated time by room type (minutes)</Label>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {normalizedApplicableTypes.map((code) => (
                                            <div key={code} className="flex items-center gap-2 rounded border border-[var(--border-default)] px-2 py-1.5">
                                                <span className="w-8 text-xs font-semibold text-[var(--text-secondary)]">{code}</span>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={timeByRoomType[code]}
                                                    onChange={(e) => updateTimeEstimate(code, e.target.value)}
                                                    placeholder="30"
                                                    className="h-8"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">Leave empty to use default 30 minutes</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting} className="min-h-[44px]">Cancel</Button>
                    <Button onClick={handleSave} disabled={isSubmitting} className="bg-primary min-h-[44px]">
                        {isSubmitting ? "Saving..." : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Simple internal component
function BadgeButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold border rounded-full transition-colors ${
                active
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] border-[var(--border-input)]"
            }`}
        >
            <span className={`text-[11px] leading-none ${active ? "opacity-100" : "opacity-30"}`}>●</span>
            {children}
        </button>
    );
}
