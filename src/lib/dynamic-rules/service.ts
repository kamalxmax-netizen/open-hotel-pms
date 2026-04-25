import type {
  AppliedLogRow,
  BulkActionRequest,
  BulkActionResponse,
  DynamicEngineSettings,
  DynamicPreviewRow,
  EvaluateResponse,
  ProjectedRow,
  RateRuleGroup,
  RateRuleGroupMember,
  RateRuleTier,
  SimulationResponse,
  SuggestionImpactSummary,
  UndoResponse,
} from "@/lib/rates/dynamic-types";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { applyAction, clampDynamicPrice, getDirection, roundPrice } from "@/lib/dynamic-rules/rounding";
import type { NextRequest } from "next/server";

type SupabaseClientLike = ReturnType<typeof createServerSupabaseClient>;

export type DynamicRulesActor = {
  userId: string;
  role: string;
};

type RoomTypeMeta = {
  roomTypeId: string;
  roomTypeName: string;
  minRateFloor: number | null;
  roomIds: string[];
};

type PreviewFilters = {
  status?: string;
  fromDate?: string;
  toDate?: string;
  roomTypeId?: string;
  groupId?: string;
  direction?: string;
  includeAllEvaluations?: boolean;
  limit?: number;
};

type AppliedLogFilters = {
  hours?: number;
  limit?: number;
};

type GroupDraft = {
  name: string;
  priority?: number;
  trigger_scope: "hotel_wide" | "group_aggregate" | "per_room_type";
  mode: "suggest_only" | "auto_apply";
  is_active?: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  applies_to_dow?: number[] | null;
};

type EvaluateWithAttributionOptions = {
  startDate: string;
  endDate: string;
  actorUserId?: string | null;
};

type SimulationCandidate = {
  row: ProjectedRow;
  supersededGroupIds: string[];
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNullableString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseIsoDate(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeDow(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const unique = Array.from(
    new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
    )
  ).sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

function minutesRemaining(iso: string) {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 60000);
}

function buildDynamicPreviewRow(
  row: any,
  roomTypeNames: Map<string, string>,
  groupNames: Map<string, string>
): DynamicPreviewRow {
  const basePrice = toNumber(row.base_price);
  const suggestedPrice = toNumber(row.suggested_price);
  return {
    id: String(row.id),
    stay_date: String(row.stay_date),
    room_type_id: String(row.room_type_id),
    room_type_name: roomTypeNames.get(String(row.room_type_id)),
    base_price: basePrice,
    suggested_price: suggestedPrice,
    delta_thb: Math.round((suggestedPrice - basePrice) * 100) / 100,
    delta_pct: basePrice > 0 ? (suggestedPrice - basePrice) / basePrice : 0,
    direction: String(row.direction) as DynamicPreviewRow["direction"],
    requires_confirmation: Boolean(row.requires_confirmation),
    clamped_to_floor: Boolean(row.clamped_to_floor),
    clamped_to_max: Boolean(row.clamped_to_max),
    direction_override: Boolean(row.direction_override),
    applied_rule_group_id: String(row.applied_rule_group_id),
    applied_rule_group_name: groupNames.get(String(row.applied_rule_group_id)),
    applied_tier_id: String(row.applied_tier_id),
    status: String(row.status) as DynamicPreviewRow["status"],
    superseded_by: row.superseded_by ? String(row.superseded_by) : null,
    eval_run_id: String(row.eval_run_id),
    created_at: String(row.created_at),
    actioned_at: row.actioned_at ? String(row.actioned_at) : null,
    actioned_by: row.actioned_by ? String(row.actioned_by) : null,
    reject_reason: row.reject_reason ? String(row.reject_reason) : null,
  };
}

function getSimulationDirectionOverride(direction: ProjectedRow["direction"], mode: RateRuleGroup["mode"]) {
  return direction === "down" && mode === "auto_apply";
}

async function fetchRoomTypeLookup(supabase: SupabaseClientLike, roomTypeIds: string[]) {
  if (roomTypeIds.length === 0) return new Map<string, string>();
  const { data, error } = await supabase
    .from("room_types")
    .select("id, name_en")
    .in("id", roomTypeIds.map((value) => Number(value)));

  if (error) throw new Error(error.message);

  return new Map(
    (data ?? []).map((row: any) => [String(row.id), String(row.name_en ?? "")])
  );
}

async function fetchGroupNameLookup(supabase: SupabaseClientLike, groupIds: string[]) {
  if (groupIds.length === 0) return new Map<string, string>();
  const { data, error } = await supabase
    .from("rate_rule_groups")
    .select("id, name")
    .in("id", groupIds);

  if (error) throw new Error(error.message);

  return new Map((data ?? []).map((row: any) => [String(row.id), String(row.name)]));
}

async function fetchRoomTypeMeta(supabase: SupabaseClientLike, roomTypeIds: string[]) {
  const ids = Array.from(new Set(roomTypeIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, RoomTypeMeta>();

  const [{ data: roomTypes, error: roomTypeError }, { data: rooms, error: roomError }] = await Promise.all([
    supabase
      .from("room_types")
      .select("id, name_en, min_rate_floor")
      .in("id", ids.map((value) => Number(value))),
    supabase
      .from("rooms")
      .select("id, room_type_id, room_number, is_sellable, is_dayuse")
      .in("room_type_id", ids.map((value) => Number(value)))
      .eq("is_sellable", true)
      .eq("is_dayuse", false)
      .order("room_number", { ascending: true }),
  ]);

  if (roomTypeError) throw new Error(roomTypeError.message);
  if (roomError) throw new Error(roomError.message);

  const map = new Map<string, RoomTypeMeta>();
  for (const row of roomTypes ?? []) {
    map.set(String((row as any).id), {
      roomTypeId: String((row as any).id),
      roomTypeName: String((row as any).name_en ?? ""),
      minRateFloor: (row as any).min_rate_floor == null ? null : Number((row as any).min_rate_floor),
      roomIds: [],
    });
  }

  for (const row of rooms ?? []) {
    const key = String((row as any).room_type_id);
    const entry = map.get(key);
    if (!entry) continue;
    entry.roomIds.push(String((row as any).id));
  }

  return map;
}

async function fetchDynamicSettings(supabase: SupabaseClientLike): Promise<DynamicEngineSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value_json")
    .in("key", [
      "rate.dynamic_max_multiplier",
      "rate.dynamic_eval_window_days",
      "rate.dynamic_undo_window_minutes",
      "rate.dynamic_suggestion_stale_minutes",
    ]);

  if (error) throw new Error(error.message);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    map.set(String((row as any).key), (row as any).value_json);
  }

  return {
    dynamic_max_multiplier: Math.max(1, Math.min(3, toNumber(map.get("rate.dynamic_max_multiplier"), 1.5))),
    dynamic_eval_window_days: Math.max(7, Math.min(120, Math.round(toNumber(map.get("rate.dynamic_eval_window_days"), 60)))),
    dynamic_undo_window_minutes: Math.max(5, Math.min(240, Math.round(toNumber(map.get("rate.dynamic_undo_window_minutes"), 60)))),
    dynamic_suggestion_stale_minutes: Math.max(30, Math.min(720, Math.round(toNumber(map.get("rate.dynamic_suggestion_stale_minutes"), 120)))),
  };
}

async function fetchRuleGroupsData(supabase: SupabaseClientLike, groupIds?: string[]) {
  let groupsQuery = supabase
    .from("rate_rule_groups")
    .select("id, name, priority, trigger_scope, mode, is_active, effective_from, effective_to, applies_to_dow, created_at, updated_at")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  let membersQuery = supabase
    .from("rate_rule_group_members")
    .select("group_id, room_type_id, action_type, action_value, rounding")
    .order("room_type_id", { ascending: true });

  let tiersQuery = supabase
    .from("rate_rule_tiers")
    .select("id, group_id, trigger_metric, trigger_threshold, tier_order")
    .order("tier_order", { ascending: true });

  if (groupIds && groupIds.length > 0) {
    groupsQuery = groupsQuery.in("id", groupIds);
    membersQuery = membersQuery.in("group_id", groupIds);
    tiersQuery = tiersQuery.in("group_id", groupIds);
  }

  const [{ data: groups, error: groupError }, { data: members, error: memberError }, { data: tiers, error: tierError }] =
    await Promise.all([groupsQuery, membersQuery, tiersQuery]);

  if (groupError) throw new Error(groupError.message);
  if (memberError) throw new Error(memberError.message);
  if (tierError) throw new Error(tierError.message);

  const roomTypeLookup = await fetchRoomTypeLookup(
    supabase,
    Array.from(new Set((members ?? []).map((row: any) => String(row.room_type_id))))
  );

  const membersByGroup = new Map<string, RateRuleGroupMember[]>();
  for (const row of members ?? []) {
    const groupId = String((row as any).group_id);
    const next: RateRuleGroupMember = {
      room_type_id: String((row as any).room_type_id),
      room_type_name: roomTypeLookup.get(String((row as any).room_type_id)),
      action_type: String((row as any).action_type) as RateRuleGroupMember["action_type"],
      action_value: toNumber((row as any).action_value),
      rounding: String((row as any).rounding) as RateRuleGroupMember["rounding"],
    };
    membersByGroup.set(groupId, [...(membersByGroup.get(groupId) ?? []), next]);
  }

  const tiersByGroup = new Map<string, RateRuleTier[]>();
  for (const row of tiers ?? []) {
    const groupId = String((row as any).group_id);
    const next: RateRuleTier = {
      id: String((row as any).id),
      trigger_metric: String((row as any).trigger_metric) as RateRuleTier["trigger_metric"],
      trigger_threshold: toNumber((row as any).trigger_threshold),
      tier_order: toNumber((row as any).tier_order),
    };
    tiersByGroup.set(groupId, [...(tiersByGroup.get(groupId) ?? []), next]);
  }

  return (groups ?? []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    priority: toNumber(row.priority, 100),
    trigger_scope: String(row.trigger_scope) as RateRuleGroup["trigger_scope"],
    mode: String(row.mode) as RateRuleGroup["mode"],
    is_active: Boolean(row.is_active),
    effective_from: parseIsoDate(row.effective_from),
    effective_to: parseIsoDate(row.effective_to),
    applies_to_dow: normalizeDow(row.applies_to_dow),
    members: membersByGroup.get(String(row.id)) ?? [],
    tiers: (tiersByGroup.get(String(row.id)) ?? []).sort((a, b) => a.tier_order - b.tier_order),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  })) satisfies RateRuleGroup[];
}

async function loadBasePricesByRoomType(
  supabase: SupabaseClientLike,
  stayDate: string,
  roomMeta: Map<string, RoomTypeMeta>
) {
  const roomIds = Array.from(roomMeta.values()).flatMap((entry) => entry.roomIds);
  const roomTypeByRoomId = new Map<string, string>();
  for (const entry of roomMeta.values()) {
    for (const roomId of entry.roomIds) {
      roomTypeByRoomId.set(roomId, entry.roomTypeId);
    }
  }

  if (roomIds.length === 0) return new Map<string, number>();

  const { data, error } = await supabase
    .from("rate_templates")
    .select("room_id, price")
    .eq("stay_date", stayDate)
    .in("room_id", roomIds);

  if (error) throw new Error(error.message);

  const valuesByType = new Map<string, number[]>();
  for (const row of data ?? []) {
    const roomId = String((row as any).room_id);
    const roomTypeId = roomTypeByRoomId.get(roomId);
    if (!roomTypeId) continue;
    valuesByType.set(roomTypeId, [...(valuesByType.get(roomTypeId) ?? []), toNumber((row as any).price)]);
  }

  const result = new Map<string, number>();
  for (const [roomTypeId, values] of valuesByType.entries()) {
    if (values.length === 0) continue;
    result.set(roomTypeId, Math.min(...values));
  }
  return result;
}

async function loadOccupancyByRoomType(
  supabase: SupabaseClientLike,
  stayDate: string,
  roomMeta: Map<string, RoomTypeMeta>
) {
  const roomIds = Array.from(roomMeta.values()).flatMap((entry) => entry.roomIds);
  const roomTypeByRoomId = new Map<string, string>();
  for (const entry of roomMeta.values()) {
    for (const roomId of entry.roomIds) {
      roomTypeByRoomId.set(roomId, entry.roomTypeId);
    }
  }

  const bookedCounts = new Map<string, number>();
  if (roomIds.length > 0) {
    const { data, error } = await supabase
      .from("reservation_nights")
      .select("room_id, reservation_id, reservations!inner(status)")
      .eq("stay_date", stayDate)
      .is("cancelled_at", null)
      .in("room_id", roomIds);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const reservation = Array.isArray((row as any).reservations)
        ? (row as any).reservations[0]
        : (row as any).reservations;
      const status = String(reservation?.status ?? "").toLowerCase();
      if (status === "cancelled" || status === "no_show") continue;
      const roomTypeId = roomTypeByRoomId.get(String((row as any).room_id));
      if (!roomTypeId) continue;
      bookedCounts.set(roomTypeId, (bookedCounts.get(roomTypeId) ?? 0) + 1);
    }
  }

  const occupancy = new Map<string, { booked: number; total: number; pct: number }>();
  for (const entry of roomMeta.values()) {
    const booked = bookedCounts.get(entry.roomTypeId) ?? 0;
    const total = entry.roomIds.length;
    occupancy.set(entry.roomTypeId, {
      booked,
      total,
      pct: total > 0 ? Math.round((booked * 10000) / total) / 100 : 0,
    });
  }

  return occupancy;
}

function findMatchingTier(
  tiers: RateRuleTier[],
  occ: { booked: number; total: number; pct: number }
) {
  return [...tiers]
    .sort((a, b) => {
      if (b.trigger_threshold !== a.trigger_threshold) {
        return b.trigger_threshold - a.trigger_threshold;
      }
      return a.tier_order - b.tier_order;
    })
    .find((tier) =>
      tier.trigger_metric === "occ_percent"
        ? occ.pct >= tier.trigger_threshold
        : occ.booked >= tier.trigger_threshold
    ) ?? null;
}

function addSupersededGroup(candidate: SimulationCandidate, previousGroupId: string) {
  if (candidate.supersededGroupIds.includes(previousGroupId)) return candidate.supersededGroupIds;
  return [...candidate.supersededGroupIds, previousGroupId];
}

async function buildImpactSummary(supabase: SupabaseClientLike, rows: DynamicPreviewRow[]): Promise<SuggestionImpactSummary> {
  const roomTypeIds = Array.from(new Set(rows.map((row) => row.room_type_id)));
  const roomMeta = await fetchRoomTypeMeta(supabase, roomTypeIds);
  const { data: channels, error: channelError } = await supabase
    .from("ota_channels")
    .select("code")
    .eq("is_active", true)
    .eq("sync_method", "manual");

  if (channelError) throw new Error(channelError.message);
  const manualChannelCount = Math.max(1, (channels ?? []).length);

  const distinctDates = new Set(rows.map((row) => row.stay_date));
  const distinctRoomTypes = new Set(rows.map((row) => row.room_type_id));

  let estimatedRevenueDeltaThb = 0;
  for (const row of rows) {
    const roomCount = roomMeta.get(row.room_type_id)?.roomIds.length ?? 0;
    estimatedRevenueDeltaThb += row.delta_thb * roomCount;
  }

  return {
    total_rows: rows.length,
    price_up_rows: rows.filter((row) => row.direction === "up").length,
    price_down_rows: rows.filter((row) => row.direction === "down").length,
    estimated_revenue_delta_thb: Math.round(estimatedRevenueDeltaThb * 100) / 100,
    distinct_dates: distinctDates.size,
    distinct_room_types: distinctRoomTypes.size,
    clamped_floor_count: rows.filter((row) => row.clamped_to_floor).length,
    clamped_max_count: rows.filter((row) => row.clamped_to_max).length,
    ota_sync_tasks_that_will_generate: rows.length * manualChannelCount,
  };
}

async function computeAppliedLogState(
  supabase: SupabaseClientLike,
  row: any,
  roomTypeNames: Map<string, string>
): Promise<AppliedLogRow> {
  const affectedRoomIds = Array.isArray(row.affected_room_ids)
    ? row.affected_room_ids.map((entry: unknown) => String(entry))
    : [];
  const currentPrices: Record<string, number> = {};
  let divergenceReason: AppliedLogRow["divergence_reason"] = "none";

  if (row.undone_at) {
    divergenceReason = "already_undone";
  } else if (minutesRemaining(String(row.reversible_until)) <= 0) {
    divergenceReason = "window_expired";
  } else if (affectedRoomIds.length > 0) {
    const { data, error } = await supabase
      .from("rate_templates")
      .select("room_id, price")
      .eq("stay_date", String(row.stay_date))
      .in("room_id", affectedRoomIds);

    if (error) throw new Error(error.message);
    for (const entry of data ?? []) {
      currentPrices[String((entry as any).room_id)] = toNumber((entry as any).price);
    }

    const expected = toNumber(row.new_price);
    const hasMismatch = affectedRoomIds.some((roomId: string) => currentPrices[roomId] !== expected);
    if (hasMismatch) {
      divergenceReason = "price_changed";
    }
  }

  const isUndoable = divergenceReason === "none";
  return {
    id: String(row.id),
    preview_id: row.preview_id ? String(row.preview_id) : null,
    stay_date: String(row.stay_date),
    room_type_id: String(row.room_type_id),
    room_type_name: roomTypeNames.get(String(row.room_type_id)),
    previous_price: toNumber(row.previous_price),
    new_price: toNumber(row.new_price),
    applied_at: String(row.applied_at),
    applied_by: row.applied_by ? String(row.applied_by) : null,
    apply_method: String(row.apply_method) as AppliedLogRow["apply_method"],
    reversible_until: String(row.reversible_until),
    undone_at: row.undone_at ? String(row.undone_at) : null,
    undone_by: row.undone_by ? String(row.undone_by) : null,
    affected_room_ids: affectedRoomIds,
    affected_room_count: affectedRoomIds.length,
    is_undoable: isUndoable,
    divergence_reason: divergenceReason,
    current_prices: divergenceReason === "price_changed" ? currentPrices : undefined,
  };
}

export async function requireDynamicRulesReadAccess(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const actor = await getAuthenticatedUser(supabase, request);
  if (!actor) {
    return { ok: false as const, error: "Unauthorized." };
  }
  const role = await getUserRole(supabase, actor.id);
  if (role !== "admin" && role !== "supervisor") {
    return { ok: false as const, error: "Forbidden." };
  }
  return { ok: true as const, supabase, actor: { userId: actor.id, role: role ?? "" } satisfies DynamicRulesActor };
}

export async function requireDynamicRulesAdminAccess(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const actor = await getAuthenticatedUser(supabase, request);
  if (!actor) {
    return { ok: false as const, error: "Unauthorized." };
  }
  const role = await getUserRole(supabase, actor.id);
  if (role !== "admin") {
    return { ok: false as const, error: "Forbidden." };
  }
  return { ok: true as const, supabase, actor: { userId: actor.id, role: role ?? "" } satisfies DynamicRulesActor };
}

export async function listRuleGroups(supabase: SupabaseClientLike) {
  return fetchRuleGroupsData(supabase);
}

export async function getRuleGroup(supabase: SupabaseClientLike, groupId: string) {
  const rows = await fetchRuleGroupsData(supabase, [groupId]);
  return rows[0] ?? null;
}

export async function createRuleGroup(supabase: SupabaseClientLike, actorUserId: string, input: GroupDraft) {
  const payload = {
    name: input.name.trim(),
    priority: Math.round(toNumber(input.priority, 100)),
    trigger_scope: input.trigger_scope,
    mode: input.mode,
    is_active: input.is_active !== false,
    effective_from: parseIsoDate(input.effective_from) ?? null,
    effective_to: parseIsoDate(input.effective_to) ?? null,
    applies_to_dow: normalizeDow(input.applies_to_dow),
    created_by: actorUserId,
  };

  const { data, error } = await supabase
    .from("rate_rule_groups")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return getRuleGroup(supabase, String((data as any).id));
}

export async function updateRuleGroup(supabase: SupabaseClientLike, groupId: string, input: GroupDraft) {
  const payload = {
    name: input.name.trim(),
    priority: Math.round(toNumber(input.priority, 100)),
    trigger_scope: input.trigger_scope,
    mode: input.mode,
    is_active: input.is_active !== false,
    effective_from: parseIsoDate(input.effective_from) ?? null,
    effective_to: parseIsoDate(input.effective_to) ?? null,
    applies_to_dow: normalizeDow(input.applies_to_dow),
  };

  const { data, error } = await supabase
    .from("rate_rule_groups")
    .update(payload)
    .eq("id", groupId)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return getRuleGroup(supabase, groupId);
}

export async function deleteRuleGroup(supabase: SupabaseClientLike, groupId: string) {
  const { error } = await supabase.from("rate_rule_groups").delete().eq("id", groupId);
  if (error) throw new Error(error.message);
}

export async function replaceGroupMembers(supabase: SupabaseClientLike, groupId: string, members: RateRuleGroupMember[]) {
  const { error: deleteError } = await supabase
    .from("rate_rule_group_members")
    .delete()
    .eq("group_id", groupId);
  if (deleteError) throw new Error(deleteError.message);

  if (members.length > 0) {
    const { error: insertError } = await supabase
      .from("rate_rule_group_members")
      .insert(
        members.map((member) => ({
          group_id: groupId,
          room_type_id: Number(member.room_type_id),
          action_type: member.action_type,
          action_value: member.action_value,
          rounding: member.rounding,
        }))
      );
    if (insertError) throw new Error(insertError.message);
  }

  return getRuleGroup(supabase, groupId);
}

export async function replaceGroupTiers(supabase: SupabaseClientLike, groupId: string, tiers: Array<Omit<RateRuleTier, "id"> & { id?: string }>) {
  const { error: deleteError } = await supabase
    .from("rate_rule_tiers")
    .delete()
    .eq("group_id", groupId);
  if (deleteError) throw new Error(deleteError.message);

  if (tiers.length > 0) {
    const { error: insertError } = await supabase
      .from("rate_rule_tiers")
      .insert(
        tiers.map((tier) => ({
          group_id: groupId,
          trigger_metric: tier.trigger_metric,
          trigger_threshold: tier.trigger_threshold,
          tier_order: tier.tier_order,
        }))
      );
    if (insertError) throw new Error(insertError.message);
  }

  return getRuleGroup(supabase, groupId);
}

export async function listPreviewRows(supabase: SupabaseClientLike, filters: PreviewFilters) {
  let query = supabase
    .from("rate_dynamic_preview")
    .select("id, stay_date, room_type_id, base_price, suggested_price, direction, requires_confirmation, clamped_to_floor, clamped_to_max, direction_override, applied_rule_group_id, applied_tier_id, status, superseded_by, eval_run_id, created_at, actioned_at, actioned_by, reject_reason")
    .order("stay_date", { ascending: true })
    .order("created_at", { ascending: false });

  const status = filters.status ?? "suggested";
  if (status !== "all") query = query.eq("status", status);
  if (filters.fromDate) query = query.gte("stay_date", filters.fromDate);
  if (filters.toDate) query = query.lte("stay_date", filters.toDate);
  if (filters.roomTypeId) query = query.eq("room_type_id", Number(filters.roomTypeId));
  if (filters.groupId) query = query.eq("applied_rule_group_id", filters.groupId);
  if (filters.direction && filters.direction !== "all") query = query.eq("direction", filters.direction);
  if (!filters.includeAllEvaluations && status === "suggested") query = query.is("superseded_by", null);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const roomTypeLookup = await fetchRoomTypeLookup(
    supabase,
    Array.from(new Set(rows.map((row: any) => String(row.room_type_id))))
  );
  const groupLookup = await fetchGroupNameLookup(
    supabase,
    Array.from(new Set(rows.map((row: any) => String(row.applied_rule_group_id))))
  );

  const normalized = rows.map((row: any) => buildDynamicPreviewRow(row, roomTypeLookup, groupLookup));
  const summary = await buildImpactSummary(supabase, normalized);
  return { rows: normalized, summary };
}

export async function bulkActionPreviewRows(
  supabase: SupabaseClientLike,
  actorUserId: string,
  payload: BulkActionRequest
): Promise<BulkActionResponse> {
  const previewIds = Array.from(new Set(payload.preview_ids.map((id) => String(id).trim()).filter(Boolean)));
  if (previewIds.length === 0) {
    return { success: false, error: "No preview rows selected." };
  }

  const { data, error } = await supabase
    .from("rate_dynamic_preview")
    .select("id, stay_date, room_type_id, base_price, suggested_price, status")
    .in("id", previewIds);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const validRows = rows.filter((row: any) => String(row.status) === "suggested");
  const failedIds = previewIds.filter((id) => !validRows.some((row: any) => String(row.id) === id));

  if (payload.action === "reject") {
    if (!toNullableString(payload.reject_reason)) {
      return { success: false, error: "reject_reason is required." };
    }

    if (validRows.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: rejectError } = await supabase
        .from("rate_dynamic_preview")
        .update({
          status: "rejected",
          actioned_at: nowIso,
          actioned_by: actorUserId,
          reject_reason: payload.reject_reason,
        })
        .in("id", validRows.map((row: any) => row.id))
        .eq("status", "suggested");

      if (rejectError) throw new Error(rejectError.message);
    }

    return {
      success: true,
      rejected_count: validRows.length,
      failed_ids: failedIds.length > 0 ? failedIds : undefined,
    };
  }

  const settings = await fetchDynamicSettings(supabase);
  const roomMeta = await fetchRoomTypeMeta(
    supabase,
    Array.from(new Set(validRows.map((row: any) => String(row.room_type_id))))
  );

  let approvedCount = 0;
  for (const row of validRows) {
    const roomTypeId = String((row as any).room_type_id);
    const meta = roomMeta.get(roomTypeId);
    if (!meta || meta.roomIds.length === 0) {
      failedIds.push(String((row as any).id));
      continue;
    }

    const nowIso = new Date().toISOString();
    const suggestedPrice = toNumber((row as any).suggested_price);
    const basePrice = toNumber((row as any).base_price);

    const upsertRows = meta.roomIds.map((roomId) => ({
      room_id: roomId,
      stay_date: String((row as any).stay_date),
      price: suggestedPrice,
      updated_by: actorUserId,
      updated_at: nowIso,
    }));

    const { error: upsertError } = await supabase
      .from("rate_templates")
      .upsert(upsertRows, { onConflict: "stay_date,room_id" });
    if (upsertError) throw new Error(upsertError.message);

    const reversibleUntil = new Date(Date.now() + settings.dynamic_undo_window_minutes * 60000).toISOString();
    const { error: logError } = await supabase
      .from("rate_dynamic_applied_log")
      .insert({
        preview_id: String((row as any).id),
        stay_date: String((row as any).stay_date),
        room_type_id: Number(roomTypeId),
        previous_price: basePrice,
        new_price: suggestedPrice,
        applied_at: nowIso,
        applied_by: actorUserId,
        apply_method: "confirmed",
        reversible_until: reversibleUntil,
        affected_room_ids: meta.roomIds,
      });
    if (logError) throw new Error(logError.message);

    const { data: updated, error: updateError } = await supabase
      .from("rate_dynamic_preview")
      .update({
        status: "applied",
        actioned_at: nowIso,
        actioned_by: actorUserId,
      })
      .eq("id", String((row as any).id))
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (updateError) throw new Error(updateError.message);
    if (!updated) {
      failedIds.push(String((row as any).id));
      continue;
    }

    approvedCount += 1;
  }

  return {
    success: true,
    approved_count: approvedCount,
    failed_ids: failedIds.length > 0 ? failedIds : undefined,
  };
}

export async function listAppliedLogRows(supabase: SupabaseClientLike, filters: AppliedLogFilters) {
  const limit = Math.max(1, Math.min(200, Math.round(filters.limit ?? 100)));
  const hours = Math.max(1, Math.min(168, Math.round(filters.hours ?? 24)));
  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("rate_dynamic_applied_log")
    .select("id, preview_id, stay_date, room_type_id, previous_price, new_price, applied_at, applied_by, apply_method, reversible_until, undone_at, undone_by, affected_room_ids")
    .gte("applied_at", cutoffIso)
    .order("applied_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const roomTypeLookup = await fetchRoomTypeLookup(
    supabase,
    Array.from(new Set((data ?? []).map((row: any) => String(row.room_type_id))))
  );

  return Promise.all((data ?? []).map((row: any) => computeAppliedLogState(supabase, row, roomTypeLookup)));
}

export async function undoAppliedLogRow(
  supabase: SupabaseClientLike,
  actorUserId: string,
  appliedLogId: string
): Promise<UndoResponse> {
  const { data, error } = await supabase
    .from("rate_dynamic_applied_log")
    .select("id, stay_date, room_type_id, previous_price, new_price, reversible_until, undone_at, affected_room_ids")
    .eq("id", appliedLogId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { success: false, error_code: "NOT_FOUND", error: "Applied log not found." };
  }
  if ((data as any).undone_at) {
    return { success: false, error_code: "ALREADY_UNDONE", error: "This apply has already been undone." };
  }
  if (minutesRemaining(String((data as any).reversible_until)) <= 0) {
    return { success: false, error_code: "WINDOW_EXPIRED", error: "Undo window has expired." };
  }

  const affectedRoomIds = Array.isArray((data as any).affected_room_ids)
    ? (data as any).affected_room_ids.map((entry: unknown) => String(entry))
    : [];

  const { data: currentRates, error: rateError } = await supabase
    .from("rate_templates")
    .select("room_id, price")
    .eq("stay_date", String((data as any).stay_date))
    .in("room_id", affectedRoomIds);

  if (rateError) throw new Error(rateError.message);

  const expectedPrice = toNumber((data as any).new_price);
  const currentPrices: Record<string, number> = {};
  for (const row of currentRates ?? []) {
    currentPrices[String((row as any).room_id)] = toNumber((row as any).price);
  }

  const diverged = affectedRoomIds.some((roomId: string) => currentPrices[roomId] !== expectedPrice);
  if (diverged) {
    return {
      success: false,
      error_code: "DIVERGED",
      error: "Price changed since apply. Cannot undo safely.",
      current_prices: currentPrices,
      expected_price: expectedPrice,
    };
  }

  const nowIso = new Date().toISOString();
  const previousPrice = toNumber((data as any).previous_price);
  const rows = affectedRoomIds.map((roomId: string) => ({
    room_id: roomId,
    stay_date: String((data as any).stay_date),
    price: previousPrice,
    updated_by: actorUserId,
    updated_at: nowIso,
  }));

  const { error: upsertError } = await supabase
    .from("rate_templates")
    .upsert(rows, { onConflict: "stay_date,room_id" });
  if (upsertError) throw new Error(upsertError.message);

  const { error: updateError } = await supabase
    .from("rate_dynamic_applied_log")
    .update({ undone_at: nowIso, undone_by: actorUserId })
    .eq("id", appliedLogId)
    .is("undone_at", null);
  if (updateError) throw new Error(updateError.message);

  return { success: true };
}

export async function runDynamicEvaluation(
  supabase: SupabaseClientLike,
  options: EvaluateWithAttributionOptions
): Promise<EvaluateResponse> {
  const { data, error } = await supabase.rpc("evaluate_dynamic_rates", {
    p_start: options.startDate,
    p_end: options.endDate,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const response = data as EvaluateResponse | null;
  if (!response?.success || !response.eval_run_id) {
    return response ?? { success: false, error: "Dynamic evaluation failed." };
  }

  if (options.actorUserId) {
    const nowIso = new Date().toISOString();
    const { data: previewRows, error: previewError } = await supabase
      .from("rate_dynamic_preview")
      .select("id")
      .eq("eval_run_id", response.eval_run_id)
      .eq("status", "applied");
    if (previewError) throw new Error(previewError.message);

    const previewIds = (previewRows ?? []).map((row: any) => String(row.id));
    if (previewIds.length > 0) {
      const { error: previewUpdateError } = await supabase
        .from("rate_dynamic_preview")
        .update({ actioned_by: options.actorUserId, actioned_at: nowIso })
        .in("id", previewIds);
      if (previewUpdateError) throw new Error(previewUpdateError.message);

      const { data: logRows, error: logError } = await supabase
        .from("rate_dynamic_applied_log")
        .select("id, stay_date, new_price, affected_room_ids")
        .in("preview_id", previewIds);
      if (logError) throw new Error(logError.message);

      const { error: logUpdateError } = await supabase
        .from("rate_dynamic_applied_log")
        .update({ applied_by: options.actorUserId, apply_method: "manual_run" })
        .in("preview_id", previewIds);
      if (logUpdateError) throw new Error(logUpdateError.message);

      for (const row of logRows ?? []) {
        const affectedRoomIds = Array.isArray((row as any).affected_room_ids)
          ? (row as any).affected_room_ids.map((entry: unknown) => String(entry))
          : [];
        if (affectedRoomIds.length === 0) continue;

        const { error: rateTemplateError } = await supabase
          .from("rate_templates")
          .update({ updated_by: options.actorUserId })
          .eq("stay_date", String((row as any).stay_date))
          .eq("price", toNumber((row as any).new_price))
          .in("room_id", affectedRoomIds);
        if (rateTemplateError) throw new Error(rateTemplateError.message);
      }
    }
  }

  return response;
}

export async function simulateDynamicRules(
  supabase: SupabaseClientLike,
  stayDate: string,
  groupId?: string
): Promise<SimulationResponse> {
  const allGroups = groupId ? (await fetchRuleGroupsData(supabase, [groupId])) : (await fetchRuleGroupsData(supabase));
  const effectiveGroups = allGroups
    .filter((group) => {
      if (groupId && group.id === groupId) {
        if (group.effective_from && stayDate < group.effective_from) return false;
        if (group.effective_to && stayDate > group.effective_to) return false;
        if (group.applies_to_dow && group.applies_to_dow.length > 0) {
          const dow = new Date(`${stayDate}T00:00:00`).getDay();
          if (!group.applies_to_dow.includes(dow)) return false;
        }
        return true;
      }

      if (!group.is_active) return false;
      if (group.effective_from && stayDate < group.effective_from) return false;
      if (group.effective_to && stayDate > group.effective_to) return false;
      if (group.applies_to_dow && group.applies_to_dow.length > 0) {
        const dow = new Date(`${stayDate}T00:00:00`).getDay();
        if (!group.applies_to_dow.includes(dow)) return false;
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  const roomTypeIds = Array.from(
    new Set(effectiveGroups.flatMap((group) => group.members.map((member) => member.room_type_id)))
  );
  const [settings, roomMeta] = await Promise.all([
    fetchDynamicSettings(supabase),
    fetchRoomTypeMeta(supabase, roomTypeIds),
  ]);
  const [basePriceByType, occByType] = await Promise.all([
    loadBasePricesByRoomType(supabase, stayDate, roomMeta),
    loadOccupancyByRoomType(supabase, stayDate, roomMeta),
  ]);

  const roomMetaResolved = roomMeta;
  const totalBooked = Array.from(occByType.values()).reduce((sum, item) => sum + item.booked, 0);
  const totalRooms = Array.from(occByType.values()).reduce((sum, item) => sum + item.total, 0);
  const hotelOcc = {
    booked: totalBooked,
    total: totalRooms,
    pct: totalRooms > 0 ? Math.round((totalBooked * 10000) / totalRooms) / 100 : 0,
  };

  const winners = new Map<string, SimulationCandidate>();

  for (const group of effectiveGroups) {
    const groupMembers = group.members.filter((member) => roomMetaResolved.has(member.room_type_id));
    if (groupMembers.length === 0 || group.tiers.length === 0) continue;

    const groupOcc =
      group.trigger_scope === "hotel_wide"
        ? hotelOcc
        : group.trigger_scope === "group_aggregate"
          ? (() => {
              const totals = groupMembers.reduce(
                (acc, member) => {
                  const occ = occByType.get(member.room_type_id) ?? { booked: 0, total: 0, pct: 0 };
                  acc.booked += occ.booked;
                  acc.total += occ.total;
                  return acc;
                },
                { booked: 0, total: 0 }
              );
              return {
                booked: totals.booked,
                total: totals.total,
                pct: totals.total > 0 ? Math.round((totals.booked * 10000) / totals.total) / 100 : 0,
              };
            })()
          : null;

    for (const member of groupMembers) {
      const meta = roomMetaResolved.get(member.room_type_id);
      const basePrice = basePriceByType.get(member.room_type_id);
      const memberOcc = occByType.get(member.room_type_id) ?? { booked: 0, total: 0, pct: 0 };
      if (!meta || basePrice == null) continue;

      const occ = group.trigger_scope === "per_room_type" ? memberOcc : groupOcc;
      if (!occ) continue;

      const tier = findMatchingTier(group.tiers, occ);
      if (!tier) continue;

      const rawPrice = applyAction(basePrice, member.action_type, member.action_value);
      const roundedPrice =
        member.action_type === "step" ? roundPrice(rawPrice, "none") : roundPrice(rawPrice, member.rounding);
      const clamped = clampDynamicPrice({
        suggestedPrice: roundedPrice,
        basePrice,
        floorPrice: meta.minRateFloor,
        maxMultiplier: settings.dynamic_max_multiplier,
        rounding: member.rounding,
      });
      const direction = getDirection(basePrice, clamped.price);
      if (direction === "same") continue;

      const row: ProjectedRow = {
        room_type_id: member.room_type_id,
        room_type_name: meta.roomTypeName,
        base_price: basePrice,
        projected_price: clamped.price,
        delta_thb: Math.round((clamped.price - basePrice) * 100) / 100,
        delta_pct: basePrice > 0 ? (clamped.price - basePrice) / basePrice : 0,
        direction,
        requires_confirmation: direction === "down",
        clamped_to_floor: clamped.clampedToFloor,
        clamped_to_max: clamped.clampedToMax,
        direction_override: getSimulationDirectionOverride(direction, group.mode),
        applied_rule_group_id: group.id,
        applied_rule_group_name: group.name,
        applied_tier_id: tier.id,
      };

      const previous = winners.get(member.room_type_id);
      if (!previous) {
        winners.set(member.room_type_id, { row, supersededGroupIds: [] });
        continue;
      }

      winners.set(member.room_type_id, {
        row,
        supersededGroupIds: addSupersededGroup(previous, previous.row.applied_rule_group_id),
      });
    }
  }

  const projectedRows = Array.from(winners.values())
    .map((entry) => ({
      ...entry.row,
      superseded_group_ids: entry.supersededGroupIds.length > 0 ? entry.supersededGroupIds : undefined,
    }))
    .sort((a, b) => String(a.room_type_name ?? "").localeCompare(String(b.room_type_name ?? "")));

  return {
    success: true,
    scope: groupId ? "single_group" : "all_groups",
    group_id: groupId,
    stay_date: stayDate,
    projected_rows: projectedRows,
  };
}
