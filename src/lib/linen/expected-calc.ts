import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinenCategorySummary, LinenExpectedResult, LinenRoomCategory } from "@/lib/types";

const TOWEL_CHECKLIST_KEYS = ["ผ้าขนหนู"];
const DEFAULT_CUTOFF_TIME = "11:00";

type LinenItemRow = { id: number; item_number: number; name_th: string };
type SetupRow = { room_type_code: string; linen_item_id: number; qty: number };
type RuleRow = { category: LinenRoomCategory; linen_item_id: number; percentage: number; use_checklist: boolean };
type ReservationRow = {
  id?: string;
  guest_name?: string | null;
  status?: string | null;
  checkin_date?: string | null;
  checkout_date?: string | null;
  is_dayuse?: boolean | null;
};

type TaskRow = {
  id: string;
  room_id: string;
  reservation_night_id?: string | null;
  stay_date: string;
  status: string;
  started_at: string | null;
  is_no_service?: boolean | null;
  checklist_snapshot?: unknown;
  rooms?: {
    id?: string;
    room_number?: string;
    is_dayuse?: boolean | null;
    room_types?: { code?: string | null } | null;
  } | null;
  reservation_nights?: {
    reservation_id?: string | null;
    reservations?: ReservationRow | null;
  } | null;
};

type InhouseNightRow = {
  id: string;
  room_id: string;
  stay_date: string;
  cancelled_at?: string | null;
  rooms?: {
    id?: string;
    room_number?: string;
    is_dayuse?: boolean | null;
    room_types?: { code?: string | null } | null;
  } | null;
  reservations?: ReservationRow | null;
};

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return dateString(parsed);
}

function bangkokCutoffIso(date: string, cutoffTime: string): string {
  const [hour = "11", minute = "00"] = cutoffTime.split(":");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCHours(Number(hour) - 7, Number(minute), 0, 0);
  return parsed.toISOString();
}

function emptyCategorySummary(): LinenCategorySummary {
  return {
    checkout_serviced: 0,
    checkout_towel_only: 0,
    inhouse_serviced: 0,
    inhouse_not_started: 0,
    inhouse_no_task: 0,
    inhouse_no_service: 0,
    after_cutoff: 0,
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function checklistEntries(snapshot: unknown): Record<string, unknown>[] {
  if (!snapshot) return [];
  if (Array.isArray(snapshot)) return snapshot.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  if (typeof snapshot !== "object") return [];

  const object = snapshot as Record<string, unknown>;
  for (const key of ["items", "checklist", "entries"]) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      return nested.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
    }
  }

  return Object.entries(object).map(([item, entry]) => {
    if (entry && typeof entry === "object") return { item, ...(entry as Record<string, unknown>) };
    return { item, checked: Boolean(entry), used: entry };
  });
}

export function extractTowelChecklistQty(snapshot: unknown): number {
  for (const entry of checklistEntries(snapshot)) {
    const item = normalizeText(entry.item ?? entry.name ?? entry.label);
    const category = normalizeText(entry.category);
    const checked = entry.checked === true || entry.checked === "true";
    const primaryMatch = TOWEL_CHECKLIST_KEYS.some((key) => item.includes(key.toLowerCase()));
    const fallbackMatch = category === "bath" && (item.includes("towel") || item.includes("ผ้าขนหนู"));
    if (checked && (primaryMatch || fallbackMatch)) {
      return Math.max(0, Math.round(numeric(entry.used ?? entry.quantity ?? entry.qty ?? 0)));
    }
  }
  return 0;
}

function classifyTask(
  task: TaskRow,
  room: TaskRow["rooms"] | null,
  reservation: ReservationRow | null,
  businessDate: string,
  windowStartIso: string,
  windowEndIso: string
): LinenRoomCategory | null {
  if (reservation?.is_dayuse || room?.is_dayuse) return null;
  if (task.is_no_service) return "inhouse_no_service";

  const startedAt = task.started_at;
  if (!startedAt) return reservation?.checkout_date === businessDate ? "checkout_towel_only" : "inhouse_not_started";
  if (startedAt >= windowEndIso) return "after_cutoff";
  if (startedAt < windowStartIso) return null;

  return reservation?.checkout_date === businessDate ? "checkout_serviced" : "inhouse_serviced";
}

export async function getCurrentBusinessDate(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("hotel_settings")
    .select("business_date")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const value = String((data as any)?.business_date ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateString(new Date());
}

export async function calculateExpectedLinen(
  supabase: SupabaseClient,
  options: { businessDate?: string; cutoffTime?: string } = {}
): Promise<LinenExpectedResult> {
  const businessDate = options.businessDate ?? await getCurrentBusinessDate(supabase);
  const cutoffTime = options.cutoffTime ?? DEFAULT_CUTOFF_TIME;
  const previousDate = addDays(businessDate, -1);
  const windowStartIso = bangkokCutoffIso(previousDate, cutoffTime);
  const windowEndIso = bangkokCutoffIso(businessDate, cutoffTime);

  const [itemsRes, setupsRes, rulesRes, tasksRes, inhouseRes] = await Promise.all([
    supabase.from("linen_items").select("id, item_number, name_th").eq("is_active", true).order("sort_order", { ascending: true }),
    supabase.from("room_linen_setups").select("room_type_code, linen_item_id, qty"),
    supabase.from("linen_usage_rules").select("category, linen_item_id, percentage, use_checklist"),
    supabase
      .from("housekeeping_tasks")
      .select(`
        id,
        room_id,
        reservation_night_id,
        stay_date,
        status,
        started_at,
        is_no_service,
        checklist_snapshot,
        rooms(id, room_number, is_dayuse, room_types(code)),
        reservation_nights(reservation_id, reservations(id, guest_name, status, checkin_date, checkout_date, is_dayuse))
      `)
      .gte("stay_date", previousDate)
      .lte("stay_date", businessDate),
    supabase
      .from("reservation_nights")
      .select("id, room_id, stay_date, cancelled_at, rooms(id, room_number, is_dayuse, room_types(code)), reservations(id, guest_name, status, checkin_date, checkout_date, is_dayuse)")
      .gte("stay_date", previousDate)
      .lte("stay_date", businessDate)
      .is("cancelled_at", null),
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (setupsRes.error) throw new Error(setupsRes.error.message);
  if (rulesRes.error) throw new Error(rulesRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (inhouseRes.error) throw new Error(inhouseRes.error.message);

  const items = (itemsRes.data ?? []) as LinenItemRow[];
  const setups = (setupsRes.data ?? []) as SetupRow[];
  const rules = (rulesRes.data ?? []) as RuleRow[];
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const inhouseNights = (inhouseRes.data ?? []) as InhouseNightRow[];

  const setupByRoomType = new Map<string, Map<number, number>>();
  for (const row of setups) {
    const key = String(row.room_type_code ?? "");
    if (!setupByRoomType.has(key)) setupByRoomType.set(key, new Map());
    setupByRoomType.get(key)!.set(Number(row.linen_item_id), Number(row.qty ?? 0));
  }

  const ruleByCategory = new Map<LinenRoomCategory, Map<number, RuleRow>>();
  for (const row of rules) {
    if (!ruleByCategory.has(row.category)) ruleByCategory.set(row.category, new Map());
    ruleByCategory.get(row.category)!.set(Number(row.linen_item_id), row);
  }

  const estimatedByItem = new Map<number, number>();
  const rooms: LinenExpectedResult["rooms"] = [];
  const categorySummary = emptyCategorySummary();
  const taskRoomIdsForBusinessDate = new Set(
    tasks
      .filter((task) => String(task.stay_date) === businessDate)
      .map((task) => String(task.room_id))
  );
  const nightById = new Map<string, InhouseNightRow>();
  const nightByRoomDate = new Map<string, InhouseNightRow>();
  const nightByRoomCheckoutDate = new Map<string, InhouseNightRow>();
  const countedTaskKeys = new Set<string>();

  const roomDateKey = (roomId: unknown, date: unknown) => `${String(roomId ?? "")}:${String(date ?? "")}`;
  for (const night of inhouseNights) {
    const nightId = String(night.id ?? "");
    const roomId = String(night.room_id ?? night.rooms?.id ?? "");
    const stayDate = String(night.stay_date ?? "");
    const checkoutDate = String(night.reservations?.checkout_date ?? "");
    if (nightId) nightById.set(nightId, night);
    if (roomId && stayDate) nightByRoomDate.set(roomDateKey(roomId, stayDate), night);
    if (roomId && checkoutDate) nightByRoomCheckoutDate.set(roomDateKey(roomId, checkoutDate), night);
  }

  const resolveNightForTask = (task: TaskRow) => {
    const reservationNightId = String(task.reservation_night_id ?? "");
    if (reservationNightId && nightById.has(reservationNightId)) return nightById.get(reservationNightId) ?? null;
    return (
      nightByRoomDate.get(roomDateKey(task.room_id, task.stay_date)) ??
      nightByRoomCheckoutDate.get(roomDateKey(task.room_id, task.stay_date)) ??
      null
    );
  };

  for (const task of tasks) {
    const resolvedNight = resolveNightForTask(task);
    const room = task.rooms ?? resolvedNight?.rooms ?? null;
    const reservation = task.reservation_nights?.reservations ?? resolvedNight?.reservations ?? null;
    if (!reservation) continue;

    const category = classifyTask(task, room, reservation, businessDate, windowStartIso, windowEndIso);
    if (!category) continue;

    const roomTypeCode = String(room?.room_types?.code ?? "");
    const estimateKey = `${category}:${reservation.id ?? `${task.room_id}:${task.stay_date}`}`;
    if (countedTaskKeys.has(estimateKey)) continue;
    countedTaskKeys.add(estimateKey);

    categorySummary[category] += 1;
    rooms.push({
      room_id: String(room?.id ?? task.room_id),
      room_number: String(room?.room_number ?? ""),
      room_type_code: roomTypeCode,
      category,
      guest_name: reservation?.guest_name ?? null,
    });

    const setup = setupByRoomType.get(roomTypeCode);
    const categoryRules = ruleByCategory.get(category);
    if (!setup || !categoryRules) continue;

    for (const item of items) {
      const rule = categoryRules.get(item.id);
      if (!rule) continue;
      const baseQty = setup.get(item.id) ?? 0;
      const addition = rule.use_checklist ? extractTowelChecklistQty(task.checklist_snapshot) : baseQty * (Number(rule.percentage) / 100);
      estimatedByItem.set(item.id, (estimatedByItem.get(item.id) ?? 0) + addition);
    }
  }

  for (const night of inhouseNights) {
    if (String(night.stay_date ?? "") !== businessDate) continue;
    const reservation = night.reservations ?? null;
    const room = night.rooms ?? null;
    const roomId = String(night.room_id ?? room?.id ?? "");
    if (!roomId || taskRoomIdsForBusinessDate.has(roomId) || reservation?.is_dayuse || room?.is_dayuse) continue;
    if (reservation?.status !== "active") continue;
    if (!reservation.checkout_date || reservation.checkout_date <= businessDate) continue;

    categorySummary.inhouse_no_task += 1;
    rooms.push({
      room_id: roomId,
      room_number: String(room?.room_number ?? ""),
      room_type_code: String(room?.room_types?.code ?? ""),
      category: "inhouse_no_task",
      guest_name: reservation.guest_name ?? null,
    });
  }

  return {
    business_date: businessDate,
    cutoff_time: cutoffTime,
    rooms,
    items: items.map((item) => ({
      linen_item_id: item.id,
      item_number: item.item_number,
      name_th: item.name_th,
      estimated_qty: Math.max(0, Math.round(estimatedByItem.get(item.id) ?? 0)),
    })),
    category_summary: categorySummary,
  };
}
