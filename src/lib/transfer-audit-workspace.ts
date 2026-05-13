export type TransferAuditWorkspaceCandidate = {
  id: string;
  transfer_event_id?: string | null;
  booking_group_id?: string | null;
  group_name?: string | null;
};

export const DRAFT_TRANSFER_SET_EDITOR_ID = "__draft_transfer_set__";

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
}

function selectedIdSet(selectedPaymentIds: string[]) {
  return new Set(uniqueIds(selectedPaymentIds));
}

function foreignSetIdsForCandidates(
  candidates: TransferAuditWorkspaceCandidate[],
  currentSetId?: string | null
): Set<string> {
  const current = String(currentSetId ?? "").trim();
  const ids = candidates
    .map((candidate) => String(candidate.transfer_event_id ?? "").trim())
    .filter((id) => id && id !== current);
  return new Set(ids);
}

export function addPaymentIds(selectedPaymentIds: string[], paymentIdsToAdd: string[]): string[] {
  return uniqueIds([...selectedPaymentIds, ...paymentIdsToAdd]);
}

export function removePaymentId(selectedPaymentIds: string[], paymentId: string): string[] {
  const idToRemove = String(paymentId ?? "").trim();
  return uniqueIds(selectedPaymentIds).filter((id) => id !== idToRemove);
}

export function getTransferSetEditorId(draftSet: boolean, selectedSetId?: string | null): string | null {
  if (draftSet) return DRAFT_TRANSFER_SET_EDITOR_ID;
  const selected = String(selectedSetId ?? "").trim();
  return selected || null;
}

export function shouldCollapseTransferSetEditor(event: {
  key?: string;
  targetInsideTransferSetControls?: boolean;
}): boolean {
  if (event.key === "Escape") return true;
  return event.targetInsideTransferSetControls === false;
}

export function canSaveTransferSet(args: {
  draftSet: boolean;
  hasSelectedSet: boolean;
  selectedPaymentCount: number;
}): boolean {
  if (args.draftSet) return args.selectedPaymentCount > 0;
  if (args.hasSelectedSet) return true;
  return args.selectedPaymentCount > 0;
}

export function getTransferSetSaveAction(args: {
  draftSet: boolean;
  hasSelectedSet: boolean;
  selectedPaymentCount: number;
}): "save" | "archive_empty" | "disabled" {
  if (!canSaveTransferSet(args)) return "disabled";
  if (!args.draftSet && args.hasSelectedSet && args.selectedPaymentCount === 0) {
    return "archive_empty";
  }
  return "save";
}

export function getTransferSetEditorIdAfterSelect(args: {
  nextSetId?: string | null;
  currentEditorId?: string | null;
  expand: boolean;
}): string | null {
  const nextSetId = String(args.nextSetId ?? "").trim();
  if (!nextSetId) return null;
  if (args.expand) return nextSetId;
  return args.currentEditorId === nextSetId ? nextSetId : null;
}

export function shouldBlockTransferSetSwitch(args: {
  dirty: boolean;
  draftSet: boolean;
  currentSetId?: string | null;
  nextSetId?: string | null;
}): boolean {
  if (!args.dirty) return false;
  if (args.draftSet) return true;
  const current = String(args.currentSetId ?? "").trim();
  const next = String(args.nextSetId ?? "").trim();
  return current !== next;
}

export function splitWorkspaceCandidates(
  candidates: TransferAuditWorkspaceCandidate[],
  selectedPaymentIds: string[],
  currentSetId?: string | null
): {
  selected: TransferAuditWorkspaceCandidate[];
  needsDetail: TransferAuditWorkspaceCandidate[];
} {
  const selectedIds = selectedIdSet(selectedPaymentIds);
  const current = String(currentSetId ?? "").trim();

  const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));
  const needsDetail = candidates.filter((candidate) => {
    if (selectedIds.has(candidate.id)) return false;
    const eventId = String(candidate.transfer_event_id ?? "").trim();
    return !eventId || (current && eventId === current);
  });

  return { selected, needsDetail };
}

export function addSameBookingGroupPaymentIds(
  selectedPaymentIds: string[],
  candidates: TransferAuditWorkspaceCandidate[],
  selectedCandidates: TransferAuditWorkspaceCandidate[],
  currentSetId?: string | null
): string[] {
  const groupIds = new Set(
    selectedCandidates
      .map((candidate) => String(candidate.booking_group_id ?? "").trim())
      .filter(Boolean)
  );
  if (groupIds.size === 0) return uniqueIds(selectedPaymentIds);

  const matchingCandidates = candidates.filter((candidate) => {
    const groupId = String(candidate.booking_group_id ?? "").trim();
    return groupId && groupIds.has(groupId);
  });
  const foreignSetIds = foreignSetIdsForCandidates(matchingCandidates, currentSetId);
  const ids = candidates
    .filter((candidate) => {
      const groupId = String(candidate.booking_group_id ?? "").trim();
      const eventId = String(candidate.transfer_event_id ?? "").trim();
      return (groupId && groupIds.has(groupId)) || (eventId && foreignSetIds.has(eventId));
    })
    .map((candidate) => candidate.id);

  return addPaymentIds(selectedPaymentIds, ids);
}

export function addSameGroupNamePaymentIds(
  selectedPaymentIds: string[],
  candidates: TransferAuditWorkspaceCandidate[],
  selectedCandidates: TransferAuditWorkspaceCandidate[],
  currentSetId?: string | null
): string[] {
  const groupNames = new Set(
    selectedCandidates
      .map((candidate) => String(candidate.group_name ?? "").trim())
      .filter(Boolean)
  );
  if (groupNames.size === 0) return uniqueIds(selectedPaymentIds);

  const matchingCandidates = candidates.filter((candidate) => {
    const groupName = String(candidate.group_name ?? "").trim();
    return groupName && groupNames.has(groupName);
  });
  const foreignSetIds = foreignSetIdsForCandidates(matchingCandidates, currentSetId);
  const ids = candidates
    .filter((candidate) => {
      const groupName = String(candidate.group_name ?? "").trim();
      const eventId = String(candidate.transfer_event_id ?? "").trim();
      return (groupName && groupNames.has(groupName)) || (eventId && foreignSetIds.has(eventId));
    })
    .map((candidate) => candidate.id);

  return addPaymentIds(selectedPaymentIds, ids);
}
