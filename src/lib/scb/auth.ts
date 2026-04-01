import crypto from "crypto";

type CachedToken = {
  token: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

export type ScbConfig = {
  baseUrl: string;
  tokenUrl: string;
  qrCreateUrl: string;
  inquiryUrl: string;
  applicationKey: string;
  applicationSecret: string;
  resourceOwnerId: string;
  walletId: string;
  acceptLanguage: string;
  callbackHmacSecret: string | null;
  callbackAllowInsecureSandbox: boolean;
  callbackSignatureHeaders: string[];
  callbackAllowedIps: string[];
  mockMode: boolean;
};

function normalizeCsv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getScbConfig(): ScbConfig {
  const baseUrl = String(process.env.SCB_MAEMANEE_BASE_URL ?? "https://api-sandbox.partners.scb/partners/sandbox").trim();
  const applicationKey = String(process.env.SCB_APPLICATION_KEY ?? "").trim();
  const applicationSecret = String(process.env.SCB_APPLICATION_SECRET ?? "").trim();
  const resourceOwnerId = String(process.env.SCB_RESOURCE_OWNER_ID ?? applicationKey).trim();
  const walletId = String(process.env.SCB_MAEMANEE_WALLET_ID ?? "").trim();
  const mockMode = String(process.env.SCB_MAEMANEE_MOCK_MODE ?? "").trim().toLowerCase() === "true";

  return {
    baseUrl,
    tokenUrl: String(process.env.SCB_OAUTH_TOKEN_URL ?? `${baseUrl}/v1/oauth/token`).trim(),
    qrCreateUrl: String(process.env.SCB_MAEMANEE_QR_CREATE_URL ?? `${baseUrl}/v1/maemanee/payment/qr/create`).trim(),
    inquiryUrl: String(process.env.SCB_MAEMANEE_GETONE_URL ?? `${baseUrl}/v1/maemanee/payment/transaction/getone`).trim(),
    applicationKey,
    applicationSecret,
    resourceOwnerId,
    walletId,
    acceptLanguage: String(process.env.SCB_ACCEPT_LANGUAGE ?? "th").trim() || "th",
    callbackHmacSecret: String(process.env.SCB_CALLBACK_HMAC_SECRET ?? "").trim() || null,
    callbackAllowInsecureSandbox: String(process.env.SCB_CALLBACK_ALLOW_INSECURE_SANDBOX ?? "").trim().toLowerCase() === "true",
    callbackSignatureHeaders: normalizeCsv(process.env.SCB_CALLBACK_SIGNATURE_HEADERS).length > 0
      ? normalizeCsv(process.env.SCB_CALLBACK_SIGNATURE_HEADERS)
      : ["x-scb-signature", "signature", "x-signature"],
    callbackAllowedIps: normalizeCsv(process.env.SCB_CALLBACK_ALLOWED_IPS),
    mockMode,
  };
}

export function isScbMockMode(): boolean {
  return getScbConfig().mockMode;
}

function assertScbAuthConfig(config: ScbConfig): void {
  if (config.mockMode) return;
  if (!config.applicationKey || !config.applicationSecret || !config.resourceOwnerId) {
    throw new Error("SCB OAuth config is incomplete.");
  }
}

export function buildScbRequestUId(): string {
  return crypto.randomUUID();
}

export async function getScbAccessToken(): Promise<string> {
  const config = getScbConfig();
  if (config.mockMode) return "mock-scb-access-token";
  assertScbAuthConfig(config);

  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-language": config.acceptLanguage,
      "requestUId": buildScbRequestUId(),
      "resourceOwnerId": config.resourceOwnerId,
    },
    body: JSON.stringify({
      applicationKey: config.applicationKey,
      applicationSecret: config.applicationSecret,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(`SCB OAuth token request failed (${response.status}).`);
  }

  const token = String(payload?.data?.accessToken ?? "").trim();
  const expiresIn = Number(payload?.data?.expiresIn ?? 0);
  if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("SCB OAuth token response is invalid.");
  }

  cachedToken = {
    token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };

  return token;
}
