"use client";

import { useState, useEffect, useRef } from "react";
import { Camera, CameraOff, X, ImagePlus, Loader2 } from "lucide-react";
import { compressImageForUpload } from "@/lib/client-image-compression";

interface Room {
    id: string;
    room_number: string;
    guest_name: string | null;
    reservation_id: string | null;
}

interface LfReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function LfReportModal({ isOpen, onClose, onSuccess }: LfReportModalProps) {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state
    const [roomId, setRoomId] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("general");
    const [locationDetail, setLocationDetail] = useState("");
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            // Fetch rooms
            fetch("/api/lost-found/rooms", { cache: "no-store" })
                .then(res => res.json())
                .then(data => {
                    if (data?.success && Array.isArray(data.rooms)) setRooms(data.rooms);
                })
                .catch(console.error);
        } else {
            // Reset state
            setRoomId("");
            setDescription("");
            setCategory("general");
            setLocationDetail("");
            setPhoto(null);
            setPhotoPreview(null);
            setError(null);
        }
    }, [isOpen]);

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Preview
        const objectUrl = URL.createObjectURL(file);
        setPhotoPreview(objectUrl);
        setPhoto(file);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim()) {
            setError("Item Description is required.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            // 1. Create item
            const selectedRoom = rooms.find((r) => r.id === roomId) || null;
            const res = await fetch("/api/lost-found", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_id: selectedRoom?.id ?? null,
                    description: description.trim(),
                    category,
                    location_detail: locationDetail.trim() || null,
                    reservation_id: selectedRoom?.reservation_id ?? null,
                    found_by: "Frontdesk",
                })
            });

            if (!res.ok) throw new Error("Failed to report item");
            const data = await res.json();
            const itemId = data.item.id;

            // 2. Upload photo if exists
            if (photo) {
                const resizedFile = await compressImageForUpload(photo, { maxBytes: 5 * 1024 * 1024 });
                const formData = new FormData();
                formData.append("image", resizedFile, resizedFile.name);
                formData.append("item_id", itemId);

                const uploadRes = await fetch("/api/lost-found/upload", {
                    method: "POST",
                    body: formData
                });
                
                if (!uploadRes.ok) {
                    const uploadJson = await uploadRes.json().catch(() => null);
                    console.error("Photo upload failed", uploadJson);
                    throw new Error(uploadJson?.error || "Photo upload failed");
                }
            }

            onSuccess();
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-panel md">
                <div className="modal-header">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">Report Lost & Found</h2>
                    <button onClick={onClose} className="rounded-full p-1.5 hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit}>
                    <div className="modal-body space-y-4">
                        {error && <div className="p-3 bg-rose-50 text-rose-600 rounded border border-rose-100 text-sm font-medium">{error}</div>}

                        <div>
                            <label className="form-label">Room</label>
                            <select className="form-input" value={roomId} onChange={e => setRoomId(e.target.value)}>
                                <option value="">No room</option>
                                {rooms.map(r => (
                                    <option key={r.id} value={r.id}>
                                        Room {r.room_number}{r.guest_name ? ` - ${r.guest_name}` : ""}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                                Select &quot;No room&quot; when Front Desk found the item outside a checked-out room.
                            </p>
                        </div>

                        <div>
                            <label className="form-label">Item Description <span className="text-rose-500">*</span></label>
                            <textarea 
                                className="form-input min-h-[80px] resize-none"
                                placeholder="E.g. Black leather wallet, Apple iPhone charger..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="form-label">Category</label>
                                <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                                    <option value="general">General</option>
                                    <option value="electronics">Electronics</option>
                                    <option value="clothing">Clothing</option>
                                    <option value="documents">Documents</option>
                                    <option value="valuables">Valuables</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="form-label">Location Found (Optional)</label>
                                <input 
                                    type="text"
                                    className="form-input"
                                    placeholder="E.g. Under the bed"
                                    value={locationDetail}
                                    onChange={(e) => setLocationDetail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="form-label">Photo (Optional)</label>
                            <input 
                                type="file"
                                accept="image/*"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handlePhotoChange}
                            />
                            
                            {photoPreview ? (
                                <div className="relative w-full h-40 bg-[var(--bg-muted)] rounded-lg border border-[var(--border-subtle)] overflow-hidden group">
                                    <img src={photoPreview} alt="Preview" className="w-full h-full object-contain" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary bg-white text-slate-800 hover:bg-slate-100">
                                            Change
                                        </button>
                                        <button type="button" onClick={() => { setPhoto(null); setPhotoPreview(null); }} className="btn-primary bg-rose-500 hover:bg-rose-600 border-none">
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button 
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full h-24 border-2 border-dashed border-[var(--border-strong)] rounded-lg flex flex-col items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-brand-500 hover:border-brand-400 transition-colors"
                                >
                                    <ImagePlus className="w-6 h-6 mb-1" />
                                    <span className="text-sm font-semibold">Click to upload photo</span>
                                </button>
                            )}
                        </div>
                    </div>
                    
                    <div className="modal-footer bg-[var(--bg-body)]">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-ghost font-semibold">
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting} className="btn-primary font-bold">
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                    Submitting...
                                </>
                            ) : "Submit Report"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
