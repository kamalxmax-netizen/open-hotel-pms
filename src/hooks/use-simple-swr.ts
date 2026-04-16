"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Fetcher<T> = (key: string) => Promise<T>;

export default function useSWR<T>(key: string | null, fetcher: Fetcher<T>) {
  const fetcherRef = useRef(fetcher);
  const requestIdRef = useRef(0);
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(async () => {
    if (!key) {
      setData(undefined);
      setError(undefined);
      setIsValidating(false);
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsValidating(true);
    setError(undefined);

    try {
      const nextData = await fetcherRef.current(key);
      if (requestIdRef.current === requestId) {
        setData(nextData);
      }
      return nextData;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err));
      if (requestIdRef.current === requestId) {
        setError(nextError);
      }
      return undefined;
    } finally {
      if (requestIdRef.current === requestId) {
        setIsValidating(false);
      }
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    error,
    mutate: load,
    isValidating,
    isLoading: Boolean(key && !data && !error),
  };
}
