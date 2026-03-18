import type { GeneratedShiftEntry, RosterGenerateResult, RosterStaffConfig } from "@/lib/types";

type ShiftKind = "morning" | "afternoon" | "night";

export type FoRosterGenerateInput = {
  year: number;
  month: number; // 1-12
  nightStartPersonOrder: number;
  staffConfigs: RosterStaffConfig[];
};

type DaySlot = {
  date: string;
  dow: number; // 0=Sun..6=Sat
  day: number;
};

type StaffMapItem = {
  staff_id: string;
  nickname: string;
  regular_day_off: number;
  shift_preference: "morning_fixed" | "rotate";
  night_rotation_order: number | null;
  extra_day_offs_per_month: number;
};

const REQUIRED_STAFFING: Record<number, { morning: number; afternoon: number; night: number }> = {
  0: { morning: 1, afternoon: 2, night: 1 }, // Sun
  1: { morning: 1, afternoon: 2, night: 1 }, // Mon
  2: { morning: 1, afternoon: 1, night: 1 }, // Tue
  3: { morning: 1, afternoon: 1, night: 1 }, // Wed
  4: { morning: 1, afternoon: 1, night: 1 }, // Thu
  5: { morning: 1, afternoon: 1, night: 1 }, // Fri (strict afternoon = 1)
  6: { morning: 1, afternoon: 1, night: 1 }, // Sat
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dateToYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dayKeyAtLocalNoon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function buildMonthDays(year: number, month: number): DaySlot[] {
  const maxDay = new Date(year, month, 0).getDate();
  const days: DaySlot[] = [];
  for (let day = 1; day <= maxDay; day += 1) {
    const date = dayKeyAtLocalNoon(year, month, day);
    days.push({
      date: dateToYmd(date),
      dow: date.getDay(),
      day,
    });
  }
  return days;
}

function sortStaffIdsByNickname(ids: string[], staffById: Map<string, StaffMapItem>): string[] {
  return [...ids].sort((a, b) => {
    const aName = (staffById.get(a)?.nickname ?? "").trim();
    const bName = (staffById.get(b)?.nickname ?? "").trim();
    const byName = aName.localeCompare(bName, "th");
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });
}

function shiftOnDate(
  assignments: Map<string, Map<string, ShiftKind>>,
  date: string,
  staffId: string
): ShiftKind | null {
  const dateMap = assignments.get(date);
  if (!dateMap) return null;
  return dateMap.get(staffId) ?? null;
}

function setShift(
  assignments: Map<string, Map<string, ShiftKind>>,
  shiftsByDate: Map<string, { morning: string[]; afternoon: string[]; night: string[] }>,
  date: string,
  staffId: string,
  shift: ShiftKind,
  warnings: string[]
): boolean {
  const dateMap = assignments.get(date) ?? new Map<string, ShiftKind>();
  const existing = dateMap.get(staffId);
  if (existing && existing !== shift) {
    warnings.push(
      `Conflict: ${staffId} already has ${existing} on ${date}; cannot assign ${shift}.`
    );
    return false;
  }
  if (existing === shift) return true;

  dateMap.set(staffId, shift);
  assignments.set(date, dateMap);

  const bucket = shiftsByDate.get(date) ?? { morning: [], afternoon: [], night: [] };
  bucket[shift].push(staffId);
  shiftsByDate.set(date, bucket);
  return true;
}

function removeShift(
  assignments: Map<string, Map<string, ShiftKind>>,
  shiftsByDate: Map<string, { morning: string[]; afternoon: string[]; night: string[] }>,
  date: string,
  staffId: string,
  shift: ShiftKind
): boolean {
  const dateMap = assignments.get(date);
  if (!dateMap) return false;
  const existing = dateMap.get(staffId);
  if (!existing || existing !== shift) return false;

  dateMap.delete(staffId);
  if (dateMap.size === 0) assignments.delete(date);

  const bucket = shiftsByDate.get(date);
  if (!bucket) return true;
  const next = bucket[shift].filter((id) => id !== staffId);
  bucket[shift] = next;
  shiftsByDate.set(date, bucket);
  return true;
}

function isRestViolation(
  assignments: Map<string, Map<string, ShiftKind>>,
  days: DaySlot[],
  dayIndexByDate: Map<string, number>,
  date: string,
  staffId: string,
  nextShift: ShiftKind
): boolean {
  const dayIndex = dayIndexByDate.get(date);
  if (dayIndex === undefined) return false;

  const prevDate = dayIndex > 0 ? days[dayIndex - 1].date : null;
  const nextDate = dayIndex < days.length - 1 ? days[dayIndex + 1].date : null;
  const prevShift = prevDate ? shiftOnDate(assignments, prevDate, staffId) : null;
  const nextDayShift = nextDate ? shiftOnDate(assignments, nextDate, staffId) : null;

  if (nextShift === "morning") {
    if (prevShift === "afternoon" || prevShift === "night") return true;
  }
  if (nextShift === "afternoon") {
    if (prevShift === "night") return true;
    if (nextDayShift === "morning") return true;
  }
  if (nextShift === "night") {
    if (nextDayShift === "morning" || nextDayShift === "afternoon") return true;
  }
  return false;
}

function countWeekdayInMonth(days: DaySlot[], dow: number): number {
  return days.reduce((acc, day) => acc + (day.dow === dow ? 1 : 0), 0);
}

function nightWorkerForDay(
  dayIndex: number,
  firstTuesdayIndex: number,
  rotateIdsInOrder: string[],
  startIndex: number
): string {
  if (dayIndex >= firstTuesdayIndex) {
    const cycle = Math.floor((dayIndex - firstTuesdayIndex) / 7);
    const idx = (startIndex + cycle) % rotateIdsInOrder.length;
    return rotateIdsInOrder[idx];
  }
  const prevIdx = (startIndex - 1 + rotateIdsInOrder.length) % rotateIdsInOrder.length;
  return rotateIdsInOrder[prevIdx];
}

export function generateFoRoster(input: FoRosterGenerateInput): RosterGenerateResult {
  const warnings: string[] = [];
  const days = buildMonthDays(input.year, input.month);
  const dayIndexByDate = new Map(days.map((day, index) => [day.date, index]));

  const staffById = new Map<string, StaffMapItem>();
  for (const raw of input.staffConfigs) {
    if (!raw.staff_id) continue;
    staffById.set(raw.staff_id, {
      staff_id: raw.staff_id,
      nickname: String(raw.nickname ?? "").trim(),
      regular_day_off: raw.regular_day_off,
      shift_preference: raw.shift_preference,
      night_rotation_order: raw.night_rotation_order,
      extra_day_offs_per_month: raw.extra_day_offs_per_month,
    });
  }

  const allStaffIds = sortStaffIdsByNickname(Array.from(staffById.keys()), staffById);
  if (allStaffIds.length === 0) {
    return { shifts: [], summary: {}, warnings: ["No staff config provided."] };
  }

  const morningFixedIds = allStaffIds.filter(
    (staffId) => staffById.get(staffId)?.shift_preference === "morning_fixed"
  );
  const rotateIds = allStaffIds.filter(
    (staffId) => staffById.get(staffId)?.shift_preference === "rotate"
  );

  if (morningFixedIds.length !== 1) {
    warnings.push(
      `Expected exactly 1 morning_fixed staff, found ${morningFixedIds.length}. Using first by nickname.`
    );
  }
  if (rotateIds.length === 0) {
    warnings.push("No rotate staff available for night schedule.");
  }

  const morningFixedId = morningFixedIds[0] ?? allStaffIds[0];
  const rotateIdsInOrder = [...rotateIds].sort((a, b) => {
    const aOrder = staffById.get(a)?.night_rotation_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = staffById.get(b)?.night_rotation_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aName = staffById.get(a)?.nickname ?? "";
    const bName = staffById.get(b)?.nickname ?? "";
    const byName = aName.localeCompare(bName, "th");
    if (byName !== 0) return byName;
    return a.localeCompare(b);
  });

  let startRotateIndex = 0;
  if (rotateIdsInOrder.length > 0) {
    const wantedOrder = input.nightStartPersonOrder;
    const foundIndex = rotateIdsInOrder.findIndex(
      (staffId) => (staffById.get(staffId)?.night_rotation_order ?? null) === wantedOrder
    );
    if (foundIndex >= 0) {
      startRotateIndex = foundIndex;
    } else {
      warnings.push(
        `nightStartPersonOrder=${wantedOrder} not found in rotate roster_config; fallback to first rotation order.`
      );
    }
  }

  const firstTuesdayIndex = days.findIndex((day) => day.dow === 2);
  if (firstTuesdayIndex < 0) {
    warnings.push("No Tuesday found in month; night cycle cannot be generated.");
  }

  const assignments = new Map<string, Map<string, ShiftKind>>();
  const shiftsByDate = new Map<string, { morning: string[]; afternoon: string[]; night: string[] }>();
  const forcedOff = new Map<string, Set<string>>();

  // Pass 1: fixed morning assignment.
  for (const day of days) {
    const fixed = staffById.get(morningFixedId);
    if (!fixed) continue;
    if (day.dow === fixed.regular_day_off) continue;
    if (
      isRestViolation(assignments, days, dayIndexByDate, day.date, morningFixedId, "morning")
    ) {
      warnings.push(
        `Rest rule prevented morning_fixed assignment for ${fixed.nickname || morningFixedId} on ${day.date}.`
      );
      continue;
    }
    setShift(assignments, shiftsByDate, day.date, morningFixedId, "morning", warnings);
  }

  // Pass 2: night cycle + post-night Tuesday forced off marker.
  if (rotateIdsInOrder.length > 0 && firstTuesdayIndex >= 0) {
    for (let i = 0; i < days.length; i += 1) {
      const day = days[i];
      const nightStaff = nightWorkerForDay(i, firstTuesdayIndex, rotateIdsInOrder, startRotateIndex);
      setShift(assignments, shiftsByDate, day.date, nightStaff, "night", warnings);

      if (day.dow === 2) {
        const previousNightStaff =
          i > 0
            ? nightWorkerForDay(i - 1, firstTuesdayIndex, rotateIdsInOrder, startRotateIndex)
            : rotateIdsInOrder[
                (rotateIdsInOrder.indexOf(nightStaff) - 1 + rotateIdsInOrder.length) %
                  rotateIdsInOrder.length
              ];
        const setForDate = forcedOff.get(day.date) ?? new Set<string>();
        setForDate.add(previousNightStaff);
        forcedOff.set(day.date, setForDate);
      }
    }
  }

  const isCandidateForAfternoon = (
    staffId: string,
    day: DaySlot,
    options?: { avoidRegularDayOff?: boolean }
  ): boolean => {
    if (shiftOnDate(assignments, day.date, staffId)) return false;
    if (forcedOff.get(day.date)?.has(staffId)) return false;
    if (
      isRestViolation(assignments, days, dayIndexByDate, day.date, staffId, "afternoon")
    ) {
      return false;
    }
    const avoidRegularDayOff = options?.avoidRegularDayOff ?? false;
    if (avoidRegularDayOff) {
      const cfg = staffById.get(staffId);
      if (cfg && day.dow === cfg.regular_day_off) return false;
    }
    return true;
  };

  // Pass 3: afternoon staffing.
  for (const day of days) {
    const target = REQUIRED_STAFFING[day.dow].afternoon;
    let current = shiftsByDate.get(day.date)?.afternoon.length ?? 0;
    while (current < target) {
      const candidateIds = sortStaffIdsByNickname(
        allStaffIds.filter((staffId) =>
          isCandidateForAfternoon(staffId, day, { avoidRegularDayOff: true })
        ),
        staffById
      );
      let chosen = candidateIds[0] ?? null;
      if (!chosen) {
        const fallback = sortStaffIdsByNickname(
          allStaffIds.filter((staffId) => isCandidateForAfternoon(staffId, day)),
          staffById
        );
        chosen = fallback[0] ?? null;
      }
      if (!chosen) {
        warnings.push(`Understaffed afternoon on ${day.date}. Required ${target}, found ${current}.`);
        break;
      }
      setShift(assignments, shiftsByDate, day.date, chosen, "afternoon", warnings);
      current = shiftsByDate.get(day.date)?.afternoon.length ?? 0;
    }
  }

  // Pass 4: Saturday morning replacement for morning_fixed day-off.
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (day.dow !== 6) continue; // Saturday only

    const currentMorning = shiftsByDate.get(day.date)?.morning.length ?? 0;
    if (currentMorning >= REQUIRED_STAFFING[6].morning) continue;

    const previousDay = i > 0 ? days[i - 1] : null;
    const fridayAfternoonWorkers = previousDay
      ? new Set(shiftsByDate.get(previousDay.date)?.afternoon ?? [])
      : new Set<string>();

    const preferredPool = sortStaffIdsByNickname(
      rotateIdsInOrder.filter((staffId) => {
        if (fridayAfternoonWorkers.has(staffId)) return false;
        if (shiftOnDate(assignments, day.date, staffId)) return false;
        if (forcedOff.get(day.date)?.has(staffId)) return false;
        return !isRestViolation(assignments, days, dayIndexByDate, day.date, staffId, "morning");
      }),
      staffById
    );

    let chosen = preferredPool[0] ?? null;

    if (!chosen) {
      const fallback = sortStaffIdsByNickname(
        allStaffIds.filter((staffId) => {
          if (fridayAfternoonWorkers.has(staffId)) return false;
          if (shiftOnDate(assignments, day.date, staffId)) return false;
          if (forcedOff.get(day.date)?.has(staffId)) return false;
          return !isRestViolation(assignments, days, dayIndexByDate, day.date, staffId, "morning");
        }),
        staffById
      );
      chosen = fallback[0] ?? null;
    }

    if (!chosen) {
      warnings.push(`Unable to assign Saturday replacement morning on ${day.date}.`);
      continue;
    }

    setShift(assignments, shiftsByDate, day.date, chosen, "morning", warnings);
  }

  // Pass 5: balance by swapping afternoon assignment.
  const workCountByStaff = new Map<string, number>();
  const shiftCountByStaff = new Map<
    string,
    { morning: number; afternoon: number; night: number; work: number }
  >();

  for (const staffId of allStaffIds) {
    workCountByStaff.set(staffId, 0);
    shiftCountByStaff.set(staffId, { morning: 0, afternoon: 0, night: 0, work: 0 });
  }

  for (const day of days) {
    const dateMap = assignments.get(day.date);
    if (!dateMap) continue;
    for (const [staffId, shift] of dateMap.entries()) {
      workCountByStaff.set(staffId, (workCountByStaff.get(staffId) ?? 0) + 1);
      const summary = shiftCountByStaff.get(staffId) ?? { morning: 0, afternoon: 0, night: 0, work: 0 };
      summary[shift] += 1;
      summary.work += 1;
      shiftCountByStaff.set(staffId, summary);
    }
  }

  const workDelta = new Map<string, number>();
  for (const staffId of allStaffIds) {
    const cfg = staffById.get(staffId);
    if (!cfg) continue;
    const regularOffDays = countWeekdayInMonth(days, cfg.regular_day_off);
    const expectedOff = Math.max(0, regularOffDays + Math.max(0, cfg.extra_day_offs_per_month));
    const expectedWork = Math.max(0, days.length - expectedOff);
    const actualWork = workCountByStaff.get(staffId) ?? 0;
    workDelta.set(staffId, actualWork - expectedWork);
  }

  const underworked = sortStaffIdsByNickname(
    allStaffIds.filter((staffId) => (workDelta.get(staffId) ?? 0) < 0),
    staffById
  );

  for (const receiverId of underworked) {
    let receiverDelta = workDelta.get(receiverId) ?? 0;
    while (receiverDelta < 0) {
      let swapped = false;

      for (const day of days) {
        if (!isCandidateForAfternoon(receiverId, day)) continue;

        const donors = sortStaffIdsByNickname(
          (shiftsByDate.get(day.date)?.afternoon ?? []).filter((donorId) => (workDelta.get(donorId) ?? 0) > 0),
          staffById
        );
        if (donors.length === 0) continue;

        const donorId = donors[0];
        const removed = removeShift(assignments, shiftsByDate, day.date, donorId, "afternoon");
        if (!removed) continue;
        const inserted = setShift(assignments, shiftsByDate, day.date, receiverId, "afternoon", warnings);
        if (!inserted) {
          setShift(assignments, shiftsByDate, day.date, donorId, "afternoon", warnings);
          continue;
        }

        workDelta.set(donorId, (workDelta.get(donorId) ?? 0) - 1);
        workDelta.set(receiverId, (workDelta.get(receiverId) ?? 0) + 1);
        receiverDelta = workDelta.get(receiverId) ?? 0;
        swapped = true;
        break;
      }

      if (!swapped) break;
    }
  }

  for (const staffId of allStaffIds) {
    const delta = workDelta.get(staffId) ?? 0;
    if (delta > 0) {
      warnings.push(
        `Balance: ${staffById.get(staffId)?.nickname || staffId} is over target work days by ${delta}.`
      );
    }
    if (delta < 0) {
      warnings.push(
        `Balance: ${staffById.get(staffId)?.nickname || staffId} is under target work days by ${Math.abs(delta)}.`
      );
    }
  }

  const shifts: GeneratedShiftEntry[] = [];
  const summary: RosterGenerateResult["summary"] = {};

  for (const staffId of allStaffIds) {
    summary[staffId] = { work: 0, off: 0, morning: 0, afternoon: 0, night: 0 };
  }

  for (const day of days) {
    const dateMap = assignments.get(day.date);
    if (!dateMap) continue;
    for (const [staffId, shift] of dateMap.entries()) {
      shifts.push({
        staff_id: staffId,
        shift_date: day.date,
        shift_type: shift,
      });
      const bucket = summary[staffId];
      if (!bucket) continue;
      bucket.work += 1;
      bucket[shift] += 1;
    }
  }

  for (const staffId of allStaffIds) {
    const bucket = summary[staffId];
    bucket.off = days.length - bucket.work;
  }

  shifts.sort((a, b) => {
    const byDate = a.shift_date.localeCompare(b.shift_date);
    if (byDate !== 0) return byDate;
    if (a.shift_type !== b.shift_type) {
      const rank: Record<ShiftKind, number> = { morning: 1, afternoon: 2, night: 3 };
      return rank[a.shift_type] - rank[b.shift_type];
    }
    const aName = staffById.get(a.staff_id)?.nickname ?? "";
    const bName = staffById.get(b.staff_id)?.nickname ?? "";
    const byName = aName.localeCompare(bName, "th");
    if (byName !== 0) return byName;
    return a.staff_id.localeCompare(b.staff_id);
  });

  return { shifts, summary, warnings };
}

