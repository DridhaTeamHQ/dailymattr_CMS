"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * A list's page number, kept in the query string.
 *
 * Holding it in the URL rather than in component state means a page of a list
 * is somewhere you can link to, bookmark, reload onto, and reach with the back
 * button — which is what an editor sending "it's the one on page 12" expects.
 *
 * Page one is written as the *absence* of the parameter, so the tidy URL is
 * the first page and only the others carry a number. Anything unparseable —
 * `?page=abc`, `?page=-3`, a hand-edited `?page=0` — reads as page one rather
 * than erroring; the pager clamps the upper end against the real total.
 *
 * `key` names the parameter, so a screen with two independent lists (the QA
 * queue and its approved shelf) can page them separately.
 */
export function usePageParam(key = "page"): [number, (page: number) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const raw = Number(params.get(key));
  const page = Number.isInteger(raw) && raw > 0 ? raw : 1;

  const setPage = useCallback(
    (next: number) => {
      const target = next <= 1 ? null : String(next);
      // Callers reset to page one freely — on a tab switch, and on every
      // keystroke in a search box. Without this, each of those would push an
      // identical URL and bury the back button under duplicate entries.
      if (params.get(key) === target) return;

      const q = new URLSearchParams(params.toString());
      if (target === null) q.delete(key);
      else q.set(key, target);

      const query = q.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [key, params, pathname, router]
  );

  return [page, setPage];
}
