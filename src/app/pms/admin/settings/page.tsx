"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/Label";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
export default function AdminSettingsPage() {
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [applying, setApplying] = useState(false);
    
    const [retentionDays, setRetentionDays] = useState("30");
    const [gasSyncEnabled, setGasSyncEnabled] = useState(true);
    const [gasSaving, setGasSaving] = useState(false);
    const [logs, setLogs] = useState<any[]>([]);
    const [stats, setStats] = useState<{ total_uncleaned: number }>({ total_uncleaned: 0 });
    const [error, setError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    useEffect(() => {
        let cancelled = false;
        const boot = async () => {
            try {
                const supabase = createBrowserSupabaseClient();
                const { data: authData } = await supabase.auth.getUser();
                const authUserId = authData?.user?.id;
                if (!authUserId) {
                    router.push("/login");
                    return;
                }
                const { data: profileData } = await supabase
                    .from("profiles")
                    .select("role")
                    .eq("user_id", authUserId)
                    .maybeSingle();
                const role = String(profileData?.role ?? "").trim().toLowerCase();
                if (role !== "admin") {
                    router.push("/pms");
                    return;
                }
                if (!cancelled) {
                    void fetchData();
                }
            } catch {
                router.push("/login");
            }
        };

        void boot();
        return () => {
            cancelled = true;
        };
    }, [router]);

    const fetchData = async () => {
        setLoading(true);
        setError("");
        
        try {
            // First run will fail if Agent B hasn't merged the APIs yet, 
            // so we handle errors gracefully.
            const [settingsRes, logsRes, statsRes] = await Promise.allSettled([
                fetch("/api/admin/settings"),
                fetch("/api/admin/trigger-cleanup"),
                fetch("/api/admin/settings?action=stats")
            ]);
            
            if (settingsRes.status === "fulfilled" && settingsRes.value.ok) {
                const data = await settingsRes.value.json();
                if (data.success) {
                    const rawSetting =
                        data?.setting?.value ??
                        data?.settings?.passport_photo_retention_days ??
                        null;
                    if (rawSetting != null) {
                        setRetentionDays(String(rawSetting));
                    }
                    setGasSyncEnabled(data?.settings?.google_sheet_sync_enabled !== false);
                }
            }
            
            if (logsRes.status === "fulfilled" && logsRes.value.ok) {
                const data = await logsRes.value.json();
                if (data.success && data.logs) {
                    setLogs(data.logs);
                }
            }

            if (statsRes.status === "fulfilled" && statsRes.value.ok) {
                const data = await statsRes.value.json();
                if (data.success) {
                    setStats({
                        total_uncleaned: Number(data.total_uncleaned ?? data?.stats?.total_uncleaned ?? 0),
                    });
                }
            }
        } catch (err) {
            console.error("Failed to fetch settings data", err);
            setError("Failed to load settings from server.");
        } finally {
            setLoading(false);
        }
    };

    const handleGasSyncToggle = async () => {
        const newValue = !gasSyncEnabled;
        setGasSaving(true);
        setError("");
        setSuccessMsg("");
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ google_sheet_sync_enabled: newValue })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to update Google Sheet Sync setting");
            }
            setGasSyncEnabled(data?.settings?.google_sheet_sync_enabled !== false);
            setSuccessMsg(`Google Sheet Sync ${newValue ? "enabled" : "disabled"}.`);
            setTimeout(() => setSuccessMsg(""), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update GAS sync setting");
        } finally {
            setGasSaving(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setError("");
        setSuccessMsg("");
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    passport_photo_retention_days: Number.parseInt(retentionDays, 10) || 30
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to save setting");
            }
            setSuccessMsg("Settings saved successfully.");
            setTimeout(() => setSuccessMsg(""), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setSaving(false);
        }
    };

    const handleApplyExisting = async () => {
        if (!confirm(`Are you sure you want to recalculate expiration dates for ALL uncleaned passport scans using ${retentionDays} days?`)) {
            return;
        }
        
        setApplying(true);
        setError("");
        setSuccessMsg("");
        try {
            const res = await fetch("/api/admin/settings?apply_existing=true", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    retention_days: parseInt(retentionDays, 10)
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to apply to existing");
            }
            setSuccessMsg(`Applied retention policy to ${data.total_updated || data.updated_count || 0} existing scans.`);
            fetchData();
            setTimeout(() => setSuccessMsg(""), 5000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setApplying(false);
        }
    };

    const handleTriggerCleanup = async () => {
        if (!confirm("Are you sure you want to manually trigger the cleanup edge function? This will permanently delete expired passport photos from storage.")) {
            return;
        }
        
        setTriggering(true);
        setError("");
        setSuccessMsg("");
        
        try {
            const res = await fetch("/api/admin/trigger-cleanup", {
                method: "POST",
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to trigger cleanup");
            }
            setSuccessMsg(`Cleanup completed! Deleted ${data.result?.deleted_rows || data.result?.deleted_count || 0} expired scans in ${data.result?.duration_ms || 0}ms.`);
            fetchData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setTriggering(false);
        }
    };

    if (loading) {
        return (
            <div className="p-6">
                <div className="animate-pulse space-y-6 max-w-2xl">
                    <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded"></div>
                    <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-xl"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 lg:p-8 max-w-4xl mx-auto space-y-8 fade-in">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-[var(--text-primary)] relative inline-flex items-center gap-2">
                    System Settings
                    <span className="flex h-6 px-2 items-center justify-center rounded-full bg-rose-100 text-rose-800 text-[10px] uppercase font-bold tracking-wider dark:bg-rose-900/30 dark:text-rose-400">
                        Admin Only
                    </span>
                </h1>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                    Manage core system parameters and security controls.
                </p>
            </header>

            {error && (
                <div className="p-4 mb-6 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 flex items-start gap-3 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400">
                    <div className="mt-0.5 text-lg">⚠️</div>
                    <div>
                        <p className="font-semibold text-sm">Error saving settings</p>
                        <p className="text-sm opacity-90">{error}</p>
                    </div>
                </div>
            )}

            {successMsg && (
                <div className="p-4 mb-6 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-start gap-3 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400">
                    <div className="mt-0.5 text-lg">✅</div>
                    <p className="text-sm font-medium">{successMsg}</p>
                </div>
            )}

            {/* GOOGLE SHEET SYNC TOGGLE */}
            <Card className="shadow-sm overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl bg-[var(--bg-surface)]">
                <CardContent className="px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-500/10 flex items-center justify-center text-green-600 dark:text-green-400 shadow-inner">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Google Sheet Sync</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                Sync booking data to Google Sheets via Apps Script.
                                {!gasSyncEnabled && " (Disabled — bookings will not push to sheet)"}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={gasSyncEnabled}
                        disabled={gasSaving}
                        onClick={handleGasSyncToggle}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 ${gasSyncEnabled ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"}`}
                    >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${gasSyncEnabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-full">
                {/* SETTINGS CARD */}
                <Card className="shadow-sm overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 rounded-xl bg-[var(--bg-surface)] w-full">
                    <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 px-6 py-5">
                        <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-inner">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                        </div>
                        <CardTitle className="text-lg">Passport Photo Retention</CardTitle>
                        <CardDescription className="text-xs">
                            Number of days to keep scanned passport images after check-in.
                            Once expired, images are automatically deleted via scheduled Edge Functions.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 flex-1">
                        <div className="space-y-4">
                            <div>
                                <Label className="text-sm font-medium text-[var(--text-primary)]">Retention Policy (Days)</Label>
                                <div className="flex mt-1.5 group">
                                    <Input 
                                        type="number" 
                                        min="1" 
                                        max="365"
                                        value={retentionDays}
                                        onChange={(e) => setRetentionDays(e.target.value)}
                                        className="h-10 rounded-r-none focus-visible:ring-1 focus-visible:ring-indigo-500 z-10"
                                    />
                                    <div className="h-10 px-4 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-200 dark:border-slate-700 rounded-r-md flex items-center text-sm text-[var(--text-muted)] whitespace-nowrap group-focus-within:border-indigo-500/50 transition-colors">
                                        Days
                                    </div>
                                </div>
                            </div>

                            <div className="p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-700/30 rounded-lg text-xs leading-relaxed text-amber-800 dark:text-amber-500">
                                <strong>Note:</strong> Changing this value only applies to new scans. To apply this policy retroactively to existing uncleaned scans, use the "Apply to Existing" button below.
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Auto-Cleanup Active
                        </div>
                        <Button 
                            onClick={handleSave} 
                            disabled={saving}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-all shadow-indigo-200 dark:shadow-none h-9 text-sm px-5 rounded-lg"
                        >
                            {saving ? "Saving..." : "Save Policy"}
                        </Button>
                    </CardFooter>
                </Card>

                {/* MANUAL TRIGGER CARD */}
                <Card className="shadow-sm overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 rounded-xl bg-[var(--bg-surface)] w-full">
                    <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 px-6 py-5">
                        <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-orange-600 dark:text-orange-400 mb-4 shadow-inner">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </div>
                        <CardTitle className="text-lg">Data Retention Tools</CardTitle>
                        <CardDescription className="text-xs">
                            Apply new retention policies retroactively or forcefully trigger the cleanup job.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 flex-1 flex flex-col justify-center space-y-6">
                        <div className="flex flex-col gap-3 pb-6 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Retroactive Policy Update</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-1">Recalculate expiration dates for all {stats.total_uncleaned} pending scans using the {retentionDays}-day policy.</p>
                            </div>
                            <Button 
                                variant="outline" 
                                onClick={handleApplyExisting} 
                                disabled={applying || stats.total_uncleaned === 0}
                                className="w-full justify-center h-10 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                {applying ? "Applying..." : "Apply to Existing Scans"}
                            </Button>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--text-primary)] text-rose-700 dark:text-rose-500">Manual Cleanup Trigger</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-1">Run the Edge Function immediately to delete any currently expired images.</p>
                            </div>
                            <Button 
                                variant="destructive" 
                                onClick={handleTriggerCleanup} 
                                disabled={triggering}
                                className="w-full justify-center h-10 bg-rose-600 hover:bg-rose-700 shadow-sm shadow-rose-200 dark:shadow-none"
                            >
                                {triggering ? "Running Cleanup..." : "Force Trigger Cleanup Run"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* AUDIT LOGS */}
            <div className="mt-8 overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl bg-[var(--bg-surface)] shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cleanup History Logs</h2>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">Recent executions of the cleanup cron job.</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={fetchData} className="h-8 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
                        Refresh Logs
                    </Button>
                </div>
                
                {logs.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                        </div>
                        <p className="text-sm text-[var(--text-muted)]">No cleanup logs found yet.</p>
                        <p className="text-xs text-[var(--text-muted)] opacity-70 mt-1">The system will log here once the nightly job runs.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left align-middle" style={{ color: "var(--text-primary)" }}>
                            <thead className="text-xs uppercase bg-[var(--bg-body)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                                <tr>
                                    <th className="px-6 py-3 font-medium tracking-wider">Time</th>
                                    <th className="px-6 py-3 font-medium tracking-wider">Deleted Count</th>
                                    <th className="px-6 py-3 font-medium tracking-wider">Duration</th>
                                    <th className="px-6 py-3 font-medium tracking-wider text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-surface)]">
                                {logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                                        <td className="px-6 py-3 whitespace-nowrap">
                                            <div className="font-medium text-slate-700 dark:text-slate-200">
                                                {new Date(log.ran_at).toLocaleString('th-TH')}
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5 font-mono">{log.job_name}</div>
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
                                                {log.deleted_count} scans
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap text-xs text-[var(--text-muted)]">
                                            {log.duration_ms} ms
                                        </td>
                                        <td className="px-6 py-3 whitespace-nowrap text-right">
                                            {log.error_message ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-400">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                                    Error
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                    Success
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            
        </div>
    );
}
