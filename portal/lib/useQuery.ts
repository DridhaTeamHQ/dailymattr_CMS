"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Data loader for the pages. Returns null while loading on the first mount,
 * then keeps the previous data visible during subsequent refetches so the UI
 * never flashes blank after the initial load.
 *
 *   const { data, error, refetch } = useQuery(async () => ({
 *     content: await listContent(),
 *   }));
 *
 * Stale-while-revalidate: on refetch, `loading` turns true but `data` stays
 * at its last value, so the page keeps rendering while new data arrives.
 */
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Track whether we've had at least one successful fetch.
  const hasLoaded = useRef(false);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // On refetches, keep the previous data visible (stale-while-revalidate).
    // Only clear data on the very first load.
    if (!hasLoaded.current) {
      setData(null);
    }

    fetcher()
      .then((r) => {
        if (cancelled) return;
        hasLoaded.current = true;
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
