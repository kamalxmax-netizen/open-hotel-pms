"use client";

import useSWR from "@/hooks/use-simple-swr";
import type { 
  LinenMonthlySummary, 
  LinenMonthlyDaily, 
  LinenMonthlyVariance,
  LinenMonthlySummaryRow,
  LinenMonthlyDailyCell,
  LinenMonthlyVarianceRow,
  LinenMonthlyExtra,
  LinenMonthlyDayuseSummary
} from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

// Toggle this once Agent B has real APIs ready
const ENABLE_REAL_API = true;

/**
 * Hook to fetch monthly summary (Per-Item View)
 */
export function useLinenMonthlySummary(year: number, month: number) {
  const url = `/api/linen/monthly/summary?year=${year}&month=${month}`;
  const { data, error, mutate, isValidating, isLoading } = useSWR<LinenMonthlySummary>(
    ENABLE_REAL_API ? url : null, 
    apiDataFetcher
  );

  // Mock data if real API is disabled
  const mockData: LinenMonthlySummary | undefined = !ENABLE_REAL_API ? {
    year,
    month,
    closed: false,
    closed_at: null,
    total_pieces: 3249,
    total_baht: 18989,
    items: generateMockSummaryRows(month),
    extras: [
      { item_name: "ขนหนูเพิ่ม", linen_item_id: 2, qty: 174 },
      { item_name: "ปลอกหมอนเพิ่ม", linen_item_id: 1, qty: 67 }
    ],
    dayuse: [
      { linen_item_id: 1, item_number: 1, name_th: "ปลอกหมอน (เก่า)", qty: 20 },
      { linen_item_id: 2, item_number: 2, name_th: "ผ้าขนหนู (เก่า)", qty: 45 }
    ]
  } : undefined;

  return {
    data: ENABLE_REAL_API ? data : mockData,
    isLoading: ENABLE_REAL_API ? isLoading : false,
    isError: error,
    mutate,
    isValidating
  };
}

/**
 * Hook to fetch monthly daily grid (Per-Day Heatmap)
 */
export function useLinenMonthlyDaily(year: number, month: number) {
  const url = `/api/linen/monthly/daily?year=${year}&month=${month}`;
  const { data, error, mutate, isValidating, isLoading } = useSWR<LinenMonthlyDaily>(
    ENABLE_REAL_API ? url : null, 
    apiDataFetcher
  );

  const mockData: LinenMonthlyDaily | undefined = !ENABLE_REAL_API ? {
    year,
    month,
    days_in_month: 30, // simplified
    cells: generateMockDailyCells(year, month)
  } : undefined;

  return {
    data: ENABLE_REAL_API ? data : mockData,
    isLoading: ENABLE_REAL_API ? isLoading : false,
    isError: error,
    mutate,
    isValidating
  };
}

/**
 * Hook to fetch monthly variance (Items 1-9)
 */
export function useLinenMonthlyVariance(year: number, month: number) {
  const url = `/api/linen/monthly/variance?year=${year}&month=${month}`;
  const { data, error, mutate, isValidating, isLoading } = useSWR<LinenMonthlyVariance>(
    ENABLE_REAL_API ? url : null, 
    apiDataFetcher
  );

  const mockData: LinenMonthlyVariance | undefined = !ENABLE_REAL_API ? {
    year,
    month,
    rows: generateMockVarianceRows(),
    config: {
      id: 1,
      green_min: 90,
      green_max: 110,
      yellow_min: 70,
      yellow_max: 130,
      updated_at: new Date().toISOString(),
      updated_by: null
    }
  } : undefined;

  return {
    data: ENABLE_REAL_API ? data : mockData,
    isLoading: ENABLE_REAL_API ? isLoading : false,
    isError: error,
    mutate,
    isValidating
  };
}

// --- Mock Generators ---

function generateMockSummaryRows(month: number): LinenMonthlySummaryRow[] {
  const items = [
    { id: 1, num: 1, th: "ปลอกหมอน", en: "Pillow Case", rate: 3 },
    { id: 2, num: 2, th: "ผ้าขนหนู", en: "Towel", rate: 5 },
    { id: 3, num: 3, th: "ผ้าเช็ดเท้า", en: "Foot Towel", rate: 3 },
    { id: 4, num: 4, th: "ผ้าปูเล็ก", en: "Single Sheet", rate: 8 },
    { id: 5, num: 5, th: "ผ้าปูกลาง", en: "Double Sheet", rate: 9 },
    { id: 6, num: 6, th: "ผ้าปูใหญ่", en: "King Sheet", rate: 9 },
    { id: 7, num: 7, th: "ปลอกผ้านวมเล็ก", en: "Single Duvet Cover", rate: 15 },
    { id: 8, num: 8, th: "ปลอกผ้านวมกลาง", en: "Double Duvet Cover", rate: 20 },
    { id: 9, num: 9, th: "ปลอกผ้านวมใหญ่", en: "King Duvet Cover", rate: 20 },
    { id: 10, num: 10, th: "รองกันเปื้อนเล็ก", en: "Single Mattress Protector", rate: 30 },
    { id: 11, num: 11, th: "รองกันเปื้อนกลาง", en: "Double Mattress Protector", rate: 30 },
    { id: 12, num: 12, th: "รองกันเปื้อนใหญ่", en: "King Mattress Protector", rate: 30 },
    { id: 13, num: 13, th: "ไส้นวมเล็ก", en: "Single Comforter", rate: 30 },
    { id: 14, num: 14, th: "ไส้นวมกลาง", en: "Double Comforter", rate: 40 },
    { id: 15, num: 15, th: "ไส้นวมใหญ่", en: "King Comforter", rate: 40 },
    { id: 16, num: 16, th: "หมอน", en: "Pillow", rate: 50 },
  ];

  return items.map(item => ({
    linen_item_id: item.id,
    item_number: item.num,
    name_th: item.th,
    name_en: item.en,
    rate: item.rate,
    qty_sent: 100 + Math.floor(Math.random() * 900),
    qty_returned: 100 + Math.floor(Math.random() * 900),
    qty_pending: Math.floor(Math.random() * 10),
    qty_extra: Math.floor(Math.random() * 50),
    qty_dayuse: Math.floor(Math.random() * 20),
    total_baht: 0 // Will be calculated in UI based on Lead's comment: rate * qty_sent
  })).map(row => ({
    ...row,
    total_baht: row.rate * row.qty_sent
  }));
}

function generateMockDailyCells(year: number, month: number): LinenMonthlyDailyCell[] {
  const cells: LinenMonthlyDailyCell[] = [];
  const daysInMonth = 30; // Approx
  
  for (let itemId = 1; itemId <= 16; itemId++) {
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        linen_item_id: itemId,
        item_number: itemId,
        day_of_month: day,
        qty_sent: Math.random() > 0.3 ? Math.floor(Math.random() * 50) : 0
      });
    }
  }
  return cells;
}

function generateMockVarianceRows(): LinenMonthlyVarianceRow[] {
  const items = [
    { id: 1, num: 1, th: "ปลอกหมอน" },
    { id: 2, num: 2, th: "ผ้าขนหนู" },
    { id: 3, num: 3, th: "ผ้าเช็ดเท้า" },
    { id: 4, num: 4, th: "ผ้าปูเล็ก" },
    { id: 5, num: 5, th: "ผ้าปูกลาง" },
    { id: 6, num: 6, th: "ผ้าปูใหญ่" },
    { id: 7, num: 7, th: "ปลอกผ้านวมเล็ก" },
    { id: 8, num: 8, th: "ปลอกผ้านวมกลาง" },
    { id: 9, num: 9, th: "ปลอกผ้านวมใหญ่" },
  ];

  return items.map(item => {
    const expected = 500 + Math.floor(Math.random() * 500);
    const actual = expected + (Math.floor(Math.random() * 200) - 100);
    const pct = (actual / expected) * 100;
    
    let tier: any = "green";
    if (pct < 70 || pct > 130) tier = "red";
    else if (pct < 90 || pct > 110) tier = "yellow";

    return {
      linen_item_id: item.id,
      item_number: item.num,
      name_th: item.th,
      expected_qty: expected,
      actual_qty: actual,
      variance_pct: pct,
      tier
    };
  });
}
