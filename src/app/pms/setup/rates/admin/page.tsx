"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type AdminSettings = {
  min_rate_floor: Record<string, number | null>;
  price_delta_warn_threshold: number;
  alarm_minutes: number;
  telegram_admin_chat_id?: string;
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
              onClick={testTelegram}
              disabled={!settings.telegram_admin_chat_id}
              className="btn btn-secondary"
            >
              Test Ping
            </button>
          </div>
        </div>
      </div>

      {toast && <div className="toast-bar toast-success z-50">{toast}</div>}
    </div>
  );
}
