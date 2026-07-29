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

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

export function StatsStrip({
  stats,
  className = "",
}: {
  stats: ContentStats | undefined;
  className?: string;
}) {
  /* No row means nothing has happened yet, which is a real answer and reads
     better as zeros than as an absence. A story published a minute ago has no
     numbers; so does one nobody opened, and the difference is the timestamp. */
  const s = stats ?? {
    contentId: "",
    likes: 0,
    dislikes: 0,
    saves: 0,
    shares: 0,
    views: 0,
    commentOpens: 0,
    lastAt: null,
  };

  const items: [typeof Eye, number, string][] = [
    [Eye, s.views, "Opened"],
    [Heart, s.likes, "Liked"],
    [ThumbsDown, s.dislikes, "Disliked"],
    [MessageCircle, s.commentOpens, "Comments opened"],
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
