"use client";

import { Bookmark, Eye, Heart, MessageCircle, Share2, ThumbsDown } from "lucide-react";
import { EMPTY_STATS } from "@/lib/db";
import type { ContentStats } from "@/lib/types";

/* What readers did with a story.
 *
 * Shown to super admins and chief editors only. That is not squeamishness: a
 * writer watching a like count tick on their own work optimises for the count,
 * and QA's question is whether a story is correct rather than whether it did
 * well. The row-level policies name the same two roles, so this is the
 * convenience and the database is the boundary.
 *
 * Counted by device. There are no accounts in the app — a reader is a device
 * id generated on first launch — so two phones is two people and one person
 * with two phones is also two. The tooltip says so rather than letting a
 * precise-looking number imply more than it knows.
 */

export const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);


export function StatsStrip({
  stats,
  className = "",
  commentsSupported = true,
}: {
  stats: ContentStats | undefined;
  className?: string;
  /**
   * False for Pix, Qix, Trax and desk-written articles. `app_comments` is
   * keyed to the pipeline's own articles table, so those formats have no
   * thread in the app at all — a zero there would be read as "nobody said
   * anything" when the truth is there was nowhere to say it.
   */
  commentsSupported?: boolean;
}) {
  const s = stats ?? EMPTY_STATS;

  /* The speech bubble counts comments written, not the panel being opened.
     It was the latter for a while, and a story someone had commented on read
     as zero — worse than showing nothing, because it looked like an answer.
     The number now comes from `app_comments` itself, so it includes everything
     said before any of this was instrumented. Opens are still collected and
     shown on the detail page, where there is room to say which is which.

     `null` means the format has no thread at all, which is a different fact
     from nobody having spoken. */
  const items: [typeof Eye, number | null, string][] = [
    [Eye, s.views, "Opened"],
    [Heart, s.likes, "Liked"],
    [ThumbsDown, s.dislikes, "Disliked"],
    [MessageCircle, commentsSupported ? s.comments : null, "Comments written"],
    [Bookmark, s.saves, "Saved"],
    [Share2, s.shares, "Shared"],
  ];

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}
      title="Counted by device — the app has no accounts, so this counts phones rather than people."
    >
      {items.map(([Icon, n, label]) => (
        <span
          key={label}
          aria-label={n === null ? `${label}: not available` : `${label}: ${n}`}
          title={
            n === null ? "This format has no comment thread in the app." : label
          }
          className={`flex items-center gap-1 text-[11px] font-semibold tabular-nums ${
            n && n > 0 ? "text-ink" : "text-faint"
          }`}
        >
          <Icon size={11} aria-hidden />
          {n === null ? "—" : fmt(n)}
        </span>
      ))}
    </div>
  );
}
