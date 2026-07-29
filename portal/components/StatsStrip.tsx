"use client";

import { Bookmark, Eye, Heart, MessageCircle, Share2, ThumbsDown } from "lucide-react";
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

/* No row means nothing has happened yet, which is a real answer and reads
   better as zeros than as an absence. A story published a minute ago has no
   numbers; so does one nobody opened, and the difference is the timestamp.
   The view is built from the engagement tables rather than from the content,
   so untouched items have no row at all — this is the common case, not an
   error case. */
export const EMPTY_STATS: ContentStats = {
  source: "cms",
  contentId: "",
  likes: 0,
  dislikes: 0,
  saves: 0,
  shares: 0,
  views: 0,
  commentOpens: 0,
  comments: 0,
  sourceOpens: 0,
  lastAt: null,
};

export function StatsStrip({
  stats,
  className = "",
}: {
  stats: ContentStats | undefined;
  className?: string;
}) {
  const s = stats ?? EMPTY_STATS;

  /* The speech bubble counts comments written, not the panel being opened.
     It used to be the latter, and a story someone had commented on read as
     zero — which is worse than showing nothing, because it looked like an
     answer. Opens are still collected and shown on the detail page, where
     there is room to say which is which. */
  const items: [typeof Eye, number, string][] = [
    [Eye, s.views, "Opened"],
    [Heart, s.likes, "Liked"],
    [ThumbsDown, s.dislikes, "Disliked"],
    [MessageCircle, s.comments, "Comments written"],
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
          aria-label={`${label}: ${n}`}
          className={`flex items-center gap-1 text-[11px] font-semibold tabular-nums ${
            n > 0 ? "text-ink" : "text-faint"
          }`}
        >
          <Icon size={11} aria-hidden />
          {fmt(n)}
        </span>
      ))}
    </div>
  );
}
