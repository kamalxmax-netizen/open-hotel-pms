"use client";

import { useState, useRef } from "react";

type PreviewStats = {
  total_guests: number;
  with_phone: number;
  without_phone: number;
  returning_guests: number;
  total_stays: number;
  stays_with_notes: number;
  sample_guests: {
    first_name: string;
    last_name: string;
    phone: string;
    stay_count: number;
    legacy_night_count: number;
    last_stay_date: string;
    preferences: string;
    vip_tier: string;
    stays: Array<{ date_in: string; date_out: string; nights: number; room: string }>;
  }[];
};

type ExecuteStats = {
  profiles_inserted: number;
  profiles_failed: number;
  stays_inserted: number;
  stays_failed: number;
  errors: string[];
};

export default function GuestMigrationPage() {
  // Clean Data State
  const [cleanConfirmText, setCleanConfirmText] = useState("");
  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanResult, setCleanResult] = useState<string | null>(null);

  // Upload & Preview State
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStats, setPreviewStats] = useState<PreviewStats | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Execute State
  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeResult, setExecuteResult] = useState<{ isDryRun: boolean; stats: ExecuteStats } | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // --- Handlers: Clean Test Data ---
  async function handleCleanup(isDryRun: boolean) {
    if (!isDryRun && cleanConfirmText !== "DELETE_ALL_GUEST_AND_BOOKING_DATA") {
      return;
    }

    setCleanLoading(true);
    setCleanResult(null);

    try {
      const res = await fetch("/api/admin/cleanup-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: isDryRun ? "" : cleanConfirmText,
          dry_run: isDryRun
        })
      });
      const data = await res.json();

      if (!res.ok && !data.deleted) {
        throw new Error(data.error || "Failed to cleanup data");
      }

      const txt = Object.entries(data.deleted || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");

      const errTxt = data.errors
        ? "\n\n⚠️ Errors:\n" + Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join("\n")
        : "";

      setCleanResult(`${isDryRun ? "[DRY RUN] Would delete" : "Deleted"}:\n${txt || "Nothing to delete"}${errTxt}`);
      if (!isDryRun) {
        setCleanConfirmText(""); // Reset after successful actual delete
      }
    } catch (err: any) {
      setCleanResult(`Error: ${err.message}`);
    } finally {
      setCleanLoading(false);
    }
  }

  // --- Handlers: Flow Upload & Preview ---
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      // Reset subsequent states when new file selected
      setPreviewStats(null);
      setPreviewError(null);
      setExecuteResult(null);
      setExecuteError(null);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewStats(null);
    setExecuteResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/guest-migration/preview", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to preview file");
      }

      setPreviewStats(data.preview);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  // --- Handlers: Execute Migration ---
  async function handleExecute(isDryRun: boolean) {
    if (!file) return;
    setExecuteLoading(true);
    setExecuteError(null);
    setExecuteResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("dry_run", isDryRun ? "true" : "false");

    try {
      const res = await fetch("/api/admin/guest-migration/execute", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to execute migration");
      }

      setExecuteResult({
        isDryRun: data.dry_run,
        stats: data.result
      });
    } catch (err: any) {
      setExecuteError(err.message);
    } finally {
      setExecuteLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Phase 51: Guest Migration</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Clean existing test data, upload the Master Guest DB, preview, and ingest into the PMS.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* SECTION 1: Clean Test Data */}
        <section className="card p-6 flex flex-col h-full border-rose-200 bg-rose-50/10">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🗑️</span>
            <h2 className="text-lg font-bold text-rose-800">Clean Test Data</h2>
          </div>
          <p className="text-sm text-rose-700/80 mb-6">
            ลบข้อมูลทดสอบทั้งหมด (Guest, Booking, Payment, Audit Logs, Passport Scans) ในระบบทิ้ง เพื่อเตรียมเปิดใช้งานจริงแบบคลีนๆ
          </p>

          <div className="space-y-4 flex-1">
            <div>
              <label className="text-xs font-semibold text-rose-700 uppercase">Confirm Text</label>
              <input
                type="text"
                placeholder="DELETE_ALL_GUEST_AND_BOOKING_DATA"
                className="mt-1 w-full rounded-md border border-rose-300 bg-white px-3 py-2 text-sm text-rose-900 placeholder:text-rose-300 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                value={cleanConfirmText}
                onChange={(e) => setCleanConfirmText(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleCleanup(true)}
                disabled={cleanLoading}
                className="rounded-lg bg-white border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {cleanLoading ? "Checking..." : "Dry Run"}
              </button>
              <button
                onClick={() => handleCleanup(false)}
                disabled={cleanLoading || cleanConfirmText !== "DELETE_ALL_GUEST_AND_BOOKING_DATA"}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 disabled:bg-rose-300 transition-colors"
              >
                Delete All Data
              </button>
            </div>
            
            {cleanResult && (
              <div className="mt-4 p-3 bg-white border border-rose-200 rounded-lg whitespace-pre-wrap font-mono text-xs text-rose-900">
                {cleanResult}
              </div>
            )}
          </div>
        </section>

        {/* SECTION 2 & 3: Upload, Preview & Execute */}
        <section className="card p-6 flex flex-col h-full space-y-6">
          
          {/* S2: Upload */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📂</span>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Upload Master Guest DB</h2>
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Upload the .xlsx file containing 5,067 legacy guest profiles.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-secondary border-dashed border-2 py-3 w-full max-w-[200px]"
              >
                {file ? "Change File" : "Choose Excel File"}
              </button>
              {file && (
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              )}
            </div>

            {file && (
              <button
                onClick={handlePreview}
                disabled={previewLoading}
                className="mt-4 btn btn-primary w-full max-w-[200px]"
              >
                {previewLoading ? "Parsing..." : "Preview Data"}
              </button>
            )}

            {previewError && (
              <div className="mt-3 p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-700">
                {previewError}
              </div>
            )}
          </div>

          {/* S2: Preview Results */}
          {previewStats && (
            <div className="border border-[var(--border-default)] rounded-xl overflow-hidden bg-[var(--bg-body)]">
               <div className="bg-[var(--bg-surface)] px-4 py-3 border-b border-[var(--border-default)] font-semibold text-[var(--text-primary)] text-sm flex justify-between">
                 <span>Preview Summary</span>
                 <span className="text-[var(--text-muted)] text-xs font-normal">Parsed successfully</span>
               </div>
               
               <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm bg-white dark:bg-[#0B0E14]">
                 <div>
                   <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Guests</div>
                   <div className="font-bold text-lg">{previewStats.total_guests.toLocaleString()}</div>
                 </div>
                 <div>
                   <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">With Phone</div>
                   <div className="font-bold text-lg text-indigo-600 dark:text-indigo-400">
                     {previewStats.with_phone.toLocaleString()} 
                     <span className="text-xs font-normal text-[var(--text-muted)] ml-1">
                       ({((previewStats.with_phone / previewStats.total_guests) * 100).toFixed(1)}%)
                     </span>
                   </div>
                 </div>
                 <div>
                   <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Returning (≥2)</div>
                   <div className="font-bold text-lg text-emerald-600 dark:text-emerald-400">{previewStats.returning_guests.toLocaleString()}</div>
                 </div>
                 <div>
                   <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Total Stays</div>
                   <div className="font-bold text-lg text-amber-600 dark:text-amber-500">{previewStats.total_stays.toLocaleString()}</div>
                 </div>
                 <div>
                   <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Notes Kept</div>
                   <div className="font-bold text-lg text-blue-600 dark:text-blue-400">{previewStats.stays_with_notes.toLocaleString()}</div>
                 </div>
               </div>

               {previewStats.sample_guests.length > 0 && (
                 <div className="border-t border-[var(--border-default)]">
                   <div className="px-4 py-2 bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-secondary)]">Sample First 10 Records</div>
                   <div className="overflow-x-auto max-h-48 overflow-y-auto">
                     <table className="w-full text-xs text-left whitespace-nowrap">
                       <thead className="bg-[var(--bg-body)] sticky top-0 border-b border-[var(--border-default)]">
                         <tr>
                           <th className="px-4 py-2">Name</th>
                           <th className="px-4 py-2">Phone</th>
                           <th className="px-4 py-2">Stays</th>
                           <th className="px-4 py-2">Nights</th>
                           <th className="px-4 py-2">VIP Tier</th>
                         </tr>
                       </thead>
                       <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-surface)]">
                         {previewStats.sample_guests.map((g, i) => (
                           <tr key={i}>
                             <td className="px-4 py-2 font-medium">{g.first_name} {g.last_name}</td>
                             <td className="px-4 py-2 text-[var(--text-secondary)]">{g.phone || "—"}</td>
                             <td className="px-4 py-2">{g.stay_count}</td>
                             <td className="px-4 py-2">{g.legacy_night_count}</td>
                             <td className="px-4 py-2">
                               <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${g.vip_tier === 'loyal' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                                 {g.vip_tier}
                               </span>
                             </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                 </div>
               )}
            </div>
          )}

          {/* S3: Execute */}
          {previewStats && (
             <div className="pt-4 border-t border-[var(--border-default)]">
               <div className="flex items-center gap-2 mb-4">
                 <span className="text-xl">🚀</span>
                 <h2 className="text-lg font-bold text-[var(--text-primary)]">Execute Migration</h2>
               </div>
               
               <div className="flex gap-3">
                 <button
                   onClick={() => handleExecute(true)}
                   disabled={executeLoading}
                   className="btn btn-secondary"
                 >
                   {executeLoading ? "Working..." : "Test Run (Dry Run)"}
                 </button>
                 <button
                   onClick={() => handleExecute(false)}
                   disabled={executeLoading}
                   className="btn bg-emerald-600 text-white hover:bg-emerald-700 border-transparent shadow-sm"
                 >
                   {executeLoading ? "Importing..." : "Import For Real"}
                 </button>
               </div>

               {executeError && (
                 <div className="mt-4 p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-700">
                   {executeError}
                 </div>
               )}

               {executeResult && (
                 <div className={`mt-4 p-4 rounded-xl border ${executeResult.isDryRun ? "border-amber-200 bg-amber-50/50" : "border-emerald-200 bg-emerald-50/50"} text-sm`}>
                   <div className="font-bold flex items-center gap-2 mb-3">
                     {executeResult.isDryRun ? "🟡 Simulation Result" : "✅ Migration Complete"}
                   </div>
                   
                   <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                       <div className="text-xs uppercase text-[var(--text-muted)] font-bold">Profiles</div>
                       <div className="text-emerald-700 font-medium">✅ {executeResult.stats.profiles_inserted.toLocaleString()} Inserted</div>
                       {executeResult.stats.profiles_failed > 0 && (
                         <div className="text-rose-600 font-medium">❌ {executeResult.stats.profiles_failed.toLocaleString()} Failed</div>
                       )}
                     </div>
                     <div className="space-y-1">
                       <div className="text-xs uppercase text-[var(--text-muted)] font-bold">Stay History</div>
                       <div className="text-emerald-700 font-medium">✅ {executeResult.stats.stays_inserted.toLocaleString()} Inserted</div>
                       {executeResult.stats.stays_failed > 0 && (
                         <div className="text-rose-600 font-medium">❌ {executeResult.stats.stays_failed.toLocaleString()} Failed</div>
                       )}
                     </div>
                   </div>

                   {executeResult.stats.errors.length > 0 && (
                     <div className="mt-4 p-3 bg-white/60 dark:bg-black/20 rounded border border-rose-200 text-rose-700 text-xs font-mono max-h-32 overflow-y-auto w-full">
                       <strong>Errors Log:</strong>
                       {executeResult.stats.errors.map((e, i) => (
                         <div key={i} className="mt-1 truncate" title={e}>- {e}</div>
                       ))}
                     </div>
                   )}
                 </div>
               )}
             </div>
          )}
        </section>
      </div>
    </div>
  );
}
