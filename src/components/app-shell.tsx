"use client";

import Sidebar from "@/components/sidebar";
import BugReportButton from "@/components/bug-report-button";
import UrgentLogbookOverlay from "@/components/urgent-logbook-overlay";
import UiEventLogProvider from "@/components/ui-event-log-provider";
import { ensureCopyBoardFocusTracking } from "@/lib/copy-board";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export default function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const isMaidApp = pathname.startsWith("/maid") || pathname.startsWith("/pms/mobile-checkin");
  const isLoginPage = pathname === "/login";
  const isStandalonePopup =
    pathname === "/smart-card" ||
    pathname === "/pms/smart-card" ||
    pathname === "/passport-ocr" ||
    pathname === "/pms/passport-ocr";

  useEffect(() => {
    ensureCopyBoardFocusTracking();
  }, []);

  useEffect(() => {
    if (isMaidApp || isStandalonePopup || isLoginPage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTypingElement(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        router.push("/pms/logbook");
        return;
      }
      if (key === "d") {
        event.preventDefault();
        router.push("/pms/board");
        return;
      }
      if (key === "r") {
        event.preventDefault();
        router.push("/pms/reservations?new=1");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMaidApp, isStandalonePopup, router]);

  if (isMaidApp || isStandalonePopup || isLoginPage) {
    return <div className="bg-[var(--bg-body)] min-h-screen">{children}</div>;
  }

  const showBugReport = process.env.NEXT_PUBLIC_SHOW_BUG_REPORT === "true";

  return (
    <div className="app-shell">
      <UiEventLogProvider />
      <Sidebar />
      <div className="main-content">
        <main className="page-body">{children}</main>
      </div>
      <UrgentLogbookOverlay hasNeighbor={showBugReport} />
      {showBugReport && <BugReportButton />}
    </div>
  );
}
