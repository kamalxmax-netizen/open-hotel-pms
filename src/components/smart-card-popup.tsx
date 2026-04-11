"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logUiEvent } from "@/lib/ui-event-log-client";

type ReaderState = "connecting" | "waiting" | "reading" | "done" | "error";

type ThaiCardPayload = {
  citizenId: string;
  titleTH: string;
  firstNameTH: string;
  lastNameTH: string;
  titleEN: string;
  firstNameEN: string;
  lastNameEN: string;
  birthday: string;
  gender: string;
  address: string;
  province: string;
  issue: string;
  expire: string;
};

type IncomingPayload = {
  event?: string;
  step?: number;
  total?: number;
  message?: string;
  status?: string;
  citizenId?: string;
  titleTH?: string;
  firstNameTH?: string;
  lastNameTH?: string;
  titleEN?: string;
  firstNameEN?: string;
  lastNameEN?: string;
  birthday?: string;
  gender?: string;
  address?: string;
  province?: string;
  issue?: string;
  expire?: string;
};

function buildWsEndpoints(hostname: string): string[] {
  const candidates = ["ws://127.0.0.1:3001", "ws://localhost:3001"];
  const normalizedHost = String(hostname || "").trim();
  if (normalizedHost && normalizedHost !== "127.0.0.1" && normalizedHost !== "localhost") {
    candidates.unshift(`ws://${normalizedHost}:3001`);
  }
  return Array.from(new Set(candidates));
}

function normalizeGender(raw: string): string {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "male" || value === "m" || value === "1") return "M";
  if (value === "female" || value === "f" || value === "2") return "F";
  return "Other";
}

function formatName(title: string, firstName: string, lastName: string): string {
  return [title, firstName, lastName].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const THAI_NAME_PREFIXES = [
  "ร้อยตำรวจเอก", "ร้อยตำรวจโท", "ร้อยตำรวจตรี",
  "พันตำรวจเอก", "พันตำรวจโท", "พันตำรวจตรี",
  "พลตำรวจเอก", "พลตำรวจโท", "พลตำรวจตรี", "พลตำรวจจัตวา",
  "ร้อยเอก", "ร้อยโท", "ร้อยตรี",
  "พันเอก", "พันโท", "พันตรี",
  "พลเอก", "พลโท", "พลตรี",
  "พล.ต.อ.", "พล.ต.ท.", "พล.ต.ต.", "พล.ต.จ.",
  "พ.ต.อ.", "พ.ต.ท.", "พ.ต.ต.",
  "ร.ต.อ.", "ร.ต.ท.", "ร.ต.ต.",
  "จ.ส.ต.", "ส.ต.อ.", "ส.ต.ท.", "ส.ต.ต.", "ด.ต.",
  "พล.อ.", "พล.ท.", "พล.ต.",
  "พ.อ.", "พ.ท.", "พ.ต.",
  "ร.อ.", "ร.ท.", "ร.ต.",
  "น.อ.", "น.ท.", "น.ต.",
  "จ.ส.อ.", "จ.ส.ท.", "จ.ส.ต.",
  "พ.อ.อ.", "พ.อ.ท.", "พ.อ.ต.",
  "ส.อ.", "ส.ท.", "ส.ต.",
  "จ.อ.", "จ.ท.", "จ.ต.",
  "นาย", "นางสาว", "นาง", "เด็กชาย", "เด็กหญิง",
  "ดร.", "ศ.", "รศ.", "ผศ.", "นพ.", "พญ.",
];

const THAI_NAME_PREFIX_PATTERN = new RegExp(
  `^(?:${THAI_NAME_PREFIXES.sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})(?:\\s*หญิง)?(?:\\s+|$)`,
  "u"
);

function stripLeadingThaiNamePrefixes(value: string): string {
  let next = String(value || "").replace(/\s+/g, " ").trim();
  let previous = "";
  while (next && next !== previous) {
    previous = next;
    next = next.replace(THAI_NAME_PREFIX_PATTERN, "").trim();
  }
  return next;
}

function buildThaiCardNameParts(title: unknown, firstName: unknown, lastName: unknown): { firstName: string; lastName: string } {
  const normalized = stripLeadingThaiNamePrefixes(
    [title, firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ")
  );
  const parts = normalized.split(/\s+/u).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function extractLastProvinceToken(raw: unknown): string {
  const normalized = String(raw || "").replace(/#/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const withoutPostalCode = normalized.replace(/\s+\d{5}$/u, "").trim();
  if (!withoutPostalCode) return "";

  const tokens = withoutPostalCode.split(/\s+/u);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i]
      .replace(/^(จังหวัด|จ\.?)/u, "")
      .replace(/[,\-]/g, "")
      .trim();
    const thaiWord = token.replace(/[^ก-๙]/gu, "").trim();
    if (thaiWord) return thaiWord;
  }
  return "";
}

function extractThaiProvince(rawAddress: string, explicitProvince?: string): string {
  const fromAddress = extractLastProvinceToken(rawAddress);
  if (fromAddress) return fromAddress;
  return extractLastProvinceToken(explicitProvince);
}

function closePopupWindow() {
  const attemptClose = () => {
    try {
      window.close();
    } catch {
      // ignore close failures
    }
  };

  attemptClose();
  window.setTimeout(attemptClose, 150);
  window.setTimeout(attemptClose, 500);
}

function shouldCloseFromMessage(data: unknown, requestId?: string): boolean {
  if (!data || typeof data !== "object") return false;
  const type = "type" in data ? String((data as { type?: unknown }).type || "") : "";
  const messageRequestId =
    "requestId" in (data as Record<string, unknown>)
      ? String((data as { requestId?: unknown }).requestId || "")
      : "";
  if (requestId && messageRequestId && messageRequestId !== requestId) return false;
  return type === "PMS_THAI_CARD_IMPORTED" || type === "PMS_THAI_CARD_CLOSE";
}

function publishSmartCardChannelMessage(message: Record<string, unknown>) {
  if (typeof window === "undefined" || typeof window.BroadcastChannel === "undefined") return;
  try {
    const channel = new window.BroadcastChannel("pms-smart-card");
    channel.postMessage(message);
    channel.close();
  } catch {
    // ignore broadcast failures
  }
}

export default function SmartCardPopup() {
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const importTarget = searchParams?.get("target") === "accompany" ? "accompany" : "main";
  const requestId = searchParams?.get("request_id") || searchParams?.get("t") || "";
  const [wsEndpoints, setWsEndpoints] = useState<string[]>(["ws://127.0.0.1:3001", "ws://localhost:3001"]);
  const [readerState, setReaderState] = useState<ReaderState>("connecting");
  const [statusText, setStatusText] = useState("Connecting to Thai Card Service...");
  const [progress, setProgress] = useState(0);
  const [cardData, setCardData] = useState<ThaiCardPayload | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [endpoint, setEndpoint] = useState<string>("ws://127.0.0.1:3001");
  const [isHttpsPage, setIsHttpsPage] = useState(false);
  const [endpointInput, setEndpointInput] = useState("");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoConfirmedRef = useRef(false);
  const readingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trace = (eventName: string, message?: string, metadata?: Record<string, unknown>, severity: "info" | "warning" | "error" = "info") => {
    logUiEvent({
      pathname: window.location.pathname,
      event_type: "smart_card",
      event_name: eventName,
      severity,
      request_id: requestId || null,
      entity_type: "smart_card_popup",
      entity_id: importTarget,
      message: message ? `${message}${requestId ? ` [${requestId}]` : ""}` : (requestId ? `[${requestId}]` : null),
      metadata: {
        target: importTarget,
        request_id: requestId || null,
        ...metadata,
      },
    });
  };

  const clearReadingTimeout = () => {
    if (readingTimeoutRef.current) {
      clearTimeout(readingTimeoutRef.current);
      readingTimeoutRef.current = null;
    }
  };

  const armReadingTimeout = () => {
    clearReadingTimeout();
    readingTimeoutRef.current = setTimeout(() => {
      setReaderState("error");
      setProgress(0);
      setStatusText("Read timed out. Please remove and reinsert the card.");
      autoConfirmedRef.current = false;
    }, 15000);
  };

  const saveEndpoint = (value: string) => {
    const next = String(value || "").trim();
    if (!next) return;
    try {
      window.localStorage.setItem("pms.smartcard.wsEndpoint", next);
    } catch {
      // ignore storage failures
    }
    if (window.opener) {
      window.opener.postMessage(
        { type: "PMS_THAI_CARD_WS_ENDPOINT", endpoint: next },
        window.location.origin
      );
    }
  };

  useEffect(() => {
    trace("popup_loaded", "Smart card popup loaded");
    setIsHttpsPage(window.location.protocol === "https:");
    const queryWs = new URLSearchParams(window.location.search).get("ws");
    let savedWs = "";
    try {
      savedWs = window.localStorage.getItem("pms.smartcard.wsEndpoint") || "";
    } catch {
      savedWs = "";
    }
    const hostEndpoints = buildWsEndpoints(window.location.hostname);
    const nextEndpoints = Array.from(
      new Set([queryWs || "", savedWs || "", ...hostEndpoints].map((v) => String(v || "").trim()).filter(Boolean))
    );
    setWsEndpoints(nextEndpoints);
    if (nextEndpoints.length > 0) setEndpoint(nextEndpoints[0]);
    if (savedWs) setEndpointInput(savedWs);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!shouldCloseFromMessage(event.data, requestId)) return;
      trace("popup_close_message_received", "Popup received close message", { source: "postMessage" });
      closePopupWindow();
    };

    let channel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined") {
      channel = new window.BroadcastChannel("pms-smart-card");
      channel.onmessage = (event) => {
        if (!shouldCloseFromMessage(event.data, requestId)) return;
        trace("popup_close_message_received", "Popup received close message", { source: "broadcast_channel" });
        closePopupWindow();
      };
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      channel?.close();
    };
  }, [requestId]);

  useEffect(() => {
    if (wsEndpoints.length === 0) return;
    let ws: WebSocket | null = null;
    let closed = false;

    const connect = (index: number) => {
      if (closed) return;
      const nextIndex = index % wsEndpoints.length;
      const selectedEndpoint = wsEndpoints[nextIndex];
      setEndpoint(selectedEndpoint);
      setReaderState("connecting");
      setStatusText(`Connecting to ${selectedEndpoint} ...`);
      ws = new WebSocket(selectedEndpoint);

      ws.onopen = () => {
        setSocketConnected(true);
        setReaderState("waiting");
        setStatusText("Connected. Waiting for reader/card...");
        saveEndpoint(selectedEndpoint);
        trace("popup_ws_connected", "Popup websocket connected", { endpoint: selectedEndpoint });
      };

      ws.onmessage = (event) => {
        let payload: IncomingPayload | null = null;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          payload = null;
        }
        if (!payload?.event) return;
        if (autoConfirmedRef.current && payload.event !== "service_status") return;

        if (payload.event === "service_status") {
          const serviceStatus = String(payload.status || "");
          if (serviceStatus === "pcsc_unavailable") {
            setReaderState("waiting");
            setStatusText("Service connected, but card daemon is unavailable. Check reader/driver.");
          }
          return;
        }

        if (payload.event === "reader_ready") {
          setReaderState("waiting");
          setStatusText("Reader ready. Insert card.");
          return;
        }

        if (payload.event === "card_inserted") {
          setReaderState("reading");
          setProgress(0);
          setCardData(null);
          setStatusText("Card inserted. Reading...");
          autoConfirmedRef.current = false;
          armReadingTimeout();
          trace("popup_card_inserted", "Card inserted");
          return;
        }

        if (payload.event === "progress") {
          const step = Number(payload.step ?? 0);
          const total = Number(payload.total ?? 0);
          const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((step / total) * 100))) : 0;
          setReaderState("reading");
          setProgress(pct);
          setStatusText(`Reading... ${pct}%`);
          armReadingTimeout();
          if (pct >= 100) {
            trace("popup_progress_100", "Popup reached 100% progress", { step, total });
          }
          return;
        }

        if (payload.event === "card_data") {
          clearReadingTimeout();
          const normalizedAddress = String(payload.address || "").replace(/#/g, " ").trim();
          const thaiName = buildThaiCardNameParts(payload.titleTH, payload.firstNameTH, payload.lastNameTH);
          const nextData: ThaiCardPayload = {
            citizenId: String(payload.citizenId || "").trim(),
            titleTH: String(payload.titleTH || "").trim(),
            firstNameTH: thaiName.firstName || String(payload.firstNameTH || "").trim(),
            lastNameTH: thaiName.lastName || String(payload.lastNameTH || "").trim(),
            titleEN: String(payload.titleEN || "").trim(),
            firstNameEN: String(payload.firstNameEN || "").trim(),
            lastNameEN: String(payload.lastNameEN || "").trim(),
            birthday: String(payload.birthday || "").trim(),
            gender: normalizeGender(String(payload.gender || "")),
            address: normalizedAddress,
            province: extractThaiProvince(normalizedAddress, String(payload.province || "").trim()),
            issue: String(payload.issue || "").trim(),
            expire: String(payload.expire || "").trim(),
          };
          setCardData(nextData);
          setReaderState("done");
          setProgress(100);
          setStatusText("Read complete. Sending data...");
          trace("popup_card_data_received", "Popup received complete card data", {
            citizen_id_suffix: nextData.citizenId.slice(-4),
          });
          if (!autoConfirmedRef.current) {
            autoConfirmedRef.current = true;
            const message = {
              type: "PMS_THAI_CARD_CONFIRMED",
              target: importTarget,
              requestId,
              payload: nextData,
            };
            if (window.opener) {
              window.opener.postMessage(message, window.location.origin);
              trace("popup_confirm_sent", "Popup sent confirm to opener", { channel: "postMessage" });
            }
            publishSmartCardChannelMessage(message);
            trace("popup_confirm_sent", "Popup sent confirm to opener", { channel: "broadcast_channel" });
            closePopupWindow();
          }
          return;
        }

        if (payload.event === "reading_fail" || payload.event === "device_error" || payload.event === "error") {
          clearReadingTimeout();
          setReaderState("error");
          setProgress(0);
          setCardData(null);
          setStatusText(String(payload.message || "Unable to read card. Please try again."));
          autoConfirmedRef.current = false;
          trace("popup_reader_error", String(payload.message || "Unable to read card."), { event: payload.event }, "error");
          return;
        }

        if (payload.event === "card_removed") {
          clearReadingTimeout();
          setReaderState("waiting");
          setProgress(0);
          setCardData(null);
          setStatusText("Card removed. Insert card.");
          autoConfirmedRef.current = false;
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onclose = () => {
        setSocketConnected(false);
        setReaderState("error");
        setStatusText(`Disconnected from ${selectedEndpoint}. Retrying...`);
        if (!autoConfirmedRef.current) {
          trace("popup_ws_closed", "Popup websocket closed before completion", { endpoint: selectedEndpoint }, "warning");
        }
        if (closed) return;
        reconnectTimerRef.current = setTimeout(() => connect(nextIndex + 1), 1500);
      };
    };

    connect(0);
    return () => {
      closed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearReadingTimeout();
      ws?.close();
    };
  }, [wsEndpoints]);

  const thaiName = useMemo(
    () => (cardData ? formatName(cardData.titleTH, cardData.firstNameTH, cardData.lastNameTH) : ""),
    [cardData]
  );
  const englishName = useMemo(
    () => (cardData ? formatName(cardData.titleEN, cardData.firstNameEN, cardData.lastNameEN) : ""),
    [cardData]
  );

  const handleApplyEndpoint = () => {
    const next = String(endpointInput || "").trim();
    if (!next) return;
    saveEndpoint(next);
    setWsEndpoints((prev) => Array.from(new Set([next, ...prev])));
    setStatusText(`Saved endpoint ${next}. Reconnecting...`);
  };

  return (
    <main className="min-h-screen bg-[var(--bg-surface-hover)] p-4 sm:p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Thai ID Reader</h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              socketConnected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {socketConnected ? "Service Connected" : "Service Offline"}
          </span>
        </div>

        <div className="mb-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-3">
          <p className="text-sm font-medium text-[var(--text-secondary)]">{statusText}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Endpoint: {endpoint}</p>
          {!socketConnected && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Start service: `npm run smartcard:service`</p>
          )}
          {!socketConnected && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Tried endpoints: {wsEndpoints.join(" , ")}
            </p>
          )}
          {!socketConnected && isHttpsPage && (
            <p className="mt-1 text-xs text-amber-700">
              Current page is HTTPS. Browser can block `ws://` to local service. Use HTTP PMS URL on this machine, or
              set a reachable `ws://[machine-ip]:3001` endpoint below.
            </p>
          )}
          {!socketConnected && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={endpointInput}
                onChange={(e) => setEndpointInput(e.target.value)}
                placeholder="ws://127.0.0.1:3001"
                className="w-full rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)]"
              />
              <button
                type="button"
                onClick={handleApplyEndpoint}
                className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
              >
                Apply Endpoint
              </button>
            </div>
          )}
          {(readerState === "reading" || readerState === "done") && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {cardData && (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Citizen ID:</span> {cardData.citizenId}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Thai Name:</span> {thaiName || "-"}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">English Name:</span> {englishName || "-"}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">DOB:</span> {cardData.birthday || "-"}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Gender:</span> {cardData.gender}
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-body)]"
            onClick={() => window.close()}
          >
            Close
          </button>
        </div>
      </div>
    </main>
  );
}
