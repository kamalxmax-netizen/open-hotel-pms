"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { AuditFloorPicker } from "@/components/amenity-audit/audit-floor-picker";
import { AuditSessionCard } from "@/components/amenity-audit/audit-session-card";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmenityAuditFloorStatus, AmenityAuditSessionListRow } from "@/lib/types";

export default function AmenityAuditPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [floors, setFloors] = useState<AmenityAuditFloorStatus[]>([]);
  const [sessions, setSessions] = useState<AmenityAuditSessionListRow[]>([]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [statusRes, sessionsRes] = await Promise.all([
        fetch('/api/amenity-audit/status'),
        fetch('/api/amenity-audit/sessions')
      ]);
      
      const statusData = await statusRes.json();
      const sessionsData = await sessionsRes.json();

      if (statusData.success && statusData.floors) {
         setFloors(statusData.floors);
      }
      if (sessionsData.success && sessionsData.sessions) {
         setSessions(sessionsData.sessions);
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to load audit data.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
     fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-1">Inventory</p>
          <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Amenity Audit</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Select a floor to begin physical count & reconciliation.</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
          <RefreshCwIcon className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading && floors.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
           {[1,2,3].map(i => <div key={i} className="animate-pulse bg-[var(--bg-muted)] h-32 rounded-lg" />)}
        </div>
      ) : (
        <AuditFloorPicker floors={floors} />
      )}

      <div>
         <h2 className="text-lg font-bold text-[var(--text-primary)] mb-4">Recent Audit Sessions</h2>
         {isLoading && sessions.length === 0 ? (
           <div className="space-y-4">
             {[1,2].map(i => <div key={i} className="animate-pulse bg-[var(--bg-muted)] h-28 rounded-lg" />)}
           </div>
         ) : sessions.length === 0 ? (
           <div className="card p-8 text-center text-[var(--text-muted)]">
             <p>No recent audit sessions found.</p>
           </div>
         ) : (
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sessions.map(s => <AuditSessionCard key={s.session_id} session={s} />)}
           </div>
         )}
      </div>
    </div>
  );
}
