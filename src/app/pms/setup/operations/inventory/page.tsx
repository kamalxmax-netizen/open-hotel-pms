"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { SaveIcon, ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

export default function InventoryOperationsSetupPage() {
  const { toast } = useToast();
  const [warnDays, setWarnDays] = useState(3);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 600)); // Simulate api
    setIsSaving(false);
    toast({
      title: "Settings Saved",
      description: "Inventory operations settings updated successfully.",
    });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-4">
          <Link href="/pms/setup/operations" className="p-2 border border-[var(--border-default)] rounded-full hover:bg-[var(--bg-muted)] transition-colors text-[var(--text-secondary)]">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Setup / Operations</p>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Inventory & Amenity Audit</h1>
          </div>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="bg-brand-600 hover:bg-brand-700 text-white">
          <SaveIcon className="w-4 h-4 mr-2" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="card p-6 dark:bg-[var(--bg-surface)]">
         <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Amenity Audit Settings</h2>
         
         <div className="space-y-6 max-w-xl">
            <div>
               <label className="text-sm font-semibold text-[var(--text-primary)] flex items-center justify-between mb-1">
                 Stale Audit Warning Days
                 <span className="text-xs text-[var(--text-muted)] font-normal">{warnDays} Days</span>
               </label>
               <p className="text-xs text-[var(--text-secondary)] mb-2">
                 The number of days an amenity physical count (audit) is considered fresh. If a floor hasn't been audited within this period, it will show a warning in the Amenity Audit selector.
               </p>
               <Input 
                 type="number" 
                 min={1} 
                 max={30} 
                 value={warnDays} 
                 onChange={e => setWarnDays(parseInt(e.target.value) || 1)} 
                 className="w-32"
               />
               <p className="text-[10px] text-[var(--text-muted)] mt-1">Default is 3 days.</p>
            </div>
         </div>
      </div>
    </div>
  );
}
