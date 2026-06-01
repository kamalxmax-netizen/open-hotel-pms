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
const QUEUE_STORAGE_KEY = "pms.ui-event-log.queue-v1";
const CAPTURE_STATUS_ENDPOINT = "/api/ui-event-logs/capture-status";
const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
const FLUSH_BATCH_SIZE = 50;
const MAX_BATCH_EVENTS = 200;
const PENDING_CAPTURE_MAX_EVENTS = 100;
const QUEUE_MAX_EVENTS = 500;
const QUEUE_MAX_BYTES = 2 * 1024 * 1024;

const recentEvents = new Map<string, number>();
const eventQueue: UiEventPayload[] = [];
const pendingCaptureEvents: UiEventPayload[] = [];
let flushTimer: number | null = null;
let flushInFlight = false;
let serverCaptureEnabled: boolean | null = null;
let captureStatusInFlight: Promise<boolean> | null = null;

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

function loadPersistedQueue(): UiEventPayload[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as UiEventPayload[];
  } catch {
    return [];
  }
}

function trimQueue(queue: UiEventPayload[]): UiEventPayload[] {
  let trimmed = queue.slice(Math.max(0, queue.length - QUEUE_MAX_EVENTS));
  let serialized = JSON.stringify(trimmed);
  while (serialized.length > QUEUE_MAX_BYTES && trimmed.length > 0) {
    trimmed = trimmed.slice(Math.ceil(trimmed.length / 4));
    serialized = JSON.stringify(trimmed);
  }
  return trimmed;
}

function persistQueue(queue: UiEventPayload[]): UiEventPayload[] {
  const trimmed = trimQueue(queue);
  if (typeof window === "undefined") return trimmed;
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage failures
  }
  return trimmed;
}

function replaceQueue(queue: UiEventPayload[]): UiEventPayload[] {
  const next = persistQueue(queue);
  eventQueue.length = 0;
  eventQueue.push(...next);
  return next;
}

function buildQueuedPayload(payload: UiEventPayload): UiEventPayload {
  const capturedAt = new Date().toISOString();
  const clientEventId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${capturedAt}-${Math.random().toString(36).slice(2)}`;

  return {
    ...payload,
    metadata: {
      ...(payload.metadata ?? {}),
      captured_at: capturedAt,
      client_event_id: clientEventId,
    },
  };
}

function isCaptureAllowed(): boolean {
  if (!EGRESS_STRICT_MODE) return true;
  if (isUiEventLogManualCaptureEnabled()) return true;
  return serverCaptureEnabled === true;
}

function shouldAlwaysCapture(payload: UiEventPayload): boolean {
  return payload.event_type === "auth_activity";
}

function queueCapturedEvent(payload: UiEventPayload): UiEventPayload[] {
  return replaceQueue([...loadPersistedQueue(), payload]);
}

function releasePendingCaptureEvents(): UiEventPayload[] {
  if (pendingCaptureEvents.length === 0) return loadPersistedQueue();
  const pending = pendingCaptureEvents.splice(0, pendingCaptureEvents.length);
  return replaceQueue([...loadPersistedQueue(), ...pending]);
}

function queuePendingCaptureEvent(payload: UiEventPayload): void {
  pendingCaptureEvents.push(payload);
  if (pendingCaptureEvents.length > PENDING_CAPTURE_MAX_EVENTS) {
    pendingCaptureEvents.splice(0, pendingCaptureEvents.length - PENDING_CAPTURE_MAX_EVENTS);
  }
}

function loadServerCaptureStatus(): void {
  if (typeof window === "undefined") return;
  if (!EGRESS_STRICT_MODE || isUiEventLogManualCaptureEnabled()) return;
  if (serverCaptureEnabled !== null || captureStatusInFlight) return;

  captureStatusInFlight = fetch(CAPTURE_STATUS_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok) return false;
      const payload = await res.json().catch(() => null);
      return payload?.capture_enabled === true;
    })
    .then((enabled) => {
      serverCaptureEnabled = enabled;
      if (!enabled) {
        pendingCaptureEvents.length = 0;
        return enabled;
      }

      const nextQueue = releasePendingCaptureEvents();
      ensureFlushTimer();
      if (nextQueue.length >= FLUSH_BATCH_SIZE) {
        flushQueue();
      }
      return enabled;
    })
    .catch(() => {
      serverCaptureEnabled = false;
      pendingCaptureEvents.length = 0;
      return false;
    })
    .finally(() => {
      captureStatusInFlight = null;
    });
}

function flushQueue(keepalive = false): void {
  if (flushInFlight) return;

  const queued = loadPersistedQueue();
  const currentQueue = queued.length > 0 ? queued : eventQueue.slice();
  if (currentQueue.length === 0) return;

  const captureAllowed = isCaptureAllowed() || currentQueue.some(shouldAlwaysCapture);
  if (!captureAllowed) {
    loadServerCaptureStatus();
    return;
  }

  const batchLimit = keepalive ? FLUSH_BATCH_SIZE : MAX_BATCH_EVENTS;
  const batch = currentQueue.slice(0, batchLimit);

  const body = JSON.stringify({ events: batch });
  const headers = {
    "Content-Type": "application/json",
    "X-PMS-UI-Event-Log-Manual": captureAllowed ? "1" : "0",
  };

  flushInFlight = true;
  let shouldFlushAgain = false;
  void fetch("/api/ui-event-logs/batch", {
    method: "POST",
    headers,
    body,
    keepalive,
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      if (!payload?.success) return;
      const remaining = replaceQueue(loadPersistedQueue().slice(batch.length));
      shouldFlushAgain = !keepalive && remaining.length >= FLUSH_BATCH_SIZE;
    })
    .catch(() => {
      // Keep the queue for the next retry.
    })
    .finally(() => {
      flushInFlight = false;
      if (shouldFlushAgain) flushQueue();
    });
}

function ensureFlushTimer(): void {
  if (typeof window === "undefined" || flushTimer !== null) return;
  flushTimer = window.setInterval(() => flushQueue(), FLUSH_INTERVAL_MS);

  window.addEventListener("pagehide", () => flushQueue(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushQueue(true);
  });
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

    const queuedPayload = buildQueuedPayload(payload);
    const captureAllowed = isCaptureAllowed() || shouldAlwaysCapture(payload);
    if (!captureAllowed) {
      if (EGRESS_STRICT_MODE && serverCaptureEnabled === null) {
        queuePendingCaptureEvent(queuedPayload);
        loadServerCaptureStatus();
      }
      return;
    }

    const nextQueue = queueCapturedEvent(queuedPayload);
    ensureFlushTimer();

    if (nextQueue.length >= FLUSH_BATCH_SIZE) {
      flushQueue();
    }
  } catch {
    // ignore client logging failures
  }
}

export async function logUiEventNow(payload: UiEventPayload): Promise<void> {
  const queuedPayload = buildQueuedPayload(payload);
  try {
    const captureAllowed = isCaptureAllowed() || shouldAlwaysCapture(payload);
    if (!captureAllowed) {
      logUiEvent(payload);
      return;
    }

    const response = await fetch("/api/ui-event-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PMS-UI-Event-Log-Manual": captureAllowed ? "1" : "0",
      },
      body: JSON.stringify(queuedPayload),
      credentials: "include",
    });
    if (!response.ok) {
      queueCapturedEvent(queuedPayload);
      ensureFlushTimer();
    }
  } catch {
    queueCapturedEvent(queuedPayload);
    ensureFlushTimer();
  }
}
