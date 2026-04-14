"use client";

import { useState } from "react";

type PairingTokenResult = {
  pairing_token: string;
  device_name: string;
  expires_at: string;
};

interface DevicePairingTokenCardProps {
  onGenerate: (input: {
    device_name?: string;
    expires_in_minutes?: number;
  }) => Promise<PairingTokenResult>;
}

export function DevicePairingTokenCard({ onGenerate }: DevicePairingTokenCardProps) {
  const [deviceName, setDeviceName] = useState("");
  const [expiresInMinutes, setExpiresInMinutes] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<PairingTokenResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setCopied(false);
    setLoading(true);
    try {
      const result = await onGenerate({
        device_name: deviceName.trim() || undefined,
        expires_in_minutes: Number(expiresInMinutes || 30),
      });
      setIssued(result);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate pairing token.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!issued?.pairing_token) return;
    try {
      await navigator.clipboard.writeText(issued.pairing_token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="card">
      <div className="border-b border-[var(--border-default)] px-5 py-4">
        <h3 className="text-sm font-bold">Device Pairing Token</h3>
      </div>
      <div className="flex flex-col gap-5 p-5">
        <p className="text-sm text-[var(--text-secondary)]">
          Generate a one-time token for a specific FO device. The token is entered once on <strong>/offline</strong>,
          then that browser receives its own trusted device token.
        </p>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="form-label">Device Label</label>
            <input
              type="text"
              className="form-input"
              placeholder="FO Front Desk PC"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <label className="form-label">Expires In (minutes)</label>
            <input
              type="number"
              min={5}
              max={1440}
              className="form-input"
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(event.target.value)}
              disabled={loading}
            />
          </div>

          {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}

          <button type="submit" className="btn-secondary w-full" disabled={loading}>
            {loading ? "Generating..." : "Generate Pairing Token"}
          </button>
        </form>

        {issued ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  One-time token
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-200">
                  For <strong>{issued.device_name}</strong> until{" "}
                  {new Date(issued.expires_at).toLocaleString("th-TH", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white/80 px-3 py-2 font-mono text-sm tracking-wide text-emerald-900 dark:border-emerald-900/30 dark:bg-black/10 dark:text-emerald-100">
              {issued.pairing_token}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
