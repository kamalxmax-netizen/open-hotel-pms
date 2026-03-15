"use client";

import { useEffect, useState, FormEvent } from "react";
import PmsModal from "./pms-modal";

interface GroupBookingModalProps {
    onClose: () => void;
    onSuccess: (groupId: string) => void;
    mode?: "create" | "edit";
    group?: {
        id: string;
        group_name?: string | null;
        contact_name?: string | null;
        contact_phone?: string | null;
        contact_email?: string | null;
        source?: string | null;
        note?: string | null;
    } | null;
}

export default function GroupBookingModal({
    onClose,
    onSuccess,
    mode = "create",
    group = null
}: GroupBookingModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [groupName, setGroupName] = useState(group?.group_name ?? "");
    const [contactName, setContactName] = useState(group?.contact_name ?? "");
    const [contactPhone, setContactPhone] = useState(group?.contact_phone ?? "");
    const [contactEmail, setContactEmail] = useState(group?.contact_email ?? "");
    const [source, setSource] = useState(group?.source ?? "direct");
    const [note, setNote] = useState(group?.note ?? "");

    useEffect(() => {
        if (mode === "edit" && group) {
            setGroupName(group.group_name ?? "");
            setContactName(group.contact_name ?? "");
            setContactPhone(group.contact_phone ?? "");
            setContactEmail(group.contact_email ?? "");
            setSource(group.source ?? "direct");
            setNote(group.note ?? "");
            return;
        }
        if (mode === "create") {
            setGroupName("");
            setContactName("");
            setContactPhone("");
            setContactEmail("");
            setSource("direct");
            setNote("");
        }
    }, [group, mode]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const isEdit = mode === "edit";
            if (isEdit && !group?.id) {
                throw new Error("Missing group id.");
            }

            const endpoint = isEdit
                ? `/api/booking-groups/${group!.id}`
                : "/api/booking-groups";

            const res = await fetch(endpoint, {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    group_name: groupName,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    contact_email: contactEmail,
                    source,
                    note
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || (isEdit ? "Failed to update group" : "Failed to create group"));
            }

            onSuccess(data.group.id);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <PmsModal
            title={mode === "edit" ? "Edit Group Booking" : "Create Group Booking"}
            onClose={onClose}
            footer={
                <div className="flex w-full justify-between">
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </button>
                    <button form="create-group-form" type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? (mode === "edit" ? "Saving..." : "Creating...") : (mode === "edit" ? "Save Changes" : "Create Group")}
                    </button>
                </div>
            }
        >
            <form id="create-group-form" onSubmit={handleSubmit} className="space-y-4">
                {error && <div className="text-red-500 text-sm bg-red-50 p-2 rounded">{error}</div>}

                <div>
                    <label className="form-label">Group Name *</label>
                    <input
                        type="text"
                        className="form-input text-sm"
                        value={groupName}
                        onChange={e => setGroupName(e.target.value)}
                        required
                        placeholder="e.g. Wang Family Reunion"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="form-label">Contact Name</label>
                        <input
                            type="text"
                            className="form-input text-sm"
                            value={contactName}
                            onChange={e => setContactName(e.target.value)}
                            placeholder="Leader Name"
                        />
                    </div>
                    <div>
                        <label className="form-label">Source</label>
                        <select
                            className="form-select text-sm"
                            value={source}
                            onChange={e => setSource(e.target.value)}
                        >
                            <option value="direct">Direct</option>
                            <option value="walkin">Walk-in</option>
                            <option value="ota">OTA</option>
                            <option value="agent">Agent</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="form-label">Contact Phone</label>
                        <input
                            type="text"
                            className="form-input text-sm"
                            value={contactPhone}
                            onChange={e => setContactPhone(e.target.value)}
                            placeholder="08X-XXX-XXXX"
                        />
                    </div>
                    <div>
                        <label className="form-label">Contact Email</label>
                        <input
                            type="email"
                            className="form-input text-sm"
                            value={contactEmail}
                            onChange={e => setContactEmail(e.target.value)}
                            placeholder="leader@example.com"
                        />
                    </div>
                </div>

                <div>
                    <label className="form-label">Note</label>
                    <textarea
                        className="form-input text-sm w-full"
                        rows={2}
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Internal notes..."
                    />
                </div>

            </form>
        </PmsModal>
    );
}
