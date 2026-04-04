"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, ImagePlus, Loader2, Info } from "lucide-react";

interface ReportRoom {
    id: string;
    room_number: string;
    guest_name: string | null;
    reservation_id: string | null;
}

interface LfReportSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function LfReportSheet({ isOpen, onClose, onSuccess }: LfReportSheetProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rooms, setRooms] = useState<ReportRoom[]>([]);

    const [roomId, setRoomId] = useState("");
    const [description, setDescription] = useState("");
    const [locationDetail, setLocationDetail] = useState("");
    const [category, setCategory] = useState("general");
    const [photo, setPhoto] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        fetch("/api/lost-found/rooms", { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
                if (data?.success && Array.isArray(data.rooms)) {
                    setRooms(data.rooms);
                } else {
                    setRooms([]);
                }
            })
            .catch(() => setRooms([]));
    }, [isOpen]);

    const handleClose = () => {
        // Reset states
        setRoomId("");
        setDescription("");
        setLocationDetail("");
        setCategory("general");
        setPhoto(null);
        setPhotoPreview(null);
        setError(null);
        setRooms([]);
        onClose();
    };

    const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setPhoto(file);
        setPhotoPreview(URL.createObjectURL(file));
    };

    const resizeImage = (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const maxWidth = 1200;
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject(new Error("Canvas failure"));
                
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Blob conversion failed"));
                }, "image/webp", 0.7);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!roomId || !description.trim()) {
            setError("Room and Description are required.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const selectedRoom = rooms.find((room) => room.id === roomId) || null;
            const roomNumber = selectedRoom?.room_number || "Unknown";
            
            // 1. Create DB record
            const res = await fetch("/api/lost-found", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    room_id: roomId,
                    description: description.trim(),
                    category,
                    location_detail: locationDetail.trim() || null,
                    reservation_id: selectedRoom?.reservation_id ?? null,
                    found_by: roomNumber ? `Maid (Room ${roomNumber})` : "Maid",
                })
            });

            if (!res.ok) throw new Error("Failed to report item");
            const data = await res.json();
            const itemId = data.item.id;

            // 2. Resize & Upload (only if photo provided)
            if (photo) {
                const resizedBlob = await resizeImage(photo);
                const formData = new FormData();
                formData.append("image", resizedBlob, "photo.webp");
                formData.append("item_id", itemId);

                const uploadRes = await fetch("/api/lost-found/upload", {
                    method: "POST",
                    body: formData
                });

                if (!uploadRes.ok) throw new Error("Photo upload failed");
            }

            onSuccess();
            handleClose();
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={`fixed inset-0 z-[150] transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
            
            <div className={`absolute bottom-0 left-0 right-0 bg-[var(--bg-body)] rounded-t-3xl min-h-[50vh] max-h-[90vh] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.2)] transition-transform duration-300 ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                
                <div className="flex justify-center p-3 shrink-0">
                    <div className="w-12 h-1.5 bg-[var(--border-strong)] rounded-full"></div>
                </div>

                <div className="px-5 pb-3 flex items-center justify-between shrink-0 border-b border-[var(--border-default)]">
                    <h2 className="text-xl font-bold text-[var(--text-primary)]">Report Lost Item</h2>
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-[var(--bg-muted)] text-[var(--text-muted)]">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-3 rounded-lg flex gap-3 text-sm mb-5 border border-blue-100 dark:border-blue-900/50">
                        <Info className="w-5 h-5 shrink-0" />
                        <p>Found something? Report it immediately with a photo to notify the Front Desk.</p>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-rose-50 text-rose-600 rounded-lg text-sm font-semibold border border-rose-100">
                            {error}
                        </div>
                    )}

                    <form id="lf-report-form" onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">Where did you find it? <span className="text-rose-500">*</span></label>
                            <select 
                                className="w-full bg-[var(--bg-muted)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-base text-[var(--text-primary)] font-medium focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none appearance-none"
                                value={roomId}
                                onChange={e => setRoomId(e.target.value)}
                                required
                            >
                                <option value="" disabled>Select Room...</option>
                                {rooms.map((room) => (
                                    <option key={room.id} value={room.id}>
                                        Room {room.room_number}{room.guest_name ? ` - ${room.guest_name}` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">Take a Photo <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
                            
                            <input 
                                type="file"
                                accept="image/*"
                                capture="environment" 
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handlePhotoChange}
                            />

                            {photoPreview ? (
                                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-[var(--border-subtle)]">
                                    <img src={photoPreview} alt="Preview" className="w-full h-full object-contain" />
                                    <button 
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center shadow-lg"
                                    >
                                        <Camera className="w-4 h-4 mr-1.5" />
                                        Retake
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full aspect-video rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/10 flex flex-col items-center justify-center text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                                >
                                    <div className="w-14 h-14 bg-brand-200 dark:bg-brand-800/50 rounded-full flex items-center justify-center mb-3">
                                        <Camera className="w-7 h-7" />
                                    </div>
                                    <span className="font-bold text-lg">Tap to open Camera</span>
                                    <span className="text-sm opacity-80 mt-1">Optional</span>
                                </button>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">What is it? <span className="text-rose-500">*</span></label>
                            <textarea 
                                className="w-full bg-[var(--bg-muted)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-base text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-none min-h-[100px]"
                                placeholder="E.g. A black leather wallet, iPhone charger, keys..."
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                required
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">Category</label>
                                <select 
                                    className="w-full bg-[var(--bg-muted)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] font-medium focus:ring-2 focus:ring-brand-500 outline-none appearance-none"
                                    value={category}
                                    onChange={e => setCategory(e.target.value)}
                                >
                                    <option value="general">General</option>
                                    <option value="electronics">Electronics</option>
                                    <option value="clothing">Clothing</option>
                                    <option value="documents">Documents</option>
                                    <option value="valuables">Valuables</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-[var(--text-primary)] mb-1.5">Specific Location</label>
                                <input 
                                    type="text"
                                    className="w-full bg-[var(--bg-muted)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500 outline-none"
                                    placeholder="E.g. Under pillow"
                                    value={locationDetail}
                                    onChange={e => setLocationDetail(e.target.value)}
                                />
                            </div>
                        </div>

                    </form>
                </div>

                <div className="p-4 border-t border-[var(--border-default)] bg-[var(--bg-surface)] shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button 
                        type="submit" 
                        form="lf-report-form"
                        disabled={isSubmitting}
                        className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold text-lg rounded-xl h-14 flex items-center justify-center shadow-lg shadow-brand-500/20 active:scale-[0.98] transition-transform"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                Submitting...
                            </>
                        ) : "Submit Report"}
                    </button>
                </div>
            </div>
        </div>
    );
}
