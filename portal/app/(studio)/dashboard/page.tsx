"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileEdit,
  Sparkles,
} from "lucide-react";
import ActivityChart from "@/components/ActivityChart";
import FormatChart from "@/components/FormatChart";
import { Avatar, FactBadge, Pill, SectionHeader } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  getNewsStudioByIds,
  listAudit,
  listContent,
  listContentStats,
  listSelections,
  statKey,
} from "@/lib/db";
import { StatsStrip } from "@/components/StatsStrip";
import { timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { DashboardSkeleton } from "@/components/PageSkeleton";
import { type ContentKind, type ContentStats } from "@/lib/types";

const KINDS: ContentKind[] = ["article", "pix", "qix", "trax"];

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error } = useQuery(async () => {
    // All four queries fire in parallel — no waiting for selections before
    // fetching newsstudio. The join happens client-side after everything lands.
    const [content, audit, selectionsAndNews] = await Promise.all([
      listContent(),
      listAudit(40),
      // Selections + their NewsStudio articles: selections is fast (tiny table)
      // so chain it only with the newsstudio fetch, not with content/audit.
      listSelections().then(async (selections) => {
        const newsstudio = await getNewsStudioByIds(
          selections.map((s) => s.articleId)
        );
        return { selections, newsstudio };
      }),
    ]);

    /* After selections rather than beside them: comment counts come from DB A
       and have to be asked for by id, so this one genuinely needs the list
       first. Only for the two roles allowed to see it — RLS would hand a
       writer zeros anyway, so asking would be a round trip that buys nothing. */
    const engagement =
      user && can.seeStats(user.role)
        ? await listContentStats(
            selectionsAndNews.selections.map((s) => s.articleId),
            content.filter((c) => c.status === "published").map((c) => c.id)
          )
        : new Map<string, ContentStats>();

    return {
      content,
      audit,
      selections: selectionsAndNews.selections,
      newsstudio: selectionsAndNews.newsstudio,
      engagement,
    };
  });

  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load the dashboard: {error}
      </div>
    );
  if (!user || !data) return <DashboardSkeleton />;

  const published = data.content.filter((c) => c.status === "published").length;
  const inReview = data.content.filter((c) => c.status === "in_review").length;
  const drafts = data.content.filter((c) => c.status === "draft").length;
  const featured = data.selections.length;

  const stats = [
    {
      label: "Published",
      value: published,
      delta: "+2 this week",
      icon: CheckCircle2,
      tone: "bg-mint-tint text-mint",
    },
    {
      label: "In review",
      value: inReview,
      delta: "awaiting QA",
      icon: Clock3,
      tone: "bg-amber-tint text-amber",
    },
    {
      label: "Drafts",
      value: drafts,
      delta: "keep writing",
      icon: FileEdit,
      tone: "bg-tint text-accent",
    },
    {
      label: "Featured articles",
      value: featured,
      delta: "in the app feed",
      icon: Sparkles,
      tone: "bg-violet-tint text-violet",
    },
  ];

  const showStats = can.seeStats(user.role);

  const byKind = KINDS.map((k) => ({
    kind: k,
    total: data.content.filter((c) => c.kind === k).length,
    published: data.content.filter(
      (c) => c.kind === k && c.status === "published"
    ).length,
  }));

  return (
    <div>
      <SectionHeader
        title={`Good to see you, ${user.fullName.split(" ")[0]}`}
        sub="Here's what's moving across DailyMattr today."
      >
        <Link href="/content/pix" className="btn-primary px-5 py-2.5 text-sm">
          + New content
        </Link>
      </SectionHeader>

      {/* stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="card card-hover p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-2xl ${s.tone}`}
              >
                <s.icon size={18} />
              </span>
              <ArrowUpRight size={16} className="text-faint" />
            </div>
            <div className="text-3xl font-extrabold tracking-tight">
              {s.value}
            </div>
            <div className="mt-1 text-[13px] font-medium text-muted">
              {s.label}
            </div>
            <div className="mt-2">
              <Pill tone="muted">{s.delta}</Pill>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {/* chart card */}
        <div className="card space-y-6 p-6">
          <ActivityChart items={data.content} />
          {/* Kept below the trend as the standing position — the two answer
              different questions: what shipped lately, and what is live now. */}
          <div className="border-t border-line pt-6">
            <FormatChart data={byKind} />
          </div>
        </div>

        {/* activity */}
        <div className="card flex flex-col p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold">Recent activity</h3>
            <Link
              href="/activity"
              className="text-xs font-bold text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          {/* The chart column beside this one is far taller, so a fixed four
              entries left the card half empty. flex-1 + min-h-0 lets the list
              take whatever height the row ends up being, and scroll only when
              there is genuinely more than fits. */}
          {/* Six entries, at a comfortable size. Six is roughly what fills the
              height this card gets from the chart column beside it, so the
              panel reads full without cramming. */}
          <div className="-mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-2">
            {data.audit.slice(0, 6).map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-2xl p-2.5 transition-colors hover:bg-canvas"
              >
                <Avatar
                  name={a.actorName}
                  hue={220 + ((a.actorName.length * 37) % 140)}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  {/* Clamped to two lines. Unclamped, a long headline wrapped
                      to three or four and pushed the last entries out of the
                      card, so the count silently depended on how wordy the
                      newest title happened to be. */}
                  <p className="line-clamp-2 text-[13px] leading-snug">
                    <span className="font-bold">{a.actorName}</span>{" "}
                    <span className="text-muted">{a.action}</span>{" "}
                    <span className="font-semibold">{a.entityTitle}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {a.entity} · {timeAgo(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* featured in app */}
      <div className="card mt-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold">Live in the app feed</h3>
            <p className="text-xs text-muted">
              NewsStudio articles curated for DailyMattr
            </p>
          </div>
          <Link
            href="/content/articles"
            className="btn-ghost px-4 py-2 text-xs"
          >
            Curate articles
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.selections.map((sel) => {
            const art = data.newsstudio.find((n) => n.id === sel.articleId);
            if (!art) return null;
            return (
              <div
                key={sel.articleId}
                className="card-hover flex gap-4 rounded-2xl border border-line p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={art.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-20 w-28 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Pill tone="accent">{art.category}</Pill>
                    {sel.isFeatured && <Pill tone="violet">Featured</Pill>}
                    <FactBadge score={art.factScore} />
                  </div>
                  <p className="line-clamp-2 text-[13px] leading-snug font-bold">
                    {art.title}
                  </p>
                  <p className="mt-1 text-[11px] text-faint">
                    {art.source} · {timeAgo(art.publishedAt)}
                  </p>
                  {/* Everything in this list is in the app feed, so there is
                      no "not published yet" case to distinguish — a zero here
                      really does mean nobody has touched it. */}
                  {showStats && (
                    <StatsStrip
                      stats={data.engagement.get(
                        statKey("pipeline", art.id)
                      )}
                      className="mt-1.5"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* review shortcut for QA-ish roles */}
      {inReview > 0 && (
        <Link
          href="/review"
          className="card card-hover mt-6 flex items-center justify-between p-5"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-tint text-amber">
              <Clock3 size={18} />
            </span>
            <div>
              <div className="text-sm font-bold">
                {inReview} item{inReview > 1 ? "s" : ""} waiting for review
              </div>
              <div className="text-xs text-muted">
                Jump into the QA queue to keep content moving
              </div>
            </div>
          </div>
          <span className="btn-accent px-4 py-2 text-xs">Open queue</span>
        </Link>
      )}
    </div>
  );
}
