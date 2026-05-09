"use client";

import { EGRESS_STRICT_MODE } from "@/lib/egress-strict-mode";

type UiEventSeverity = "info" | "warning" | "error";

type UiEventPayload = {
  pathname: string;
  event_type: string;
  event_name: string;
  severity?: UiEventSeverity;
  entity_type?: string | null;
  entity_id?: string | null;
  request_id?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
};

const RECENT_EVENT_WINDOW_MS = 1500;
const MANUAL_CAPTURE_KEY = "pms.ui-event-log.manual-capture-enabled";
const recentEvents = new Map<string, number>();

export function isUiEventLogManualCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MANUAL_CAPTURE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setUiEventLogManualCaptureEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(MANUAL_CAPTURE_KEY, "1");
    } else {
      window.localStorage.removeItem(MANUAL_CAPTURE_KEY);
    }
    window.dispatchEvent(new Event("pms-ui-event-log-manual-capture-change"));
  } catch {
    // ignore localStorage failures
  }
}

function buildSignature(payload: UiEventPayload): string {
  return JSON.stringify([
    payload.pathname,
    payload.event_type,
    payload.event_name,
    payload.message ?? "",
    payload.metadata?.["label"] ?? "",
    payload.metadata?.["href"] ?? "",
  ]);
}

export function logUiEvent(payload: UiEventPayload): void {
  const manualCaptureEnabled = isUiEventLogManualCaptureEnabled();
  if (EGRESS_STRICT_MODE && !manualCaptureEnabled) return;

  try {
    const signature = buildSignature(payload);
    const now = Date.now();
    const lastSeen = recentEvents.get(signature) ?? 0;
    if (now - lastSeen < RECENT_EVENT_WINDOW_MS) return;
    recentEvents.set(signature, now);

    window.setTimeout(() => {
      for (const [key, timestamp] of recentEvents.entries()) {
        if (now - timestamp > RECENT_EVENT_WINDOW_MS * 3) {
          recentEvents.delete(key);
        }
      }
    }, RECENT_EVENT_WINDOW_MS * 2);

    void fetch("/api/ui-event-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PMS-UI-Event-Log-Manual": manualCaptureEnabled ? "1" : "0",
      },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "include",
    });
  } catch {
    // ignore client logging failures
  }
}
