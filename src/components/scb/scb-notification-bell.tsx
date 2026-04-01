"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

export function ScbNotificationBell() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/notifications/scb");
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success || cancelled) return;
        setItems(json.items ?? []);
        setUnreadCount(Number(json.unread_count ?? 0));
        setRole(json.role ?? null);
      } catch {
        // silent bell fail
      }
    };

    load();
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  const canOpenInbox = useMemo(() => role === "admin" || role === "supervisor", [role]);

  const handleReadAll = async () => {
    try {
      const res = await fetch("/api/notifications/scb/read-all", { method: "PATCH" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return;
      setUnreadCount(0);
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch {
      // no-op
    }
  };

  const handleItemClick = async () => {
    await handleReadAll();
    if (canOpenInbox) {
      router.push("/pms/scb-transfers");
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        className="relative rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
        onClick={() => setOpen((current) => !current)}
        aria-label="SCB payment notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1.5 text-center text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">SCB Notifications</div>
              <div className="text-xs text-[var(--text-muted)]">{unreadCount} unread</div>
            </div>
            <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={handleReadAll}>
              อ่านทั้งหมด
            </button>
          </div>
          <div className="max-h-[360px] overflow-auto">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No SCB payment notifications.</div>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                className="block w-full border-b border-[var(--border-default)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--bg-surface-hover)]"
                onClick={handleItemClick}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.body}</div>
                  </div>
                  {!item.is_read && <span className="mt-1 h-2 w-2 rounded-full bg-rose-600" />}
                </div>
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
