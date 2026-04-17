"use client";

import useSWR from "@/hooks/use-simple-swr";
import type { LinenItemRate } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

const ENABLE_REAL_API = true;

/**
 * Hook to fetch current rates for a month
 */
export function useLinenRates(month: string) { // month format: YYYY-MM-01
  const url = `/api/linen/rates?month=${month}`;
  const { data, error, mutate, isValidating, isLoading } = useSWR<LinenItemRate[]>(
    ENABLE_REAL_API ? url : null, 
    apiDataFetcher
  );

  const mockData: LinenItemRate[] | undefined = !ENABLE_REAL_API ? generateMockRates(month) : undefined;

  return {
    data: ENABLE_REAL_API ? data : mockData,
    isLoading: ENABLE_REAL_API ? isLoading : false,
    isError: error,
    mutate,
    isValidating
  };
}

/**
 * Hook to fetch rate history for a specific item
 */
export function useLinenRateHistory(itemId: number) {
  const url = `/api/linen/rates/${itemId}/history`;
  const { data, error, mutate, isValidating, isLoading } = useSWR<LinenItemRate[]>(
    ENABLE_REAL_API ? url : null, 
    apiDataFetcher
  );

  const mockData: LinenItemRate[] | undefined = !ENABLE_REAL_API ? [
    {
      id: "h1",
      linen_item_id: itemId,
      effective_month: "2026-04-01",
      rate_per_piece: 3.5,
      note: "Vendor price increase",
      created_at: new Date().toISOString(),
      created_by: null
    },
    {
      id: "h2",
      linen_item_id: itemId,
      effective_month: "2026-01-01",
      rate_per_piece: 3.0,
      note: "Initial rate",
      created_at: "2026-01-01T00:00:00Z",
      created_by: null
    }
  ] : undefined;

  return {
    data: ENABLE_REAL_API ? data : mockData,
    isLoading: ENABLE_REAL_API ? isLoading : false,
    isError: error,
    mutate,
    isValidating
  };
}

// --- Mock Generators ---

function generateMockRates(month: string): LinenItemRate[] {
  const items = [
    { id: 1, num: 1, th: "ปลอกหมอน", rate: 3 },
    { id: 2, num: 2, th: "ผ้าขนหนู", rate: 5 },
    { id: 3, num: 3, th: "ผ้าเช็ดเท้า", rate: 3 },
    { id: 4, num: 4, th: "ผ้าปูเล็ก", rate: 8 },
    { id: 5, num: 5, th: "ผ้าปูกลาง", rate: 9 },
    { id: 6, num: 6, th: "ผ้าปูใหญ่", rate: 9 },
    { id: 7, num: 7, th: "ปลอกผ้านวมเล็ก", rate: 15 },
    { id: 8, num: 8, th: "ปลอกผ้านวมกลาง", rate: 20 },
    { id: 9, num: 9, th: "ปลอกผ้านวมใหญ่", rate: 20 },
    { id: 10, num: 10, th: "รองกันเปื้อนเล็ก", rate: 30 },
    { id: 11, num: 11, th: "รองกันเปื้อนกลาง", rate: 30 },
    { id: 12, num: 12, th: "รองกันเปื้อนใหญ่", rate: 30 },
    { id: 13, num: 13, th: "ไส้นวมเล็ก", rate: 30 },
    { id: 14, num: 14, th: "ไส้นวมกลาง", rate: 40 },
    { id: 15, num: 15, th: "ไส้นวมใหญ่", rate: 40 },
    { id: 16, num: 16, th: "หมอน", rate: 50 },
  ];

  return items.map(item => ({
    id: `r-${item.id}`,
    linen_item_id: item.id,
    effective_month: month,
    rate_per_piece: item.rate,
    note: "Initial seed",
    created_at: new Date().toISOString(),
    created_by: null,
    item_number: item.num,
    name_th: item.th
  }));
}
