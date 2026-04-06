const http = require("http");
const path = require("path");

function safeRequire(moduleName) {
  try {
    return require(moduleName);
  } catch {
    const fallbackPath = path.resolve(
      __dirname,
      "..",
      "..",
      "Smart card Reader",
      "node_modules",
      moduleName
    );
    return require(fallbackPath);
  }
}

const { ThaiCardReader, EVENTS, MODE } = safeRequire("@privageapp/thai-national-id-reader");
const WebSocket = safeRequire("ws");

const PORT = Number(process.env.THAI_CARD_WS_PORT || 3001);
const HOST = String(process.env.THAI_CARD_WS_HOST || "0.0.0.0");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHelperPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Thai ID Reader Helper</title>
    <style>
      body { font-family: Arial, sans-serif; background: #111827; color: #f9fafb; margin: 0; padding: 20px; }
      .card { max-width: 720px; margin: 0 auto; background: #1f2937; border: 1px solid #374151; border-radius: 16px; padding: 20px; }
      .status { color: #cbd5e1; font-size: 14px; margin-bottom: 8px; }
      .hint { color: #94a3b8; font-size: 12px; margin-top: 8px; }
      .progress { height: 8px; background: #374151; border-radius: 999px; overflow: hidden; margin: 12px 0 16px; }
      .bar { height: 100%; width: 0%; background: #4f46e5; transition: width .2s ease; }
      .panel { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-top: 14px; }
      button { border: 0; border-radius: 10px; padding: 10px 14px; font-weight: 600; cursor: pointer; }
      button.primary { background: #4f46e5; color: white; }
      button.secondary { background: #374151; color: #f9fafb; margin-right: 8px; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .actions { display: flex; justify-content: flex-end; margin-top: 18px; }
      .ok { color: #34d399; }
      .warn { color: #fbbf24; }
      .err { color: #f87171; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Thai ID Reader</h1>
      <div id="status" class="status">Connecting to local Thai Card Service...</div>
      <div class="hint">Endpoint: <span id="endpoint"></span></div>
      <div class="progress"><div id="bar" class="bar"></div></div>
      <div id="details" class="panel" style="display:none"></div>
      <div class="actions">
        <button type="button" class="secondary" onclick="window.close()">Close</button>
      </div>
    </main>
    <script>
      const params = new URLSearchParams(window.location.search);
      const parentOrigin = params.get("parentOrigin") || "*";
      const target = params.get("target") === "accompany" ? "accompany" : "main";
      const explicitWs = (params.get("ws") || "").trim();
      const wsUrl = explicitWs || ("ws://" + window.location.host);
      const endpointEl = document.getElementById("endpoint");
      const statusEl = document.getElementById("status");
      const detailsEl = document.getElementById("details");
      const barEl = document.getElementById("bar");
      let cardData = null;
      endpointEl.textContent = wsUrl;

      function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = "status " + (cls || "");
      }

      function setProgress(value) {
        barEl.style.width = Math.max(0, Math.min(100, Number(value) || 0)) + "%";
      }

      function postToParent(message) {
        if (!window.opener) return;
        window.opener.postMessage(message, parentOrigin);
      }

      function completeAndClose(payload) {
        if (!payload || !window.opener) return;
        postToParent({ type: "PMS_THAI_CARD_CONFIRMED", target, payload });
        setStatus("Read complete. Sending data...", "ok");
        setTimeout(() => window.close(), 120);
      }

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      const socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        setStatus("Connected. Waiting for reader/card...", "ok");
        postToParent({ type: "PMS_THAI_CARD_WS_ENDPOINT", endpoint: wsUrl });
      };
      socket.onmessage = (event) => {
        let payload = null;
        try { payload = JSON.parse(String(event.data)); } catch {}
        if (!payload || !payload.event) return;
        if (payload.event === "service_status" && payload.status === "pcsc_unavailable") {
          setStatus("Service connected, but card daemon/reader is unavailable.", "warn");
          return;
        }
        if (payload.event === "reader_ready") {
          setStatus("Reader ready. Insert card.", "ok");
          return;
        }
        if (payload.event === "card_inserted") {
          cardData = null;
          detailsEl.style.display = "none";
          setProgress(0);
          setStatus("Card inserted. Reading...", "ok");
          return;
        }
        if (payload.event === "progress") {
          const step = Number(payload.step || 0);
          const total = Number(payload.total || 0);
          const pct = total > 0 ? Math.round((step / total) * 100) : 0;
          setProgress(pct);
          setStatus("Reading... " + pct + "%", "ok");
          return;
        }
        if (payload.event === "card_data") {
          cardData = payload;
          setProgress(100);
          setStatus("Read complete. Confirm to import.", "ok");
          detailsEl.style.display = "block";
          detailsEl.innerHTML =
            "<div><strong>Citizen ID:</strong> " + escapeHtml(payload.citizenId || "-") + "</div>" +
            "<div><strong>Thai Name:</strong> " + escapeHtml([payload.titleTH, payload.firstNameTH, payload.lastNameTH].filter(Boolean).join(" ") || "-") + "</div>" +
            "<div><strong>English Name:</strong> " + escapeHtml([payload.titleEN, payload.firstNameEN, payload.lastNameEN].filter(Boolean).join(" ") || "-") + "</div>";
          completeAndClose(payload);
          return;
        }
        if (payload.event === "card_removed") {
          cardData = null;
          detailsEl.style.display = "none";
          setProgress(0);
          setStatus("Card removed. Insert card.", "warn");
        }
      };
      socket.onerror = () => setStatus("Unable to connect to local Thai Card Service.", "err");
      socket.onclose = () => {
        if (!cardData) setStatus("Local Thai Card Service disconnected.", "err");
      };
    </script>
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (requestUrl.pathname === "/smart-card-helper") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHelperPage());
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });
let reader = null;
let retryTimer = null;

wss.on("error", (err) => {
  console.error("[thai-card-service] websocket error:", err && err.message ? err.message : err);
});

function broadcast(event, data = {}) {
  const payload = JSON.stringify({ event, ...data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function normalizeGender(raw) {
  const value = String(raw || "").toLowerCase();
  if (value === "male" || value === "m" || value === "1") return "M";
  if (value === "female" || value === "f" || value === "2") return "F";
  return "Other";
}

function extractLastProvinceToken(raw) {
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

function extractThaiProvince(rawAddress, explicitProvince) {
  const fromAddress = extractLastProvinceToken(rawAddress);
  if (fromAddress) return fromAddress;
  return extractLastProvinceToken(explicitProvince);
}

server.listen(PORT, HOST, () => {
  console.log("[thai-card-service] waiting for reader...");
  console.log(`[thai-card-service] websocket at ws://${HOST}:${PORT}`);
  console.log(`[thai-card-service] helper page at http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/smart-card-helper`);
});

wss.on("connection", (_socket, req) => {
  const remote = req && req.socket ? req.socket.remoteAddress : "unknown";
  const origin = req && req.headers ? req.headers.origin : "";
  console.log(`[thai-card-service] client connected from ${remote}${origin ? ` origin=${origin}` : ""}`);
  broadcast("service_status", { status: "service_started" });
});

function wireReaderEvents(nextReader) {
  nextReader.on(EVENTS.DEVICE_CONNECTED, () => {
    console.log("[thai-card-service] reader ready");
    broadcast("reader_ready", { message: "Reader ready" });
    broadcast("service_status", { status: "reader_ready" });
  });

  nextReader.on(EVENTS.CARD_INSERTED, () => {
    console.log("[thai-card-service] card inserted");
    broadcast("card_inserted", { message: "Card inserted" });
  });

  nextReader.on(EVENTS.READING_PROGRESS, ({ step, of, message }) => {
    broadcast("progress", { step, total: of, message });
  });

  nextReader.on(EVENTS.READING_COMPLETE, (data) => {
    const payload = {
      citizenId: String(data?.citizenId || "").replace(/\D+/g, "").slice(0, 13),
      titleTH: String(data?.titleTH || "").trim(),
      firstNameTH: String(data?.firstNameTH || "").trim(),
      lastNameTH: String(data?.lastNameTH || "").trim(),
      titleEN: String(data?.titleEN || "").trim(),
      firstNameEN: String(data?.firstNameEN || "").trim(),
      lastNameEN: String(data?.lastNameEN || "").trim(),
      birthday: String(data?.birthday || "").trim(),
      gender: normalizeGender(data?.gender),
      address: String(data?.address || "").trim(),
      province: extractThaiProvince(data?.address, data?.province),
      issue: String(data?.issue || "").trim(),
      expire: String(data?.expire || "").trim(),
    };
    console.log(`[thai-card-service] read complete id=${payload.citizenId}`);
    broadcast("card_data", payload);
  });

  nextReader.on(EVENTS.CARD_REMOVED, () => {
    broadcast("card_removed");
  });

  nextReader.on(EVENTS.DEVICE_DISCONNECTED, () => {
    console.log("[thai-card-service] reader disconnected");
    broadcast("service_status", { status: "reader_disconnected" });
  });

  nextReader.on(EVENTS.READING_FAIL, (err) => {
    console.error("[thai-card-service] reading failed", err);
    broadcast("error", { message: "Reading failed" });
  });

  nextReader.on(EVENTS.ERROR, (err) => {
    console.error("[thai-card-service] error", err);
    broadcast("error", { message: "Reader error" });
  });
}

function initReader() {
  try {
    reader = new ThaiCardReader();
    reader.readMode = MODE.PERSONAL;
    reader.autoRecreate = true;
    wireReaderEvents(reader);
    reader.startListener();
    broadcast("service_status", { status: "service_started" });
  } catch (err) {
    const message = err && err.message ? String(err.message) : "Unknown PCSC error";
    console.error("[thai-card-service] init failed:", message);
    broadcast("service_status", { status: "pcsc_unavailable", message });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(initReader, 3000);
  }
}

initReader();
