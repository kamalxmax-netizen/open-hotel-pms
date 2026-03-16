"use client";

import { useEffect, useState } from "react";

type RoomBlock = {
    id: string;
    room_number: string;
    block_type: "OOO" | "OOS";
    start_date: string;
    end_date: string;
    reason: string;
    created_at: string;
    created_by_name?: string;
};

export default function RoomBlocksPage() {
    const [blocks, setBlocks] = useState<RoomBlock[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isAdding, setIsAdding] = useState(false);

    // Form states
    const [formRoom, setFormRoom] = useState("");
    const [formType, setFormType] = useState<"OOO" | "OOS">("OOO");
    const [formStart, setFormStart] = useState("");
    const [formEnd, setFormEnd] = useState("");
    const [formReason, setFormReason] = useState("");
    const [formSaving, setFormSaving] = useState(false);

    // Fetch lists
    const [availableRooms, setAvailableRooms] = useState<{ id: string; room_number: string }[]>([]);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [blocksRes, roomsRes] = await Promise.all([
                fetch("/api/room-blocks").then(r => r.json()),
                fetch("/api/setup/rooms").then(r => r.json())
            ]);

            if (blocksRes.success) setBlocks(blocksRes.blocks);
            else setError(blocksRes.error);

            if (roomsRes.success) setAvailableRooms(roomsRes.rooms);
            else console.error("Failed to load rooms", roomsRes.error);

        } catch (err) {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setFormSaving(true);
        try {
            const res = await fetch("/api/room-blocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_id: formRoom,
                    block_type: formType,
                    start_date: formStart,
                    end_date: formEnd,
                    reason: formReason
                })
            });
            const data = await res.json();
            if (data.success) {
                setIsAdding(false);
                setFormRoom("");
                setFormStart("");
                setFormEnd("");
                setFormReason("");
                loadData();
            } else {
                alert(data.error);
            }
        } catch (err) {
            alert("Network error.");
        } finally {
            setFormSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to delete this room block?")) return;
        try {
            const res = await fetch(`/api/room-blocks/${id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                loadData();
            } else {
                alert(data.error);
            }
        } catch {
            alert("Network error.");
        }
    }

    return (
        <div className="space-y-5 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Room Blocks</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">Manage Out of Order (OOO) and Out of Service (OOS) rooms</p>
                </div>
                {!isAdding && (
                    <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
                        + Add Block
                    </button>
                )}
            </div>

            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg">{error}</div>}

            {/* Add Form */}
            {isAdding && (
                <div className="card p-5 border border-brand-200 shadow-sm bg-brand-50/30">
                    <h3 className="font-bold text-[var(--text-primary)] mb-4">New Room Block</h3>
                    <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Room Number</label>
                            <select
                                required
                                className="input"
                                value={formRoom}
                                onChange={e => setFormRoom(e.target.value)}
                            >
                                <option value="">-- Select Room --</option>
                                {availableRooms.map(r => (
                                    <option key={r.id} value={r.id}>Room {r.room_number}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Type</label>
                            <select
                                required
                                className="input"
                                value={formType}
                                onChange={e => setFormType(e.target.value as "OOO" | "OOS")}
                            >
                                <option value="OOO">Out of Order (OOO) - Deduct Inventory</option>
                                <option value="OOS">Out of Service (OOS) - Information Only</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Start Date</label>
                            <input
                                type="date"
                                required
                                className="input"
                                value={formStart}
                                onChange={e => setFormStart(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">End Date</label>
                            <input
                                type="date"
                                required
                                className="input"
                                value={formEnd}
                                onChange={e => setFormEnd(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Reason</label>
                            <input
                                type="text"
                                required
                                className="input"
                                placeholder="e.g. Broken AC, Maintenance"
                                value={formReason}
                                onChange={e => setFormReason(e.target.value)}
                            />
                        </div>

                        <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                            <button type="button" className="btn btn-secondary" onClick={() => setIsAdding(false)}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={formSaving}>
                                {formSaving ? "Saving..." : "Save Block"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* List */}
            {loading ? (
                <div className="h-40 bg-[var(--bg-muted)] animate-pulse rounded-xl" />
            ) : blocks.length === 0 ? (
                <div className="card p-12 text-center text-[var(--text-secondary)]">
                    No active room blocks.
                </div>
            ) : (
                <div className="card overflow-hidden">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Room</th>
                                <th>Type</th>
                                <th>Period</th>
                                <th>Reason</th>
                                <th>Created By</th>
                                <th className="text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {blocks.map(b => (
                                <tr key={b.id}>
                                    <td className="font-bold text-[var(--text-primary)]">Room {b.room_number}</td>
                                    <td>
                                        <span className={`badge ${b.block_type === 'OOO' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {b.block_type}
                                        </span>
                                    </td>
                                    <td className="text-sm">
                                        <div className="font-medium">{b.start_date}</div>
                                        <div className="text-[var(--text-secondary)] text-xs">to {b.end_date}</div>
                                    </td>
                                    <td className="text-sm text-[var(--text-table-cell)]">{b.reason}</td>
                                    <td className="text-xs text-[var(--text-secondary)]">{b.created_by_name || "System"}</td>
                                    <td className="text-right flex justify-end">
                                        <button
                                            className="text-xs text-red-600 hover:text-red-800 p-2"
                                            onClick={() => handleDelete(b.id)}
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
