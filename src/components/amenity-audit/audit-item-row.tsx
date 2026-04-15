import { Input } from "@/components/ui/input";
import { AmenityAuditItemDisplay } from "@/lib/types";

interface AuditItemRowProps {
  item: AmenityAuditItemDisplay;
  onChange: (id: string, field: keyof AmenityAuditItemDisplay, value: any) => void;
}

export function AuditItemRow({ item, onChange }: AuditItemRowProps) {
  const isOverclick = item.overclick_delta > 0;
  const isUnderclick = item.overclick_delta < 0;
  
  return (
    <div className="card p-4 mb-4 dark:bg-[var(--bg-surface)]">
      <div className="flex flex-col md:flex-row justify-between mb-4 gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-extrabold text-[var(--text-primary)]">{item.product_name}</h3>
          
          <div className="grid grid-cols-3 gap-3 mt-3">
             <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">ระบบ (System)</label>
                <div className="h-10 px-3 mt-1 bg-[var(--bg-muted)] border border-transparent rounded-md flex items-center font-semibold text-[var(--text-primary)] pointer-events-none">
                  {item.system_qty_before}
                </div>
             </div>
             <div>
                <label className="text-[10px] items-center font-bold text-[var(--text-secondary)] uppercase">
                  ของจริง (Physical)
                </label>
                <Input 
                   type="number" 
                   min={0}
                   className="h-10 mt-1 font-bold border-emerald-500/50 focus:border-emerald-500 focus:ring-emerald-500/20"
                   value={item.physical_qty}
                   onChange={e => onChange(item.product_id, "physical_qty", parseInt(e.target.value) || 0)}
                />
             </div>
             <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">เติมถึง (Refill to)</label>
                <Input 
                   type="number" 
                   min={item.physical_qty}
                   className="h-10 mt-1 font-bold border-sky-500/50 focus:border-sky-500 focus:ring-sky-500/20"
                   value={item.refill_to}
                   onChange={e => onChange(item.product_id, "refill_to", parseInt(e.target.value) || 0)}
                />
             </div>
          </div>
        </div>
        
        <div className="md:w-[280px] bg-[var(--bg-muted)]/50 rounded-lg p-3 flex flex-col justify-center border border-[var(--border-subtle)] mt-1 md:mt-6">
           <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
              <div>→ จะต้องเติมจริง <strong className="text-sky-600 dark:text-sky-400 text-sm">{item.refill_delta}</strong> ชิ้น</div>
              {item.overclick_delta !== 0 && (
                <div className={isOverclick ? "text-amber-600 dark:text-amber-400 font-medium" : "text-rose-600 dark:text-rose-400 font-medium"}>
                  → แม่บ้านกด [{item.product_name}] {isOverclick ? "เกิน" : "ขาด"} {Math.abs(item.overclick_delta)} ชิ้น
                </div>
              )}
           </div>
        </div>
      </div>
      
      {item.needs_note && (
        <div className="mt-2 animate-in fade-in slide-in-from-top-2">
          <label className="text-xs font-semibold text-rose-600 dark:text-rose-400">ระบุเหตุผล (Required for Variance &gt;= 5)</label>
          <Input 
             placeholder={`ทำไมถึงมียอดต่าง ${Math.abs(item.overclick_delta)} ชิ้น?`}
             className="mt-1 border-rose-300 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/30 dark:bg-rose-500/10"
             value={item.item_note || ""}
             onChange={e => onChange(item.product_id, "item_note", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
