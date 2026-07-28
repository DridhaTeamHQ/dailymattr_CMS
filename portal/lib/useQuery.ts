"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Data loader for the pages. Returns null while loading — the signal the pages
 * branch on — plus an error to surface and a refetch to call after a write:
 *
 *   const { data, error, refetch } = useQuery(async () => ({
 *     content: await listContent(),
 *   }));
 */
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, loading, refetch };
}
