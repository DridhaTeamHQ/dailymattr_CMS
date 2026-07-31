"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing,
  Check,
  ListOrdered,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import ArticlePreview from "@/components/ArticlePreview";
import NewsVisual from "@/components/NewsVisual";
import { Pager } from "@/components/Pager";
import { Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { PAGE_SIZES, clampPage, pageCount, pageSlice } from "@/lib/paginate";
import { usePageParam } from "@/lib/usePageParam";
import {
  approveArticle,
  listContentByKind,
  listContentStats,
  listNewsStudio,
  listNotified,
  notifyReaders,
  pushAudienceSize,
  statKey,
  listNewsStudioByIds,
  listSelections,
  listUsers,
  logAudit,
  unapproveArticle,
  updateSelection,
} from "@/lib/db";
import { StatsStrip } from "@/components/StatsStrip";
import {
  modesAreEmpty,
  tidyModes,
  type ReadingModes,
} from "@/components/ReadingModesPanel";
import { timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { ArticlesSkeleton } from "@/components/PageSkeleton";
import type { ArticleSelection, ContentStats, NewsStudioArticle } from "@/lib/types";

type Tab = "newsstudio" | "cms" | "feed";

/**
 * `usePageParam` reads the query string, which is not knowable while the route
 * is prerendered — so the tabs render inside a Suspense boundary and the
 * skeleton stands in until the URL is readable on the client.
 */
export default function ArticlesPage() {
  return (
    <Suspense fallback={<ArticlesSkeleton />}>
      <ArticlesTabs />
    </Suspense>
  );
}

function ArticlesTabs() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("newsstudio");
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  // One page counter, held in ?page — the tabs reset it, so each list starts
  // at the top.
  const [page, setPage] = usePageParam();

  // Typing shouldn't fire a query per keystroke now that searching happens on
  // the server; settle for a moment first.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const newsSize = PAGE_SIZES.newsGrid;
  const rowSize = PAGE_SIZES.articleRows;

  /* Everything that doesn't depend on which page is being viewed. The app
     feed joins selections (DB B) to their articles (DB A) by id, and those
     articles are almost never the twelve currently on screen — so they are
     fetched by id rather than looked up in the grid's page. */
  const { data, error, refetch } = useQuery(async () => {
    /* Stats are the desk's, not the writer's — see `can.seeStats`. Asked for
       only when they will be shown, so a writer's page doesn't spend a round
       trip fetching numbers RLS would hand back as zeros anyway. */
    const [selections, written, users] = await Promise.all([
      listSelections(),
      listContentByKind("article"),
      listUsers(),
    ]);

    /* After the lists, because comment counts are asked for by id and live in
       whichever project owns the story — DB A for the feed, here for ours. */
    const [notified, audience] = await Promise.all([listNotified(), pushAudienceSize()]);

    const [feedArticles, stats] = await Promise.all([
      listNewsStudioByIds(selections.map((s) => s.articleId)),
      user && can.seeStats(user.role)
        ? listContentStats(
            selections.map((s) => s.articleId),
            written.filter((c) => c.status === "published").map((c) => c.id)
          )
        : new Map<string, ContentStats>(),
    ]);

    return { selections, written, users, feedArticles, stats, notified, audience };
  });

  /* One page of the grid. Re-runs on page or search change only; useQuery
     keeps the previous page on screen while the next one loads, so paging
     doesn't blink back to a skeleton. */
  const {
    data: news,
    error: newsError,
    refetch: refetchNews,
  } = useQuery(
    () => listNewsStudio({ page, size: newsSize, search: term }),
    [page, term, newsSize]
  );

  const newsCount = news ? pageCount(news.total, newsSize) : 1;
  // A hand-typed ?page=900 on a list that has 240 pages: land on the last one
  // rather than showing an empty grid.
  useEffect(() => {
    if (news && page > newsCount) setPage(newsCount);
  }, [news, page, newsCount, setPage]);

  const failure = error ?? newsError;
  if (failure)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load articles: {failure}
      </div>
    );
  if (!user || !data || !news) return <ArticlesSkeleton />;
  const approver = can.approveArticles(user.role);
  // Approving changes the selections *and* the ring on the grid card, so both
  // queries have to hear about it.
  const refresh = () => {
    refetch();
    refetchNews();
  };

  // ── approval actions ────────────────────────────────────────────
  const approve = async (art: NewsStudioArticle) => {
    if (!approver) return;
    if (data?.selections.some((s) => s.articleId === art.id)) return;
    await toast.run(() => approveArticle(art.id, user, art.title), {
      // Feed order is approval order, so say where it landed.
      success: `Added to the app feed — position ${(data?.selections.length ?? 0) + 1}`,
      error: "Couldn't add that to the feed",
    });
    refresh();
    // Not awaited: the desk should not wait on a model to see the story land.
    void fillModes(art);
  };

  /* Fill in the retellings a story arrived without.
   *
   * The summariser reaches a fraction of the wire, so most stories land with
   * a summary and nothing else — and asking an editor to press Generate on
   * every one of them is asking them to do the machine's job. Approval is the
   * moment it matters: the story is going into the feed, so this is when it
   * either has retellings or gets them.
   *
   * Deliberately after the approval, never before it, and never blocking it.
   * A story the desk approved must appear in the feed whether or not a model
   * answered — the modes are an enhancement, not a precondition. Failures are
   * silent for the same reason; the panel is still there to press by hand.
   *
   * Skipped when the story already has them, from either source, so approving
   * something twice costs nothing. */
  const fillModes = async (art: NewsStudioArticle) => {
    if (art.hasModes) return;
    const existing = data?.selections.find((x) => x.articleId === art.id);
    if (existing?.modesOverride) return;

    try {
      const res = await fetch("/api/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: art.title, summary: art.summary }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { modes?: ReadingModes };
      if (!json.modes || modesAreEmpty(json.modes)) return;
      await updateSelection(art.id, { modesOverride: tidyModes(json.modes) });
      toast.success(`Reading modes written for "${art.title.slice(0, 40)}"`);
      refetch();
    } catch {
      /* the editor can still write them by hand in the preview */
    }
  };

  const unapprove = async (art: NewsStudioArticle) => {
    if (!approver) return;
    await toast.run(() => unapproveArticle(art.id, user, art.title), {
      success: "Removed from the app feed",
      error: "Couldn't remove that from the feed",
    });
    refresh();
  };

  const toggleApproval = async (art: NewsStudioArticle) => {
    const approved = data?.selections.some((s) => s.articleId === art.id);
    if (approved) await unapprove(art);
    else await approve(art);
  };

  /* Notifying is its own act, not a consequence of featuring.

     A push reaches every install at once and cannot be recalled, so it stays a
     decision someone makes while looking at the recipient count. The database
     refuses a second send for the same story, so the disabled state here is a
     courtesy rather than the guard. */
  const notify = async (art: NewsStudioArticle) => {
    const audience = data?.audience ?? 0;
    const sel = data?.selections.find((x) => x.articleId === art.id);
    if (!data || data.notified.has(statKey("pipeline", art.id)) || audience === 0) return;
    if (
      !window.confirm(
        `Notify ${audience} ${audience === 1 ? "reader" : "readers"} about "${art.title}"?

This cannot be undone or recalled.`,
      )
    )
      return;

    await toast.run(
      async () => {
        const r = await notifyReaders({
          source: "pipeline",
          contentId: art.id,
          title: sel?.titleOverride?.trim() || art.title,
          body: sel?.summaryOverride?.trim() || art.summary,
          image: sel?.imageOverride?.trim() || art.imageUrl,
        });
        if (r.failed > 0) {
          throw new Error(`Sent to ${r.sent} of ${r.attempted}. ${r.failed} failed.`);
        }
      },
      { success: "Readers notified", error: "Couldn't notify readers" },
    );
    refetch();
  };

  const toggleFeature = async (art: NewsStudioArticle) => {
    if (!approver) return;
    const sel = data?.selections.find((s) => s.articleId === art.id);
    if (!sel) return approve(art);
    const featuring = !sel.isFeatured;
    await toast.run(
      async () => {
        await updateSelection(art.id, { isFeatured: featuring });
        if (featuring)
          await logAudit(user, "featured", "newsstudio article", art.title);
      },
      {
        success: featuring ? "Featured in the app" : "No longer featured",
        error: "Couldn't change that",
      }
    );
    refresh();
  };

  const saveOverrides = async (
    art: NewsStudioArticle,
    patch: {
      titleOverride: string | null;
      summaryOverride: string | null;
      imageOverride: string | null;
      modesOverride: ArticleSelection["modesOverride"];
    }
  ) => {
    await toast.run(
      async () => {
        await updateSelection(art.id, patch);
        await logAudit(
          user,
          "edited app copy for",
          "newsstudio article",
          art.title
        );
      },
      {
        success: "App copy saved",
        error: "That copy didn't save",
      }
    );
    refresh();
  };

  // ── derived ─────────────────────────────────────────────────────
  const selections = data.selections;
  const written = data.written;
  const showStats = can.seeStats(user.role);

  const articleOf = (id: string) =>
    data.feedArticles.find((n) => n.id === id) ?? null;

  const hit = (...fields: (string | null | undefined)[]) => {
    if (!term) return true;
    const needle = term.toLowerCase();
    return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
  };

  /* Newest first.
     `position` still counts up from the first story ever approved — that is
     what it means and the number is on the card — but a desk opening this tab
     wants what it just approved, not what it approved in April. The grid and
     the drafts already read newest-first; only this list did not. */
  const feedOrdered = [...selections].reverse().filter((sel) => {
    const art = articleOf(sel.articleId);
    return hit(sel.titleOverride, art?.title, art?.category, art?.source);
  });
  const writtenFiltered = written.filter((c) => hit(c.title, c.summary));

  // The grid arrives already paged and searched; the feed and the drafts are
  // small enough to page in the browser. Approving can empty the last page of
  // those two, so clamp before slicing.
  const newsRows = news.rows;
  const newsPage = clampPage(page, news.total, newsSize);
  const feedPage = clampPage(page, feedOrdered.length, rowSize);
  const writtenPage = clampPage(page, writtenFiltered.length, rowSize);
  const feedRows = pageSlice(feedOrdered, page, rowSize);
  const writtenRows = pageSlice(writtenFiltered, page, rowSize);

  const selOf = (id: string) => selections.find((s) => s.articleId === id);
  const nameOf = (id: string) =>
    data.users.find((u) => u.id === id)?.fullName ?? "—";
  // The preview opens from the grid or from the feed, so look in both.
  const previewArticle =
    newsRows.find((n) => n.id === previewId) ??
    data.feedArticles.find((n) => n.id === previewId) ??
    null;

  // The NewsStudio count is the server's, not the length of the page on screen.
  const TABS: [Tab, string, number | undefined][] = [
    ["newsstudio", "NewsStudio", news.total],
    ["cms", "Written in Studio", written.length],
    ["feed", "App feed", selections.length],
  ];

  return (
    <div>
      <SectionHeader
        title="Articles"
        sub="Approve NewsStudio stories into the app feed, or write your own."
      >
        <Link
          href="/content/articles/editor"
          className="btn-primary flex items-center gap-1.5 px-5 py-2.5 text-sm"
        >
          <Plus size={15} /> Write article
        </Link>
      </SectionHeader>

      {/* Tabs and one search box between them.
          The box used to live inside the NewsStudio tab, so the two lists a
          desk actually works in every day — the feed and its own drafts — had
          no way to find anything. It searches whichever tab is open, and the
          term survives switching tabs, which is how you chase one story from
          the wire into the feed. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1 shadow-(--shadow-soft)">
        {TABS.map(([t, label, count]) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPage(1);
            }}
            className={`relative rounded-full px-4 py-2 text-[13px] font-bold whitespace-nowrap transition-colors ${
              tab === t ? "text-white" : "text-muted hover:text-ink"
            }`}
          >
            {tab === t && (
              <motion.span
                layoutId="tab-active"
                className="absolute inset-0 rounded-full bg-shell"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <span className="relative z-10">
              {label}
              {count != null && (
                <span className={tab === t ? "text-white/50" : "text-faint"}>
                  {" "}
                  · {count}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

        <div className="relative w-full max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
          />
          <input
            className="field !rounded-full !bg-card pr-10 pl-10 shadow-(--shadow-soft)"
            placeholder={
              tab === "newsstudio"
                ? "Search title, category or source…"
                : tab === "feed"
                  ? "Search the live feed…"
                  : "Search your articles…"
            }
            aria-label="Search articles"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              aria-label="Clear search"
              title="Clear search"
              className="absolute top-1/2 right-4 -translate-y-1/2 text-faint hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── NewsStudio ─────────────────────────────────────────── */}
      {tab === "newsstudio" && (
        <>
          {newsRows.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 p-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
                <Search size={20} />
              </span>
              <p className="font-bold">
                {term ? `No stories match “${term}”` : "No stories yet"}
              </p>
              <p className="text-sm text-muted">
                {term
                  ? "Try a different title, category or source."
                  : "Approved pipeline stories will appear here."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {newsRows.map((n, i) => {
                const sel = selOf(n.id);
                const approved = !!sel;
                return (
                  <motion.article
                    key={n.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i * 0.035, 0.28),
                      duration: 0.4,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                    className={`card card-hover group relative flex flex-col overflow-hidden ${
                      approved ? "ring-2 ring-mint" : ""
                    }`}
                  >
                    <button
                      onClick={() => setPreviewId(n.id)}
                      className="relative block h-64 w-full overflow-hidden text-left"
                      title="Preview in app"
                    >
                      <NewsVisual
                        src={sel?.imageOverride ?? n.imageUrl}
                        imageHeight="56%"
                      />

                      {/* chips */}
                      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3">
                        <span className="rounded-full border border-white/10 bg-white/20 px-3 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
                          {n.category}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {sel?.isFeatured && (
                            <span className="rounded-full bg-violet px-2 py-1 text-[10px] font-extrabold text-white">
                              ★
                            </span>
                          )}
                          {approved ? (
                            <span className="flex items-center gap-1 rounded-full bg-mint px-2 py-1 text-[10px] font-extrabold text-white">
                              <Check size={10} strokeWidth={3} />#{sel.position}
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/10 bg-white/20 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md">
                              {timeAgo(n.publishedAt)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* headline over the wash */}
                      <div className="absolute inset-x-0 bottom-0 z-20 p-4">
                        <h3 className="line-clamp-3 text-[15px] leading-[1.2] font-extrabold tracking-tight text-white">
                          {sel?.titleOverride ?? n.title}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-[1.5] text-white/75">
                          {sel?.summaryOverride ?? n.summary}
                        </p>
                      </div>

                      <span className="absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-bold text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                        <Smartphone size={12} /> Preview
                      </span>
                    </button>

                    <div className="mt-auto px-4 pt-3 pb-4">
                      <div className="flex items-center justify-between text-[11px] text-faint">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`font-extrabold ${
                              n.factScore >= 93
                                ? "text-mint"
                                : n.factScore >= 85
                                  ? "text-amber"
                                  : "text-rose"
                            }`}
                          >
                            FACT {n.factScore}
                          </span>
                          · {n.sourceCount} SRC
                        </span>
                        <span className="truncate font-semibold text-muted">
                          {n.source}
                        </span>
                      </div>

                      {/* Only once it is in the feed. The grid is mostly
                          candidates nobody has approved, and zeros on those
                          would read as "readers ignored it" when the truth is
                          that readers were never shown it. */}
                      {showStats && approved && (
                        <StatsStrip
                          stats={data.stats.get(statKey("pipeline", n.id))}
                          className="mt-2"
                        />
                      )}

                      {approver && (
                        <div className="mt-3 flex gap-2 border-t border-line pt-3">
                          {approved ? (
                            <>
                              <span className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-mint-tint py-2 text-xs font-bold text-mint">
                                <Check size={13} strokeWidth={3} /> Approved
                              </span>
                              <button
                                onClick={() => unapprove(n)}
                                title="Remove from app feed"
                                className="btn-ghost flex h-9 w-9 items-center justify-center !p-0 hover:!text-rose"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => approve(n)}
                              className="btn-primary flex flex-1 items-center justify-center gap-1.5 py-2 text-xs"
                            >
                              <Check size={13} strokeWidth={3} /> Approve
                            </button>
                          )}
                          <button
                            onClick={() => toggleFeature(n)}
                            title={sel?.isFeatured ? "Unfeature" : "Feature"}
                            className={`btn-ghost flex h-9 w-9 items-center justify-center !p-0 ${
                              sel?.isFeatured ? "!border-violet !text-violet" : ""
                            }`}
                          >
                            {sel?.isFeatured ? (
                              <Sparkles size={14} />
                            ) : (
                              <Star size={14} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.article>
                );
              })}
            </div>
          )}

          <Pager
            page={newsPage}
            total={news.total}
            size={newsSize}
            onPage={setPage}
            label="stories"
          />
        </>
      )}

      {/* ── App feed ───────────────────────────────────────────── */}
      {tab === "feed" && (
        <>
          <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mint-tint text-mint">
                <ListOrdered size={18} />
              </span>
              <div>
                <h3 className="text-sm font-bold">Live in DailyMattr</h3>
                {/* The old line said the first story approved leads the feed.
                    That stopped being true when the app started ranking: it
                    pins featured, then scores the rest on freshness and what
                    the reader actually reads. */}
                <p className="text-[11px] text-muted">
                  Newest first here. The app leads with featured, then ranks on
                  freshness and the reader.
                </p>
              </div>
            </div>
            <Pill tone="mint">{selections.length} approved</Pill>
          </div>

          {feedOrdered.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 p-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-tint text-mint">
                <Check size={20} />
              </span>
              <p className="font-bold">
                {term ? `Nothing in the feed matches “${term}”` : "Nothing approved yet"}
              </p>
              <p className="max-w-xs text-sm text-muted">
                {term
                  ? "Headlines, categories and sources are searched."
                  : approver
                    ? "Approve stories from the NewsStudio tab — they queue up here in the order you approve them."
                    : "QA approves stories into the feed."}
              </p>
              {approver && !term && (
                <button
                  onClick={() => setTab("newsstudio")}
                  className="btn-primary mt-3 px-5 py-2.5 text-xs"
                >
                  Browse NewsStudio
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {feedRows.map((sel) => {
                  const art = data.feedArticles.find(
                    (n) => n.id === sel.articleId
                  );
                  if (!art) return null;
                  return (
                    <motion.div
                      key={sel.articleId}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 50, transition: { duration: 0.22 } }}
                      className="card card-hover group flex flex-wrap items-center gap-4 p-4"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-extrabold text-muted">
                        {sel.position}
                      </span>
                      <button
                        onClick={() => setPreviewId(art.id)}
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                        title="Preview in app"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sel.imageOverride ?? art.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-16 w-24 shrink-0 rounded-xl object-cover"
                        />
                        <span className="min-w-0">
                          <span className="mb-1 flex flex-wrap items-center gap-1.5">
                            <Pill tone="accent">{art.category}</Pill>
                            {sel.isFeatured && <Pill tone="violet">Featured</Pill>}
                            {(sel.titleOverride || sel.summaryOverride) && (
                              <Pill tone="muted">edited</Pill>
                            )}
                          </span>
                          <span className="line-clamp-1 text-[14px] font-bold">
                            {sel.titleOverride ?? art.title}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-faint">
                            Approved by {nameOf(sel.approvedBy)} ·{" "}
                            {timeAgo(sel.approvedAt)}
                          </span>
                        </span>
                      </button>

                      {approver && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => toggleFeature(art)}
                            title={sel.isFeatured ? "Unfeature" : "Feature"}
                            className={`btn-ghost flex h-9 w-9 items-center justify-center !p-0 ${
                              sel.isFeatured ? "!border-violet !text-violet" : ""
                            }`}
                          >
                            {sel.isFeatured ? (
                              <Sparkles size={14} />
                            ) : (
                              <Star size={14} />
                            )}
                          </button>
                          {sel.isFeatured && (
                            <button
                              onClick={() => notify(art)}
                              disabled={
                                data.notified.has(statKey("pipeline", art.id)) ||
                                data.audience === 0
                              }
                              title={
                                data.notified.has(statKey("pipeline", art.id))
                                  ? "Readers have already been notified"
                                  : data.audience === 0
                                    ? "No reader has push enabled yet"
                                    : `Notify ${data.audience} ${data.audience === 1 ? "reader" : "readers"}`
                              }
                              className="btn-ghost flex h-9 w-9 items-center justify-center !p-0 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <BellRing size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => unapprove(art)}
                            title="Remove from app feed"
                            className="btn-ghost flex h-9 w-9 items-center justify-center !p-0 hover:!text-rose"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      {/* Full width so flex-wrap drops it onto its own line
                          rather than squeezing the title. Every row here is
                          in the feed by definition, so there is no published
                          check to make — it is live or it is not on screen. */}
                      {showStats && (
                        <StatsStrip
                          stats={data.stats.get(statKey("pipeline", art.id))}
                          className="w-full"
                        />
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          <Pager
            page={feedPage}
            total={feedOrdered.length}
            size={rowSize}
            onPage={setPage}
            label="in the feed"
          />
        </>
      )}

      {/* ── Written in Studio ──────────────────────────────────── */}
      {tab === "cms" && (
        <>
          <div className="space-y-3">
            {writtenFiltered.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 p-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
                  <Plus size={20} />
                </span>
                <p className="font-bold">
                  {term ? `Nothing matches “${term}”` : "No articles written yet"}
                </p>
                <p className="max-w-xs text-sm text-muted">
                  {term
                    ? "Headlines and summaries are searched."
                    : "Write an original 60-word story — it flows through QA before it reaches the app."}
                </p>
                {!term && (
                  <Link
                    href="/content/articles/editor"
                    className="btn-primary mt-3 px-5 py-2.5 text-xs"
                  >
                    Write the first one
                  </Link>
                )}
              </div>
            ) : (
              writtenRows.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.2) }}
                >
                  <Link
                    href={`/content/articles/editor?id=${c.id}`}
                    className="card card-hover flex items-center gap-4 p-4"
                  >
                    {c.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.coverUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-16 w-24 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="h-16 w-24 shrink-0 rounded-xl bg-canvas" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold">{c.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                        {c.summary}
                      </p>
                      <p className="mt-1 text-[11px] text-faint">
                        Updated {timeAgo(c.updatedAt)}
                      </p>
                      {/* Only once it is live. An unpublished draft has no
                          readers, so a row of zeros on one would read as
                          indifference rather than as "not out yet". */}
                      {showStats && c.status === "published" && (
                        <StatsStrip
                          stats={data.stats.get(statKey("cms", c.id))}
                          className="mt-1.5"
                        />
                      )}
                    </div>
                    <StatusPill status={c.status} />
                  </Link>
                </motion.div>
              ))
            )}
          </div>

          <Pager
            page={writtenPage}
            total={writtenFiltered.length}
            size={rowSize}
            onPage={setPage}
            label="articles"
          />
        </>
      )}

      <ArticlePreview
        article={previewArticle}
        selection={previewArticle ? selOf(previewArticle.id) : undefined}
        canEdit={can.editArticleCopy(user.role)}
        canApprove={approver}
        onClose={() => setPreviewId(null)}
        onSave={(patch) => previewArticle && saveOverrides(previewArticle, patch)}
        onToggleFeed={() => previewArticle && toggleApproval(previewArticle)}
        onToggleFeature={() => previewArticle && toggleFeature(previewArticle)}
      />
    </div>
  );
}
