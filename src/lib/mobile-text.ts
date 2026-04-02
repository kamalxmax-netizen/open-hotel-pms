import { listNights } from "@/lib/dates";

type SummaryReservation = {
  name: string;
  roomTypeThai: string;
  checkinDate: string;
  checkoutDate: string;
  nights: number;
  price: number;
  dailyPrices: number[];
};

type AvailabilityDisplayConfig = {
  key: string;
  name: string;
  aliases: string[];
  linkLabel: string;
};

export const MOBILE_TEXT_ROOM_DISPLAY: AvailabilityDisplayConfig[] = [
  {
    key: "double_standard",
    name: "ห้องธรรมดา เตียงเดี่ยว",
    aliases: ["double standard", "ห้องธรรมดาเตียงเดี่ยว"],
    linkLabel: "ห้องธรรมดา",
  },
  {
    key: "twin_standard",
    name: "ห้องธรรมดา เตียงคู่",
    aliases: ["twin standard", "ห้องธรรมดาเตียงคู่"],
    linkLabel: "ห้องธรรมดา",
  },
  {
    key: "deluxe_queen",
    name: "ห้องดีลักซ์ เตียงเดี่ยว",
    aliases: ["deluxe queen", "ห้องดีลักซ์เตียงเดี่ยว"],
    linkLabel: "ห้องดีลักซ์",
  },
  {
    key: "deluxe_twin",
    name: "ห้องดีลักซ์ เตียงคู่",
    aliases: ["deluxe twin", "ห้องดีลักซ์เตียงคู่"],
    linkLabel: "ห้องดีลักซ์",
  },
  {
    key: "triple_beds",
    name: "ห้องสามเตียง",
    aliases: ["triple beds", "ห้องสามเตียง"],
    linkLabel: "ห้องสามเตียง",
  },
  {
    key: "junior_suite",
    name: "ห้องใหญ่ เตียงคิง",
    aliases: ["junior suite", "ห้องใหญ่เตียงคิง"],
    linkLabel: "ห้องใหญ่ เตียงคิง",
  },
  {
    key: "family_room",
    name: "ห้องแฟมิลี่ (พักได้ 3 ท่าน ค่ะ)",
    aliases: ["family room", "ห้องแฟมิลี่"],
    linkLabel: "ห้องแฟมิลี่",
  },
];

export const MOBILE_TEXT_ROOM_LINKS: Record<string, string> = {
  ห้องธรรมดา: "https://photos.app.goo.gl/mx3kJMCvRWt8x33d7",
  ห้องดีลักซ์: "https://photos.app.goo.gl/c94VaCBth1dPvTScA",
  ห้องสามเตียง: "https://photos.app.goo.gl/QV2Y4mifSCfhHKFf8",
  "ห้องใหญ่ เตียงคิง": "https://photos.app.goo.gl/5Skn5eH3AzvXQQh78",
  ห้องแฟมิลี่: "https://photos.app.goo.gl/ReiwqRvkmPpVJRmx5",
};

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function parseYmd(value: string): Date {
  return new Date(`${value}T12:00:00+07:00`);
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatThaiDayMonth(value: string): string {
  const date = parseYmd(value);
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]}`;
}

export function normalizeAlphaNumUpper(value: string): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export function formatPriceBreakdown(dailyPrices: number[]): string {
  if (!dailyPrices || dailyPrices.length === 0) return "";
  const normalized = dailyPrices.map((price) => Number(price || 0));
  const firstPrice = normalized[0] ?? 0;
  if (normalized.every((price) => price === firstPrice)) {
    return `ราคาคืนละ ${formatMoney(firstPrice)}`;
  }

  const counts = new Map<number, number>();
  for (const price of normalized) {
    counts.set(price, (counts.get(price) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([price, count]) => `ราคาคืนละ ${formatMoney(price)} ${count} คืน`)
    .join(", ");
}

export function formatBookingSummaryText(summaries: SummaryReservation[]): string {
  if (summaries.length === 0) return "";

  const totalPrice = summaries.reduce((sum, item) => sum + Number(item.price || 0), 0);
  let text = "สรุปการจองของคุณลูกค้านะคะ\n";

  if (summaries.length === 1) {
    const item = summaries[0];
    text += `คุณ${item.name}\n`;
    text += `- จอง${item.roomTypeThai}\n`;
    text += `- เข้าพักวันที่ ${formatThaiDayMonth(item.checkinDate)} - วันออก: ${formatThaiDayMonth(item.checkoutDate)}\n`;
    text += `- รวมจำนวน ${item.nights} คืน ${formatPriceBreakdown(item.dailyPrices)}\n`;
    text += `ราคารวม ${formatMoney(item.price)} บาท ค่ะ`;
    return text;
  }

  text += `คุณ${summaries[0].name}\n`;
  summaries.forEach((item, index) => {
    text += `\nห้องที่ ${index + 1}:\n`;
    text += `- จอง${item.roomTypeThai}\n`;
    text += `- เข้าพักวันที่ ${formatThaiDayMonth(item.checkinDate)} - วันออก: ${formatThaiDayMonth(item.checkoutDate)}\n`;
    text += `- รวมจำนวน ${item.nights} คืน ${formatPriceBreakdown(item.dailyPrices)}\n`;
    text += `- ราคา ${formatMoney(item.price)} บาท\n`;
  });
  text += `\nราคารวมทั้งหมด ${formatMoney(totalPrice)} บาท ค่ะ`;
  return text;
}

export function resolveRoomDisplayConfig(nameEn?: string | null, nameTh?: string | null): AvailabilityDisplayConfig | null {
  const candidates = [String(nameEn ?? ""), String(nameTh ?? "")]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  for (const config of MOBILE_TEXT_ROOM_DISPLAY) {
    if (config.aliases.some((alias) => candidates.some((item) => item.includes(alias)))) {
      return config;
    }
  }

  return null;
}

export function resolveRoomTypeThaiLabel(nameEn?: string | null, nameTh?: string | null): string {
  const thai = String(nameTh ?? "").trim();
  if (thai) return thai.replace(/\s+/g, "");

  const display = resolveRoomDisplayConfig(nameEn, nameTh);
  if (display) {
    return display.name.replace(/\s+/g, "");
  }

  return String(nameEn ?? "ไม่ทราบประเภท").trim() || "ไม่ทราบประเภท";
}

type AvailabilityDayData = Record<
  string,
  {
    price: number;
    available: boolean;
  }
>;

function samePricesOnly(left: AvailabilityDayData, right: AvailabilityDayData): boolean {
  const keys = Object.keys(left);
  for (const key of keys) {
    if ((left[key]?.price ?? 0) !== (right[key]?.price ?? 0)) return false;
  }
  return true;
}

function computeCombinedAvailability(daysData: AvailabilityDayData[]) {
  const combined: Record<string, { price: number; status: "available" | "full" | "partial" }> = {};
  Object.keys(daysData[0] ?? {}).forEach((key) => {
    let availableCount = 0;
    for (const day of daysData) {
      if (day[key]?.available) availableCount += 1;
    }
    combined[key] = {
      price: Number(daysData[0]?.[key]?.price ?? 0),
      status:
        availableCount === daysData.length
          ? "available"
          : availableCount === 0
            ? "full"
            : "partial",
    };
  });
  return combined;
}

export function groupAvailabilityDaysByPriceOnly(pricesByDay: Record<string, AvailabilityDayData>) {
  const days = Object.keys(pricesByDay).sort();
  if (days.length === 0) return [];

  const chunks: Array<{
    startDate: string;
    endDate: string;
    daysData: AvailabilityDayData[];
    combinedPrices: Record<string, { price: number; status: "available" | "full" | "partial" }>;
  }> = [];

  let current = {
    startDate: days[0],
    endDate: days[0],
    daysData: [pricesByDay[days[0]]],
    combinedPrices: computeCombinedAvailability([pricesByDay[days[0]]]),
  };

  for (let index = 1; index < days.length; index += 1) {
    const currentDay = days[index];
    if (samePricesOnly(current.daysData[0], pricesByDay[currentDay])) {
      current.endDate = currentDay;
      current.daysData.push(pricesByDay[currentDay]);
      current.combinedPrices = computeCombinedAvailability(current.daysData);
    } else {
      chunks.push(current);
      current = {
        startDate: currentDay,
        endDate: currentDay,
        daysData: [pricesByDay[currentDay]],
        combinedPrices: computeCombinedAvailability([pricesByDay[currentDay]]),
      };
    }
  }

  chunks.push(current);
  return chunks;
}

export function formatAvailabilityText(pricesByDay: Record<string, AvailabilityDayData>): string {
  const chunks = groupAvailabilityDaysByPriceOnly(pricesByDay);
  let text = "";

  chunks.forEach((chunk, index) => {
    const dateText =
      chunk.startDate === chunk.endDate
        ? formatThaiDayMonth(chunk.startDate)
        : `${formatThaiDayMonth(chunk.startDate)} - ${formatThaiDayMonth(chunk.endDate)}`;
    text += `ราคาห้องเข้าพักวันที่ ${dateText} ค่ะ\n`;

    MOBILE_TEXT_ROOM_DISPLAY.forEach((room, roomIndex) => {
      const row = chunk.combinedPrices[room.key];
      if (!row) return;
      if (row.status === "available") {
        text += `${roomIndex + 1}. ${room.name} ราคา ${formatMoney(row.price)}/คืน\n`;
      } else if (row.status === "partial") {
        text += `${roomIndex + 1}. ${room.name} มีว่างแต่ไม่ครบทุกวัน ค่ะ\n`;
      } else {
        text += `${roomIndex + 1}. ${room.name} เต็มค่ะ\n`;
      }
    });

    if (index < chunks.length - 1) text += "\n";
  });

  text += "\nห้องธรรมดาจะเป็นห้องที่ยังไม่ได้ปรับปรุงค่ะ ส่วนที่เหลือปรับปรุงใหม่หมดแล้วค่ะ\n";
  text += "ดูรูปห้องพักได้ที่นี่ค่ะ\n";
  Object.entries(MOBILE_TEXT_ROOM_LINKS).forEach(([label, link]) => {
    text += `- ${label}: ${link}\n`;
  });

  return text.trim();
}

export function buildDailyPriceMap(
  roomTypeKey: string,
  checkin: string,
  checkout: string,
  dailyRows: Array<{ stay_date: string; price: number; available: boolean }>
): Record<string, AvailabilityDayData> {
  const nights = listNights(checkin, checkout);
  const result: Record<string, AvailabilityDayData> = {};
  for (const stayDate of nights) {
    if (!result[stayDate]) result[stayDate] = {};
    const row = dailyRows.find((item) => item.stay_date === stayDate);
    result[stayDate][roomTypeKey] = {
      price: Number(row?.price ?? 0),
      available: Boolean(row?.available),
    };
  }
  return result;
}
