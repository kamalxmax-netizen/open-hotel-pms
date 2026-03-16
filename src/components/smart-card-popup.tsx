"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

export default function SmartCardPopup() {
  const importTarget =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("target") === "accompany"
      ? "accompany"
      : "main";
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
      };

      ws.onmessage = (event) => {
        let payload: IncomingPayload | null = null;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          payload = null;
        }
        if (!payload?.event) return;

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
          return;
        }

        if (payload.event === "progress") {
          const step = Number(payload.step ?? 0);
          const total = Number(payload.total ?? 0);
          const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((step / total) * 100))) : 0;
          setReaderState("reading");
          setProgress(pct);
          setStatusText(`Reading... ${pct}%`);
          return;
        }

        if (payload.event === "card_data") {
          const normalizedAddress = String(payload.address || "").replace(/#/g, " ").trim();
          const nextData: ThaiCardPayload = {
            citizenId: String(payload.citizenId || "").trim(),
            titleTH: String(payload.titleTH || "").trim(),
            firstNameTH: String(payload.firstNameTH || "").trim(),
            lastNameTH: String(payload.lastNameTH || "").trim(),
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
          setStatusText("Read complete. Confirm to import.");
          return;
        }

        if (payload.event === "card_removed") {
          setReaderState("waiting");
          setProgress(0);
          setCardData(null);
          setStatusText("Card removed. Insert card.");
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onclose = () => {
        setSocketConnected(false);
        setReaderState("error");
        setStatusText(`Disconnected from ${selectedEndpoint}. Retrying...`);
        if (closed) return;
        reconnectTimerRef.current = setTimeout(() => connect(nextIndex + 1), 1500);
      };
    };

    connect(0);
    return () => {
      closed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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

  const canConfirm = Boolean(cardData?.citizenId);

  const handleApplyEndpoint = () => {
    const next = String(endpointInput || "").trim();
    if (!next) return;
    saveEndpoint(next);
    setWsEndpoints((prev) => Array.from(new Set([next, ...prev])));
    setStatusText(`Saved endpoint ${next}. Reconnecting...`);
  };

  const handleConfirm = () => {
    if (!cardData || !window.opener) return;
    window.opener.postMessage(
      {
        type: "PMS_THAI_CARD_CONFIRMED",
        target: importTarget,
        payload: cardData,
      },
      window.location.origin
    );
    window.close();
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
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${
              canConfirm ? "bg-indigo-600 hover:bg-indigo-500" : "cursor-not-allowed bg-[var(--bg-muted)]"
            }`}
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            Confirm Import
          </button>
        </div>
      </div>
    </main>
  );
}
