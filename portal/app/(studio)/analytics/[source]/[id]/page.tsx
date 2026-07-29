"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  MessagesSquare,
  Share2,
  ThumbsDown,
} from "lucide-react";
import { Pill } from "@/components/ui";
import { fmt } from "@/components/StatsStrip";
import { can, useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/useQuery";
import { timeAgo } from "@/lib/store";
import { KIND_LABEL, loadAnalytics } from "@/lib/analytics";

/* One story, in full.
 *
 * The list answers "how did this do against everything else". This answers
 * "what actually happened to it" — including the two numbers the strip has no
 * room for: how many people opened the comments without writing one, and how
 * many left for the publisher.
 *
 * Rates rather than only counts, because a count without its denominator is
 * unreadable. Twelve likes is good on a story forty people opened and poor on
 * one that reached four thousand.
 */

const pct = (n: number, of: number) =>
  of <= 0 ? "—" : `${((n / of) * 100).toFixed(n / of >= 0.1 ? 0 : 1)}%`;

export default function AnalyticsDetailPage() {
  const { user } = useAuth();
  const params = useParams<{ source: string; id: string }>();

  const { data, error } = useQuery(() => loadAnalytics());

  const row = useMemo(
    () =>
      (data ?? []).find(
        (r) => r.source === params.source && r.id === params.id
      ),
    [data, params.source, params.id]
  );

  if (!user || !can.seeStats(user.role)) {
    return (
      <div className="card mt-6 p-6 text-sm text-muted">
        Engagement is visible to chief editors and super admins only.
      </div>
    );
  }

  if (error) {
    return (
      <div className="card mt-6 p-6 text-sm text-rose">
        Couldn&apos;t load analytics: {error}
      </div>
    );
  }

  if (!data) {
    return <div className="mt-6 h-64 animate-pulse rounded-2xl bg-canvas" />;
  }

  if (!row) {
    return (
      <>
        <Back />
        <div className="card p-8 text-center text-sm text-muted">
          {/* Unpublishing is the ordinary way to get here, so say so rather
              than implying the link was wrong. */}
          That story isn&apos;t live any more, so it has no current numbers.
        </div>
      </>
    );
  }

  const s = row.stats;

  const primary: [typeof Eye, string, number | null][] = [
    [Eye, "Opened", s.views],
    [Heart, "Liked", s.likes],
    [ThumbsDown, "Disliked", s.dislikes],
    [
      MessageCircle,
      "Comments written",
      row.commentsSupported ? s.comments : null,
    ],
    [Bookmark, "Saved", s.saves],
    [Share2, "Shared", s.shares],
  ];

  const secondary: [typeof Eye, string, number, string][] = [
    [
      MessagesSquare,
      "Comment panel opened",
      s.commentOpens,
      "How many looked at the conversation, whether or not they joined it.",
    ],
    [
      ExternalLink,
      "Left for the publisher",
      s.sourceOpens,
      "Tapped through to the original article.",
    ],
  ];

  const rates: [string, string, string][] = [
    ["Liked", pct(s.likes, s.views), "of everyone who opened it"],
    ["Saved", pct(s.saves, s.views), "of everyone who opened it"],
    ["Shared", pct(s.shares, s.views), "of everyone who opened it"],
    [
      "Joined the conversation",
      row.commentsSupported ? pct(s.comments, s.commentOpens) : "—",
      "of everyone who opened the comments",
    ],
  ];

  return (
    <>
      <Back />

      <div className="card mb-5 flex flex-wrap items-start gap-5 p-5">
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.coverUrl}
            alt=""
            className="h-28 w-44 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="h-28 w-44 shrink-0 rounded-xl bg-canvas" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill tone={row.kind === "feed" ? "muted" : "accent"}>
              {KIND_LABEL[row.kind]}
            </Pill>
            <span className="text-[11px] font-semibold text-muted">
              {row.meta}
            </span>
          </div>
          <h1 className="text-xl leading-snug font-extrabold tracking-tight">
            {row.title}
          </h1>
          <p className="mt-2 text-xs text-faint">
            Live {row.liveAt ? timeAgo(row.liveAt) : "—"}
            {" · "}
            {s.lastAt
              ? `last reader activity ${timeAgo(s.lastAt)}`
              : "no reader activity yet"}
          </p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {primary.map(([Icon, label, n]) => (
          <div key={label} className="card p-4">
            <Icon size={14} className="mb-2 text-faint" />
            <div className="text-2xl font-extrabold tabular-nums">
              {n === null ? "—" : fmt(n)}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">
              {label}
            </div>
            {n === null && (
              <p className="mt-1 text-[10px] text-faint">
                No comment thread on this format.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {secondary.map(([Icon, label, n, note]) => (
          <div key={label} className="card flex items-start gap-3 p-4">
            <Icon size={16} className="mt-0.5 shrink-0 text-faint" />
            <div className="min-w-0">
              <div className="text-lg font-extrabold tabular-nums">
                {fmt(n)}
              </div>
              <div className="text-[12px] font-bold">{label}</div>
              <p className="mt-0.5 text-[11px] text-faint">{note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-bold">Rates</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rates.map(([label, value, of]) => (
            <div key={label}>
              <div className="text-xl font-extrabold tabular-nums">{value}</div>
              <div className="text-[12px] font-bold">{label}</div>
              <p className="mt-0.5 text-[11px] text-faint">{of}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-faint">
          A dash means there is nothing to divide by yet.
        </p>
      </div>
    </>
  );
}

function Back() {
  return (
    <Link
      href="/analytics"
      className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} /> All analytics
    </Link>
  );
}
