"use client";

import { useEffect, useState } from "react";

/**
 * Client-only store subscription: returns null on the server / first paint,
 * then the selected value; re-runs the selector whenever the mock store
 * changes (any tab) or `deps` change.
 */
export function useStore<T>(selector: () => T, deps: unknown[] = []): T | null {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    const run = () => setValue(selector());
    run();
    window.addEventListener("cms-store-change", run);
    window.addEventListener("storage", run);
    return () => {
      window.removeEventListener("cms-store-change", run);
      window.removeEventListener("storage", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
