"use client";

import { useState } from "react";

export function FloorGuardModal({
  price,
  floor,
  roomTypeName,
  onCancel,
  onOverride
}: {
  price: number;
  floor: number;
  roomTypeName: string;
  onCancel: () => void;
  onOverride: (token: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        onOverride(data.token);
      } else {
        setError(data.error || "Invalid PIN");
      }
    } catch {
      setError("Network error");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel max-w-sm">
        <div className="modal-header bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900">
          <h2 className="text-lg font-bold text-rose-800 dark:text-rose-400">Rate Floor Violation</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body space-y-4">
          <div className="text-sm text-[var(--text-secondary)]">
            You are attempting to set the price for <strong>{roomTypeName}</strong> to <strong className="text-rose-600">฿{price.toLocaleString("th-TH")}</strong>, which is below the minimum allowed floor of <strong>฿{floor.toLocaleString("th-TH")}</strong>.
          </div>
          
          {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-200">{error}</div>}
          
          <div>
            <label className="form-label">Admin Override PIN</label>
            <input
              type="password"
              className="form-input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              autoFocus
              required
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-danger flex-1" disabled={verifying || !pin}>
              {verifying ? "Verifying..." : "Override"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
