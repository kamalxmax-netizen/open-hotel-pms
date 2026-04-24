"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AlertItem, AlertsSummary, AlertsRangeResponse, AlertsRangeDay } from "@/lib/types/alerts";
import { PrepaymentCard, CustomAlarmCard } from "./_components/AlertCards";
import { useAdminRole } from "@/hooks/use-admin-role";

export default function AlertsCenterPage() {
    // Current state
    const [businessDate, setBusinessDate] = useState<string>("");
    const [selectedDate, setSelectedDate] = useState<string>(""); // "" means today
    const { isAdmin } = useAdminRole();
    
    // Data state
    const [summary, setSummary] = useState<AlertsSummary | null>(null);
    const [todaySummary, setTodaySummary] = useState<AlertsSummary | null>(null);
    const [items, setItems] = useState<AlertItem[]>([]);
    const [pickerDays, setPickerDays] = useState<AlertsRangeDay[]>([]);
    const [loading, setLoading] = useState(true);
    const [finishing, setFinishing] = useState(false);
    
    // Modals
    const [snoozeModal, setSnoozeModal] = useState<{id: string, note: string} | null>(null);
    const [clearModal, setClearModal] = useState<{id: string, note: string, type: 'clear' | 'admin'} | null>(null);
    const requestSeqRef = useRef(0);

    const loadToday = useCallback(async () => {
        const requestId = ++requestSeqRef.current;
        setLoading(true);
        try {
            const res = await fetch("/api/alerts/today");
            const data = await res.json();
            if (requestSeqRef.current !== requestId) return;
            if (data.success) {
                setSummary(data.summary);
                setTodaySummary(data.summary);
                setItems(data.items || []);
                setBusinessDate(data.summary.business_date);
            }
        } catch (e) {
            console.error(e);
        } finally {
            if (requestSeqRef.current === requestId) {
                setLoading(false);
            }
        }
    }, []);

    const loadDay = useCallback(async (date: string) => {
        const requestId = ++requestSeqRef.current;
        setLoading(true);
        try {
            const res = await fetch(`/api/alerts/day/${date}`);
            const data = await res.json();
            if (requestSeqRef.current !== requestId) return;
            if (data.success) {
                setSummary(data.summary);
                setItems(data.items || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            if (requestSeqRef.current === requestId) {
                setLoading(false);
            }
        }
    }, []);

    const loadPicker = useCallback(async () => {
        if (!businessDate) return;
        try {
            // Get next 7 days
            const d = new Date(businessDate);
            d.setDate(d.getDate() + 1);
            const fromDate = d.toISOString().split("T")[0];
            d.setDate(d.getDate() + 6);
            const toDate = d.toISOString().split("T")[0];
            
            const res = await fetch(`/api/alerts/range?from=${fromDate}&to=${toDate}`);
            const data = await res.json();
            if (data.success) {
                setPickerDays(data.days || []);
            }
        } catch (e) {
            console.error(e);
        }
    }, [businessDate]);

    // Initial load
    useEffect(() => {
        loadToday();
    }, [loadToday]);

    // Load picker once businessDate is known
    useEffect(() => {
        if (businessDate) loadPicker();
    }, [businessDate, loadPicker]);

    // Effect for selectedDate
    useEffect(() => {
        if (selectedDate === "") {
            loadToday();
        } else {
            loadDay(selectedDate);
        }
    }, [selectedDate, loadToday, loadDay]);

    const handleSnooze = async () => {
        if (!snoozeModal) return;
        try {
            await fetch("/api/alerts/snooze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ daily_state_id: snoozeModal.id, note: snoozeModal.note || undefined })
            });
            setSnoozeModal(null);
            if (selectedDate === "") loadToday(); else loadDay(selectedDate);
            loadPicker(); // Refresh counts
        } catch (e) {
            console.error(e);
        }
    };

    const handleClear = async () => {
        if (!clearModal) return;
        try {
            const endpoint = clearModal.type === 'admin' ? "/api/alerts/admin-clear" : "/api/alerts/clear";
            await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ daily_state_id: clearModal.id, note: clearModal.note })
            });
            setClearModal(null);
            if (selectedDate === "") loadToday(); else loadDay(selectedDate);
            loadPicker(); // Refresh counts
        } catch (e) {
            console.error(e);
        }
    };

    const handleFinishJob = async () => {
        if (!confirm("Are you sure you want to finish the Alarm Job for today? This will notify the admin group.")) return;
        setFinishing(true);
        try {
            const res = await fetch("/api/alerts/finish-job", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                alert("Alarm Job finished successfully!");
                loadToday();
            } else {
                alert(data.error || "Failed to finish job.");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setFinishing(false);
        }
    };

    const isPreview = selectedDate !== "";
    const prepaymentItems = items.filter(i => i.alert_type === 'prepayment');
    const customItems = items.filter(i => i.alert_type === 'custom');

    const renderLeftColumn = () => {
        if (loading && !summary) {
            return (
                <div className="space-y-6 flex-[3]">
                    <div className="h-12 bg-[var(--bg-surface-hover)] rounded animate-pulse" />
                    <div className="space-y-4">
                        <div className="h-32 bg-[var(--bg-surface-hover)] rounded-xl animate-pulse" />
                        <div className="h-32 bg-[var(--bg-surface-hover)] rounded-xl animate-pulse" />
                    </div>
                </div>
            );
        }

        if (items.length === 0 && !loading) {
            return (
                <div className="space-y-6 flex-[3]">
                    <div className="flex items-center justify-between border-b pb-4">
                        <h1 className="text-2xl font-bold">
                            {isPreview ? `📅 Preview: ${selectedDate}` : `Today's Alerts`}
                        </h1>
                        {isPreview ? (
                            <button className="btn btn-secondary" onClick={() => setSelectedDate("")}>← Back to Today</button>
                        ) : (
                            <button 
                                className="btn btn-primary bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex gap-2 items-center" 
                                onClick={handleFinishJob}
                                disabled={finishing}
                            >
                                ✓ Finish Alarm Job
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="text-6xl mb-4 opacity-50">✨</div>
                        <h3 className="text-lg font-bold text-[var(--text-secondary)]">
                            {isPreview ? "ไม่มีแจ้งเตือนสำหรับวันที่เลือก" : "ไม่มีแจ้งเตือนวันนี้"}
                        </h3>
                        <p className="text-[var(--text-muted)] text-sm">
                            {isPreview ? "No alerts were materialized for this date." : "All clear! Relax and enjoy the day."}
                        </p>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-8 flex-[3]">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-default)] pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
                            {isPreview ? `📅 Preview: ${selectedDate}` : `Today's Alerts`}
                        </h1>
                        {!isPreview && summary && (
                            <span className={`px-2 py-1 rounded text-xs font-bold ${summary.is_finished ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' : summary.ready_to_finish ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                                {summary.is_finished ? 'Finished' : `${summary.cleared} / ${summary.total} cleared`}
                            </span>
                        )}
                    </div>
                    
                    {isPreview ? (
                        <button className="btn btn-secondary" onClick={() => setSelectedDate("")}>← Back to Today</button>
                    ) : summary && (
                        <button 
                            className={`btn shadow-sm flex gap-2 items-center transition-colors ${summary.is_finished ? 'btn-secondary opacity-60' : summary.ready_to_finish ? 'btn-primary bg-emerald-600 hover:bg-emerald-700 text-white' : 'btn-secondary opacity-50'}`} 
                            onClick={handleFinishJob}
                            disabled={!summary.ready_to_finish || summary.is_finished || finishing}
                        >
                            {summary.is_finished ? 'Alarm Job Finished' : 'Finish Alarm Job →'}
                        </button>
                    )}
                </div>

                {/* Pre-payment section */}
                {prepaymentItems.length > 0 && (
                    <div className="space-y-4">
                        <h2 className="text-lg font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2">
                            💰 Pre-payment <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full">{prepaymentItems.length}</span>
                        </h2>
                        <div className="grid grid-cols-1 gap-4">
                            {prepaymentItems.map(item => (
                                <PrepaymentCard 
                                    key={item.daily_state_id} 
                                    item={item} 
                                    isPreview={isPreview}
                                    isAdmin={Boolean(isAdmin)}
                                    businessDate={summary?.business_date || businessDate}
                                    onSnooze={(id) => setSnoozeModal({id, note: ""})}
                                    onClear={(id) => setClearModal({id, note: "", type: "clear"})}
                                    onAdminClear={(id) => setClearModal({id, note: "", type: "admin"})}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Custom Alarms section */}
                {customItems.length > 0 && (
                    <div className="space-y-4 pt-4">
                        <h2 className="text-lg font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
                            ⏰ Custom Alarms <span className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 px-2 py-0.5 rounded-full">{customItems.length}</span>
                        </h2>
                        <div className="grid grid-cols-1 gap-4">
                            {customItems.map(item => (
                                <CustomAlarmCard 
                                    key={item.daily_state_id} 
                                    item={item} 
                                    isPreview={isPreview}
                                    isAdmin={Boolean(isAdmin)}
                                    businessDate={summary?.business_date || businessDate}
                                    onSnooze={(id) => setSnoozeModal({id, note: ""})}
                                    onClear={(id) => setClearModal({id, note: "", type: "clear"})}
                                    onAdminClear={(id) => setClearModal({id, note: "", type: "admin"})}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderRightColumn = () => {
        return (
            <div className="flex-1 space-y-4">
                <h3 className="font-bold text-[var(--text-secondary)] uppercase text-xs tracking-wider">7-Day Projection</h3>
                <div className="flex flex-col gap-2">
                    {/* Today button */}
                    <button 
                        className={`text-left rounded-xl p-3 border transition-colors ${!isPreview ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'}`}
                        onClick={() => setSelectedDate("")}
                    >
                        <div className="flex justify-between items-center">
                            <span className={`font-bold ${!isPreview ? 'text-brand-700 dark:text-brand-400' : 'text-[var(--text-primary)]'}`}>Today</span>
                            {!isPreview && <span className="text-brand-600">→</span>}
                        </div>
                        {todaySummary && todaySummary.total > 0 && (
                            <div className="text-xs mt-1 flex gap-2">
                                {todaySummary?.pending_prepayment ? <span className="text-amber-600">💰 {todaySummary.pending_prepayment}</span> : null}
                                {todaySummary?.pending_custom ? <span className="text-indigo-600">⏰ {todaySummary.pending_custom}</span> : null}
                                {todaySummary?.cleared ? <span className="text-emerald-600">✓ {todaySummary.cleared}</span> : null}
                            </div>
                        )}
                    </button>

                    {/* Future days */}
                    {pickerDays.map(day => {
                        const isSelected = selectedDate === day.date;
                        const hasAlerts = day.total > 0;
                        const dateObj = new Date(day.date);
                        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                        
                        return (
                            <button 
                                key={day.date}
                                className={`text-left rounded-xl p-3 border transition-colors ${isSelected ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'} ${!hasAlerts ? 'opacity-60' : ''}`}
                                onClick={() => setSelectedDate(day.date)}
                            >
                                <div className="flex justify-between items-center">
                                    <div>
                                        <span className={`font-semibold ${isSelected ? 'text-brand-700 dark:text-brand-400' : 'text-[var(--text-primary)]'}`}>
                                            {dayOfWeek}, {day.date.substring(5)}
                                        </span>
                                    </div>
                                    {isSelected ? (
                                        <span className="text-brand-600">→</span>
                                    ) : hasAlerts ? (
                                        <span className="text-[var(--text-muted)] text-xs">View</span>
                                    ) : null}
                                </div>
                                <div className="text-xs mt-1 flex gap-2 h-4">
                                    {hasAlerts ? (
                                        <>
                                            {day.prepayment_count > 0 && <span className="text-amber-600">💰 {day.prepayment_count}</span>}
                                            {day.custom_count > 0 && <span className="text-indigo-600">⏰ {day.custom_count}</span>}
                                        </>
                                    ) : (
                                        <span className="text-[var(--text-muted)]">–</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-24">
            <div className="flex flex-col lg:flex-row gap-8 items-start">
                {renderLeftColumn()}
                {renderRightColumn()}
            </div>

            {/* Modals */}
            {snoozeModal && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[400px] max-w-full shadow-xl p-6">
                        <h3 className="font-bold mb-4 text-lg">Snooze to Tomorrow</h3>
                        <div className="space-y-4">
                            <label className="block text-sm">
                                <span className="font-semibold">Reason for snooze (Optional)</span>
                                <textarea 
                                    className="form-input w-full mt-1 h-24"
                                    value={snoozeModal.note}
                                    onChange={e => setSnoozeModal({...snoozeModal, note: e.target.value})}
                                    placeholder="e.g. Call guest tomorrow morning"
                                />
                            </label>
                            <div className="flex justify-end gap-2 mt-4">
                                <button className="btn btn-secondary" onClick={() => setSnoozeModal(null)}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSnooze}>Confirm Snooze</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {clearModal && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[400px] max-w-full shadow-xl p-6">
                        <h3 className={`font-bold mb-4 text-lg ${clearModal.type === 'admin' ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {clearModal.type === 'admin' ? 'Force-Clear (Admin)' : 'Clear Alert'}
                        </h3>
                        <div className="space-y-4">
                            <label className="block text-sm">
                                <span className="font-semibold">Action taken (Note) *</span>
                                <textarea 
                                    className="form-input w-full mt-1 h-24"
                                    value={clearModal.note}
                                    onChange={e => setClearModal({...clearModal, note: e.target.value})}
                                    placeholder={clearModal.type === 'admin' ? "Reason for force clear..." : "What action did you take?"}
                                />
                            </label>
                            <div className="flex justify-end gap-2 mt-4">
                                <button className="btn btn-secondary" onClick={() => setClearModal(null)}>Cancel</button>
                                <button 
                                    className={`btn ${clearModal.type === 'admin' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'btn-primary'}`} 
                                    onClick={handleClear}
                                    disabled={!clearModal.note}
                                >
                                    Confirm Clear
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
