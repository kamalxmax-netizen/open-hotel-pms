"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { extractDepositGeneralNote } from "@/lib/deposit-ledger";

type PaymentMethod = "cash" | "transfer" | "credit_card";
type DepositPolicy = "keep" | "set";
type HkStatus = "approved" | "cleaned" | "dirty" | "in_progress" | "paused" | string | null;

type SplitPaymentDraft = {
  id: string;
  amount: string;
  method: PaymentMethod;
  note: string;
};

type SplitRoomPlan = {
  deposit_policy: DepositPolicy;
  deposit_amount: string;
  deposit_note: string;
  payments: SplitPaymentDraft[];
};

type MasterPaymentLine = {
  id: string;
  amount: string;
  method: PaymentMethod;
  note: string;
};

type WizardPartyGuest = {
  guest_profile_id: string;
  display_name: string;
  profile_status: string | null;
  nationality_code: string | null;
  id_number: string | null;
  passport_no: string | null;
  completeness: {
    is_complete: boolean;
    missing_fields: string[];
    is_thai: boolean;
  };
};

type WizardReservation = {
  id: string;
  booking_code: string;
  guest_name: string;
  status: string;
  room_number: string;
  room_type: string;
  hk_status: HkStatus;
  checkin_date: string;
  is_checked_in: boolean;
  has_assigned_room: boolean;
  selected: boolean;
  total_price: number;
  deposit_amount: number;
  remaining_balance: number;
  profile_completeness: {
    is_complete: boolean;
    missing_fields: string[];
  };
  primary_guest_profile_id: string | null;
  accompanying_guest_profile_ids: string[];
  party: {
    primary: WizardPartyGuest | null;
    accompanying: WizardPartyGuest[];
  };
};

type ConfirmRoomResult = {
  reservation_id: string;
  booking_code: string | null;
  guest_name: string | null;
  status: "ok" | "failed" | "skipped";
  codes: string[];
  error?: string;
  missing_fields?: string[];
  checked_in_at?: string;
};

type GuestSearchResult = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  member_no: string | null;
  profile_status: string | null;
  nationality_code: string | null;
};

type ScanPoolSource = "thai_id" | "passport_ocr" | "search";

type ScannedPoolItem = GuestSearchResult & {
  source: ScanPoolSource;
  scan_order: number;
  display_name: string | null;
};

type ThaiCardImportPayload = {
  citizenId?: string;
  firstNameTH?: string;
  lastNameTH?: string;
  firstNameEN?: string;
  lastNameEN?: string;
  birthday?: string;
  gender?: string;
  address?: string;
  province?: string;
};

type PassportOcrImportPayload = {
  firstName?: string | null;
  familyName?: string | null;
  nationality?: string | null;
  passportNumber?: string | null;
  gender?: "M" | "F" | "X" | null;
  dateOfBirth?: string | null;
  fieldStatus?: {
    passportNumber?: "ok" | "manual_check";
  };
};

type PaymentPreviewData = {
  payment_mode: "split" | "master";
  grand_total: number;
  payment_received: number;
  deposit_received: number;
  remaining_balance: number;
  submitted_payment_total: number;
  projected_remaining_balance: number;
  overpayment_amount: number;
  room_rows: Array<{
    reservation_id: string;
    booking_code: string;
    guest_name: string | null;
    total_price: number;
    payment_received: number;
    deposit_received: number;
    remaining_balance: number;
    planned_payment: number;
    projected_remaining: number;
  }>;
  allocation_preview: Array<{
    line_index: number;
    method: string;
    amount: number;
    allocations: Array<{
      reservation_id: string;
      booking_code: string;
      allocated_amount: number;
    }>;
  }>;
  validation_errors: string[];
};

const HK_BLOCKING = new Set(["dirty", "in_progress", "paused"]);

function paymentDraft(seed = "payment"): SplitPaymentDraft {
  return {
    id: `${seed}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    amount: "",
    method: "cash",
    note: "",
  };
}

function masterLine(seed = "master"): MasterPaymentLine {
  return {
    id: `${seed}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    amount: "",
    method: "cash",
    note: "",
  };
}

function toMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function defaultSplitPlanByDeposit(reservationId: string, existingDepositAmount = 0): SplitRoomPlan {
  const normalizedDeposit = toMoney(existingDepositAmount);
  const hasSavedDeposit = normalizedDeposit > 0;
  return {
    deposit_policy: hasSavedDeposit ? "keep" : "set",
    deposit_amount: hasSavedDeposit ? String(normalizedDeposit) : "200",
    deposit_note: "",
    payments: [paymentDraft(reservationId)],
  };
}

function mapHkBadge(status: HkStatus) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "approved" || normalized === "cleaned") {
    return { label: "Ready", className: "bg-emerald-100 text-emerald-700" };
  }
  if (normalized === "dirty") {
    return { label: "Dirty", className: "bg-amber-100 text-amber-700" };
  }
  if (normalized === "in_progress") {
    return { label: "In Progress", className: "bg-sky-100 text-sky-700" };
  }
  if (normalized === "paused") {
    return { label: "Paused", className: "bg-rose-100 text-rose-700" };
  }
  if (!normalized) {
    return { label: "—", className: "bg-[var(--bg-surface-hover)] text-[var(--text-muted)]" };
  }
  return { label: normalized, className: "bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]" };
}

function guestDisplayName(guest: GuestSearchResult): string {
  const explicit = "display_name" in guest ? String((guest as any).display_name ?? "").trim() : "";
  if (explicit) return explicit;
  const first = String(guest.first_name ?? "").trim();
  const last = String(guest.last_name ?? "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return guest.member_no ? `Member ${guest.member_no}` : guest.id;
}

function scanSourceLabel(source: ScanPoolSource): string {
  if (source === "thai_id") return "Thai ID";
  if (source === "passport_ocr") return "Passport OCR";
  return "Search";
}

function scanSourceBadgeClass(source: ScanPoolSource): string {
  if (source === "thai_id") return "bg-sky-100 text-sky-700";
  if (source === "passport_ocr") return "bg-purple-100 text-purple-700";
  return "bg-[var(--bg-muted)] text-[var(--text-table-cell)]";
}

export default function GroupCheckinWizardPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const groupId = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [groupData, setGroupData] = useState<any>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [reservations, setReservations] = useState<WizardReservation[]>([]);
  const [splitPlans, setSplitPlans] = useState<Record<string, SplitRoomPlan>>({});
  const [paymentMode, setPaymentMode] = useState<"split" | "master">("split");
  const [masterPayments, setMasterPayments] = useState<MasterPaymentLine[]>([masterLine("master")]);
  const [confirmResults, setConfirmResults] = useState<ConfirmRoomResult[] | null>(null);
  const [wizardDraftJson, setWizardDraftJson] = useState<Record<string, any>>({});

  const [guestQuery, setGuestQuery] = useState("");
  const [searchingGuests, setSearchingGuests] = useState(false);
  const [searchResults, setSearchResults] = useState<GuestSearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [scannedGuestPool, setScannedGuestPool] = useState<ScannedPoolItem[]>([]);
  const [step2Busy, setStep2Busy] = useState(false);
  const [targetReservationId, setTargetReservationId] = useState("");
  const [targetRole, setTargetRole] = useState<"primary" | "accompanying">("primary");

  const [loadingPaymentPreview, setLoadingPaymentPreview] = useState(false);
  const [paymentPreview, setPaymentPreview] = useState<PaymentPreviewData | null>(null);

  const backHref = `/pms/groups?group_id=${groupId}`;

  const selectedReservations = useMemo(
    () => reservations.filter((row) => row.selected),
    [reservations]
  );

  const selectedReservationIds = useMemo(
    () => selectedReservations.map((row) => row.id),
    [selectedReservations]
  );

  const selectedAssignedGuestIds = useMemo(() => {
    const ids = new Set<string>();
    selectedReservations.forEach((reservation) => {
      if (reservation.primary_guest_profile_id) ids.add(reservation.primary_guest_profile_id);
      reservation.accompanying_guest_profile_ids.forEach((id) => ids.add(id));
    });
    return ids;
  }, [selectedReservations]);

  function mapPartyGuest(raw: any): WizardPartyGuest {
    return {
      guest_profile_id: String(raw?.guest_profile_id ?? ""),
      display_name: String(raw?.display_name ?? "Unknown Guest"),
      profile_status: raw?.profile_status ? String(raw.profile_status) : null,
      nationality_code: raw?.nationality_code ? String(raw.nationality_code) : null,
      id_number: raw?.id_number ? String(raw.id_number) : null,
      passport_no: raw?.passport_no ? String(raw.passport_no) : null,
      completeness: {
        is_complete: Boolean(raw?.completeness?.is_complete),
        missing_fields: Array.isArray(raw?.completeness?.missing_fields)
          ? raw.completeness.missing_fields.map((value: unknown) => String(value))
          : [],
        is_thai: Boolean(raw?.completeness?.is_thai),
      },
    };
  }

  function mapReservationLine(line: any, selectedIds: Set<string>): WizardReservation {
    const primary = line?.party?.primary ? mapPartyGuest(line.party.primary) : null;
    const accompanying = Array.isArray(line?.party?.accompanying)
      ? line.party.accompanying.map((guest: any) => mapPartyGuest(guest))
      : [];

    return {
      id: String(line.reservation_id),
      booking_code: String(line.booking_code ?? ""),
      guest_name: String(line.guest_name ?? ""),
      status: String(line.status ?? ""),
      room_number: line.room_number ? String(line.room_number) : "—",
      room_type: line.room_type ? String(line.room_type) : "—",
      hk_status: (line.hk_status ?? null) as HkStatus,
      checkin_date: String(line.checkin_date ?? ""),
      is_checked_in: Boolean(line.is_checked_in),
      has_assigned_room: Boolean(line.has_assigned_room),
      selected: selectedIds.has(String(line.reservation_id)),
      total_price: toMoney(line.total_price),
      deposit_amount: toMoney(line.deposit_amount),
      remaining_balance: toMoney(line.remaining_balance),
      profile_completeness: {
        is_complete: Boolean(line?.profile_completeness?.is_complete),
        missing_fields: Array.isArray(line?.profile_completeness?.missing_fields)
          ? line.profile_completeness.missing_fields.map((value: unknown) => String(value))
          : [],
      },
      primary_guest_profile_id: line?.primary_guest_profile_id
        ? String(line.primary_guest_profile_id)
        : primary?.guest_profile_id ?? null,
      accompanying_guest_profile_ids: Array.isArray(line?.accompanying_guest_profile_ids)
        ? line.accompanying_guest_profile_ids.map((value: unknown) => String(value))
        : accompanying.map((guest: WizardPartyGuest) => guest.guest_profile_id),
      party: {
        primary,
        accompanying,
      },
    };
  }

  function buildReservationRows(data: any): WizardReservation[] {
    const selectedIds = new Set<string>(
      Array.isArray(data?.selection?.selected_reservation_ids)
        ? data.selection.selected_reservation_ids.map((value: unknown) => String(value))
        : []
    );

    return Array.isArray(data?.reservation_lines)
      ? data.reservation_lines.map((line: any) => mapReservationLine(line, selectedIds))
      : [];
  }

  function buildPlanFromDraftRow(raw: any, reservationId: string, existingDepositAmount = 0): SplitRoomPlan {
    const payments = Array.isArray(raw?.payments) ? raw.payments : [];
    const draftDepositAmount = toMoney(raw?.deposit_amount ?? existingDepositAmount);
    const draftPolicy = raw?.deposit_policy === "set" ? "set" : "keep";
    const looksLikeLegacyDefaultKeep =
      draftPolicy === "keep"
      && existingDepositAmount <= 0
      && toMoney(raw?.deposit_amount ?? 0) === 200
      && String(raw?.deposit_note ?? "").trim() === "";
    const effectivePolicy: DepositPolicy = looksLikeLegacyDefaultKeep ? "set" : draftPolicy;

    return {
      deposit_policy: effectivePolicy,
      deposit_amount: String(draftDepositAmount > 0 ? draftDepositAmount : 200),
      deposit_note: extractDepositGeneralNote(raw?.deposit_note) ?? "",
      payments: payments.length > 0
        ? payments.map((payment: any, idx: number) => ({
          id: `${reservationId}-${idx}-${Math.random().toString(16).slice(2)}`,
          amount: String(payment?.amount ?? ""),
          method: payment?.method === "transfer"
            || payment?.method === "credit_card"
            ? payment.method
            : "cash",
          note: String(payment?.note ?? ""),
        }))
        : [paymentDraft(reservationId)],
    };
  }

  async function reloadReservationSnapshot() {
    const response = await fetch(
      `/api/booking-groups/${groupId}/checkin-wizard?business_date=${encodeURIComponent(businessDate || "")}`,
      { cache: "no-store" }
    );
    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Failed to reload wizard.");
    }
    setBusinessDate(String(data.business_date ?? ""));
    setGroupData(data.group ?? null);
    const draftJson =
      data?.draft?.draft_json && typeof data.draft.draft_json === "object"
        ? data.draft.draft_json
        : {};
    setWizardDraftJson(draftJson);
    setReservations(buildReservationRows(data));
  }

  const step4Buckets = useMemo(() => {
    const ready: WizardReservation[] = [];
    const notReady: Array<{ row: WizardReservation; reasons: string[] }> = [];
    const done: WizardReservation[] = [];

    for (const row of selectedReservations) {
      if (row.is_checked_in) {
        done.push(row);
        continue;
      }

      const reasons: string[] = [];
      if (!row.has_assigned_room) reasons.push("room_not_assigned");
      if (HK_BLOCKING.has(String(row.hk_status ?? ""))) reasons.push("hk_not_ready");
      if (!row.profile_completeness.is_complete) reasons.push("profile_incomplete");
      if (businessDate && row.checkin_date && row.checkin_date !== businessDate) reasons.push("not_due_in_today");

      if (reasons.length > 0) notReady.push({ row, reasons });
      else ready.push(row);
    }

    return { ready, notReady, done };
  }, [selectedReservations, businessDate]);

  const selectedRemainingTotal = useMemo(
    () => selectedReservations.reduce((sum, row) => sum + toMoney(row.remaining_balance), 0),
    [selectedReservations]
  );

  const plannedPaymentTotal = useMemo(() => {
    if (paymentMode === "master") {
      return masterPayments.reduce((sum, line) => sum + Math.max(0, toMoney(line.amount)), 0);
    }
    return selectedReservations.reduce((sum, row) => {
      const plan = splitPlans[row.id];
      if (!plan) return sum;
      const roomPlanned = plan.payments.reduce(
        (lineSum, payment) => lineSum + Math.max(0, toMoney(payment.amount)),
        0
      );
      return sum + roomPlanned;
    }, 0);
  }, [paymentMode, masterPayments, selectedReservations, splitPlans]);

  const projectedRemainingTotal = useMemo(
    () => Math.max(0, toMoney(selectedRemainingTotal - plannedPaymentTotal)),
    [selectedRemainingTotal, plannedPaymentTotal]
  );

  useEffect(() => {
    setTargetReservationId((prev) => {
      if (prev && selectedReservations.some((row) => row.id === prev)) return prev;
      return selectedReservations[0]?.id ?? "";
    });
  }, [selectedReservations]);

  useEffect(() => {
    setPaymentPreview(null);
  }, [paymentMode, selectedReservationIds.join(","), masterPayments, splitPlans]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setInfo("");
      setConfirmResults(null);
      try {
        const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard`, {
          cache: "no-store",
        });
        const data = await response.json();

        if (!response.ok || !data?.success) {
          throw new Error(data?.error || "Failed to load check-in wizard.");
        }

        if (cancelled) return;

        setBusinessDate(String(data.business_date ?? ""));
        setGroupData(data.group ?? null);
        const draftJson =
          data?.draft?.draft_json && typeof data.draft.draft_json === "object"
            ? data.draft.draft_json
            : {};
        setWizardDraftJson(draftJson);

        const rows = buildReservationRows(data);
        setReservations(rows);
        setTargetReservationId((prev) => {
          if (prev && rows.some((row) => row.id === prev && row.selected)) return prev;
          return rows.find((row) => row.selected)?.id ?? rows[0]?.id ?? "";
        });

        const draftStep2Pool = Array.isArray((draftJson as any)?.step2?.scanned_pool)
          ? (draftJson as any).step2.scanned_pool
          : [];
        const draftStep2Ids = draftStep2Pool.length > 0
          ? draftStep2Pool
            .map((item: any) => String(item?.guest_profile_id ?? "").trim())
            .filter(Boolean)
          : Array.isArray((draftJson as any)?.step2?.scanned_guest_profile_ids)
            ? (draftJson as any).step2.scanned_guest_profile_ids.map((value: unknown) => String(value))
            : [];
        const knownGuestMap = new Map<string, GuestSearchResult>();
        rows.forEach((row) => {
          if (row.party.primary) {
            knownGuestMap.set(row.party.primary.guest_profile_id, {
              id: row.party.primary.guest_profile_id,
              first_name: row.party.primary.display_name,
              last_name: null,
              phone: null,
              member_no: null,
              profile_status: row.party.primary.profile_status,
              nationality_code: row.party.primary.nationality_code,
            });
          }
          row.party.accompanying.forEach((guest) => {
            knownGuestMap.set(guest.guest_profile_id, {
              id: guest.guest_profile_id,
              first_name: guest.display_name,
              last_name: null,
              phone: null,
              member_no: null,
              profile_status: guest.profile_status,
              nationality_code: guest.nationality_code,
            });
          });
        });
        const sourceById = new Map<string, ScanPoolSource>();
        const orderById = new Map<string, number>();
        const displayById = new Map<string, string>();
        draftStep2Pool.forEach((item: any, idx: number) => {
          const profileId = String(item?.guest_profile_id ?? "").trim();
          if (!profileId) return;
          const sourceRaw = String(item?.source ?? "search").trim() as ScanPoolSource;
          sourceById.set(
            profileId,
            sourceRaw === "thai_id" || sourceRaw === "passport_ocr" || sourceRaw === "search"
              ? sourceRaw
              : "search"
          );
          orderById.set(profileId, Number.isFinite(Number(item?.scan_order)) ? Number(item.scan_order) : idx + 1);
          const snapshotName = String(item?.display_name ?? "").trim();
          if (snapshotName) displayById.set(profileId, snapshotName);
        });
        const hydratedPool: ScannedPoolItem[] = draftStep2Ids
          .map((id: string, idx: number) => {
              const known = knownGuestMap.get(id);
              return {
                ...(known ?? {
                  id,
                  first_name: null,
                  last_name: null,
                  phone: null,
                  member_no: null,
                  profile_status: null,
                  nationality_code: null,
                }),
                source: sourceById.get(id) ?? "search",
                scan_order: orderById.get(id) ?? idx + 1,
                display_name: displayById.get(id) ?? known?.first_name ?? id,
              } as ScannedPoolItem;
          })
          .sort((a: ScannedPoolItem, b: ScannedPoolItem) => a.scan_order - b.scan_order);
        setScannedGuestPool(hydratedPool);

        const plan: Record<string, SplitRoomPlan> = {};
        const draftSplitMap = new Map<string, any>();
        const draftSplitRows = Array.isArray((draftJson as any)?.step3?.split_payment_plan)
          ? (draftJson as any).step3.split_payment_plan
          : [];
        draftSplitRows.forEach((row: any) => {
          const reservationId = String(row?.reservation_id ?? "").trim();
          if (reservationId) draftSplitMap.set(reservationId, row);
        });
        rows.forEach((row) => {
          const fromDraft = draftSplitMap.get(row.id);
          plan[row.id] = fromDraft
            ? buildPlanFromDraftRow(fromDraft, row.id, row.deposit_amount)
            : defaultSplitPlanByDeposit(row.id, row.deposit_amount);
        });
        setSplitPlans(plan);

        const resumeStep = Number(data?.resume_hint?.start_step ?? 1);
        setCurrentStep(Number.isFinite(resumeStep) ? Math.max(1, Math.min(4, Math.trunc(resumeStep))) : 1);

        const draftMode = (data?.draft?.draft_json as any)?.step3?.payment_mode;
        if (draftMode === "master" || draftMode === "split") {
          setPaymentMode(draftMode);
        }

        const draftMasterPlan = Array.isArray((draftJson as any)?.step3?.master_payment_plan)
          ? (draftJson as any).step3.master_payment_plan
          : [];
        if (draftMasterPlan.length > 0) {
          setMasterPayments(
            draftMasterPlan.map((line: any, idx: number) => ({
              id: `draft-master-${idx}-${Math.random().toString(16).slice(2)}`,
              amount: String(line?.amount ?? ""),
              method: line?.method === "transfer"
                || line?.method === "credit_card"
                ? line.method
                : "cash",
              note: String(line?.note ?? ""),
            }))
          );
        } else {
          setMasterPayments([masterLine("master")]);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load wizard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function saveDraft(current: number, redirect: boolean) {
    const payload = {
      business_date: businessDate,
      current_step: current,
      draft_json: {
        step1: {
          selected_reservation_ids: reservations.filter((row) => row.selected).map((row) => row.id),
          selection_mode: "manual",
        },
        step2: {
          scanned_pool: scannedGuestPool.map((guest) => ({
            guest_profile_id: guest.id,
            source: guest.source,
            scan_order: guest.scan_order,
            display_name: guestDisplayName(guest),
            profile_status: guest.profile_status ?? null,
            nationality_code: guest.nationality_code ?? null,
          })),
          scanned_guest_profile_ids: scannedGuestPool.map((guest) => guest.id),
        },
        step3: {
          payment_mode: paymentMode,
          split_payment_plan: reservations.map((row) => ({
            reservation_id: row.id,
            ...(splitPlans[row.id] ?? {
              ...defaultSplitPlanByDeposit(row.id, row.deposit_amount),
              payments: [],
            }),
          })),
          master_payment_plan: masterPayments.map((line) => ({
            amount: toMoney(line.amount),
            method: line.method,
            note: line.note || null,
          })),
        },
        step4: {
          selected_reservation_ids: reservations.filter((row) => row.selected).map((row) => row.id),
        },
      },
    };

    const response = await fetch(
      `/api/booking-groups/${groupId}/checkin-wizard/${redirect ? "save-draft-and-exit" : "draft"}`,
      {
        method: redirect ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Failed to save draft.");
    }
  }

  async function handleSaveAndExit() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      await saveDraft(currentStep, true);
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save draft failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelDraft() {
    if (!businessDate) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/cancel-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_date: businessDate }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Cancel draft failed.");
      }
      router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel draft failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleNext() {
    setError("");
    setInfo("");

    if (currentStep === 1 && selectedReservations.length === 0) {
      setError("Please select at least one room before continuing.");
      return;
    }

    try {
      await saveDraft(currentStep, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save current step.");
      return;
    }

    setCurrentStep((prev) => Math.min(4, prev + 1));
  }

  function handleBack() {
    setError("");
    setInfo("");
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }

  function toggleSelection(id: string) {
    const target = reservations.find((row) => row.id === id);
    if (target?.selected) {
      setInfo(`Room ${target.room_number} will not be included in check-in. Guest assignments remain.`);
    }
    setReservations((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (row.is_checked_in || !row.has_assigned_room || row.status !== "active") return row;
        return { ...row, selected: !row.selected };
      })
    );
  }

  function toggleAll(select: boolean) {
    setReservations((prev) =>
      prev.map((row) => {
        const canSelect = !row.is_checked_in && row.has_assigned_room && row.status === "active";
        return canSelect ? { ...row, selected: select } : row;
      })
    );
  }

  function updateSplitPlan(reservationId: string, patch: Partial<SplitRoomPlan>) {
    const reservation = reservations.find((row) => row.id === reservationId);
    setSplitPlans((prev) => ({
      ...prev,
      [reservationId]: {
        ...(prev[reservationId] ?? defaultSplitPlanByDeposit(reservationId, reservation?.deposit_amount ?? 0)),
        ...patch,
      },
    }));
  }

  function updateSplitPayment(reservationId: string, paymentId: string, patch: Partial<SplitPaymentDraft>) {
    const reservation = reservations.find((row) => row.id === reservationId);
    setSplitPlans((prev) => {
      const base = prev[reservationId] ?? defaultSplitPlanByDeposit(reservationId, reservation?.deposit_amount ?? 0);
      return {
        ...prev,
        [reservationId]: {
          ...base,
          payments: base.payments.map((payment) =>
            payment.id === paymentId ? { ...payment, ...patch } : payment
          ),
        },
      };
    });
  }

  function addSplitPayment(reservationId: string) {
    const reservation = reservations.find((row) => row.id === reservationId);
    setSplitPlans((prev) => {
      const base = prev[reservationId] ?? defaultSplitPlanByDeposit(reservationId, reservation?.deposit_amount ?? 0);
      return {
        ...prev,
        [reservationId]: {
          ...base,
          payments: [...base.payments, paymentDraft(reservationId)],
        },
      };
    });
  }

  function removeSplitPayment(reservationId: string, paymentId: string) {
    setSplitPlans((prev) => {
      const base = prev[reservationId];
      if (!base) return prev;
      const payments = base.payments.filter((payment) => payment.id !== paymentId);
      return {
        ...prev,
        [reservationId]: {
          ...base,
          payments: payments.length > 0 ? payments : [paymentDraft(reservationId)],
        },
      };
    });
  }

  function updateMasterLine(lineId: string, patch: Partial<MasterPaymentLine>) {
    setMasterPayments((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  }

  function addMasterLine() {
    setMasterPayments((prev) => [...prev, masterLine("master")]);
  }

  function removeMasterLine(lineId: string) {
    setMasterPayments((prev) => {
      const remaining = prev.filter((line) => line.id !== lineId);
      return remaining.length > 0 ? remaining : [masterLine("master")];
    });
  }

  async function ingestIdentityToPool(params: {
    source: ScanPoolSource;
    guestProfileId?: string;
    payload?: Record<string, unknown>;
  }) {
    const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/step2/ingest-identity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: params.source,
        guest_profile_id: params.guestProfileId,
        payload: params.payload ?? {},
        scan_order: Date.now(),
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success || !data?.entry) {
      throw new Error(data?.error || "Failed to ingest identity into scan pool.");
    }

    const entry = data.entry;
    const poolItem: ScannedPoolItem = {
      id: String(entry.guest_profile_id),
      first_name: entry.first_name ? String(entry.first_name) : null,
      last_name: entry.last_name ? String(entry.last_name) : null,
      phone: entry.phone ? String(entry.phone) : null,
      member_no: entry.member_no ? String(entry.member_no) : null,
      profile_status: entry.profile_status ? String(entry.profile_status) : null,
      nationality_code: entry.nationality_code ? String(entry.nationality_code) : null,
      source: entry.source === "thai_id" || entry.source === "passport_ocr" || entry.source === "search"
        ? entry.source
        : params.source,
      scan_order: Number.isFinite(Number(entry.scan_order)) ? Number(entry.scan_order) : Date.now(),
      display_name: entry.display_name ? String(entry.display_name) : null,
    };

    setScannedGuestPool((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === poolItem.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          ...poolItem,
          scan_order: next[existingIndex].scan_order || poolItem.scan_order,
        };
        return next.sort((a, b) => a.scan_order - b.scan_order);
      }
      return [...prev, poolItem].sort((a, b) => a.scan_order - b.scan_order);
    });
    return poolItem;
  }

  function openThaiCardReader() {
    if (typeof window === "undefined") return;
    const savedWs = window.localStorage.getItem("pms.smartcard.wsEndpoint");
    const params = new URLSearchParams({ popup: "1", target: "main", t: String(Date.now()) });
    if (savedWs) params.set("ws", savedWs);
    const popup = window.open(
      `${window.location.origin}/smart-card?${params.toString()}`,
      "pms-group-thai-card-reader",
      "popup=yes,width=820,height=760,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }
    popup.focus();
  }

  function openPassportOcr() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams({ popup: "1", target: "main", t: String(Date.now()) });
    const popup = window.open(
      `${window.location.origin}/passport-ocr?${params.toString()}`,
      "pms-group-passport-ocr",
      "popup=yes,width=1180,height=860,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      setError("Popup blocked. Please allow popups and try again.");
      return;
    }
    popup.focus();
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        payload?: ThaiCardImportPayload | PassportOcrImportPayload;
      } | null;
      if (!data?.type || !data.payload) return;

      if (data.type !== "PMS_THAI_CARD_CONFIRMED" && data.type !== "PMS_PASSPORT_OCR_CONFIRMED") return;

      setStep2Busy(true);
      setError("");
      setInfo("");
      void (async () => {
        try {
          if (data.type === "PMS_THAI_CARD_CONFIRMED") {
            const item = await ingestIdentityToPool({
              source: "thai_id",
              payload: data.payload as Record<string, unknown>,
            });
            setInfo(`Added ${guestDisplayName(item)} to scan pool from Thai ID.`);
          } else {
            const item = await ingestIdentityToPool({
              source: "passport_ocr",
              payload: data.payload as Record<string, unknown>,
            });
            setInfo(`Added ${guestDisplayName(item)} to scan pool from Passport OCR.`);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to ingest scanned identity.");
        } finally {
          setStep2Busy(false);
        }
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [groupId]);

  async function searchGuestProfiles() {
    const query = guestQuery.trim();
    if (query.length < 3) {
      setSearchError("Enter at least 3 characters to search guests.");
      setSearchResults([]);
      return;
    }

    setSearchingGuests(true);
    setSearchError("");
    try {
      const response = await fetch(`/api/guests?q=${encodeURIComponent(query)}&limit=20`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Guest search failed.");
      }
      const profiles: GuestSearchResult[] = Array.isArray(data?.profiles)
        ? data.profiles.map((row: any) => ({
          id: String(row.id),
          first_name: row.first_name ? String(row.first_name) : null,
          last_name: row.last_name ? String(row.last_name) : null,
          phone: row.phone ? String(row.phone) : null,
          member_no: row.member_no ? String(row.member_no) : null,
          profile_status: row.profile_status ? String(row.profile_status) : null,
          nationality_code: row.nationality_code ? String(row.nationality_code) : null,
        }))
        : [];
      setSearchResults(profiles);
      if (profiles.length === 0) {
        setSearchError("No guest profiles found.");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Guest search failed.");
      setSearchResults([]);
    } finally {
      setSearchingGuests(false);
    }
  }

  async function addGuestToPool(guest: GuestSearchResult) {
    setStep2Busy(true);
    setError("");
    setInfo("");
    try {
      const item = await ingestIdentityToPool({
        source: "search",
        guestProfileId: guest.id,
      });
      setInfo(`Added ${guestDisplayName(item)} to scan pool.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add guest to pool.");
    } finally {
      setStep2Busy(false);
    }
  }

  function removeGuestFromPool(guestProfileId: string) {
    setScannedGuestPool((prev) => prev.filter((guest) => guest.id !== guestProfileId));
  }

  async function postStep2(path: string, payload: Record<string, unknown>) {
    const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Step 2 action failed.");
    }
    return data;
  }

  async function handleAssignGuest(guest: GuestSearchResult) {
    if (!targetReservationId) {
      setError("Select a room before assigning guest.");
      return;
    }
    if (!selectedReservationIds.includes(targetReservationId)) {
      setError("Selected room is outside Step 1 scope.");
      return;
    }

    setStep2Busy(true);
    setError("");
    setInfo("");
    try {
      if (targetRole === "primary") {
        await postStep2("step2/link-primary", {
          reservation_id: targetReservationId,
          guest_profile_id: guest.id,
        });
      } else {
        await postStep2("step2/add-accompanying", {
          reservation_id: targetReservationId,
          guest_profile_id: guest.id,
        });
      }
      if (!scannedGuestPool.some((item) => item.id === guest.id)) {
        await ingestIdentityToPool({
          source: "search",
          guestProfileId: guest.id,
        });
      }
      await reloadReservationSnapshot();
      setInfo(
        `${targetRole === "primary" ? "Primary linked" : "Accompanying added"} for room ${
          selectedReservations.find((row) => row.id === targetReservationId)?.room_number ?? targetReservationId
        }.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Guest assignment failed.");
    } finally {
      setStep2Busy(false);
    }
  }

  async function handleRemoveAccompanying(reservationId: string, guestProfileId: string) {
    setStep2Busy(true);
    setError("");
    setInfo("");
    try {
      await postStep2("step2/remove-accompanying", {
        reservation_id: reservationId,
        guest_profile_id: guestProfileId,
      });
      await reloadReservationSnapshot();
      setInfo("Accompanying guest removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove accompanying failed.");
    } finally {
      setStep2Busy(false);
    }
  }

  async function handleAutoDistribute() {
    if (scannedGuestPool.length === 0) {
      setError("Add at least one guest to scanned pool before auto-distribute.");
      return;
    }
    if (selectedReservationIds.length === 0) {
      setError("No selected rooms for distribution.");
      return;
    }

    setStep2Busy(true);
    setError("");
    setInfo("");
    try {
      const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/auto-distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_date: businessDate,
          strategy: "match_main_then_equal_split",
          selected_reservation_ids: selectedReservationIds,
          guest_profile_ids: scannedGuestPool.map((guest) => guest.id),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Auto-distribute failed.");
      }

      const previewRows = Array.isArray(data?.distribution_preview) ? data.distribution_preview : [];
      const state = new Map<
        string,
        { primary_guest_profile_id: string | null; accompanying_guest_profile_ids: string[] }
      >();
      selectedReservations.forEach((row) => {
        state.set(row.id, {
          primary_guest_profile_id: row.primary_guest_profile_id,
          accompanying_guest_profile_ids: [...row.accompanying_guest_profile_ids],
        });
      });

      let changed = 0;
      for (const preview of previewRows) {
        const reservationId = String(preview?.reservation_id ?? "");
        if (!reservationId || !state.has(reservationId)) continue;

        const current = state.get(reservationId)!;
        const targetPrimary = preview?.primary_guest_profile_id
          ? String(preview.primary_guest_profile_id)
          : null;
        const targetAccompanying = Array.isArray(preview?.accompanying_guest_profile_ids)
          ? preview.accompanying_guest_profile_ids.map((value: unknown) => String(value))
          : [];

        if (targetPrimary && targetPrimary !== current.primary_guest_profile_id) {
          const noteLine =
            typeof preview?.suggested_note_line === "string" && preview.suggested_note_line.trim()
              ? preview.suggested_note_line.trim()
              : null;
          await postStep2("step2/link-primary", {
            reservation_id: reservationId,
            guest_profile_id: targetPrimary,
            note_line: noteLine,
          });
          current.primary_guest_profile_id = targetPrimary;
          changed += 1;
        } else if (!targetPrimary && current.primary_guest_profile_id) {
          const unlinkRes = await fetch(`/api/bookings/${reservationId}/guest-profile`, {
            method: "DELETE",
          });
          const unlinkData = await unlinkRes.json().catch(() => null);
          if (!unlinkRes.ok || !unlinkData?.success) {
            throw new Error(unlinkData?.error || "Failed to rebuild primary guest assignment.");
          }
          current.primary_guest_profile_id = null;
          changed += 1;
        }

        const toRemove = current.accompanying_guest_profile_ids.filter(
          (guestId) => !targetAccompanying.includes(guestId)
        );
        for (const guestId of toRemove) {
          await postStep2("step2/remove-accompanying", {
            reservation_id: reservationId,
            guest_profile_id: guestId,
          });
          current.accompanying_guest_profile_ids = current.accompanying_guest_profile_ids.filter(
            (value) => value !== guestId
          );
          changed += 1;
        }

        for (let i = 0; i < targetAccompanying.length; i += 1) {
          const guestId = targetAccompanying[i];
          if (current.accompanying_guest_profile_ids.includes(guestId)) continue;
          await postStep2("step2/add-accompanying", {
            reservation_id: reservationId,
            guest_profile_id: guestId,
            display_order: i + 2,
          });
          current.accompanying_guest_profile_ids.push(guestId);
          changed += 1;
        }
      }

      await reloadReservationSnapshot();

      const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
      const stats = data?.distribution_stats && typeof data.distribution_stats === "object"
        ? data.distribution_stats
        : null;
      const unassignedCount = Array.isArray(data?.unassigned_pool) ? data.unassigned_pool.length : 0;
      const summary = [
        `Auto-distribute applied ${changed} change(s).`,
        stats && Number.isFinite(Number(stats?.matched_main_count))
          ? `Matched main: ${Number(stats.matched_main_count)}.`
          : "",
        unassignedCount > 0 ? `${unassignedCount} guest(s) remain unassigned.` : "All scanned guests allocated.",
        warnings.length > 0 ? `${warnings.length} warning(s).` : "",
      ]
        .filter(Boolean)
        .join(" ");
      setInfo(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-distribute failed.");
    } finally {
      setStep2Busy(false);
    }
  }

  async function handlePreviewPayments() {
    setLoadingPaymentPreview(true);
    setError("");
    try {
      const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/preview-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_date: businessDate,
          selected_reservation_ids: selectedReservationIds,
          payment_mode: paymentMode,
          split_payment_plan: selectedReservations.map((row) => {
            const plan = splitPlans[row.id] ?? {
              ...defaultSplitPlanByDeposit(row.id, row.deposit_amount),
              payments: [] as SplitPaymentDraft[],
            };
            return {
              reservation_id: row.id,
              payments: plan.payments
                .map((payment) => ({
                  amount: toMoney(payment.amount),
                  method: payment.method,
                  note: payment.note.trim() || null,
                }))
                .filter((payment) => payment.amount > 0),
            };
          }),
          master_payment_plan: masterPayments
            .map((line) => ({
              amount: toMoney(line.amount),
              method: line.method,
              note: line.note.trim() || null,
            }))
            .filter((line) => line.amount > 0),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Preview payments failed.");
      }
      setPaymentPreview({
        payment_mode: data.payment_mode === "master" ? "master" : "split",
        grand_total: toMoney(data.grand_total),
        payment_received: toMoney(data.payment_received),
        deposit_received: toMoney(data.deposit_received),
        remaining_balance: toMoney(data.remaining_balance),
        submitted_payment_total: toMoney(data.submitted_payment_total),
        projected_remaining_balance: toMoney(data.projected_remaining_balance),
        overpayment_amount: toMoney(data.overpayment_amount),
        room_rows: Array.isArray(data.room_rows)
          ? data.room_rows.map((row: any) => ({
            reservation_id: String(row.reservation_id),
            booking_code: String(row.booking_code ?? ""),
            guest_name: row.guest_name ? String(row.guest_name) : null,
            total_price: toMoney(row.total_price),
            payment_received: toMoney(row.payment_received),
            deposit_received: toMoney(row.deposit_received),
            remaining_balance: toMoney(row.remaining_balance),
            planned_payment: toMoney(row.planned_payment),
            projected_remaining: toMoney(row.projected_remaining),
          }))
          : [],
        allocation_preview: Array.isArray(data.allocation_preview)
          ? data.allocation_preview.map((line: any) => ({
            line_index: Number(line?.line_index ?? 0),
            method: String(line?.method ?? ""),
            amount: toMoney(line?.amount),
            allocations: Array.isArray(line?.allocations)
              ? line.allocations.map((row: any) => ({
                reservation_id: String(row?.reservation_id ?? ""),
                booking_code: String(row?.booking_code ?? ""),
                allocated_amount: toMoney(row?.allocated_amount),
              }))
              : [],
          }))
          : [],
        validation_errors: Array.isArray(data.validation_errors)
          ? data.validation_errors.map((value: unknown) => String(value))
          : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview payments failed.");
    } finally {
      setLoadingPaymentPreview(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError("");
    setInfo("");
    setConfirmResults(null);

    try {
      const splitPaymentPlan = selectedReservations.map((row) => {
        const plan = splitPlans[row.id] ?? {
          ...defaultSplitPlanByDeposit(row.id, row.deposit_amount),
          payments: [] as SplitPaymentDraft[],
        };

        return {
          reservation_id: row.id,
          deposit_policy: plan.deposit_policy,
          deposit_amount: toMoney(plan.deposit_amount),
          deposit_note: plan.deposit_note.trim() || null,
          payments: plan.payments
            .map((payment) => ({
              amount: toMoney(payment.amount),
              method: payment.method,
              note: payment.note.trim() || null,
            }))
            .filter((payment) => payment.amount > 0),
        };
      });

      const masterPaymentPlan = masterPayments
        .map((line) => ({
          amount: toMoney(line.amount),
          method: line.method,
          note: line.note.trim() || null,
        }))
        .filter((line) => line.amount > 0);

      const response = await fetch(`/api/booking-groups/${groupId}/checkin-wizard/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_date: businessDate,
          strict_due_in: true,
          selected_reservation_ids: selectedReservations.map((row) => row.id),
          payment_mode: paymentMode,
          split_payment_plan: splitPaymentPlan,
          master_payment_plan: paymentMode === "master" ? masterPaymentPlan : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.results) {
        throw new Error(data?.error || "Confirm check-in failed.");
      }

      const results: ConfirmRoomResult[] = Array.isArray(data.results)
        ? data.results.map((row: any) => ({
            reservation_id: String(row.reservation_id),
            booking_code: row.booking_code ? String(row.booking_code) : null,
            guest_name: row.guest_name ? String(row.guest_name) : null,
            status: row.status,
            codes: Array.isArray(row.codes) ? row.codes.map((code: unknown) => String(code)) : [],
            error: row.error ? String(row.error) : undefined,
            missing_fields: Array.isArray(row.missing_fields)
              ? row.missing_fields.map((field: unknown) => String(field))
              : undefined,
            checked_in_at: row.checked_in_at ? String(row.checked_in_at) : undefined,
          }))
        : [];

      setConfirmResults(results);
      const okCount = results.filter((row) => row.status === "ok").length;
      const failedCount = results.filter((row) => row.status === "failed").length;
      const skippedCount = results.filter((row) => row.status === "skipped").length;
      setInfo(`Check-in completed: ${okCount} success, ${failedCount} failed, ${skippedCount} skipped.`);

      if (failedCount === 0) {
        router.push(backHref);
        return;
      }

      await reloadReservationSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm check-in failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-body)] flex items-center justify-center text-[var(--text-secondary)]">
        Loading group check-in wizard...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-body)]">
      <header className="bg-[var(--bg-surface)] border-b border-[var(--border-default)] px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <Link href={backHref} className="text-[var(--text-secondary)] hover:text-indigo-700 text-sm font-semibold">
              Back to Group Detail
            </Link>
            <span className="text-[var(--text-muted)]">|</span>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Group Check-in Wizard</h1>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            <span className="font-semibold text-indigo-700">{groupData?.group_code || "—"}</span>
            <span className="mx-2">·</span>
            <span>{groupData?.group_name || "Group"}</span>
            {businessDate ? <span className="ml-2">({businessDate})</span> : null}
            {Object.keys(wizardDraftJson).length > 0 ? (
              <span className="ml-2 text-emerald-700 font-semibold">Draft loaded</span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep === step ? "bg-indigo-600 text-white" : currentStep > step ? "bg-emerald-500 text-white" : "bg-[var(--bg-muted)] text-[var(--text-secondary)]"}`}>
                {currentStep > step ? "✓" : step}
              </div>
              {step < 4 ? <div className={`h-0.5 w-6 ${currentStep > step ? "bg-emerald-500" : "bg-[var(--bg-muted)]"}`} /> : null}
            </div>
          ))}
        </div>
      </header>

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-sm p-6">
          {error ? <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
          {info ? <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div> : null}

          {currentStep === 1 ? (
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Step 1 — Select Rooms</h2>
                  <p className="text-sm text-[var(--text-secondary)]">Choose rooms to include in this check-in run.</p>
                </div>
                <div className="text-sm text-[var(--text-secondary)] font-semibold">
                  {selectedReservations.length} selected / {reservations.filter((row) => !row.is_checked_in && row.has_assigned_room && row.status === "active").length} eligible
                </div>
              </div>

              <div className="overflow-auto border border-[var(--border-default)] rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-body)] border-b border-[var(--border-default)]">
                    <tr>
                      <th className="p-3 w-10 text-left">
                        <input
                          type="checkbox"
                          checked={selectedReservations.length > 0 && selectedReservations.length === reservations.filter((row) => !row.is_checked_in && row.has_assigned_room && row.status === "active").length}
                          onChange={(e) => toggleAll(e.target.checked)}
                        />
                      </th>
                      <th className="p-3 text-left">Booking</th>
                      <th className="p-3 text-left">Room</th>
                      <th className="p-3 text-left">Guest</th>
                      <th className="p-3 text-left">HK</th>
                      <th className="p-3 text-left">Profile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.map((row) => {
                      const disabled = row.is_checked_in || !row.has_assigned_room || row.status !== "active";
                      const hk = mapHkBadge(row.hk_status);
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-[var(--border-subtle)] ${row.selected ? "bg-indigo-50/50" : ""} ${disabled ? "opacity-60" : "hover:bg-[var(--bg-body)]"}`}
                          onClick={() => {
                            if (!disabled) toggleSelection(row.id);
                          }}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={disabled}
                              onChange={() => undefined}
                            />
                          </td>
                          <td className="p-3 font-semibold text-[var(--text-table-cell)]">{row.booking_code}</td>
                          <td className="p-3">
                            <div className="font-semibold text-[var(--text-primary)]">{row.room_number}</div>
                            <div className="text-xs text-[var(--text-secondary)]">{row.room_type}</div>
                          </td>
                          <td className="p-3 text-[var(--text-table-cell)]">{row.guest_name || "—"}</td>
                          <td className="p-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${hk.className}`}>{hk.label}</span>
                          </td>
                          <td className="p-3">
                            {row.profile_completeness.is_complete ? (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Complete</span>
                            ) : (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Incomplete</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {currentStep === 2 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Step 2 — Guest Assignment</h2>
                <p className="text-sm text-[var(--text-secondary)]">Search/scan guest pool, assign primary or accompanying immediately, then auto-distribute by booking order.</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Manual profile entry is currently per booking. Use <span className="font-semibold">Manual (per booking)</span> to open reservation editor.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 border border-[var(--border-default)] rounded-xl p-4 bg-[var(--bg-surface)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">Scan Pool</h3>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={handleAutoDistribute}
                      disabled={step2Busy || scannedGuestPool.length === 0 || selectedReservations.length === 0}
                    >
                      {step2Busy ? "Applying..." : "Auto-assign"}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button type="button" className="btn btn-secondary" onClick={openThaiCardReader} disabled={step2Busy}>
                      Read Thai ID
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={openPassportOcr} disabled={step2Busy}>
                      Passport OCR
                    </button>
                  </div>

                  <p className="text-xs text-[var(--text-secondary)]">
                    Strategy: rebuild all assignments in selected scope, match main by profile id first, then equal split by room.
                  </p>

                  <div className="border border-[var(--border-default)] rounded-lg max-h-80 overflow-auto bg-[var(--bg-body)]">
                    {scannedGuestPool.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">No identities in pool yet.</div>
                    ) : (
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {scannedGuestPool.map((guest) => (
                          <div key={guest.id} className="px-3 py-2 flex items-center justify-between gap-2 bg-[var(--bg-surface)]">
                            <div>
                              <div className="text-sm font-medium text-[var(--text-primary)]">{guestDisplayName(guest)}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                                <span className={`inline-flex rounded px-1.5 py-0.5 font-semibold ${scanSourceBadgeClass(guest.source)}`}>
                                  {scanSourceLabel(guest.source)}
                                </span>
                                <span>{guest.profile_status || "draft"}</span>
                                {selectedAssignedGuestIds.has(guest.id) ? <span>· assigned</span> : null}
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => removeGuestFromPool(guest.id)}
                              disabled={step2Busy}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-5 border border-[var(--border-default)] rounded-xl p-4 bg-[var(--bg-body)] space-y-3">
                  <h3 className="font-semibold text-[var(--text-primary)]">Manual Assign</h3>
                  <div className="flex flex-col gap-2">
                    <input
                      className="form-input"
                      placeholder="Search name / phone / passport / ID..."
                      value={guestQuery}
                      onChange={(event) => setGuestQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") searchGuestProfiles();
                      }}
                    />
                    <button className="btn btn-secondary" onClick={searchGuestProfiles} disabled={searchingGuests || step2Busy}>
                      {searchingGuests ? "Searching..." : "Search"}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <label className="form-label text-xs">Target Room</label>
                      <select
                        className="form-select"
                        value={targetReservationId}
                        onChange={(event) => setTargetReservationId(event.target.value)}
                      >
                        {selectedReservations.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.booking_code} · Room {row.room_number}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label text-xs">Assign As</label>
                      <select
                        className="form-select"
                        value={targetRole}
                        onChange={(event) => setTargetRole(event.target.value as "primary" | "accompanying")}
                      >
                        <option value="primary">Primary Guest</option>
                        <option value="accompanying">Accompanying Guest</option>
                      </select>
                    </div>
                  </div>

                  {searchError ? (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{searchError}</div>
                  ) : null}

                  <div className="border border-[var(--border-default)] rounded-lg bg-[var(--bg-surface)] max-h-80 overflow-auto">
                    {searchResults.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">No search result yet.</div>
                    ) : (
                      <div className="divide-y divide-[var(--border-subtle)]">
                        {searchResults.map((guest) => {
                          const assigned = selectedAssignedGuestIds.has(guest.id);
                          const inPool = scannedGuestPool.some((item) => item.id === guest.id);
                          return (
                            <div key={guest.id} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-[var(--text-primary)]">{guestDisplayName(guest)}</div>
                                <div className="text-xs text-[var(--text-secondary)]">
                                  {guest.phone ? `Phone: ${guest.phone}` : "No phone"}
                                  {guest.profile_status ? ` · ${guest.profile_status}` : ""}
                                  {guest.member_no ? ` · #${guest.member_no}` : ""}
                                </div>
                                {assigned ? (
                                  <div className="text-[11px] text-indigo-700 font-semibold">Already assigned in selected scope</div>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  className="btn btn-ghost"
                                  type="button"
                                  onClick={() => { void addGuestToPool(guest); }}
                                  disabled={inPool || step2Busy}
                                >
                                  {inPool ? "In Pool" : "Send to Pool"}
                                </button>
                                <button
                                  className="btn btn-primary"
                                  type="button"
                                  onClick={() => handleAssignGuest(guest)}
                                  disabled={step2Busy || !targetReservationId}
                                >
                                  Assign
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedReservations.map((row) => (
                  <div
                    key={row.id}
                    className={`border rounded-lg p-4 ${
                      targetReservationId === row.id
                        ? "border-indigo-300 bg-indigo-50/40"
                        : "border-[var(--border-default)] bg-[var(--bg-body)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">
                          Room {row.room_number} · {row.booking_code}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {row.party.primary ? "Primary linked" : "Primary not linked"}
                          {" · "}
                          {row.party.accompanying.length} accompanying
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => setTargetReservationId(row.id)}
                        >
                          Set Target
                        </button>
                        <Link
                          className="btn btn-secondary"
                          href={`/pms/reservations?open=${encodeURIComponent(row.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Manual (per booking)
                        </Link>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase">Primary</div>
                        {row.party.primary ? (
                          <div className="mt-1">
                            <div className="font-medium text-[var(--text-primary)]">{row.party.primary.display_name}</div>
                            <div className="text-xs text-[var(--text-secondary)]">
                              {row.party.primary.profile_status || "draft"}
                              {row.party.primary.nationality_code ? ` · ${row.party.primary.nationality_code}` : ""}
                            </div>
                            {row.party.primary.completeness.is_complete ? (
                              <span className="inline-flex mt-1 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                Profile Ready
                              </span>
                            ) : (
                              <div className="mt-1">
                                <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                                  Missing {row.party.primary.completeness.missing_fields.length} field(s)
                                </span>
                                <div className="text-[11px] text-amber-700 mt-1">
                                  {row.party.primary.completeness.missing_fields.join(", ")}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-amber-700">No primary guest profile</div>
                        )}
                      </div>

                      <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">Accompanying</div>
                        {row.party.accompanying.length === 0 ? (
                          <div className="text-sm text-[var(--text-secondary)]">No accompanying guest</div>
                        ) : (
                          <div className="space-y-2">
                            {row.party.accompanying.map((guest) => (
                              <div key={guest.guest_profile_id} className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-[var(--text-primary)]">{guest.display_name}</div>
                                  <div className="text-xs text-[var(--text-secondary)]">
                                    {guest.profile_status || "draft"}
                                    {guest.nationality_code ? ` · ${guest.nationality_code}` : ""}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-ghost text-rose-600"
                                  onClick={() => handleRemoveAccompanying(row.id, guest.guest_profile_id)}
                                  disabled={step2Busy}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {selectedReservations.length === 0 ? (
                  <div className="text-sm text-[var(--text-secondary)]">No selected rooms. Go back to Step 1.</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {currentStep === 3 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Step 3 — Payment Plan</h2>
                  <p className="text-sm text-[var(--text-secondary)]">Configure split-by-room or master payment.</p>
                </div>
                <div className="flex items-center bg-[var(--bg-muted)] p-1 rounded-lg border border-[var(--border-default)]">
                  <button
                    className={`px-4 py-1.5 text-sm rounded ${paymentMode === "split" ? "bg-[var(--bg-surface)] text-indigo-700 font-semibold" : "text-[var(--text-secondary)]"}`}
                    onClick={() => setPaymentMode("split")}
                  >
                    Split
                  </button>
                  <button
                    className={`px-4 py-1.5 text-sm rounded ${paymentMode === "master" ? "bg-[var(--bg-surface)] text-indigo-700 font-semibold" : "text-[var(--text-secondary)]"}`}
                    onClick={() => setPaymentMode("master")}
                  >
                    Master
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-body)] p-4 text-sm text-[var(--text-table-cell)]">
                  <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Current Remaining</div>
                  <div className="font-bold text-lg mt-1">
                    ฿ {selectedRemainingTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
                  <div className="text-xs uppercase tracking-wide text-indigo-600">Planned Payment</div>
                  <div className="font-bold text-lg mt-1">฿ {plannedPaymentTotal.toFixed(2)}</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <div className="text-xs uppercase tracking-wide text-emerald-600">Projected Remaining</div>
                  <div className="font-bold text-lg mt-1">฿ {projectedRemainingTotal.toFixed(2)}</div>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePreviewPayments}
                  disabled={loadingPaymentPreview || busy || selectedReservations.length === 0}
                >
                  {loadingPaymentPreview ? "Previewing..." : "Preview Payments"}
                </button>
              </div>

              {paymentMode === "split" ? (
                <div className="space-y-4">
                  {selectedReservations.map((row) => {
                    const plan = splitPlans[row.id] ?? {
                      ...defaultSplitPlanByDeposit(row.id, row.deposit_amount),
                    };
                    return (
                      <div key={row.id} className="border border-[var(--border-default)] rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-semibold text-[var(--text-primary)]">{row.booking_code} · Room {row.room_number}</div>
                          <div className="text-sm text-[var(--text-secondary)]">Remain: ฿ {row.remaining_balance.toFixed(2)}</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <label className="form-label text-xs">Deposit Policy</label>
                            <select
                              className="form-select"
                              value={plan.deposit_policy}
                              onChange={(e) => updateSplitPlan(row.id, { deposit_policy: e.target.value as DepositPolicy })}
                            >
                              <option value="keep">keep</option>
                              <option value="set">set</option>
                            </select>
                          </div>
                          <div>
                            <label className="form-label text-xs">Deposit Amount</label>
                            <input
                              className="form-input"
                              type="number"
                              value={plan.deposit_amount}
                              onChange={(e) => updateSplitPlan(row.id, { deposit_amount: e.target.value })}
                              disabled={plan.deposit_policy !== "set"}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="form-label text-xs">Deposit Note</label>
                            <input
                              className="form-input"
                              value={plan.deposit_note}
                              onChange={(e) => updateSplitPlan(row.id, { deposit_note: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          {plan.payments.map((payment) => (
                            <div key={payment.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                              <div className="md:col-span-3">
                                <label className="form-label text-xs">Amount</label>
                                <input
                                  type="number"
                                  className="form-input"
                                  value={payment.amount}
                                  onChange={(e) => updateSplitPayment(row.id, payment.id, { amount: e.target.value })}
                                />
                              </div>
                              <div className="md:col-span-3">
                                <label className="form-label text-xs">Method</label>
                                <select
                                  className="form-select"
                                  value={payment.method}
                                  onChange={(e) => updateSplitPayment(row.id, payment.id, { method: e.target.value as PaymentMethod })}
                                >
                                  <option value="cash">Cash</option>
                                  <option value="transfer">Transfer</option>
                                  <option value="credit_card">Card</option>
                                </select>
                              </div>
                              <div className="md:col-span-5">
                                <label className="form-label text-xs">Note</label>
                                <input
                                  className="form-input"
                                  value={payment.note}
                                  onChange={(e) => updateSplitPayment(row.id, payment.id, { note: e.target.value })}
                                />
                              </div>
                              <div className="md:col-span-1">
                                <button
                                  type="button"
                                  className="btn btn-ghost w-full"
                                  onClick={() => removeSplitPayment(row.id, payment.id)}
                                >
                                  x
                                </button>
                              </div>
                            </div>
                          ))}
                          <button type="button" className="btn btn-secondary" onClick={() => addSplitPayment(row.id)}>
                            Add Payment
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3 border border-[var(--border-default)] rounded-xl p-4">
                  <p className="text-sm text-[var(--text-secondary)]">Master payment will be allocated by remaining balance on server.</p>
                  {masterPayments.map((line) => (
                    <div key={line.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                      <div className="md:col-span-3">
                        <label className="form-label text-xs">Amount</label>
                        <input
                          type="number"
                          className="form-input"
                          value={line.amount}
                          onChange={(e) => updateMasterLine(line.id, { amount: e.target.value })}
                        />
                      </div>
                      <div className="md:col-span-3">
                        <label className="form-label text-xs">Method</label>
                        <select
                          className="form-select"
                          value={line.method}
                          onChange={(e) => updateMasterLine(line.id, { method: e.target.value as PaymentMethod })}
                        >
                          <option value="cash">Cash</option>
                          <option value="transfer">Transfer</option>
                          <option value="credit_card">Card</option>
                        </select>
                      </div>
                      <div className="md:col-span-5">
                        <label className="form-label text-xs">Note</label>
                        <input
                          className="form-input"
                          value={line.note}
                          onChange={(e) => updateMasterLine(line.id, { note: e.target.value })}
                        />
                      </div>
                      <div className="md:col-span-1">
                        <button type="button" className="btn btn-ghost w-full" onClick={() => removeMasterLine(line.id)}>
                          x
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={addMasterLine}>
                    Add Payment Line
                  </button>
                </div>
              )}

              {paymentPreview ? (
                <div className="border border-[var(--border-default)] rounded-xl p-4 bg-[var(--bg-surface)] space-y-3">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    Preview ({paymentPreview.payment_mode})
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
                    <div className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1">
                      Grand Total: ฿ {paymentPreview.grand_total.toFixed(2)}
                    </div>
                    <div className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1">
                      Payment Received: ฿ {paymentPreview.payment_received.toFixed(2)}
                    </div>
                    <div className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1">
                      Deposit Received: ฿ {paymentPreview.deposit_received.toFixed(2)}
                    </div>
                    <div className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1">
                      Current Remaining: ฿ {paymentPreview.remaining_balance.toFixed(2)}
                    </div>
                    <div className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">
                      Submitted: ฿ {paymentPreview.submitted_payment_total.toFixed(2)}
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                      Projected Remaining: ฿ {paymentPreview.projected_remaining_balance.toFixed(2)}
                    </div>
                  </div>

                  {paymentPreview.overpayment_amount > 0 ? (
                    <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      Overpayment: ฿ {paymentPreview.overpayment_amount.toFixed(2)}
                    </div>
                  ) : null}

                  {paymentPreview.validation_errors.length > 0 ? (
                    <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {paymentPreview.validation_errors.join(" ")}
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    {paymentPreview.room_rows.map((row) => (
                      <div
                        key={row.reservation_id}
                        className="text-xs rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-2 py-1 flex items-center justify-between"
                      >
                        <span>{row.booking_code}</span>
                        <span>
                          Planned ฿ {row.planned_payment.toFixed(2)} · Projected ฿ {row.projected_remaining.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {paymentPreview.payment_mode === "master" && paymentPreview.allocation_preview.length > 0 ? (
                    <div className="space-y-2">
                      {paymentPreview.allocation_preview.map((line) => (
                        <div key={`${line.line_index}-${line.method}`} className="border border-[var(--border-default)] rounded-lg p-2">
                          <div className="text-xs font-semibold text-[var(--text-table-cell)]">
                            Line #{line.line_index + 1} · {line.method} · ฿ {line.amount.toFixed(2)}
                          </div>
                          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1 text-xs">
                            {line.allocations.map((row) => (
                              <div key={`${line.line_index}-${row.reservation_id}`} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-body)] px-2 py-1">
                                {row.booking_code}: ฿ {row.allocated_amount.toFixed(2)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {currentStep === 4 ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Step 4 — Confirm Check-in</h2>
                <p className="text-sm text-[var(--text-secondary)]">Review ready/not-ready rooms and submit partial check-in.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">Ready: {step4Buckets.ready.length}</div>
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">Not Ready: {step4Buckets.notReady.length}</div>
                <div className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2">Already Done: {step4Buckets.done.length}</div>
              </div>

              <div className="space-y-3">
                {step4Buckets.ready.map((row) => (
                  <div key={row.id} className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    {row.booking_code} · Room {row.room_number} · {row.guest_name || "—"}
                  </div>
                ))}
                {step4Buckets.notReady.map(({ row, reasons }) => (
                  <div key={row.id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                    <div>{row.booking_code} · Room {row.room_number} · {row.guest_name || "—"}</div>
                    <div className="text-amber-700 text-xs mt-1">{reasons.join(", ")}</div>
                    {!row.profile_completeness.is_complete ? (
                      <div className="text-amber-700 text-xs">Missing: {row.profile_completeness.missing_fields.join(", ")}</div>
                    ) : null}
                  </div>
                ))}
                {step4Buckets.done.map((row) => (
                  <div key={row.id} className="rounded border border-[var(--border-default)] bg-[var(--bg-body)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                    {row.booking_code} · Room {row.room_number} already checked in
                  </div>
                ))}
              </div>

              {confirmResults ? (
                <div className="rounded border border-[var(--border-default)] p-3 bg-[var(--bg-surface)]">
                  <h3 className="font-semibold text-[var(--text-primary)] mb-2">Confirm Results</h3>
                  <div className="space-y-2 text-sm">
                    {confirmResults.map((row) => (
                      <div key={row.reservation_id} className="border border-[var(--border-subtle)] rounded p-2">
                        <div className="font-medium text-[var(--text-primary)]">
                          {row.booking_code || row.reservation_id} · {row.guest_name || "—"}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">status: {row.status}</div>
                        {row.codes.length > 0 ? <div className="text-xs text-[var(--text-secondary)]">codes: {row.codes.join(", ")}</div> : null}
                        {row.missing_fields?.length ? <div className="text-xs text-amber-700">missing: {row.missing_fields.join(", ")}</div> : null}
                        {row.error ? <div className="text-xs text-rose-700">error: {row.error}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>

      <footer className="bg-[var(--bg-surface)] border-t border-[var(--border-default)] px-6 py-4 flex items-center justify-between sticky bottom-0 z-20">
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={handleSaveAndExit} disabled={busy || step2Busy}>
            Save Draft & Exit
          </button>
          <button className="btn btn-ghost text-rose-600" onClick={handleCancelDraft} disabled={busy || step2Busy || !businessDate}>
            Cancel Wizard
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary" onClick={handleBack} disabled={currentStep === 1 || busy || step2Busy}>
            Back
          </button>
          {currentStep < 4 ? (
            <button className="btn btn-primary" onClick={handleNext} disabled={busy || step2Busy}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleConfirm} disabled={busy || step2Busy || selectedReservations.length === 0}>
              {busy ? "Checking in..." : `Confirm Check-in (${selectedReservations.length})`}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
