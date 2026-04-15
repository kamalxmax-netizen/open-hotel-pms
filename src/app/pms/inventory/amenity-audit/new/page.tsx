"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { AuditItemRow } from "@/components/amenity-audit/audit-item-row";
import { AuditSummaryFooter } from "@/components/amenity-audit/audit-summary-footer";
import { AmenityAuditItemDisplay } from "@/lib/types";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

function AuditFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const floorParam = searchParams?.get("floor");
  const floorNumber = floorParam ? parseInt(floorParam) : 1;
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<AmenityAuditItemDisplay[]>([]);
  const [sessionNote, setSessionNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/amenity-audit/products?floor_number=${floorNumber}`);
      const data = await res.json();
      
      if (data.success && data.products) {
        setItems(data.products.map((p: any) => ({
          product_id: p.product_id,
          product_name: p.product_name,
          unit: p.unit,
          system_qty_before: p.system_qty,
          physical_qty: p.system_qty,
          overclick_delta: 0,
          refill_to: p.system_qty,
          refill_delta: 0,
          needs_note: false,
          item_note: ""
        })));
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load floor audit items.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }, [floorNumber, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChange = (id: string, field: keyof AmenityAuditItemDisplay, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.product_id !== id) return item;
      
      const updated = { ...item, [field]: value };
      
      // Auto-recalculate
      if (field === "physical_qty") {
        updated.overclick_delta = updated.physical_qty - updated.system_qty_before;
        if (updated.refill_to < updated.physical_qty) {
            updated.refill_to = updated.physical_qty;
        }
        updated.refill_delta = updated.refill_to - updated.physical_qty;
      } else if (field === "refill_to") {
        updated.refill_delta = updated.refill_to - updated.physical_qty;
      }
      
      // Needs note logic: if absolute variance >= 5, require note
      updated.needs_note = Math.abs(updated.overclick_delta) >= 5;
      
      return updated;
    }));
  };

  const totals = useMemo(() => {
    return items.reduce((acc, item) => {
      acc.totalRefill += Math.max(0, item.refill_delta);
      if (item.overclick_delta > 0) acc.totalOverclick += item.overclick_delta;
      if (item.overclick_delta < 0) acc.totalUnderclick += item.overclick_delta;
      return acc;
    }, { totalRefill: 0, totalOverclick: 0, totalUnderclick: 0 });
  }, [items]);

  const isValid = useMemo(() => {
    if (items.length === 0) return false;
    for (const item of items) {
       // Validate that we aren't refilling backwards
       if (item.refill_to < item.physical_qty) return false;
       // Validates note if required
       if (item.needs_note && !(item.item_note || "").trim()) return false;
    }
    return true;
  }, [items]);

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      
      const payload = {
        floor_number: floorNumber,
        audited_by: "FO Check", // Should be replaced by actual logged in user
        session_note: sessionNote || undefined,
        items: items.map(i => ({
          product_id: i.product_id,
          system_qty_before: i.system_qty_before,
          physical_qty: i.physical_qty,
          refill_to: i.refill_to,
          item_note: (i.item_note || "").trim() || null
        }))
      };

      const res = await fetch("/api/amenity-audit/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (!res.ok || data.success === false) {
          throw new Error(data.error || "Failed to submit audit.");
      }
      
      toast({
        title: "Audit Submitted",
        description: `Successfully reconciled Floor ${floorNumber}.`,
      });
      router.push("/pms/inventory/amenity-audit");
    } catch (err) {
      toast({
        title: "Submit Failed",
        description: err instanceof Error ? err.message : "An error occurred while submitting the session.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <Link href="/pms/inventory/amenity-audit" className="p-2 border border-[var(--border-default)] rounded-full hover:bg-[var(--bg-muted)] transition-colors text-[var(--text-secondary)]">
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Amenity Audit</p>
          <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">New Session (Floor {floorNumber})</h1>
        </div>
      </div>
      
      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="animate-pulse bg-[var(--bg-muted)] h-40 rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
         <div className="card p-12 text-center text-[var(--text-muted)]">
           <p>No products found for this floor.</p>
         </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <AuditItemRow key={item.product_id} item={item} onChange={handleChange} />
          ))}
          
          <AuditSummaryFooter 
             isValid={isValid}
             isSubmitting={isSubmitting}
             onSubmit={handleSubmit}
             totalOverclick={totals.totalOverclick}
             totalUnderclick={totals.totalUnderclick}
             totalRefill={totals.totalRefill}
             sessionNote={sessionNote}
             setSessionNote={setSessionNote}
          />
        </div>
      )}
    </>
  );
}

export default function AmenityAuditNewSessionPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Suspense fallback={<div className="p-12 text-center animate-pulse">Loading Audit Form...</div>}>
        <AuditFormContent />
      </Suspense>
    </div>
  );
}
