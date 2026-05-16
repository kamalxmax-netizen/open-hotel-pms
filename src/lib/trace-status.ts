export type TraceStatus = "open" | "done" | "cancelled";
export type TraceStatusAction = "done" | "cancelled" | "restore";

export const TRACE_ACTION_ERROR = "action must be 'done', 'cancelled', or 'restore'";

type TraceStatusUpdate =
  | {
      ok: true;
      update: {
        status: TraceStatus;
        resolved_at: string | null;
        resolved_by: string | null;
      } | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export function parseTraceAction(action: unknown): TraceStatusAction | null {
  if (action === "done" || action === "cancelled" || action === "restore") {
    return action;
  }
  return null;
}

export function buildTraceStatusUpdate({
  action,
  currentStatus,
  nowIso,
  resolvedBy,
}: {
  action: TraceStatusAction;
  currentStatus: TraceStatus;
  nowIso: string;
  resolvedBy?: string | null;
}): TraceStatusUpdate {
  if (action === "restore") {
    if (currentStatus === "open") {
      return { ok: true, update: null };
    }
    if (currentStatus !== "cancelled") {
      return {
        ok: false,
        status: 400,
        error: "Only cancelled traces can be restored.",
      };
    }
    return {
      ok: true,
      update: {
        status: "open",
        resolved_at: null,
        resolved_by: null,
      },
    };
  }

  if (currentStatus !== "open") {
    return { ok: true, update: null };
  }

  return {
    ok: true,
    update: {
      status: action,
      resolved_at: nowIso,
      resolved_by: resolvedBy ?? null,
    },
  };
}
