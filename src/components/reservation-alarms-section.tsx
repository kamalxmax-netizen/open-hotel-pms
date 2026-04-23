"use client";

import { useState, useEffect, useCallback } from "react";
import { BookingAlarm } from "@/lib/types/alerts";

export function BookingAlarmsSection({ reservationId, checkInDate }: { reservationId: string; checkInDate: string }) {
    const [alarms, setAlarms] = useState<BookingAlarm[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [businessDate, setBusinessDate] = useState<string>("");

    // Modal states
    const [showAddModal, setShowAddModal] = useState(false);
    const [addDate, setAddDate] = useState("");
    const [addNote, setAddNote] = useState("");
    const [saving, setSaving] = useState(false);

    const [completeModalId, setCompleteModalId] = useState<string | null>(null);
    const [completeNote, setCompleteNote] = useState("");
    const [editingAlarm, setEditingAlarm] = useState<BookingAlarm | null>(null);

    const [showDeleted, setShowDeleted] = useState(false);

    const loadAlarms = useCallback(async () => {
        setLoading(true);
        try {
            const [alarmsRes, eodRes] = await Promise.all([
                fetch(`/api/bookings/${reservationId}/alarms`).then(r => r.json()),
                fetch(`/api/eod/status`).then(r => r.json()).catch(() => ({ business_date: new Date().toISOString().split('T')[0] }))
            ]);
            
            if (alarmsRes.success) {
                setAlarms(alarmsRes.alarms || []);
            }
            if (typeof eodRes.business_date === "string" && eodRes.business_date) {
                setBusinessDate(eodRes.business_date);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [reservationId]);

    useEffect(() => {
        loadAlarms();
    }, [loadAlarms]);

    const handleAdd = async () => {
        if (!addDate || addNote.length < 5) return;
        setSaving(true);
        setError("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/alarms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ alarm_date: addDate, note: addNote })
            });
            const data = await res.json();
            if (res.ok) {
                setShowAddModal(false);
                setAddDate("");
                setAddNote("");
                loadAlarms();
            } else {
                setError(data.error || "Failed to add alarm");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleEdit = async () => {
        if (!editingAlarm || !addDate || addNote.length < 5) return;
        setSaving(true);
        setError("");
        try {
            const res = await fetch(`/api/bookings/${reservationId}/alarms`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: editingAlarm.id, alarm_date: addDate, note: addNote })
            });
            const data = await res.json();
            if (res.ok) {
                setEditingAlarm(null);
                setShowAddModal(false);
                setAddDate("");
                setAddNote("");
                loadAlarms();
            } else {
                setError(data.error || "Failed to update alarm");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleComplete = async () => {
        if (!completeModalId || !completeNote) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/alarms`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: completeModalId, action: "complete", completion_note: completeNote })
            });
            if (res.ok) {
                setCompleteModalId(null);
                setCompleteNote("");
                loadAlarms();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this alarm?")) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/bookings/${reservationId}/alarms`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                loadAlarms();
            }
        } finally {
            setSaving(false);
        }
    };

    // calculate max date for add (check_in_date - 1)
    const getMaxDate = () => {
        if (!checkInDate) return "";
        const d = new Date(checkInDate);
        d.setDate(d.getDate() - 1);
        return d.toISOString().split("T")[0];
    };

    const activeAlarms = alarms.filter(a => a.status === 'active').sort((a, b) => a.alarm_date.localeCompare(b.alarm_date));
    const completedAlarms = alarms.filter(a => a.status === 'completed' || a.status === 'auto_cancelled_due_in');
    const deletedAlarms = alarms.filter(a => a.status === 'deleted');

    if (loading) {
        return <div className="h-10 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--text-secondary)] flex items-center gap-2">
                    🔔 Alarms <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-[10px]">Phase 74</span>
                </h3>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                        setEditingAlarm(null);
                        setAddDate("");
                        setAddNote("");
                        setError("");
                        setShowAddModal(true);
                    }}
                >
                    + เพิ่ม Alarm
                </button>
            </div>

            {/* Active Alarms */}
            {activeAlarms.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center py-2">ไม่มี Alarm ที่กำลังทำงาน</p>
            ) : (
                <div className="space-y-2">
                    {activeAlarms.map(a => (
                        <div key={a.id} className="rounded-xl border border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-900/20 p-3 flex flex-col gap-2">
                            <div className="flex justify-between items-start gap-2">
                                <div>
                                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400 block mb-1">
                                        ⏰ {a.alarm_date}
                                    </span>
                                    <p className="text-sm text-indigo-900 dark:text-indigo-100 whitespace-pre-wrap">{a.note}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    <button
                                        className="btn btn-sm btn-secondary text-xs px-2 py-1"
                                        onClick={() => {
                                            setEditingAlarm(a);
                                            setAddDate(a.alarm_date);
                                            setAddNote(a.note);
                                            setError("");
                                            setShowAddModal(true);
                                        }}
                                    >
                                        แก้ไข
                                    </button>
                                    <button className="btn btn-sm bg-indigo-600 text-white hover:bg-indigo-700 text-xs px-2 py-1" onClick={() => setCompleteModalId(a.id)}>
                                        ✓ ปิด + Note
                                    </button>
                                    <button className="btn btn-sm btn-ghost text-rose-500 hover:bg-rose-50 px-2 py-1 text-xs" onClick={() => handleDelete(a.id)}>
                                        ลบ
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Completed Alarms */}
            {completedAlarms.length > 0 && (
                <details className="text-sm">
                    <summary className="cursor-pointer text-[var(--text-muted)] text-xs font-semibold">
                        {completedAlarms.length} completed alarm{completedAlarms.length > 1 ? 's' : ''}
                    </summary>
                    <div className="mt-2 space-y-2">
                        {completedAlarms.map(a => (
                            <div key={a.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-xs flex flex-col gap-1 opacity-70">
                                <div className="flex justify-between text-[var(--text-secondary)]">
                                    <span className="font-semibold line-through">⏰ {a.alarm_date}</span>
                                    <span className="text-[10px] uppercase bg-[var(--bg-surface-hover)] px-1 rounded">{a.status}</span>
                                </div>
                                <p className="text-[var(--text-secondary)] line-through">{a.note}</p>
                                {a.completion_note && (
                                    <p className="text-emerald-600 dark:text-emerald-400 font-medium">✓ {a.completion_note}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Deleted Alarms */}
            {deletedAlarms.length > 0 && (
                <div className="mt-2">
                    <button className="text-xs text-[var(--text-muted)] hover:underline" onClick={() => setShowDeleted(!showDeleted)}>
                        {showDeleted ? "Hide deleted alarms" : `Show ${deletedAlarms.length} deleted alarms`}
                    </button>
                    {showDeleted && (
                        <div className="mt-2 space-y-2">
                            {deletedAlarms.map(a => (
                                <div key={a.id} className="rounded-lg border border-rose-100 bg-rose-50 dark:border-rose-900/30 dark:bg-rose-900/10 px-3 py-2 text-xs flex flex-col gap-1 opacity-50">
                                    <div className="flex justify-between text-rose-700 dark:text-rose-400">
                                        <span className="font-semibold">⏰ {a.alarm_date}</span>
                                        <span className="text-[10px] uppercase bg-rose-100 dark:bg-rose-900/50 px-1 rounded">DELETED</span>
                                    </div>
                                    <p className="text-rose-600 dark:text-rose-300">{a.note}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Add Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[400px] max-w-full overflow-hidden shadow-xl p-5">
                        <h3 className="font-bold mb-4 text-[var(--text-primary)]">
                            {editingAlarm ? "แก้ไข Alarm" : "เพิ่ม Alarm"}
                        </h3>
                        <div className="space-y-4 text-sm">
                            <div>
                                <label className="form-label block mb-1">วันที่ต้องการแจ้งเตือน</label>
                                <input 
                                    type="date" 
                                    className="form-input w-full" 
                                    min={businessDate} 
                                    max={getMaxDate()} 
                                    value={addDate} 
                                    onChange={e => setAddDate(e.target.value)}
                                />
                                <p className="text-[10px] text-[var(--text-muted)] mt-1">ต้องก่อนวัน Check-in ({checkInDate}) อย่างน้อย 1 วัน</p>
                            </div>
                            <div>
                                <label className="form-label block mb-1">รายละเอียด (Note) *</label>
                                <textarea 
                                    className="form-input w-full min-h-[80px]" 
                                    value={addNote} 
                                    onChange={e => setAddNote(e.target.value)}
                                    placeholder="ใส่รายละเอียดที่ต้องการเตือน (ขั้นต่ำ 5 ตัวอักษร)"
                                />
                            </div>
                            {error && <p className="text-rose-500 text-xs">{error}</p>}
                            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-[var(--border-default)]">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setShowAddModal(false);
                                        setEditingAlarm(null);
                                        setAddDate("");
                                        setAddNote("");
                                        setError("");
                                    }}
                                >
                                    ยกเลิก
                                </button>
                                <button 
                                    className="btn btn-primary" 
                                    disabled={saving || !addDate || addNote.length < 5} 
                                    onClick={editingAlarm ? handleEdit : handleAdd}
                                >
                                    {saving ? "กำลังบันทึก..." : editingAlarm ? "บันทึกการแก้ไข" : "บันทึก"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Complete Modal */}
            {completeModalId && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
                    <div className="bg-[var(--bg-surface)] rounded-xl w-[400px] max-w-full overflow-hidden shadow-xl p-5">
                        <h3 className="font-bold mb-4 text-[var(--text-primary)] text-indigo-700 dark:text-indigo-400">ปิด Alarm (ระบุผลลัพธ์)</h3>
                        <div className="space-y-4 text-sm">
                            <div>
                                <label className="form-label block mb-1">บันทึกผลการทำงาน (Note) *</label>
                                <textarea 
                                    className="form-input w-full min-h-[80px]" 
                                    value={completeNote} 
                                    onChange={e => setCompleteNote(e.target.value)}
                                    placeholder="เช่น โทรหาลูกค้าเรียบร้อยแล้ว"
                                />
                            </div>
                            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-[var(--border-default)]">
                                <button className="btn btn-secondary" onClick={() => setCompleteModalId(null)}>ยกเลิก</button>
                                <button 
                                    className="btn btn-primary bg-indigo-600 hover:bg-indigo-700" 
                                    disabled={saving || !completeNote} 
                                    onClick={handleComplete}
                                >
                                    {saving ? "กำลังบันทึก..." : "เสร็จสิ้น"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
