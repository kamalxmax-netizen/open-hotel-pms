export function normalizePhoneForStorage(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return text;
}

export function formatPhoneInput(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const digits = text.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length > 3 && digits.length <= 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return text;
}
