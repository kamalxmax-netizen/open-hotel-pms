"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2Icon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StockReconcileSectionProps {
  onReconcileComplete: (isComplete: boolean) => void;
}

type StockReconcileUiSection = {
  key: string;
  label_en: string;
  label_th: string;
  status: "clean" | "pending" | "acknowledged";
  variance_count: number;
  total_count: number;
  note?: string;
  acknowledged_by?: string;
};

type StockReconcileUiStatus = {
  all_clean: boolean;
  can_complete_night_audit: boolean;
  sections: StockReconcileUiSection[];
};

export function StockReconcileSection({ onReconcileComplete }: StockReconcileSectionProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<StockReconcileUiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackingKey, setAckingKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/night-audit/stock-reconcile");
      const apiData = await res.json();
      
      const sections: StockReconcileUiSection[] = [];
      const ack = apiData.acknowledgments || {};

      // POS
      sections.push({
        key: "pos",
        label_en: "POS Inventory (Main Only)",
        label_th: "สินค้า POS",
        status: ack.pos ? "acknowledged" : (apiData.pos.status === "clean" ? "clean" : "pending"),
        variance_count: apiData.pos.variance_count || 0,
        total_count: apiData.pos.total_products || 0,
        note: ack.pos?.note || undefined,
        acknowledged_by: ack.pos?.acknowledged_by || undefined,
      });

      // Amenity Prepare
      sections.push({
        key: "amenity_prepare",
        label_en: "Amenity Prepare Batches",
        label_th: "เบิกจ่าย Amenity",
        status: ack.amenity_prepare ? "acknowledged" : (apiData.amenity_prepare.status === "clean" ? "clean" : "pending"),
        variance_count: apiData.amenity_prepare.pending_batches || 0,
        total_count: apiData.amenity_prepare.pending_batches || 0, // Using pending count conceptually here
        note: ack.amenity_prepare?.note || undefined,
        acknowledged_by: ack.amenity_prepare?.acknowledged_by || undefined,
      });

      // Amenity Direct
      sections.push({
        key: "amenity_direct",
        label_en: "Amenity Direct (Floor Audit)",
        label_th: "สต๊อก Amenity ชั้น",
        status: ack.amenity_direct ? "acknowledged" : (apiData.amenity_direct.status === "clean" ? "clean" : "pending"),
        variance_count: apiData.amenity_direct.stale_floors?.length || 0,
        total_count: apiData.amenity_direct.stale_floors?.length || 0, // Using stale floors conceptually
        note: ack.amenity_direct?.note || undefined,
        acknowledged_by: ack.amenity_direct?.acknowledged_by || undefined,
      });

      const can_complete_night_audit = apiData.overall_status === "clean" || apiData.overall_status === "acknowledged";
      
      setStatus({
         all_clean: apiData.overall_status === "clean",
         can_complete_night_audit,
         sections
      });
      onReconcileComplete(can_complete_night_audit);
    } catch (e) {
      console.error(e);
      onReconcileComplete(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAcknowledge = async (key: string) => {
    if (!notes[key]?.trim()) {
       toast({ title: "Note is required", variant: "destructive" });
       return;
    }
    try {
      setAckingKey(key);
      const res = await fetch("/api/night-audit/stock-reconcile/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
           section: key,
           note: notes[key]
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);

      await fetchStatus();
      toast({ title: "Acknowledged Variance" });
    } catch (e) {
       toast({ title: "Failed", variant: "destructive" });
    } finally {
      setAckingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-[var(--text-secondary)]">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-[var(--border-default)] border-t-brand-600 mb-2"></div>
        <p className="text-xs">Checking Stock Reconciliations...</p>
      </div>
    );
  }

  if (!status) return null;

  if (status.all_clean) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 mt-4">
         <div className="flex items-center gap-2 mb-1">
            <CheckCircle2Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span className="font-semibold text-emerald-800 dark:text-emerald-400">Stock Reconciliation — All Clean</span>
         </div>
         <p className="text-xs text-emerald-700 dark:text-emerald-500 pl-7">
            POS inventory, Amenity Prepare batches, and Floor Audit are all balanced for this business date.
         </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-4 mt-2">
      {status.sections.map(sec => {
        if (sec.status === "clean") {
          return (
            <div key={sec.key} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex justify-between items-center dark:bg-emerald-500/5 dark:border-emerald-500/20">
               <div>
                 <p className="text-xs font-bold text-emerald-800 dark:text-emerald-400">{sec.label_en}</p>
               </div>
               <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500">
                  <CheckCircle2Icon className="w-4 h-4" /> Clean ({sec.total_count} products)
               </div>
            </div>
          );
        }
        
        if (sec.status === "acknowledged") {
           return (
             <div key={sec.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:bg-slate-500/5 dark:border-slate-500/20">
                <div className="flex justify-between items-center mb-2">
                   <div>
                     <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{sec.label_en}</p>
                     <p className="text-[10px] text-slate-500 font-medium">{sec.label_th}</p>
                   </div>
                   <div className="text-right text-xs">
                     <span className="text-slate-500 font-semibold italic">Acknowledged by {sec.acknowledged_by}</span>
                   </div>
                </div>
                {sec.note && (
                  <p className="text-[11px] text-slate-600 bg-slate-200/50 dark:bg-slate-500/20 p-2 rounded-md">Note: {sec.note}</p>
                )}
             </div>
           );
        }
        
        return (
          <div key={sec.key} className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:bg-amber-500/10 dark:border-amber-500/20">
             <div className="flex items-start gap-3">
               <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">!</div>
               <div className="flex-1">
                 <h4 className="text-sm font-bold text-amber-800 dark:text-amber-400">Variance Detected in {sec.label_en}</h4>
                 <p className="text-xs font-medium text-amber-700 dark:text-amber-500 mb-2">{sec.label_th}</p>
                 <p className="text-[13px] text-amber-700 dark:text-amber-400 mb-3 block">
                    Found {sec.variance_count} product(s) with variance. Acknowledge this soft-warning to unblock Night Audit.
                 </p>
                 <div className="flex gap-2">
                    <Input 
                      placeholder="เหตุผล (Reason for accepting variance)..." 
                      className="h-8 text-xs bg-white dark:bg-[var(--bg-body)] border-amber-200 focus:border-amber-400"
                      value={notes[sec.key] || ""}
                      onChange={e => setNotes({...notes, [sec.key]: e.target.value})}
                    />
                    <Button 
                       size="sm" 
                       onClick={() => handleAcknowledge(sec.key)} 
                       disabled={ackingKey === sec.key}
                       className="h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                    >
                       {ackingKey === sec.key ? "Acking..." : "Acknowledge"}
                    </Button>
                 </div>
               </div>
             </div>
          </div>
        );
      })}
    </div>
  );
}
