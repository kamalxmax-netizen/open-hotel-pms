"use client";

import { useState } from "react";
import { ExtraTaskTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PlusIcon, ChevronDownIcon, ChevronUpIcon, SparklesIcon } from "lucide-react";

interface TemplatePickerProps {
    templates: ExtraTaskTemplate[];
    maidNames: string[];
    onAssign: (data: {
        template_id?: string;
        task_name: string;
        duration_min: number;
        assigned_maid: string;
    }) => Promise<void>;
    onCreateTemplate: (data: {
        name: string;
        duration_min: number;
        category: string;
    }) => Promise<void>;
    disabled?: boolean;
}

export function TemplatePicker({ templates, maidNames, onAssign, onCreateTemplate, disabled }: TemplatePickerProps) {
    const POOL_MAID = "POOL";
    const [isExpanded, setIsExpanded] = useState(false);
    const [isCustom, setIsCustom] = useState(false);
    const [showCreateTemplate, setShowCreateTemplate] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
    const [taskName, setTaskName] = useState("");
    const [durationMin, setDurationMin] = useState<number>(30);
    const [assignedMaid, setAssignedMaid] = useState<string>(POOL_MAID);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState("");
    const [newTemplateDuration, setNewTemplateDuration] = useState<number>(30);
    const [newTemplateCategory, setNewTemplateCategory] = useState("General");
    const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

    const handleTemplateChange = (value: string) => {
        setSelectedTemplateId(value);
        const template = templates.find((t) => t.id === value);
        if (template) {
            setTaskName(template.name);
            setDurationMin(template.duration_min);
        }
    };

    const handleSubmit = async () => {
        if (!taskName || !assignedMaid || durationMin <= 0) return;
        try {
            setIsSubmitting(true);
            await onAssign({
                template_id: isCustom ? undefined : selectedTemplateId,
                task_name: taskName,
                duration_min: durationMin,
                assigned_maid: assignedMaid,
            });
            setSelectedTemplateId("");
            setTaskName("");
            setDurationMin(30);
            setAssignedMaid(POOL_MAID);
            setIsCustom(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateTemplate = async () => {
        if (!newTemplateName.trim() || newTemplateDuration <= 0 || !newTemplateCategory.trim()) return;
        try {
            setIsCreatingTemplate(true);
            await onCreateTemplate({
                name: newTemplateName.trim(),
                duration_min: newTemplateDuration,
                category: newTemplateCategory.trim(),
            });
            setNewTemplateName("");
            setNewTemplateDuration(30);
            setNewTemplateCategory("General");
            setShowCreateTemplate(false);
        } finally {
            setIsCreatingTemplate(false);
        }
    };

    const isValid = taskName.trim().length > 0 && assignedMaid.trim().length > 0 && durationMin > 0;
    const isTemplateValid = newTemplateName.trim().length > 0 && newTemplateDuration > 0 && newTemplateCategory.trim().length > 0;

    // Collapsed state: just a button
    if (!isExpanded) {
        return (
            <button
                onClick={() => setIsExpanded(true)}
                disabled={disabled}
                className="w-full border-2 border-dashed border-[var(--border-input)] rounded-xl p-4 text-center hover:border-sky-400 hover:bg-sky-50/50 transition-colors group disabled:opacity-50"
            >
                <div className="flex items-center justify-center gap-2 text-[var(--text-muted)] group-hover:text-sky-600">
                    <PlusIcon className="w-5 h-5" />
                    <span className="font-semibold text-sm">Create Extra Task</span>
                </div>
            </button>
        );
    }

    return (
        <div className="border rounded-xl bg-[var(--bg-surface)] shadow-sm overflow-hidden">
            {/* Collapsible Header */}
            <button
                onClick={() => setIsExpanded(false)}
                className="w-full flex items-center justify-between px-5 py-3 bg-[var(--bg-body)] border-b hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <SparklesIcon className="w-4 h-4 text-sky-600" />
                    <span className="font-semibold text-sm text-[var(--text-primary)]">Create Extra Task</span>
                </div>
                <ChevronUpIcon className="w-4 h-4 text-[var(--text-muted)]" />
            </button>

            <div className="p-5 space-y-4">
                {/* Mode toggle */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setIsCustom(false); setShowCreateTemplate(false); }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${!isCustom && !showCreateTemplate ? "bg-sky-100 text-sky-700" : "bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"}`}
                        disabled={disabled || isSubmitting}
                    >
                        From Template
                    </button>
                    <button
                        onClick={() => { setIsCustom(true); setShowCreateTemplate(false); }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${isCustom && !showCreateTemplate ? "bg-sky-100 text-sky-700" : "bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"}`}
                        disabled={disabled || isSubmitting}
                    >
                        Custom Task
                    </button>
                    <div className="flex-1" />
                    <button
                        onClick={() => setShowCreateTemplate((prev) => !prev)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${showCreateTemplate ? "bg-amber-100 text-amber-700" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"}`}
                        disabled={disabled || isSubmitting || isCreatingTemplate}
                    >
                        {showCreateTemplate ? "Close" : "+ New Template"}
                    </button>
                </div>

                {/* Create Template Form */}
                {showCreateTemplate && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">New Template</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Name</Label>
                                <Input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="e.g. VIP welcome setup" disabled={disabled || isCreatingTemplate} className="h-9" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Duration (min)</Label>
                                <Input type="number" min={1} value={newTemplateDuration} onChange={(e) => setNewTemplateDuration(Number(e.target.value))} disabled={disabled || isCreatingTemplate} className="h-9" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Category</Label>
                                <Input value={newTemplateCategory} onChange={(e) => setNewTemplateCategory(e.target.value)} placeholder="General" disabled={disabled || isCreatingTemplate} className="h-9" />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button variant="outline" size="sm" onClick={handleCreateTemplate} disabled={!isTemplateValid || disabled || isCreatingTemplate} className="h-8">
                                {isCreatingTemplate ? "Saving..." : "Save Template"}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Assignment Form */}
                {!showCreateTemplate && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                        {!isCustom ? (
                            <div className="space-y-1 md:col-span-2">
                                <Label className="text-xs">Task Template</Label>
                                <Select value={selectedTemplateId} onValueChange={handleTemplateChange} disabled={disabled || isSubmitting}>
                                    <SelectTrigger className="h-9">
                                        <SelectValue placeholder="Select template..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.filter(t => t.is_active).map((temp) => (
                                            <SelectItem key={temp.id} value={temp.id}>
                                                {temp.name} ({temp.duration_min}m)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-1">
                                    <Label className="text-xs">Task Name</Label>
                                    <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="e.g. Pool cleaning" disabled={disabled || isSubmitting} className="h-9" />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Duration (min)</Label>
                                    <Input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} disabled={disabled || isSubmitting} className="h-9" />
                                </div>
                            </>
                        )}

                        <div className="space-y-1">
                            <Label className="text-xs">Assign to</Label>
                            <Select value={assignedMaid} onValueChange={setAssignedMaid} disabled={disabled || isSubmitting}>
                                <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select maid..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={POOL_MAID}>POOL (assign later)</SelectItem>
                                    {(maidNames.length > 0 ? maidNames : ["Jan", "Tan", "Others"]).map((name) => (
                                        <SelectItem key={name} value={name}>{name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <Button
                            onClick={handleSubmit}
                            disabled={!isValid || disabled || isSubmitting}
                            className="h-9 bg-sky-600 hover:bg-sky-700 text-white"
                        >
                            {isSubmitting ? "..." : <><PlusIcon className="w-4 h-4 mr-1" /> Add</>}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
