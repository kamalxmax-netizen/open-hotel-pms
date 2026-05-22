"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  Layers2,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Undo2,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { normalizeTransferSenderName } from "@/lib/transfer-detail";
import { useAdminRole } from "@/hooks/use-admin-role";
import { isTransferAuditReadOnlyRole } from "@/lib/transfer-audit-auth";
import {
  addPaymentIds,
  addSameBookingGroupPaymentIds,
  addSameGroupNamePaymentIds,
  DRAFT_TRANSFER_SET_EDITOR_ID,
  findTransferAuditFocusedRow,
  getTransferSetEditorIdAfterSelect,
  getTransferSetEditorId,
  getTransferSetSaveAction,
  removePaymentId,
  shouldBlockTransferSetSwitch,
  shouldCollapseTransferSetEditor,
  splitWorkspaceCandidates,
} from "@/lib/transfer-audit-workspace";

type TransferCandidate = {
  id: string;
  transfer_event_id: string | null;
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  room_number: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
  booking_group_id: string | null;
  group_code: string | null;
  group_name: string | null;
  paid_date: string | null;
  paid_at: string | null;
  tx_type: string | null;
  amount: number;
  note: string | null;
  cashier_name: string | null;
  revenue_category: string | null;
  search_text: string;
};

type TransferAuditRow = {
  id: string;
  kind: "grouped" | "unlinked";
  status: "grouped" | "needs_detail";
  transfer_event_id: string | null;
  payment_id: string | null;
  payment_ids: string[];
  payment_count: number;
  payments: TransferCandidate[];
  paid_date: string | null;
  transfer_at: string | null;
  recorded_at: string | null;
  amount: number;
  actual_amount: number | null;
  folio_amount: number;
  delta: number | null;
  sender_name: string | null;
  bank_ref: string | null;
  transfer_note: string | null;
  booking_codes: string[];
  guest_names: string[];
  room_numbers: string[];
  group_names: string[];
  group_codes: string[];
  booking_code: string | null;
  guest_name: string | null;
  room_number: string | null;
};

type TransferAuditSummary = {
  needs_detail_count: number;
  grouped_count: number;
  grouped_total: number;
  total_amount: number;
};

type DetailForm = {
  senderName: string;
  bankRef: string;
  transferAt: string;
  note: string;
};

const EMPTY_SUMMARY: TransferAuditSummary = {
  needs_detail_count: 0,
  grouped_count: 0,
  grouped_total: 0,
  total_amount: 0,
};

function todayInBangkok(): string {
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function readSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function readDateParam(params: URLSearchParams | null, name: string): string | null {
  const value = params?.get(name)?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function readFocusParam(params: URLSearchParams | null): string | null {
  const value = params?.get("focus")?.trim() ?? "";
  return value || null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toBangkokDateTimeLocal(value: string | null): string {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const bangkok = new Date(safeDate.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const yyyy = bangkok.getFullYear();
  const mm = String(bangkok.getMonth() + 1).padStart(2, "0");
  const dd = String(bangkok.getDate()).padStart(2, "0");
  const hh = String(bangkok.getHours()).padStart(2, "0");
  const mi = String(bangkok.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function splitDateTimeLocal(value: string): { date: string; time: string } {
  const [date = "", timeRaw = ""] = String(value ?? "").split("T");
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInBangkok(),
    time: /^[0-9:]{0,5}$/.test(timeRaw) ? timeRaw.slice(0, 5) : "00:00",
  };
}

function combineDateTimeLocal(date: string, time: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInBangkok();
  return `${safeDate}T${time}`;
}

function normalizeTime24(value: string, fallback = "00:00"): string {
  const cleaned = String(value ?? "").trim();
  const match = cleaned.match(/^(\d{1,2})(?::?(\d{0,2}))?$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = match[2] === undefined || match[2] === "" ? 0 : Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function compactJoin(values: Array<string | null | undefined>, fallback = "-"): string {
  const unique = Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (unique.length === 0) return fallback;
  if (unique.length <= 3) return unique.join(", ");
  return `${unique.slice(0, 3).join(", ")} +${unique.length - 3}`;
}

function rowSearchText(row: TransferAuditRow): string {
  return [
    row.booking_codes.join(" "),
    row.guest_names.join(" "),
    row.room_numbers.join(" "),
    row.group_names.join(" "),
    row.group_codes.join(" "),
    row.sender_name,
    row.bank_ref,
    row.transfer_note,
    row.payments.map((payment) => payment.note).join(" "),
  ].join(" ").toLowerCase();
}

function candidateSearchText(candidate: TransferCandidate): string {
  return [
    candidate.search_text,
    candidate.booking_code,
    candidate.guest_name,
    candidate.room_number,
    candidate.group_code,
    candidate.group_name,
    candidate.note,
  ].join(" ").toLowerCase();
}

function defaultFormForSet(row: TransferAuditRow | null): DetailForm {
  return {
    senderName: row?.sender_name ?? "",
    bankRef: row?.bank_ref ?? "",
    transferAt: toBangkokDateTimeLocal(row?.transfer_at ?? row?.recorded_at ?? null),
    note: row?.transfer_note ?? "",
  };
}

function defaultFormForCandidate(candidate: TransferCandidate): DetailForm {
  return {
    senderName: normalizeTransferSenderName(candidate.guest_name),
    bankRef: "",
    transferAt: toBangkokDateTimeLocal(candidate.paid_at),
    note: "",
  };
}

function amountTotal(candidates: TransferCandidate[]): number {
  return Math.round(candidates.reduce((sum, candidate) => sum + Number(candidate.amount ?? 0), 0) * 100) / 100;
}

function humanizeTransferSetError(message: string): string {
  return message
    .replace(/transfer group/gi, "Transfer Set")
    .replace(/group amount/gi, "Transfer Set amount")
    .replace(/grouped/gi, "in a Transfer Set");
}

function transferSetBadge(selected: boolean, pendingMerge: boolean) {
  if (selected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-sky-900 hc:bg-sky-200 hc:text-sky-950">
        <CheckCircle2 className="h-3 w-3" />
        Selected
      </span>
    );
  }
  if (pendingMerge) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-cyan-900 hc:bg-cyan-200 hc:text-cyan-950">
        <Link2 className="h-3 w-3" />
        Will Merge
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 hc:border-emerald-900 hc:bg-emerald-200 hc:text-emerald-950">
      <Layers2 className="h-3 w-3" />
      Transfer Set
    </span>
  );
}

function needsDetailBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 hc:border-amber-900 hc:bg-amber-200 hc:text-amber-950">
      <Clock className="h-3 w-3" />
      Needs Detail
    </span>
  );
}

function candidateTitle(candidate: TransferCandidate): string {
  const booking = candidate.booking_code || "No booking";
  const room = candidate.room_number ? `Room ${candidate.room_number}` : "No room";
  return `${booking} · ${room}`;
}

function candidateSubtitle(candidate: TransferCandidate): string {
  const guest = candidate.guest_name || "Guest";
  const group = candidate.group_name || candidate.group_code || "No Booking Group";
  const type = candidate.tx_type === "deposit" ? "Deposit" : "Payment";
  return `Guest now: ${guest} · ${group} · ${type}`;
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

export default function TransferAuditPage() {
  const { role, loading: roleLoading } = useAdminRole();
  const [from, setFrom] = useState(todayInBangkok());
  const [to, setTo] = useState(todayInBangkok());
  const [query, setQuery] = useState("");
  const [needsQuery, setNeedsQuery] = useState("");
  const [rows, setRows] = useState<TransferAuditRow[]>([]);
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [summary, setSummary] = useState<TransferAuditSummary>(EMPTY_SUMMARY);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [draftSet, setDraftSet] = useState(false);
  const [expandedSetEditorId, setExpandedSetEditorId] = useState<string | null>(null);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [form, setForm] = useState<DetailForm>(defaultFormForSet(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [urlParamsReady, setUrlParamsReady] = useState(false);
  const focusRef = useRef<string | null>(null);
  const isOwnerReadOnly = isTransferAuditReadOnlyRole(role);
  const editControlsDisabled = roleLoading || isOwnerReadOnly;

  useEffect(() => {
    const params = readSearchParams();
    const nextFrom = readDateParam(params, "from");
    const nextTo = readDateParam(params, "to");
    focusRef.current = readFocusParam(params);
    if (nextFrom) setFrom(nextFrom);
    if (nextTo || nextFrom) setTo(nextTo ?? nextFrom ?? todayInBangkok());
    setUrlParamsReady(true);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const targetInsideTransferSetControls = Boolean(target?.closest("[data-transfer-set-controls='true']"));
      if (shouldCollapseTransferSetEditor({ targetInsideTransferSetControls })) {
        setExpandedSetEditorId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldCollapseTransferSetEditor({ key: event.key })) {
        setExpandedSetEditorId(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const transferSets = useMemo(
    () => rows.filter((row) => row.kind === "grouped"),
    [rows]
  );

  const selectedSet = useMemo(
    () => transferSets.find((row) => row.id === selectedSetId) ?? null,
    [selectedSetId, transferSets]
  );

  const currentSetId = draftSet ? null : selectedSet?.transfer_event_id ?? null;

  const candidateById = useMemo(() => {
    const map = new Map<string, TransferCandidate>();
    for (const candidate of candidates) map.set(candidate.id, candidate);
    return map;
  }, [candidates]);

  const selectedCandidates = useMemo(
    () => selectedPaymentIds.map((id) => candidateById.get(id)).filter(Boolean) as TransferCandidate[],
    [candidateById, selectedPaymentIds]
  );

  const selectedTotal = useMemo(() => amountTotal(selectedCandidates), [selectedCandidates]);

  const workspaceSplit = useMemo(
    () => splitWorkspaceCandidates(candidates, selectedPaymentIds, currentSetId),
    [candidates, currentSetId, selectedPaymentIds]
  );

  const filteredTransferSets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return transferSets;
    return transferSets.filter((row) => rowSearchText(row).includes(needle));
  }, [query, transferSets]);

  const filteredNeedsDetail = useMemo(() => {
    const needle = needsQuery.trim().toLowerCase();
    if (!needle) return workspaceSplit.needsDetail as TransferCandidate[];
    return (workspaceSplit.needsDetail as TransferCandidate[]).filter((candidate) =>
      candidateSearchText(candidate).includes(needle)
    );
  }, [needsQuery, workspaceSplit.needsDetail]);

  const selectedSourceSetIds = useMemo(() => {
    const ids = selectedCandidates
      .map((candidate) => String(candidate.transfer_event_id ?? "").trim())
      .filter((id) => id && id !== currentSetId);
    return new Set(ids);
  }, [currentSetId, selectedCandidates]);

  const dirty = useMemo(() => {
    if (draftSet) return selectedPaymentIds.length > 0;
    if (!selectedSet) return false;
    return (
      !sameIds(selectedPaymentIds, selectedSet.payment_ids)
      || form.senderName !== (selectedSet.sender_name ?? "")
      || form.bankRef !== (selectedSet.bank_ref ?? "")
      || form.note !== (selectedSet.transfer_note ?? "")
      || form.transferAt !== toBangkokDateTimeLocal(selectedSet.transfer_at ?? selectedSet.recorded_at ?? null)
    );
  }, [draftSet, form, selectedPaymentIds, selectedSet]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, limit: "500", _ts: String(Date.now()) });
      const response = await fetch(`/api/transfer-events?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to load Transfer Audit.");
      }

      const nextRows = (data.rows ?? []) as TransferAuditRow[];
      const nextCandidates = (data.candidate_payments ?? []) as TransferCandidate[];
      setRows(nextRows);
      setCandidates(nextCandidates);
      setSummary(data.summary ?? EMPTY_SUMMARY);

      const focusId = focusRef.current;
      if (focusId) {
        const focused = findTransferAuditFocusedRow(nextRows, focusId);
        const focusedCandidateId = focused?.payment_id ?? focused?.payment_ids?.[0] ?? focusId;
        const focusedCandidate = nextCandidates.find((candidate) => candidate.id === focusedCandidateId)
          ?? focused?.payments.find((candidate) => candidate.id === focusedCandidateId)
          ?? focused?.payments[0];
        focusRef.current = null;

        if (focused?.kind === "grouped") {
          setDraftSet(false);
          setSelectedSetId(focused.id);
          setSelectedPaymentIds(focused.payment_ids);
          setForm(defaultFormForSet(focused));
          setExpandedSetEditorId(getTransferSetEditorId(false, focused.id));
          setWorkspaceError("");
          return nextRows;
        }
        if (focusedCandidate) {
          setDraftSet(true);
          setSelectedSetId(null);
          setSelectedPaymentIds([focusedCandidate.id]);
          setForm(defaultFormForCandidate(focusedCandidate));
          setExpandedSetEditorId(getTransferSetEditorId(true, null));
          setWorkspaceError("");
          return nextRows;
        }

        setDraftSet(false);
        setSelectedSetId(null);
        setSelectedPaymentIds([]);
        setForm(defaultFormForSet(null));
        setExpandedSetEditorId(null);
        setWorkspaceError("");
        setError("Focused transfer was not found in this date range.");
        return nextRows;
      }

      const nextTransferSets = nextRows.filter((row) => row.kind === "grouped");
      setSelectedSetId((current) => {
        if (draftSet) return current;
        if (current && nextTransferSets.some((row) => row.id === current)) return current;
        const first = nextTransferSets[0] ?? null;
        if (!first) return null;
        setSelectedPaymentIds(first.payment_ids);
        setForm(defaultFormForSet(first));
        return first.id;
      });

      return nextRows;
    } catch (err) {
      setError(err instanceof Error ? humanizeTransferSetError(err.message) : "Failed to load Transfer Audit.");
      setRows([]);
      setCandidates([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [draftSet, from, to]);

  useEffect(() => {
    if (!urlParamsReady) return;
    void fetchRows();
  }, [fetchRows, urlParamsReady]);

  function keepCurrentEditorOpen() {
    setExpandedSetEditorId(getTransferSetEditorId(draftSet, selectedSetId));
  }

  function blockUnsavedSetSwitch() {
    setWorkspaceError("Save the current Transfer Set before switching to another Set.");
    keepCurrentEditorOpen();
  }

  function blockReadOnlyOwnerEdit() {
    if (roleLoading) {
      setWorkspaceError("Checking your role before editing Transfer Sets.");
      keepCurrentEditorOpen();
      return;
    }
    setWorkspaceError("Owner role can view Transfer Audit but cannot edit Transfer Sets.");
    keepCurrentEditorOpen();
  }

  function selectTransferSet(row: TransferAuditRow, options: { expand?: boolean } = {}) {
    if (shouldBlockTransferSetSwitch({ dirty, draftSet, currentSetId: selectedSetId, nextSetId: row.id })) {
      blockUnsavedSetSwitch();
      return;
    }
    setWorkspaceError("");
    setDraftSet(false);
    setSelectedSetId(row.id);
    setSelectedPaymentIds(row.payment_ids);
    setForm(defaultFormForSet(row));
    setExpandedSetEditorId(getTransferSetEditorIdAfterSelect({
      nextSetId: row.id,
      currentEditorId: expandedSetEditorId,
      expand: options.expand === true,
    }));
  }

  function toggleTransferSetEditor(row: TransferAuditRow) {
    if (!draftSet && selectedSetId === row.id && expandedSetEditorId === row.id) {
      setExpandedSetEditorId(null);
      return;
    }
    selectTransferSet(row, { expand: true });
  }

  function startDraftSet(candidate?: TransferCandidate) {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    if (dirty) {
      blockUnsavedSetSwitch();
      return;
    }
    setWorkspaceError("");
    setDraftSet(true);
    setSelectedSetId(null);
    setSelectedPaymentIds(candidate ? [candidate.id] : []);
    setForm(candidate ? defaultFormForCandidate(candidate) : defaultFormForSet(null));
    setExpandedSetEditorId(getTransferSetEditorId(true, null));
  }

  function addCandidateToSelectedSet(candidate: TransferCandidate) {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    setWorkspaceError("");
    if (!selectedSet && !draftSet) {
      startDraftSet(candidate);
      return;
    }
    setSelectedPaymentIds((current) => addPaymentIds(current, [candidate.id]));
    keepCurrentEditorOpen();
  }

  function removeCandidateFromSelectedSet(candidate: TransferCandidate) {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    setWorkspaceError("");
    setSelectedPaymentIds((current) => removePaymentId(current, candidate.id));
    keepCurrentEditorOpen();
  }

  function mergeTransferSetIntoSelected(row: TransferAuditRow) {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    setWorkspaceError("");
    if (!selectedSet && !draftSet) {
      selectTransferSet(row);
      return;
    }
    setSelectedPaymentIds((current) => addPaymentIds(current, row.payment_ids));
  }

  function addSameBookingGroup() {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    setSelectedPaymentIds((current) =>
      addSameBookingGroupPaymentIds(current, candidates, selectedCandidates, currentSetId)
    );
  }

  function addSameGroupName() {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    setSelectedPaymentIds((current) =>
      addSameGroupNamePaymentIds(current, candidates, selectedCandidates, currentSetId)
    );
  }

  async function saveSet() {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    if (!selectedSet && !draftSet) {
      setWorkspaceError("Select or start a Transfer Set first.");
      return;
    }
    if (selectedPaymentIds.length === 0) {
      if (selectedSet) {
        await archiveSelectedSet(true);
        return;
      }
      setWorkspaceError("Add at least one booking row before saving this Transfer Set.");
      return;
    }

    const formParts = splitDateTimeLocal(form.transferAt);
    const normalizedTransferAt = combineDateTimeLocal(
      formParts.date,
      normalizeTime24(formParts.time, formParts.time)
    );
    setSaving(true);
    setWorkspaceError("");
    try {
      const payload = {
        folio_payment_ids: selectedPaymentIds,
        detail: {
          sender_name: form.senderName,
          bank_ref: form.bankRef,
          transfer_at: normalizedTransferAt,
          note: form.note,
        },
      };

      const url = selectedSet
        ? `/api/transfer-events/${encodeURIComponent(selectedSet.transfer_event_id || selectedSet.id)}`
        : "/api/transfer-events/group";
      const method = selectedSet ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to save Transfer Set.");
      }

      setDraftSet(false);
      const nextRows = await fetchRows();
      const savedId = String(data.transfer_event_id ?? "");
      const savedRow = nextRows.find((row) => row.transfer_event_id === savedId || row.id === savedId);
      if (savedRow) {
        setSelectedSetId(savedRow.id);
        setSelectedPaymentIds(savedRow.payment_ids);
        setForm(defaultFormForSet(savedRow));
        setExpandedSetEditorId(getTransferSetEditorId(false, savedRow.id));
      }
    } catch (err) {
      setWorkspaceError(humanizeTransferSetError(err instanceof Error ? err.message : "Failed to save Transfer Set."));
    } finally {
      setSaving(false);
    }
  }

  async function archiveSelectedSet(confirmArchive = true) {
    if (editControlsDisabled) {
      blockReadOnlyOwnerEdit();
      return;
    }
    if (!selectedSet?.transfer_event_id) return;
    if (confirmArchive) {
      const ok = window.confirm("Archive this Transfer Set? Payment rows stay in folio and notes are restored.");
      if (!ok) return;
    }

    setSaving(true);
    setWorkspaceError("");
    try {
      const response = await fetch(`/api/transfer-events/${encodeURIComponent(selectedSet.transfer_event_id)}/archive`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to archive Transfer Set.");
      }
      setSelectedSetId(null);
      setSelectedPaymentIds([]);
      setForm(defaultFormForSet(null));
      setExpandedSetEditorId(null);
      await fetchRows();
    } catch (err) {
      setWorkspaceError(humanizeTransferSetError(err instanceof Error ? err.message : "Failed to archive Transfer Set."));
    } finally {
      setSaving(false);
    }
  }

  const selectedLabel = draftSet ? "New Transfer Set" : selectedSet ? "Selected Transfer Set" : "No Transfer Set selected";
  const transferSetSaveAction = getTransferSetSaveAction({
    draftSet,
    hasSelectedSet: Boolean(selectedSet),
    selectedPaymentCount: selectedPaymentIds.length,
  });

  function renderTransferSetEditor() {
    const transferDateTime = splitDateTimeLocal(form.transferAt);
    return (
      <div className="mt-3 border-t border-sky-200 pt-3 dark:border-sky-500/20 hc:border-black">
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_96px]">
            <label className="block">
              <span className="form-label">Transfer date</span>
              <input
                className="form-input h-9"
                type="date"
                value={transferDateTime.date}
                disabled={editControlsDisabled}
                onChange={(event) => setForm((current) => {
                  const currentParts = splitDateTimeLocal(current.transferAt);
                  return {
                    ...current,
                    transferAt: combineDateTimeLocal(event.target.value, currentParts.time),
                  };
                })}
              />
            </label>
            <label className="block">
              <span className="form-label">Time (24h)</span>
              <input
                className="form-input h-9 font-mono"
                type="text"
                inputMode="numeric"
                placeholder="HH:mm"
                value={transferDateTime.time}
                disabled={editControlsDisabled}
                onChange={(event) => setForm((current) => {
                  const currentParts = splitDateTimeLocal(current.transferAt);
                  return {
                    ...current,
                    transferAt: combineDateTimeLocal(currentParts.date, event.target.value),
                  };
                })}
                onBlur={(event) => setForm((current) => {
                  const currentParts = splitDateTimeLocal(current.transferAt);
                  return {
                    ...current,
                    transferAt: combineDateTimeLocal(currentParts.date, normalizeTime24(event.target.value, currentParts.time)),
                  };
                })}
              />
            </label>
          </div>
          <label className="block">
            <span className="form-label">Sender / account name</span>
            <input
              className="form-input h-9"
              value={form.senderName}
              disabled={editControlsDisabled}
              onChange={(event) => setForm((current) => ({ ...current, senderName: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label className="block">
            <span className="form-label">Reference no.</span>
            <input
              className="form-input h-9"
              value={form.bankRef}
              disabled={editControlsDisabled}
              onChange={(event) => setForm((current) => ({ ...current, bankRef: event.target.value }))}
              placeholder="Bank ref / slip no."
            />
          </label>
          <label className="block">
            <span className="form-label">Additional note</span>
            <textarea
              className="form-input min-h-[70px] resize-y py-2"
              value={form.note}
              disabled={editControlsDisabled}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="Optional context"
            />
          </label>
        </div>

        {workspaceError && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 hc:border-rose-900 hc:bg-rose-100 hc:text-rose-950">
            {workspaceError}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary h-9 text-xs" onClick={addSameBookingGroup} disabled={saving || editControlsDisabled || selectedCandidates.length === 0}>
            Same Booking Group
          </button>
          <button type="button" className="btn btn-secondary h-9 text-xs" onClick={addSameGroupName} disabled={saving || editControlsDisabled || selectedCandidates.length === 0}>
            Same Group Name
          </button>
          <button
            type="button"
            className={`btn col-span-2 h-10 ${
              transferSetSaveAction === "archive_empty"
                ? "border-amber-700 bg-amber-600 text-white hover:bg-amber-700 hc:border-amber-950 hc:bg-amber-300 hc:text-amber-950"
                : "btn-primary"
            }`}
            onClick={() => void saveSet()}
            disabled={saving || editControlsDisabled || transferSetSaveAction === "disabled"}
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : transferSetSaveAction === "archive_empty" ? (
              <Archive className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isOwnerReadOnly ? "View Only" : transferSetSaveAction === "archive_empty" ? "Archive Empty Set" : "Save Set"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full flex-col bg-[var(--bg-body)] hc:bg-white hc:text-black">
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-5 py-4 hc:border-black hc:bg-white">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-[var(--text-muted)] hc:text-black">
              <ArrowDownUp className="h-4 w-4" />
              Audit & Finance
            </div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] hc:text-black">Transfer Audit</h1>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="form-label">From</span>
              <input className="form-input h-9 w-[150px]" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="block">
              <span className="form-label">To</span>
              <input className="form-input h-9 w-[150px]" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <label className="block min-w-[280px]">
              <span className="form-label">Search Sets</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)] hc:text-black" />
                <input
                  className="form-input h-9 pl-8"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Booking, guest, room, Booking Group, ref"
                />
              </div>
            </label>
            <button type="button" className="btn btn-secondary h-9" onClick={() => void fetchRows()} disabled={loading || saving}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-bold text-[var(--text-secondary)] hc:text-black">
          <span>Transfer Sets {summary.grouped_count}</span>
          <span>Needs Detail {workspaceSplit.needsDetail.length}</span>
          <span>Total ฿{formatMoney(summary.total_amount)}</span>
          {dirty && (
            <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-1 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-sky-900 hc:bg-sky-100 hc:text-sky-950">
              Unsaved changes
            </span>
          )}
          {isOwnerReadOnly && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200 hc:border-amber-900 hc:bg-amber-100 hc:text-amber-950">
              Owner view only
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 hc:border-rose-900 hc:bg-rose-100 hc:text-rose-950">
          {error}
        </div>
      )}

      <main className="grid flex-1 gap-3 p-3 xl:grid-cols-[minmax(290px,0.95fr)_minmax(360px,1.15fr)_minmax(290px,0.95fr)] xl:overflow-hidden">
        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hc:border-black hc:bg-white">
          <div className="border-b border-[var(--border-default)] px-4 py-3 hc:border-black">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-[var(--text-primary)] hc:text-black">Transfer Sets</h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)] hc:text-black">Bank transfer evidence units.</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary h-8 shrink-0 text-xs"
                onClick={() => startDraftSet()}
                disabled={saving || editControlsDisabled}
              >
                <Plus className="h-4 w-4" />
                New
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {draftSet && (
              <div
                data-transfer-set-controls="true"
                className="rounded-lg border-2 border-sky-300 bg-sky-50/80 p-3 shadow-sm transition-colors dark:border-sky-500/30 dark:bg-sky-500/15 hc:border-sky-900 hc:bg-sky-100 hc:text-sky-950"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-sky-800 dark:text-sky-200 hc:text-sky-950">
                      {selectedLabel}
                    </div>
                    <div className="font-mono text-2xl font-black text-[var(--text-primary)] hc:text-sky-950">฿{formatMoney(selectedTotal)}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)] hc:text-sky-900">
                      {selectedPaymentIds.length} linked folio row{selectedPaymentIds.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-white text-sky-800 transition hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-sky-900 hc:bg-sky-200 hc:text-sky-950 hc:hover:bg-sky-300"
                    onClick={() => setExpandedSetEditorId((current) => current === DRAFT_TRANSFER_SET_EDITOR_ID ? null : DRAFT_TRANSFER_SET_EDITOR_ID)}
                    aria-expanded={expandedSetEditorId === DRAFT_TRANSFER_SET_EDITOR_ID}
                    aria-label={expandedSetEditorId === DRAFT_TRANSFER_SET_EDITOR_ID ? "Collapse Transfer Set details" : "Expand Transfer Set details"}
                    title={expandedSetEditorId === DRAFT_TRANSFER_SET_EDITOR_ID ? "Collapse details" : "Expand details"}
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedSetEditorId === DRAFT_TRANSFER_SET_EDITOR_ID ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {expandedSetEditorId === DRAFT_TRANSFER_SET_EDITOR_ID && renderTransferSetEditor()}
              </div>
            )}

            {loading ? (
              <div className="py-10 text-center text-sm text-[var(--text-secondary)] hc:text-black">Loading Transfer Sets...</div>
            ) : filteredTransferSets.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border-default)] px-4 py-8 text-center text-sm text-[var(--text-secondary)] hc:border-black hc:text-black">
                No Transfer Sets in this date range.
              </div>
            ) : (
              filteredTransferSets.map((row) => {
                const selected = selectedSetId === row.id && !draftSet;
                const pendingMerge = Boolean(row.transfer_event_id && selectedSourceSetIds.has(row.transfer_event_id));
                const expanded = selected && expandedSetEditorId === row.id;
                return (
                  <div
                    key={row.id}
                    data-transfer-set-controls="true"
                    className={`w-full rounded-lg border p-3 text-left shadow-sm transition-colors hc:text-black ${
                      selected
                        ? "border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15 hc:border-sky-900 hc:bg-sky-100"
                        : pendingMerge
                          ? "border-sky-200 bg-sky-50/60 dark:border-sky-500/20 dark:bg-sky-500/10 hc:border-cyan-900 hc:bg-cyan-100"
                          : "border-[var(--border-default)] bg-[var(--bg-body)] hover:bg-[var(--bg-surface-hover)] hc:border-slate-700 hc:bg-white hc:hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => selectTransferSet(row)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          {transferSetBadge(selected, pendingMerge)}
                          <span className="font-mono text-lg font-black text-[var(--text-primary)] hc:text-black">฿{formatMoney(row.amount)}</span>
                        </div>
                        <div className="mt-2 text-sm font-bold text-[var(--text-primary)] hc:text-black">{formatDateTime(row.transfer_at)}</div>
                        <div className="mt-1 truncate text-xs text-[var(--text-secondary)] hc:text-black">
                          {row.sender_name || compactJoin(row.guest_names, "No sender")} · Ref {row.bank_ref || "-"}
                        </div>
                        <div className="mt-1 truncate text-xs text-[var(--text-muted)] hc:text-black">
                          {compactJoin(row.booking_codes)} · {compactJoin(row.room_numbers, "No room")}
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => toggleTransferSetEditor(row)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-sky-300 bg-white text-sky-800 transition hover:bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-sky-900 hc:bg-sky-200 hc:text-sky-950 hc:hover:bg-sky-300"
                          aria-expanded={expanded}
                          aria-label={expanded ? "Collapse Transfer Set details" : "Expand Transfer Set details"}
                          title={expanded ? "Collapse details" : "Expand details"}
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </div>
                    {expanded && renderTransferSetEditor()}
                    {!editControlsDisabled && !selected && (selectedSet || draftSet) && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            mergeTransferSetIntoSelected(row);
                          }}
                          className="inline-flex h-8 items-center rounded-md border border-sky-300 bg-white px-2 text-xs font-black text-sky-800 hover:bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200 hc:border-sky-900 hc:bg-sky-100 hc:text-sky-950 hc:hover:bg-sky-200"
                        >
                          Merge into selected Set
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hc:border-black hc:bg-white">
          <div className="border-b border-[var(--border-default)] px-4 py-3 hc:border-black">
            <h2 className="text-sm font-black text-[var(--text-primary)] hc:text-black">Bookings in Selected Set</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)] hc:text-black">
              {isOwnerReadOnly ? "Bookings currently linked to this Transfer Set." : "Click a booking row to move it back to Needs Detail before saving."}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {!selectedSet && !draftSet ? (
              <div className="rounded-md border border-dashed border-[var(--border-default)] px-4 py-10 text-center text-sm text-[var(--text-secondary)] hc:border-black hc:text-black">
                Select a Transfer Set or click a Needs Detail card to start.
              </div>
            ) : selectedCandidates.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-4 py-10 text-center text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 hc:border-amber-900 hc:bg-amber-100 hc:text-amber-950">
                This Transfer Set has no booking rows selected.
              </div>
            ) : (
              selectedCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => removeCandidateFromSelectedSet(candidate)}
                  disabled={editControlsDisabled}
                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-body)] p-3 text-left shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 hc:border-amber-900 hc:bg-amber-100 hc:text-amber-950 hc:hover:bg-amber-200"
                  title={isOwnerReadOnly ? "Owner view only" : "Move to Needs Detail"}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[var(--text-primary)] hc:text-black">{candidateTitle(candidate)}</div>
                      <div className="mt-1 truncate text-xs text-[var(--text-secondary)] hc:text-black">{candidateSubtitle(candidate)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-base font-black text-[var(--text-primary)] hc:text-black">฿{formatMoney(candidate.amount)}</div>
                      {candidate.transfer_event_id && candidate.transfer_event_id !== currentSetId && (
                        <div className="mt-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-800 dark:bg-sky-500/15 dark:text-sky-200 hc:border hc:border-sky-900 hc:bg-sky-200 hc:text-sky-950">
                          Merge
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 hc:text-amber-950">
                    <Undo2 className="h-3.5 w-3.5" />
                    Move to Needs Detail
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] hc:border-black hc:bg-white">
          <div className="border-b border-[var(--border-default)] px-4 py-3 hc:border-black">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-[var(--text-primary)] hc:text-black">Needs Detail</h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)] hc:text-black">
                  {isOwnerReadOnly ? "Transfer rows waiting for detail." : "Click a card to move it into the selected Transfer Set."}
                </p>
              </div>
              {needsDetailBadge()}
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--text-muted)] hc:text-black" />
              <input
                className="form-input h-9 pl-8"
                type="search"
                value={needsQuery}
                onChange={(event) => setNeedsQuery(event.target.value)}
                placeholder="Booking, guest, room, Booking Group"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {filteredNeedsDetail.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border-default)] px-4 py-10 text-center text-sm text-[var(--text-secondary)] hc:border-black hc:text-black">
                No rows need detail.
              </div>
            ) : (
              filteredNeedsDetail.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => addCandidateToSelectedSet(candidate)}
                  disabled={editControlsDisabled}
                  className="w-full rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50 dark:border-amber-500/30 dark:bg-amber-500/15 dark:hover:bg-sky-500/10 hc:border-amber-900 hc:bg-amber-100 hc:text-amber-950 hc:hover:bg-sky-100"
                  title={isOwnerReadOnly ? "Owner view only" : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-[var(--text-primary)] hc:text-black">{candidateTitle(candidate)}</div>
                      <div className="mt-1 truncate text-xs text-[var(--text-secondary)] hc:text-black">{candidateSubtitle(candidate)}</div>
                    </div>
                    <span className="shrink-0 font-mono text-base font-black text-[var(--text-primary)] hc:text-black">฿{formatMoney(candidate.amount)}</span>
                  </div>
                  <div className="mt-2 truncate text-xs text-[var(--text-muted)] hc:text-black">{candidate.note || "-"}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs font-bold text-sky-800 dark:text-sky-200 hc:text-sky-950">
                    <Plus className="h-3.5 w-3.5" />
                    {selectedSet || draftSet ? "Add to selected Set" : "Start new Transfer Set"}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
