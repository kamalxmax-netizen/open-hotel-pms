import useSWR from "@/hooks/use-simple-swr";
import type {
    LaundryBatch,
    LaundryBatchEvent,
    LaundryBatchItem,
    LaundryRewashEvent,
    LaundryReturnSourceItem,
    LaundryVendorToken,
    LinenEditAuditLog,
    LinenExpectedResult,
} from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

type LinenBatchDetail = {
  batch: LaundryBatch;
  items: LaundryBatchItem[];
  rewash_events?: LaundryRewashEvent[];
  resolved_rewash_events?: LaundryRewashEvent[];
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

export function useLinenBatches(filters?: any) {
    const query = filters
        ? new URLSearchParams(
            Object.entries(filters)
                .filter(([_, v]) => v !== undefined && v !== null && v !== "" && (typeof v !== "boolean" || v))
                .reduce((acc, [k, v]) => ({ ...acc, [k]: String(v) }), {})
        ).toString()
        : "";
    const { data, error, mutate, isValidating } = useSWR<LaundryBatch[]>(
        query ? `/api/linen/batches?${query}` : "/api/linen/batches", 
        apiDataFetcher
    );
    
    return {
        batches: data || [],
        isLoading: !error && !data,
        isError: error,
        mutate,
        isValidating,
    };
}

export function useLinenAuditLogs(batchId?: string | null) {
    const { data, error, mutate, isValidating } = useSWR<LinenEditAuditLog[]>(
        batchId ? `/api/linen/batches/${batchId}/audit` : null,
        apiDataFetcher
    );
    
    return {
        logs: data || [],
        isLoading: !error && !data,
        isError: error,
        mutate,
        isValidating,
    };
}
