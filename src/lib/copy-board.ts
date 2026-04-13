"use client";

export type CopyBoardEntry = {
  id: string;
  text: string;
  createdAt: string;
  sourceLabel?: string;
};

type CopyBoardEventDetail = {
  entries: CopyBoardEntry[];
};

const STORAGE_KEY = "pms-copy-board-history-v1";
export const COPY_BOARD_UPDATED_EVENT = "copy-board:updated";
const MAX_ENTRIES = 5;

let trackingInitialized = false;
let lastFocusedEditable: HTMLElement | HTMLInputElement | HTMLTextAreaElement | null = null;
let lastContentEditableRange: Range | null = null;

function isInputLikeElement(
  element: unknown
): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function isEditableElement(
  element: unknown
): element is HTMLElement | HTMLInputElement | HTMLTextAreaElement {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    return !element.disabled && !element.readOnly;
  }

  return element instanceof HTMLElement && element.isContentEditable;
}

function emitCopyBoardUpdated(entries: CopyBoardEntry[]) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CopyBoardEventDetail>(COPY_BOARD_UPDATED_EVENT, {
      detail: { entries },
    })
  );
}

function saveEntries(entries: CopyBoardEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  emitCopyBoardUpdated(entries);
}

export function loadCopyBoardEntries(): CopyBoardEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is CopyBoardEntry => {
        return Boolean(
          entry &&
            typeof entry === "object" &&
            typeof entry.id === "string" &&
            typeof entry.text === "string" &&
            entry.text.trim() &&
            typeof entry.createdAt === "string"
        );
      })
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function pushCopyBoardEntry(
  text: string,
  options?: { sourceLabel?: string }
): CopyBoardEntry[] {
  const normalized = typeof text === "string" ? text : "";
  if (!normalized.trim()) {
    return loadCopyBoardEntries();
  }

  const nextEntry: CopyBoardEntry = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `copy-${Date.now()}`,
    text: normalized,
    createdAt: new Date().toISOString(),
    sourceLabel: options?.sourceLabel,
  };

  const previous = loadCopyBoardEntries();
  const deduped = previous.filter((entry) => entry.text !== normalized);
  const next = [nextEntry, ...deduped].slice(0, MAX_ENTRIES);
  saveEntries(next);
  return next;
}

export async function copyToClipboardWithHistory(
  text: string,
  options?: { sourceLabel?: string }
): Promise<boolean> {
  const normalized = typeof text === "string" ? text : "";
  if (!normalized.trim()) return false;
  pushCopyBoardEntry(normalized, options);
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;

  try {
    await navigator.clipboard.writeText(normalized);
    return true;
  } catch {
    return false;
  }
}

export function ensureCopyBoardFocusTracking() {
  if (typeof window === "undefined" || trackingInitialized) return;
  trackingInitialized = true;

  document.addEventListener(
    "focusin",
    (event) => {
      if (isEditableElement(event.target)) {
        lastFocusedEditable = event.target;
      }
    },
    true
  );

  document.addEventListener(
    "selectionchange",
    () => {
      if (!(lastFocusedEditable instanceof HTMLElement) || !lastFocusedEditable.isContentEditable) {
        return;
      }

      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!lastFocusedEditable.contains(range.commonAncestorContainer)) return;
      lastContentEditableRange = range.cloneRange();
    },
    true
  );

  document.addEventListener(
    "copy",
    () => {
      const copiedText = getSelectedCopyText();
      if (!copiedText) return;
      pushCopyBoardEntry(copiedText, { sourceLabel: "Copied Selection" });
    },
    true
  );
}

function resolveEditableTarget() {
  if (typeof document === "undefined") return null;

  const activeElement = document.activeElement;
  if (isEditableElement(activeElement)) {
    return activeElement;
  }

  if (lastFocusedEditable && document.contains(lastFocusedEditable)) {
    return lastFocusedEditable;
  }

  return null;
}

function dispatchEditableEvents(target: HTMLElement) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function getSelectedCopyText(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";

  const activeElement = document.activeElement;
  if (isInputLikeElement(activeElement)) {
    const value = activeElement.value ?? "";
    const start = activeElement.selectionStart ?? 0;
    const end = activeElement.selectionEnd ?? 0;
    return value.slice(start, end).trim();
  }

  const selection = window.getSelection();
  return selection?.toString().trim() ?? "";
}

function insertIntoInputLike(
  target: HTMLInputElement | HTMLTextAreaElement,
  text: string
) {
  const value = target.value ?? "";
  const start = target.selectionStart ?? value.length;
  const end = target.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;

  const prototype = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (valueSetter) {
    valueSetter.call(target, nextValue);
  } else {
    target.value = nextValue;
  }

  target.focus();
  const caret = start + text.length;
  target.setSelectionRange(caret, caret);
  lastFocusedEditable = target;
  dispatchEditableEvents(target);
}

function insertIntoContentEditable(target: HTMLElement, text: string) {
  target.focus();

  const selection = window.getSelection();
  let range: Range | null = null;

  if (selection && selection.rangeCount > 0) {
    const currentRange = selection.getRangeAt(0);
    if (target.contains(currentRange.commonAncestorContainer)) {
      range = currentRange;
    }
  }

  if (!range && lastContentEditableRange && target.contains(lastContentEditableRange.commonAncestorContainer)) {
    range = lastContentEditableRange.cloneRange();
  }

  if (!range) {
    range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);

  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  lastFocusedEditable = target;
  lastContentEditableRange = range.cloneRange();
  dispatchEditableEvents(target);
}

export function insertCopyBoardTextIntoFocusedField(text: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!text) return false;

  ensureCopyBoardFocusTracking();
  const target = resolveEditableTarget();
  if (!target) return false;

  if (isInputLikeElement(target)) {
    insertIntoInputLike(target, text);
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    insertIntoContentEditable(target, text);
    return true;
  }

  return false;
}
