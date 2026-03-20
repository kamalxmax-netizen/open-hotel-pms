"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EodStatusResponse } from "@/lib/types";

type NightAuditPendingPopupProps = {
  pageName: string;
};

const NIGHT_AUDIT_SNOOZE_KEY = "pms.night-audit-warning-snooze-until";

function getSnoozeUntil(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(NIGHT_AUDIT_SNOOZE_KEY);
  const parsed = Number(raw ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function setSnoozeUntil(untilMs: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NIGHT_AUDIT_SNOOZE_KEY, String(untilMs));
}

function clearSnooze() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(NIGHT_AUDIT_SNOOZE_KEY);
}

export default function NightAuditPendingPopup({
  pageName,
}: NightAuditPendingPopupProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EodStatusResponse | null>(null);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/eod/status", { cache: "no-store" });
        const data = (await response.json()) as Partial<EodStatusResponse>;
        if (!active) return;

        if (response.ok && data.success && data.needs_eod) {
          setStatus(data as EodStatusResponse);
          const snoozeUntil = getSnoozeUntil();
          setOpen(snoozeUntil <= Date.now());
          return;
        }

        setStatus(null);
        setOpen(false);
        clearSnooze();
      } catch {
        if (!active) return;
        setStatus(null);
        setOpen(false);
      }
    }

    loadStatus();
    return () => {
      active = false;
    };
  }, []);

  if (!status?.needs_eod) return null;

  function handleSnooze() {
    const snoozeMin = Math.max(1, Number(status?.night_audit_popup_snooze_min ?? 30));
    setSnoozeUntil(Date.now() + snoozeMin * 60 * 1000);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleSnooze();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden border-2 border-amber-300 bg-amber-50 p-0 dark:border-amber-500/30 dark:bg-zinc-950">
        <DialogHeader className="border-b border-amber-200 bg-amber-100 px-6 py-5 dark:border-amber-500/20 dark:bg-amber-950/40">
          <DialogTitle className="text-xl font-bold text-amber-950 dark:text-amber-300">
            Night Audit not done yet
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-amber-900 dark:text-amber-400">
            {pageName} is showing information of yesterday until Night Audit is completed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5 text-sm text-amber-950 dark:text-amber-500">
          <div className="rounded-xl border border-amber-200 bg-[var(--bg-surface)]/80 px-4 py-3 dark:border-amber-500/20">
            <p className="font-semibold">
              Business Date: <span className="font-bold">{status.business_date}</span>
            </p>
            <p className="mt-1">
              Calendar Date: <span className="font-bold">{status.calendar_date}</span>
            </p>
            <p className="mt-1">
              Overdue: <span className="font-bold">{status.days_overdue}</span> day
              {status.days_overdue === 1 ? "" : "s"}
            </p>
          </div>

          <p className="leading-6 text-amber-900 dark:text-amber-400/80">
            If you need today&apos;s correct status, run Night Audit first. This popup will
            appear every time you enter this page until Night Audit is done.
          </p>
        </div>

        <DialogFooter className="border-t border-amber-200 bg-amber-50 px-6 py-4 dark:border-amber-500/20 dark:bg-amber-950/40">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSnooze}
          >
            Remind Me In {Math.max(1, Number(status?.night_audit_popup_snooze_min ?? 30))} Min
          </button>
          <Link href="/pms/night-audit" className="btn btn-primary">
            Open Night Audit
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
