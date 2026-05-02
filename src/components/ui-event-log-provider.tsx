"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { logUiEvent } from "@/lib/ui-event-log-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const AUTH_SESSION_LOG_PREFIX = "pms.auth-activity.session-started.";

function shouldTrackPath(pathname: string): boolean {
  if (!pathname.startsWith("/pms")) return false;
  if (pathname.startsWith("/pms/admin/debug-logs")) return false;
  if (pathname.startsWith("/pms/setup/bug-reports")) return false;
  if (pathname.startsWith("/pms/mobile-checkin")) return false;
  return true;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function getActionableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest("[data-debug-log-ignore='true']")) return null;
  return target.closest("button, a[href], [role='button'], [data-debug-action]") as HTMLElement | null;
}

function getElementLabel(element: HTMLElement): string {
  const dataLabel = element.dataset.debugLabel;
  if (dataLabel) return clip(collapseWhitespace(dataLabel));
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return clip(collapseWhitespace(ariaLabel));
  const title = element.getAttribute("title");
  if (title) return clip(collapseWhitespace(title));
  const text = collapseWhitespace(element.textContent ?? "");
  if (text) return clip(text);
  return clip(element.tagName.toLowerCase());
}

export default function UiEventLogProvider() {
  const pathname = usePathname();

  useEffect(() => {
    if (!shouldTrackPath(pathname)) return;
    logUiEvent({
      pathname,
      event_type: "page_view",
      event_name: "page_view",
      metadata: {
        title: document.title,
      },
    });
  }, [pathname]);

  useEffect(() => {
    if (!shouldTrackPath(pathname)) return;

    let cancelled = false;
    async function logSessionStarted() {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const session = data.session;
      const userId = session?.user?.id ?? null;
      if (!userId) return;

      const sessionKey = `${AUTH_SESSION_LOG_PREFIX}${userId}.${session?.expires_at ?? "unknown"}`;
      try {
        if (window.sessionStorage.getItem(sessionKey) === "1") return;
        window.sessionStorage.setItem(sessionKey, "1");
      } catch {
        // If sessionStorage is unavailable, still log once for this mount.
      }

      logUiEvent({
        pathname,
        event_type: "auth_activity",
        event_name: "session_started",
        metadata: {
          entry_path: pathname,
        },
      });
    }

    void logSessionStarted();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (!shouldTrackPath(pathname)) return;

    const onClick = (event: MouseEvent) => {
      const element = getActionableElement(event.target);
      if (!element) return;
      const href = element instanceof HTMLAnchorElement ? element.href : null;
      logUiEvent({
        pathname,
        event_type: "click",
        event_name: element.dataset.debugAction || (href ? "link_click" : "button_click"),
        metadata: {
          label: getElementLabel(element),
          href,
          tag: element.tagName.toLowerCase(),
        },
      });
    };

    const onSubmit = (event: Event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      const formName = clip(
        collapseWhitespace(form.dataset.debugLabel || form.getAttribute("name") || form.getAttribute("id") || "form_submit"),
        100
      );
      logUiEvent({
        pathname,
        event_type: "submit",
        event_name: "form_submit",
        metadata: {
          label: formName,
          action: form.getAttribute("action"),
          method: form.getAttribute("method") || "get",
        },
      });
    };

    const onError = (event: ErrorEvent) => {
      logUiEvent({
        pathname,
        event_type: "client_error",
        event_name: "window_error",
        severity: "error",
        message: clip(collapseWhitespace(event.message || "Unknown client error"), 300),
        metadata: {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        typeof event.reason === "string"
          ? event.reason
          : event.reason instanceof Error
            ? event.reason.message
            : "Unhandled rejection";
      logUiEvent({
        pathname,
        event_type: "client_error",
        event_name: "unhandled_rejection",
        severity: "error",
        message: clip(collapseWhitespace(reason), 300),
      });
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [pathname]);

  return null;
}
