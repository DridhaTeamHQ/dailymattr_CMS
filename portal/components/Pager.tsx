"use client";

import { useId, useState } from "react";
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
  const jumpId = useId();
  const [jump, setJump] = useState("");

  const count = pageCount(total, size);
  if (count <= 1) return null;

  const { from, to } = pageRange(page, size, total);
  const go = (p: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    onPage(Math.min(Math.max(1, p), count));
  };

  /** Jump box: take whatever was typed, clamp it, and clear the field. */
  const submitJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jump, 10);
    if (Number.isFinite(n)) onPage(Math.min(Math.max(1, n), count));
    setJump("");
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-2.5">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
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

      {/* Shown wherever there is a pager at all, so the control is in the same
          place on every list rather than appearing once a list gets long. */}
      <form onSubmit={submitJump} className="flex items-center gap-2">
        <label
          htmlFor={jumpId}
          className="text-[12px] font-semibold whitespace-nowrap text-muted"
        >
          Go to page
        </label>
        <input
          id={jumpId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
          onBlur={submitJump}
          placeholder={String(page)}
          aria-label={`Go to page, 1 to ${count}`}
          title={`1 to ${count}`}
          className="h-9 w-16 rounded-xl border border-line text-center text-[13px] font-bold tabular-nums outline-none focus:border-accent"
        />
      </form>
      </div>

      <p className="text-[11px] text-faint tabular-nums">
        {from}–{to} of {total} {label}
      </p>
    </div>
  );
}
