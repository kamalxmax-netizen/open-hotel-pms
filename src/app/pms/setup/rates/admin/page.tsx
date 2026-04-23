"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type AdminSettings = {
  min_rate_floor: Record<string, number | null>;
  price_delta_warn_threshold: number;
  alarm_minutes: number;
  telegram_admin_chat_id?: string;
  dynamic_max_multiplier: number;
  dynamic_eval_window_days: number;
  dynamic_undo_window_minutes: number;
  dynamic_suggestion_stale_minutes: number;
};

type RoomTypeInfo = {
  type_id: string;
  type_name: string;
};

export default function AdminSettingsPage() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeInfo[]>([]);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  useEffect(() => {
    async function load() {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        router.push("/login");
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", session.user.id).single();
      
      if (profile?.role !== "admin") {
        router.push("/pms/setup/rates");
        return;
      }
      setRole("admin");

      try {
        const [setRes, rateRes] = await Promise.all([
          fetch("/api/admin/settings"),
          fetch("/api/rates?start=2026-01-01&end=2026-01-01") // minimal fetch to get room types
        ]);
        
        const setJson = await setRes.json();
        if (setJson) {
          setSettings({
            min_rate_floor: setJson.min_rate_floor || {},
            price_delta_warn_threshold: setJson.price_delta_warn_threshold || 0.20,
            alarm_minutes: setJson.alarm_minutes || 120,
            telegram_admin_chat_id: setJson.telegram_admin_chat_id || "",
            dynamic_max_multiplier: setJson["rate.dynamic_max_multiplier"] ?? 1.5,
            dynamic_eval_window_days: setJson["rate.dynamic_eval_window_days"] ?? 60,
            dynamic_undo_window_minutes: setJson["rate.dynamic_undo_window_minutes"] ?? 60,
            dynamic_suggestion_stale_minutes: setJson["rate.dynamic_suggestion_stale_minutes"] ?? 120,
          });
        }

        const rateJson = await rateRes.json();
        if (rateJson.success && rateJson.room_types) {
          setRoomTypes(rateJson.room_types.map((rt: any) => ({ type_id: rt.type_id, type_name: rt.type_name })));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  async function updateSetting(key: string, value: any) {
    setSaving(key);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value })
      });
      if (!res.ok) throw new Error("Save failed");
      showToast("✓ Saved successfully");
    } catch (err) {
      showToast("❌ Failed to save");
    } finally {
      setSaving(null);
    }
  }

  async function testTelegram() {
    if (!settings?.telegram_admin_chat_id) return;
    try {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: settings.telegram_admin_chat_id,
          text: "🔔 Test ping from OpenHotel PMS Rate Setup."
        })
      });
      if (res.ok) showToast("✓ Ping sent to Telegram");
      else showToast("❌ Failed to send ping");
    } catch (err) {
      showToast("❌ Network error");
    }
  }

  async function registerTelegramWebhook() {
    setSaving("telegram.webhook");
    try {
      const res = await fetch("/api/telegram/webhook/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Webhook registration failed");
      }

      showToast("✓ Telegram webhook registered");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Webhook registration failed";
      showToast(`❌ ${message}`);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="p-6 text-[var(--text-muted)] animate-pulse">Loading settings...</div>;
  if (role !== "admin" || !settings) return null;

  return (
    <div className="max-w-4xl space-y-8 pb-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Admin Only</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Rate Grid & OTA Settings</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Configure guard rails, warnings, and Telegram alerts.</p>
      </div>

      {/* Section 1: Bottom Price per Room Type */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">1. Bottom Price (Min Rate Floor)</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Hard floor for manual rate edits. Entering a price below this requires an Admin PIN.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-1/2">Room Type</th>
                <th>Min Floor (THB)</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {roomTypes.map((rt) => {
                const floorVal = settings.min_rate_floor[rt.type_id] ?? "";
                const isSaving = saving === `room_type.${rt.type_id}.min_rate_floor`;
                return (
                  <tr key={rt.type_id}>
                    <td className="font-medium">{rt.type_name}</td>
                    <td>
                      <div className="relative max-w-[150px]">
                        <span className="absolute left-3 top-2 text-sm text-[var(--text-muted)]">฿</span>
                        <input
                          type="number"
                          className="form-input pl-7"
                          value={floorVal}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSettings(s => s ? { ...s, min_rate_floor: { ...s.min_rate_floor, [rt.type_id]: val ? Number(val) : null } } : s);
                          }}
                          onBlur={() => updateSetting(`room_type.${rt.type_id}.min_rate_floor`, floorVal !== "" ? Number(floorVal) : null)}
                        />
                      </div>
                    </td>
                    <td className="text-right">
                      {isSaving && <span className="text-xs text-brand-500 animate-pulse">Saving...</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Delta Warn Threshold */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">2. Price Change Warning Threshold</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Show a warning modal if a manual price edit jumps by more than this percentage.</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="5"
            max="50"
            step="5"
            className="w-48 accent-brand-500"
            value={Math.round(settings.price_delta_warn_threshold * 100)}
            onChange={(e) => {
              const val = Number(e.target.value) / 100;
              setSettings(s => s ? { ...s, price_delta_warn_threshold: val } : s);
            }}
            onMouseUp={() => updateSetting("rate.price_delta_warn_threshold", settings.price_delta_warn_threshold)}
          />
          <span className="text-lg font-bold text-brand-600">{Math.round(settings.price_delta_warn_threshold * 100)}%</span>
          {saving === "rate.price_delta_warn_threshold" && <span className="text-xs text-brand-500 animate-pulse ml-4">Saving...</span>}
        </div>
      </div>

      {/* Section 3: OTA Alarm Delay */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">3. OTA Sync Alarm Delay</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">How many minutes a sync task can sit in 'pending' before triggering a Telegram alert.</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="number"
            min="30"
            max="480"
            step="10"
            className="form-input w-32"
            value={settings.alarm_minutes}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSettings(s => s ? { ...s, alarm_minutes: val } : s);
            }}
            onBlur={() => updateSetting("ota.alarm_minutes", settings.alarm_minutes)}
          />
          <span className="text-sm text-[var(--text-secondary)]">Minutes</span>
          {saving === "ota.alarm_minutes" && <span className="text-xs text-brand-500 animate-pulse ml-4">Saving...</span>}
        </div>
      </div>

      {/* Section 4: Telegram Setup */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">4. Telegram Alert Configuration</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Set the Chat ID to receive OTA sync delays and system alerts.</p>
        </div>
        <div className="bg-sky-50 border border-sky-200 dark:bg-sky-900/20 dark:border-sky-800 rounded-xl p-4 text-sm text-sky-800 dark:text-sky-300">
          <p className="font-semibold mb-1">How to setup:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the Telegram app and search for your bot.</li>
            <li>Send the command <code>/start</code> to the bot.</li>
            <li>The bot will reply with your Chat ID. Copy and paste it below.</li>
            <li>Click <span className="font-semibold">Register Webhook</span> once after env is configured on the deployed app.</li>
          </ol>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            className="form-input w-64"
            placeholder="e.g. 123456789"
            value={settings.telegram_admin_chat_id || ""}
            onChange={(e) => {
              const val = e.target.value;
              setSettings(s => s ? { ...s, telegram_admin_chat_id: val } : s);
            }}
            onBlur={() => updateSetting("telegram.admin_chat_id", settings.telegram_admin_chat_id)}
          />
          {saving === "telegram.admin_chat_id" && <span className="text-xs text-brand-500 animate-pulse">Saving...</span>}
          <div className="ml-auto">
            <button
              onClick={registerTelegramWebhook}
              disabled={saving === "telegram.webhook"}
              className="btn btn-secondary mr-2"
            >
              {saving === "telegram.webhook" ? "Registering..." : "Register Webhook"}
            </button>
            <button
              onClick={testTelegram}
              disabled={!settings.telegram_admin_chat_id}
              className="btn btn-secondary"
            >
              Test Ping
            </button>
          </div>
        </div>
      </div>

      {/* Section 5: Dynamic Engine */}
      <div className="card p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">5. Dynamic Rules Engine</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Configure global constraints and evaluation parameters for dynamic rates.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--text-primary)]">Max Multiplier Cap</label>
            <p className="text-xs text-[var(--text-muted)]">Max allowed multiple of base price (e.g. 1.5 = +50% cap).</p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.1"
                className="w-48 accent-brand-500"
                value={settings.dynamic_max_multiplier}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSettings(s => s ? { ...s, dynamic_max_multiplier: val } : s);
                }}
                onMouseUp={() => updateSetting("rate.dynamic_max_multiplier", settings.dynamic_max_multiplier)}
              />
              <span className="text-base font-bold text-brand-600">{settings.dynamic_max_multiplier.toFixed(1)}x</span>
              {saving === "rate.dynamic_max_multiplier" && <span className="text-xs text-brand-500 animate-pulse ml-2">Saving...</span>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--text-primary)]">Evaluation Window (days)</label>
            <p className="text-xs text-[var(--text-muted)]">Look-ahead window for daily scheduled evaluations.</p>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="7"
                max="120"
                className="form-input w-24"
                value={settings.dynamic_eval_window_days}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSettings(s => s ? { ...s, dynamic_eval_window_days: val } : s);
                }}
                onBlur={() => updateSetting("rate.dynamic_eval_window_days", settings.dynamic_eval_window_days)}
              />
              <span className="text-sm text-[var(--text-secondary)]">Days</span>
              {saving === "rate.dynamic_eval_window_days" && <span className="text-xs text-brand-500 animate-pulse ml-2">Saving...</span>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--text-primary)]">Undo Window (minutes)</label>
            <p className="text-xs text-[var(--text-muted)]">Time allowed to revert an applied rate.</p>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="5"
                max="240"
                className="form-input w-24"
                value={settings.dynamic_undo_window_minutes}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSettings(s => s ? { ...s, dynamic_undo_window_minutes: val } : s);
                }}
                onBlur={() => updateSetting("rate.dynamic_undo_window_minutes", settings.dynamic_undo_window_minutes)}
              />
              <span className="text-sm text-[var(--text-secondary)]">Minutes</span>
              {saving === "rate.dynamic_undo_window_minutes" && <span className="text-xs text-brand-500 animate-pulse ml-2">Saving...</span>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--text-primary)]">Suggestion Staleness</label>
            <p className="text-xs text-[var(--text-muted)]">Pending time before triggering an alert.</p>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="30"
                max="720"
                className="form-input w-24"
                value={settings.dynamic_suggestion_stale_minutes}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSettings(s => s ? { ...s, dynamic_suggestion_stale_minutes: val } : s);
                }}
                onBlur={() => updateSetting("rate.dynamic_suggestion_stale_minutes", settings.dynamic_suggestion_stale_minutes)}
              />
              <span className="text-sm text-[var(--text-secondary)]">Minutes</span>
              {saving === "rate.dynamic_suggestion_stale_minutes" && <span className="text-xs text-brand-500 animate-pulse ml-2">Saving...</span>}
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="toast-bar toast-success z-50">{toast}</div>}
    </div>
  );
}
