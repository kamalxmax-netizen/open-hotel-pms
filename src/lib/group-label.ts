export function formatShortGroupCode(groupCode?: string | null): string {
  const raw = String(groupCode ?? "").trim();
  if (!raw) return "G-000";

  const digits = raw.replace(/\D/g, "");
  const compact = (digits || raw.replace(/[^A-Za-z0-9]/g, "")).toUpperCase();
  const tail = compact.slice(-3).padStart(3, "0");
  return `G-${tail}`;
}
