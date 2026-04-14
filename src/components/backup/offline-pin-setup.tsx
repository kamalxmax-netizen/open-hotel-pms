"use client";

import { useState } from "react";
import { hashSHA256 } from "@/lib/crypto";

interface OfflinePinSetupProps {
  currentPinSet: boolean;
  onUpdate: (rawPin: string) => Promise<void>;
  viewerUrl: string;
}

export function OfflinePinSetup({ currentPinSet, onUpdate, viewerUrl }: OfflinePinSetupProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
      setError("PIN must be 4 digits");
      return;
    }

    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }

    setLoading(true);
    try {
      await onUpdate(pin);
      const hashed = await hashSHA256(pin);
      localStorage.setItem("pms_offline_pin_hash", hashed);
      setSuccess(true);
      setPin("");
      setConfirmPin("");
    } catch (err: any) {
      setError(err.message || "Failed to update PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="border-b border-[var(--border-default)] px-5 py-4">
        <h3 className="text-sm font-bold">Offline Security</h3>
      </div>
      <div className="flex flex-col gap-6 p-5">
        <div>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            Set a 4-digit PIN to access the <strong>Offline Emergency Viewer</strong>. The server stores only the
            SHA-256 hash. This device caches the hash locally so the viewer can keep working offline.
          </p>

          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/10 dark:text-amber-300">
            <p className="mb-1 font-bold">Offline Viewer</p>
            <p>
              Open here:{" "}
              <a href={viewerUrl} target="_blank" rel="noreferrer" className="font-mono underline">
                {viewerUrl}
              </a>
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-xs space-y-4">
          <div>
            <label className="form-label">New 4-Digit PIN</label>
            <input
              type="password"
              maxLength={4}
              placeholder="••••"
              className="form-input text-center font-mono text-lg tracking-widest"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              disabled={loading}
            />
          </div>
          <div>
            <label className="form-label">Confirm PIN</label>
            <input
              type="password"
              maxLength={4}
              placeholder="••••"
              className="form-input text-center font-mono text-lg tracking-widest"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              disabled={loading}
            />
          </div>

          {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}
          {success ? <p className="text-xs font-medium text-emerald-500">PIN updated successfully!</p> : null}

          <button type="submit" className="btn-primary w-full" disabled={loading || pin.length !== 4}>
            {loading ? "Updating..." : currentPinSet ? "Change PIN" : "Set Initial PIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
