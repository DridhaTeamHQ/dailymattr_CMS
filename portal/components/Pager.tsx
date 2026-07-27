"use client";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { pageCount, pageRange, pageWindow } from "@/lib/paginate";

/**
 * Client-side pager for the content lists. Renders nothing when everything fits
 * on one page, so short lists stay uncluttered.
 */
export function Pager({
  page,
  total,
  size,
  onPage,
  label = "items",
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  /** Plural noun for the count line, e.g. "Pix". */
  label?: string;
}) {
  const count = pageCount(total, size);
  if (count <= 1) return null;

  const { from, to } = pageRange(page, size, total);
  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    onPage(Math.min(Math.max(1, p), count));
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={go(page - 1)}
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-40" : ""}
            />
          </PaginationItem>

          {pageWindow(page, count).map((p, i) => (
            <PaginationItem key={`${p}-${i}`}>
              {p === "gap" ? (
                <PaginationEllipsis />
              ) : (
                <PaginationLink
                  href="#"
                  isActive={p === page}
                  onClick={go(p)}
                  aria-label={`Go to page ${p}`}
                >
                  {p}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={go(page + 1)}
              aria-disabled={page === count}
              className={page === count ? "pointer-events-none opacity-40" : ""}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      <p className="text-[11px] text-faint tabular-nums">
        {from}–{to} of {total} {label}
      </p>
    </div>
  );
}
