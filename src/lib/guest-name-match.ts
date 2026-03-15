export type GuestNameMatchResult = "unknown" | "exact" | "likely" | "mismatch";

export const BOOKED_NAME_NOTE_PREFIX = "จองมาในชื่อ";

const TITLE_TOKENS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mister",
  "นาย",
  "นาง",
  "นางสาว",
  "คุณ",
  "ดร",
  "ดช",
  "ดญ",
  "น",
  "ส",
]);

function sanitizeName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeName(raw: unknown): string[] {
  return sanitizeName(raw)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !TITLE_TOKENS.has(token));
}

function hasLikelyPrefixOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 2) return false;
  return a.startsWith(b) || b.startsWith(a);
}

export function normalizeGuestName(raw: unknown): string {
  return tokenizeName(raw).join(" ");
}

export function classifyGuestNameMatch(expected: unknown, actual: unknown): GuestNameMatchResult {
  const expectedName = normalizeGuestName(expected);
  const actualName = normalizeGuestName(actual);

  if (!expectedName || !actualName) return "unknown";
  if (expectedName === actualName) return "exact";

  if (
    (expectedName.includes(actualName) || actualName.includes(expectedName)) &&
    Math.min(expectedName.length, actualName.length) >= 4
  ) {
    return "likely";
  }

  const expectedTokens = expectedName.split(" ").filter(Boolean);
  const actualTokens = actualName.split(" ").filter(Boolean);
  const smallerTokens = expectedTokens.length <= actualTokens.length ? expectedTokens : actualTokens;
  const largerSet = new Set(expectedTokens.length <= actualTokens.length ? actualTokens : expectedTokens);
  if (smallerTokens.length >= 2 && smallerTokens.every((token) => largerSet.has(token))) {
    return "likely";
  }

  const comparableLen = Math.min(expectedTokens.length, actualTokens.length);
  if (comparableLen >= 2) {
    let alignedLikely = 0;
    for (let i = 0; i < comparableLen; i++) {
      if (hasLikelyPrefixOverlap(expectedTokens[i], actualTokens[i])) {
        alignedLikely += 1;
      }
    }
    if (alignedLikely >= comparableLen - 1) {
      return "likely";
    }
  }

  if (expectedTokens.length >= 2 && actualTokens.length >= 2) {
    const expectedFirst = expectedTokens[0];
    const expectedLast = expectedTokens[expectedTokens.length - 1];
    const actualFirst = actualTokens[0];
    const actualLast = actualTokens[actualTokens.length - 1];
    if (
      hasLikelyPrefixOverlap(expectedFirst, actualLast) &&
      hasLikelyPrefixOverlap(expectedLast, actualFirst)
    ) {
      return "likely";
    }
  }

  return "mismatch";
}

export function buildBookedNameNoteLine(name: unknown): string {
  const normalized = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return `${BOOKED_NAME_NOTE_PREFIX} ${normalized}`;
}

export function extractBookedNameFromProfileNotes(notes: unknown): string {
  const source = String(notes ?? "").trim();
  if (!source) return "";

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith(`${BOOKED_NAME_NOTE_PREFIX} `)) continue;
    return line.slice(BOOKED_NAME_NOTE_PREFIX.length).trim();
  }
  return "";
}
