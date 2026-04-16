import useSWR from "@/hooks/use-simple-swr";
import type { LaundryBatch, LaundryBatchEvent, LaundryBatchItem, LaundryReturnSourceItem, LaundryVendorToken, LinenExpectedResult } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

type LinenBatchDetail = {
  batch: LaundryBatch;
  items: LaundryBatchItem[];
  events?: LaundryBatchEvent[];
  tokens?: LaundryVendorToken[];
  return_sources?: LaundryReturnSourceItem[];
};

export function useLinenBatchDetail(id?: string | null) {
  const { data, error, mutate, isValidating } = useSWR<LinenBatchDetail>(
    id ? `/api/linen/batches/${id}` : null,
    apiDataFetcher
  );

  return {
    data,
    isLoading: !error && !data,
    isError: error,
    mutate,
    isValidating,
  };
}

export function useLinenExpected() {
   const { data, error, mutate, isValidating } = useSWR<LinenExpectedResult>("/api/linen/expected", apiDataFetcher);
   
   return {
     expected: data,
     isLoading: !error && !data,
     isError: error,
     mutate,
     isValidating,
   };
}

export function useLinenBatches() {
    const { data, error, mutate, isValidating } = useSWR<LaundryBatch[]>("/api/linen/batches", apiDataFetcher);
    
    return {
        batches: data || [],
        isLoading: !error && !data,
        isError: error,
        mutate,
        isValidating,
    };
}
