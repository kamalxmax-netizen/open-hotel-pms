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

const wss = new WebSocket.Server({ host: HOST, port: PORT });
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

console.log("[thai-card-service] waiting for reader...");
console.log(`[thai-card-service] websocket at ws://${HOST}:${PORT}`);

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
