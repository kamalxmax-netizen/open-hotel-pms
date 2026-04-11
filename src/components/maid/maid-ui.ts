import type { ChecklistItem, MaidRoom } from "@/lib/types";
import { getAmenityLabelFromValues } from "@/lib/maid-amenities";

export function getAmenityLabel(item: Pick<ChecklistItem, "item" | "product_id">): string {
  return getAmenityLabelFromValues(item.item, item.product_id ?? null);
}

export type MaidStatusPalette = {
  card: string;
  accentText: string;
  badge: string;
  timer: string;
  pill: string;
};

export function getRoomPalette(room: MaidRoom): MaidStatusPalette {
  if (room.is_no_service) {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(232,247,255,0.98),rgba(196,233,252,0.92))] border border-sky-300 border-l-[12px] border-l-sky-600 shadow-[0_14px_32px_rgba(14,165,233,0.14)] dark:bg-none dark:bg-sky-950/40 dark:border-sky-500/40 dark:border-l-sky-500 dark:shadow-[0_4px_20px_rgba(14,165,233,0.1)]",
      accentText: "text-sky-600 dark:text-sky-400",
      badge: "dark:bg-sky-500/15 bg-sky-200 dark:text-sky-300 text-sky-800 border dark:border-sky-500/30 border-sky-300/60",
      timer: "dark:text-sky-300 text-sky-700",
      pill: "dark:bg-sky-500/20 bg-sky-200/90 text-sky-800 dark:text-sky-300 border dark:border-sky-500/30 border-sky-300/60",
    };
  }

  if (room.status === "in_progress") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(255,244,219,0.98),rgba(252,222,167,0.92))] border border-amber-300 border-l-[12px] border-l-amber-500 shadow-[0_14px_32px_rgba(245,158,11,0.14)] dark:bg-none dark:bg-amber-900/40 dark:border-amber-500/40 dark:border-l-amber-500 dark:shadow-[0_4px_20px_rgba(245,158,11,0.1)]",
      accentText: "text-amber-500 dark:text-amber-400",
      badge: "dark:bg-amber-500/15 bg-amber-200 dark:text-amber-300 text-amber-800 border dark:border-amber-500/30 border-amber-300/60",
      timer: "dark:text-slate-100 text-slate-800",
      pill: "dark:bg-amber-500/20 bg-amber-200/90 text-amber-800 dark:text-amber-300 border dark:border-amber-500/30 border-amber-300/60",
    };
  }

  if (room.status === "paused") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(244,236,255,0.98),rgba(226,208,255,0.92))] border border-purple-300 border-l-[12px] border-l-purple-500 shadow-[0_14px_32px_rgba(168,85,247,0.14)] dark:bg-none dark:bg-purple-950/40 dark:border-purple-500/40 dark:border-l-purple-500 dark:shadow-[0_4px_20px_rgba(168,85,247,0.1)]",
      accentText: "text-purple-600 dark:text-purple-400",
      badge: "dark:bg-purple-500/15 bg-purple-200 dark:text-purple-300 text-purple-800 border dark:border-purple-500/30 border-purple-300/60",
      timer: "dark:text-slate-100 text-slate-800",
      pill: "dark:bg-purple-500/20 bg-purple-200/90 text-purple-800 dark:text-purple-300 border dark:border-purple-500/30 border-purple-300/60",
    };
  }

  if (room.status === "approved") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(233,250,242,0.92),rgba(208,241,224,0.84))] border border-emerald-200 border-l-[12px] border-l-emerald-400 shadow-[0_14px_28px_rgba(16,185,129,0.09)] dark:bg-none dark:bg-emerald-950/25 dark:border-emerald-500/25 dark:border-l-emerald-400 dark:shadow-[0_4px_20px_rgba(16,185,129,0.06)]",
      accentText: "text-emerald-500 dark:text-emerald-300",
      badge: "dark:bg-emerald-500/10 bg-emerald-100 dark:text-emerald-300 text-emerald-700 border dark:border-emerald-500/20 border-emerald-200/80",
      timer: "dark:text-emerald-300 text-emerald-700",
      pill: "dark:bg-emerald-500/12 bg-emerald-100 text-emerald-700 dark:text-emerald-300 border dark:border-emerald-500/20 border-emerald-200/80",
    };
  }

  if (room.status === "cleaned") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(225,250,235,0.98),rgba(186,235,206,0.92))] border border-emerald-300 border-l-[12px] border-l-emerald-500 shadow-[0_14px_32px_rgba(16,185,129,0.14)] dark:bg-none dark:bg-emerald-950/40 dark:border-emerald-500/40 dark:border-l-emerald-500 dark:shadow-[0_4px_20px_rgba(16,185,129,0.1)]",
      accentText: "text-emerald-600 dark:text-emerald-400",
      badge: "dark:bg-emerald-500/15 bg-emerald-200 dark:text-emerald-300 text-emerald-800 border dark:border-emerald-500/30 border-emerald-300/60",
      timer: "dark:text-emerald-300 text-emerald-700",
      pill: "dark:bg-emerald-500/20 bg-emerald-200/90 text-emerald-800 dark:text-emerald-300 border dark:border-emerald-500/30 border-emerald-300/60",
    };
  }

  return {
    card:
      "bg-[linear-gradient(135deg,rgba(255,232,238,0.98),rgba(250,202,214,0.92))] border border-rose-300 border-l-[12px] border-l-rose-600 shadow-[0_14px_32px_rgba(225,29,72,0.15)] dark:bg-none dark:bg-rose-950/40 dark:border-rose-500/40 dark:border-l-rose-500 dark:shadow-[0_4px_20px_rgba(225,29,72,0.1)]",
    accentText: "text-rose-600 dark:text-rose-400",
    badge: "dark:bg-rose-500/15 bg-rose-200 dark:text-rose-300 text-rose-800 border dark:border-rose-500/30 border-rose-300/60",
    timer: "dark:text-slate-100 text-slate-800",
    pill: "dark:bg-rose-500/20 bg-rose-200/90 text-rose-800 dark:text-rose-300 border dark:border-rose-500/30 border-rose-300/60",
  };
}

export function getExtraTaskPalette(status: "pending" | "in_progress" | "paused" | "done" | "cancelled"): {
  card: string;
  accentText: string;
  timer: string;
} {
  if (status === "in_progress") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(255,244,219,0.98),rgba(252,222,167,0.92))] border border-amber-300 border-l-[12px] border-l-amber-500 shadow-[0_14px_32px_rgba(245,158,11,0.14)] dark:bg-none dark:bg-amber-900/40 dark:border-amber-500/40 dark:border-l-amber-500 dark:shadow-[0_4px_20px_rgba(245,158,11,0.1)]",
      accentText: "text-amber-500 dark:text-amber-400",
      timer: "dark:text-slate-100 text-slate-800",
    };
  }

  if (status === "paused") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(244,236,255,0.98),rgba(226,208,255,0.92))] border border-purple-300 border-l-[12px] border-l-purple-500 shadow-[0_14px_32px_rgba(168,85,247,0.14)] dark:bg-none dark:bg-purple-950/40 dark:border-purple-500/40 dark:border-l-purple-500 dark:shadow-[0_4px_20px_rgba(168,85,247,0.1)]",
      accentText: "text-purple-600 dark:text-purple-400",
      timer: "dark:text-slate-100 text-slate-800",
    };
  }

  if (status === "done") {
    return {
      card:
        "bg-[linear-gradient(135deg,rgba(225,250,235,0.98),rgba(186,235,206,0.92))] border border-emerald-300 border-l-[12px] border-l-emerald-500 shadow-[0_14px_32px_rgba(16,185,129,0.14)] dark:bg-none dark:bg-emerald-950/40 dark:border-emerald-500/40 dark:border-l-emerald-500 dark:shadow-[0_4px_20px_rgba(16,185,129,0.1)]",
      accentText: "text-emerald-600 dark:text-emerald-400",
      timer: "dark:text-emerald-300 text-emerald-700",
    };
  }

  return {
    card:
      "bg-[linear-gradient(135deg,rgba(255,232,238,0.98),rgba(250,202,214,0.92))] border border-rose-300 border-l-[12px] border-l-rose-600 shadow-[0_14px_32px_rgba(225,29,72,0.15)] dark:bg-none dark:bg-rose-950/40 dark:border-rose-500/40 dark:border-l-rose-500 dark:shadow-[0_4px_20px_rgba(225,29,72,0.1)]",
    accentText: "text-rose-600 dark:text-rose-400",
    timer: "dark:text-slate-100 text-slate-800",
  };
}
