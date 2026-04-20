const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF]/g;

function isThaiCombiningMark(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code === 0x0E31 || (code >= 0x0E34 && code <= 0x0E3A) || (code >= 0x0E47 && code <= 0x0E4E);
}

function isThaiBaseChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x0E01 && code <= 0x0E30) || (code >= 0x0E32 && code <= 0x0E33) || (code >= 0x0E40 && code <= 0x0E46);
}

export function cleanFloatingThaiMarks(value: unknown): string {
  const input = String(value ?? "").replace(ZERO_WIDTH_CHARS, "");
  let output = "";
  let canAcceptThaiMark = false;

  for (const char of input) {
    if (isThaiCombiningMark(char)) {
      if (canAcceptThaiMark) output += char;
      continue;
    }

    output += char;
    canAcceptThaiMark = isThaiBaseChar(char);
  }

  return output;
}

export function cleanBookingNameInput(value: unknown): string {
  return cleanFloatingThaiMarks(value).replace(/\s+/g, " ").trim();
}
