"use client";

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
const recentEvents = new Map<string, number>();

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "include",
    });
  } catch {
    // ignore client logging failures
  }
}
