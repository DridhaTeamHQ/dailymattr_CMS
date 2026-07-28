/** Shared paging maths for the content lists and the QA queue. */

export const PAGE_SIZES = {
  /** Pix grid — five across at the widest breakpoint, so pages of ten. */
  pixGrid: 10,
  /** NewsStudio grid — four across at the widest, so pages of twelve. */
  newsGrid: 12,
  /** Article rows — the app feed and Studio drafts are both single columns. */
  articleRows: 8,
  /** Review queue rows are tall; fewer per page keeps the actions in reach. */
  reviewRows: 5,
} as const;

export const pageCount = (total: number, size: number) =>
  Math.max(1, Math.ceil(total / size));

/** Clamps a page number into range — lists shrink as items get approved. */
export const clampPage = (page: number, total: number, size: number) =>
  Math.min(Math.max(1, page), pageCount(total, size));

export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice((p - 1) * size, p * size);
}

/** 1-indexed range shown, for the "6–10 of 14" label. */
export function pageRange(page: number, size: number, total: number) {
  if (total === 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  return { from: (p - 1) * size + 1, to: Math.min(p * size, total) };
}

/**
 * The page numbers to render: first, last, the current page and its neighbours,
 * with gaps standing in for the rest.
 */
export function pageWindow(
  page: number,
  count: number,
  span = 1
): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - span);
  const end = Math.min(count - 1, page + span);

  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < count - 1) out.push("gap");
  out.push(count);

  return out;
}
