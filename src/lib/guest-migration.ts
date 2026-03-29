import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getUserRole } from "@/lib/server-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const NAME_PREFIXES = ["คุณ", "Mr.", "Mrs.", "Ms.", "Mr ", "Mrs ", "Ms "];

const EXACT_NOTE_STRIP_SET = new Set([
  "walk-in",
  "walk-in โทร",
  "walk-in โทร.",
  "โทร",
  "ทำห้อง",
  "ไม่ทำห้อง",
  "ไม่ทำ",
  "welcome back",
  "ไม่สลับห้อง",
  "ห้ามย้าย",
  "แล้วค่ะ",
  "tel",
  "/",
  ".",
  "**",
  "()",
]);

const PREFIX_NOTE_STRIP_SET = [
  "พักร่วม",
  "ย้ายมาจาก",
  "ย้ายจาก",
  "พรุ่งนี้ย้าย",
  "เสียบปลั๊ก",
];

export type ParsedMigrationGuest = {
  id: string;
  name_key: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  line_id: string | null;
  stay_count: number;
  legacy_night_count: number;
  last_stay_date: string | null;
  preferences: string | null;
  vip_tier: "regular" | "loyal";
  profile_status: "draft";
};

export type ParsedMigrationStay = {
  guest_profile_id: string;
  name_key: string;
  date_in: string;
  date_out: string;
  nights: number;
  room_number: string | null;
  source_file: string | null;
  notes: string | null;
};

export type ParsedMigrationWorkbook = {
  guests: ParsedMigrationGuest[];
  stays: ParsedMigrationStay[];
  preview: {
    total_guests: number;
    with_phone: number;
    without_phone: number;
    returning_guests: number;
    total_stays: number;
    stays_with_notes: number;
    sample_guests: Array<{
      first_name: string;
      last_name: string;
      phone: string | null;
      stay_count: number;
      legacy_night_count: number;
      last_stay_date: string | null;
      preferences: string | null;
      vip_tier: "regular" | "loyal";
      stays: Array<{
        date_in: string;
        date_out: string;
        nights: number;
        room: string | null;
      }>;
    }>;
    unmatched_stays: number;
    unmatched_stay_names: string[];
  };
};

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-./()]/g, "");
}

function readRowValue(row: Record<string, unknown>, candidates: string[]): unknown {
  const normalizedMap = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalizedMap.set(normalizeHeader(key), value);
  }
  for (const candidate of candidates) {
    const hit = normalizedMap.get(normalizeHeader(candidate));
    if (hit !== undefined && hit !== null && String(hit).trim() !== "") {
      return hit;
    }
  }
  return null;
}

function toNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = normalizeSpaces(String(value));
  return text.length > 0 ? text : null;
}

function toInteger(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toDateIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const yyyy = String(parsed.y).padStart(4, "0");
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const text = normalizeSpaces(String(value));
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const dd = String(Number(slash[1])).padStart(2, "0");
    const mm = String(Number(slash[2])).padStart(2, "0");
    const yyyy = slash[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function normalizePhone(value: unknown): string | null {
  const raw = toNullableText(value);
  if (!raw) return null;
  const normalized = raw.replace(/[^\d]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function stripNamePrefix(fullName: string): string {
  let normalized = normalizeSpaces(fullName);
  for (const prefix of NAME_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalizeSpaces(normalized.slice(prefix.length));
      break;
    }
  }
  return normalized;
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const cleaned = stripNamePrefix(fullName);
  const [first, ...rest] = cleaned.split(" ");
  return {
    first_name: first ?? "",
    last_name: rest.join(" "),
  };
}

function normalizeNameKey(value: unknown): string | null {
  const text = toNullableText(value);
  if (!text) return null;
  return normalizeSpaces(text);
}

function buildPreferences(row: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const floorPref = toNullableText(readRowValue(row, ["Floor Pref", "FloorPreference", "Floor"]));
  const smoking = toNullableText(readRowValue(row, ["Smoking"]));
  const lastRoom = toNullableText(readRowValue(row, ["Last Room", "LastRoom"]));
  const specialNotes = toNullableText(readRowValue(row, ["Special Notes", "SpecialNotes", "Notes"]));

  if (floorPref) parts.push(`ชั้นที่ชอบ: ${floorPref}`);
  if (smoking) parts.push(`สูบบุหรี่: ${smoking}`);
  if (lastRoom) parts.push(`ห้องล่าสุด: ${lastRoom}`);
  if (specialNotes) parts.push(specialNotes);

  return parts.length > 0 ? parts.join(" | ") : null;
}

function shouldStripOperationalNote(value: unknown): boolean {
  const text = toNullableText(value);
  if (!text) return true;
  const normalized = text.toLowerCase();

  if (/^\d+$/.test(normalized)) return true;
  if (EXACT_NOTE_STRIP_SET.has(normalized)) return true;
  if (PREFIX_NOTE_STRIP_SET.some((prefix) => normalized.startsWith(prefix))) return true;
  return false;
}

function normalizeNote(value: unknown): string | null {
  const text = toNullableText(value);
  if (!text) return null;
  return shouldStripOperationalNote(text) ? null : text;
}

function findSheetName(workbook: XLSX.WorkBook, keywords: string[], fallbackIndex: number): string | null {
  const byKeyword = workbook.SheetNames.find((name) =>
    keywords.some((keyword) => normalizeHeader(name).includes(normalizeHeader(keyword)))
  );
  if (byKeyword) return byKeyword;
  return workbook.SheetNames[fallbackIndex] ?? null;
}

function parseSummaryRows(summarySheet: XLSX.WorkSheet): ParsedMigrationGuest[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(summarySheet, {
    defval: null,
    raw: true,
    blankrows: false,
  });

  const guests: ParsedMigrationGuest[] = [];
  for (const row of rows) {
    const rawName = normalizeNameKey(readRowValue(row, ["Name"]));
    if (!rawName) continue;

    const split = splitName(rawName);
    const stayCount = Math.max(0, toInteger(readRowValue(row, ["Total Stays", "TotalStays"]), 0));
    const totalNights = Math.max(0, toInteger(readRowValue(row, ["Total Nights", "TotalNights"]), 0));

    guests.push({
      id: randomUUID(),
      name_key: rawName,
      first_name: split.first_name,
      last_name: split.last_name,
      phone: normalizePhone(readRowValue(row, ["Phone"])),
      line_id: toNullableText(readRowValue(row, ["Line ID", "LineID", "Line"])),
      stay_count: stayCount,
      legacy_night_count: totalNights,
      last_stay_date: toDateIso(readRowValue(row, ["Last Visit", "LastVisit"])),
      preferences: buildPreferences(row),
      vip_tier: stayCount >= 10 ? "loyal" : "regular",
      profile_status: "draft",
    });
  }

  return guests;
}

function parseHistoryRows(
  historySheet: XLSX.WorkSheet | null,
  guests: ParsedMigrationGuest[]
): { stays: ParsedMigrationStay[]; unmatchedNames: string[]; unmatchedCount: number } {
  if (!historySheet) return { stays: [], unmatchedNames: [], unmatchedCount: 0 };

  const nameToGuestIds = new Map<string, string[]>();
  for (const guest of guests) {
    const list = nameToGuestIds.get(guest.name_key) ?? [];
    list.push(guest.id);
    nameToGuestIds.set(guest.name_key, list);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(historySheet, {
    defval: null,
    raw: true,
    blankrows: false,
  });

  const stays: ParsedMigrationStay[] = [];
  const unmatchedNamesSet = new Set<string>();
  let unmatchedCount = 0;

  for (const row of rows) {
    const nameKey = normalizeNameKey(readRowValue(row, ["Name"]));
    if (!nameKey) continue;

    const guestIds = nameToGuestIds.get(nameKey) ?? [];
    const guestProfileId = guestIds[0] ?? null;

    if (!guestProfileId) {
      unmatchedCount += 1;
      unmatchedNamesSet.add(nameKey);
      continue;
    }

    const dateIn = toDateIso(readRowValue(row, ["Date In", "DateIn", "Check In", "Checkin"]));
    const dateOut = toDateIso(readRowValue(row, ["Date Out", "DateOut", "Check Out", "Checkout"]));
    if (!dateIn || !dateOut) continue;

    const parsedNights = toInteger(readRowValue(row, ["Nights"]), 0);
    const nights = parsedNights > 0 ? parsedNights : 1;

    stays.push({
      guest_profile_id: guestProfileId,
      name_key: nameKey,
      date_in: dateIn,
      date_out: dateOut,
      nights,
      room_number: toNullableText(readRowValue(row, ["Room", "Room Number", "Last Room"])),
      source_file: toNullableText(readRowValue(row, ["Source File", "Source"])),
      notes: normalizeNote(readRowValue(row, ["Notes", "Note"])),
    });
  }

  return {
    stays,
    unmatchedNames: Array.from(unmatchedNamesSet).sort((a, b) => a.localeCompare(b)).slice(0, 100),
    unmatchedCount,
  };
}

function buildPreview(guests: ParsedMigrationGuest[], stays: ParsedMigrationStay[], unmatchedNames: string[]) {
  const staysByGuest = new Map<string, ParsedMigrationStay[]>();
  for (const stay of stays) {
    const list = staysByGuest.get(stay.guest_profile_id) ?? [];
    list.push(stay);
    staysByGuest.set(stay.guest_profile_id, list);
  }

  const sampleGuests = guests.slice(0, 10).map((guest) => ({
    first_name: guest.first_name,
    last_name: guest.last_name,
    phone: guest.phone,
    stay_count: guest.stay_count,
    legacy_night_count: guest.legacy_night_count,
    last_stay_date: guest.last_stay_date,
    preferences: guest.preferences,
    vip_tier: guest.vip_tier,
    stays: (staysByGuest.get(guest.id) ?? []).slice(0, 5).map((stay) => ({
      date_in: stay.date_in,
      date_out: stay.date_out,
      nights: stay.nights,
      room: stay.room_number,
    })),
  }));

  return {
    total_guests: guests.length,
    with_phone: guests.filter((guest) => !!guest.phone).length,
    without_phone: guests.filter((guest) => !guest.phone).length,
    returning_guests: guests.filter((guest) => guest.stay_count >= 2).length,
    total_stays: stays.length,
    stays_with_notes: stays.filter((stay) => !!stay.notes).length,
    sample_guests: sampleGuests,
    unmatched_stays: unmatchedNames.length,
    unmatched_stay_names: unmatchedNames,
  };
}

export async function parseMigrationWorkbook(file: File): Promise<ParsedMigrationWorkbook> {
  if (!(file instanceof File)) {
    throw new Error("Missing upload file.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File too large. Maximum size is 20MB.");
  }

  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
    throw new Error("Invalid file type. Please upload an Excel file (.xlsx or .xls).");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (!workbook.SheetNames.length) {
    throw new Error("Excel file has no sheets.");
  }

  const summarySheetName = findSheetName(workbook, ["summary"], 0);
  const historySheetName = findSheetName(workbook, ["history", "logs"], 1);
  const summarySheet = summarySheetName ? workbook.Sheets[summarySheetName] : null;
  const historySheet = historySheetName ? workbook.Sheets[historySheetName] : null;

  if (!summarySheet) {
    throw new Error("Summary sheet not found.");
  }

  const guests = parseSummaryRows(summarySheet);
  const { stays, unmatchedNames, unmatchedCount } = parseHistoryRows(historySheet ?? null, guests);

  return {
    guests,
    stays,
    preview: {
      ...buildPreview(guests, stays, unmatchedNames),
      unmatched_stays: unmatchedCount,
    },
  };
}

export function parseDryRunFlag(value: FormDataEntryValue | null): boolean {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function requireAdminRouteAccess(request: NextRequest): Promise<
  | {
      ok: true;
      supabase: ReturnType<typeof createServerSupabaseClient>;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    }
> {
  const supabase = createServerSupabaseClient();
  const user = await getAuthenticatedUser(supabase, request);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 }),
    };
  }
  const role = await getUserRole(supabase, user.id);
  if (role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Forbidden." }, { status: 403 }),
    };
  }
  return { ok: true, supabase, userId: user.id };
}

export function chunkArray<T>(items: T[], size: number): T[][];
export function chunkArray<T>(items: T[], size: number): Array<T[]> {
  const chunks: Array<T[]> = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
