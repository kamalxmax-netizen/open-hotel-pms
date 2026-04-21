import { LogbookNote, LogbookRichBody, LogbookRichTextSize } from "@/lib/types";

export const LOGBOOK_TEXT_COLORS = [
  "#334155",
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#be123c",
  "#b45309",
];

export function getDefaultRichBody(body: string): LogbookRichBody {
  return {
    html: plainTextToHtml(body),
    styles: {
      bold: false,
      color: "#334155",
      size: "m",
    },
  };
}

export function getNoteRichBody(note: Pick<LogbookNote, "body" | "body_rich">): LogbookRichBody {
  return note.body_rich ?? getDefaultRichBody(note.body ?? "");
}

export function plainTextToHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

export function richHtmlToPlainText(value: string): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function getRichBodyTextareaStyle(richBody: LogbookRichBody): React.CSSProperties {
  // If color is the default slate/charcoal, we want to allow it to be overridden by parent classes
  // specifically for dark mode readability on colored logbook cards.
  const isDefaultColor = richBody.styles.color === "#334155" || richBody.styles.color === "var(--text-table-cell)";
  
  return {
    fontWeight: richBody.styles.bold ? 700 : 500,
    color: isDefaultColor ? undefined : richBody.styles.color,
    fontSize:
      richBody.styles.size === "s"
        ? "12px"
        : richBody.styles.size === "l"
          ? "19px"
          : "15px",
    lineHeight: richBody.styles.size === "l" ? "1.7" : richBody.styles.size === "m" ? "1.6" : "1.5",
  };
}

export function getRichBodyPreviewStyle(richBody: LogbookRichBody, isFullView: boolean): React.CSSProperties {
  const size = richBody.styles.size;
  const fontSize =
    size === "s"
      ? isFullView ? "17px" : "12px"
      : size === "l"
        ? isFullView ? "26px" : "19px"
        : isFullView ? "21px" : "15px";

  return {
    fontWeight: richBody.styles.bold ? 700 : 500,
    color: richBody.styles.color,
    fontSize,
    lineHeight: isFullView ? "1.75" : "1.6",
  };
}

export function cycleRichTextSize(current: LogbookRichTextSize): LogbookRichTextSize {
  if (current === "s") return "m";
  if (current === "m") return "l";
  return "s";
}
