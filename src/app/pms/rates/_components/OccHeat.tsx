export function occTint(pct: number): string {
  if (pct < 30)  return "bg-emerald-50 dark:bg-emerald-950/30 hc:bg-emerald-200 hc:border-l-4 hc:border-emerald-700";
  if (pct < 60)  return "bg-amber-50 dark:bg-amber-950/30 hc:bg-amber-200 hc:border-l-4 hc:border-amber-700";
  if (pct < 85)  return "bg-orange-50 dark:bg-orange-950/30 hc:bg-orange-200 hc:border-l-4 hc:border-orange-700";
  return "bg-rose-100 dark:bg-rose-950/40 hc:bg-rose-300 hc:border-l-4 hc:border-rose-800";
}
