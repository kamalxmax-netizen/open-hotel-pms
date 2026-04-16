import useSWR from "@/hooks/use-simple-swr";
import type { LinenDashboard } from "@/lib/types";
import { apiDataFetcher } from "@/lib/client/api-fetcher";

export function useLinenDashboard() {
  const { data, error, mutate, isValidating } = useSWR<LinenDashboard>("/api/linen/dashboard", apiDataFetcher);

  return {
    dashboard: data,
    isLoading: !error && !data,
    isError: error,
    mutate,
    isValidating,
  };
}
