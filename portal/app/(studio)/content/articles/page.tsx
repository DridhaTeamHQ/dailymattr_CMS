"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
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
  listNewsStudioByIds,
  listSelections,
  listUsers,
  logAudit,
  unapproveArticle,
  updateSelection,
} from "@/lib/db";
import { StatsStrip } from "@/components/StatsStrip";
import { timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { ArticlesSkeleton } from "@/components/PageSkeleton";
import type { NewsStudioArticle } from "@/lib/types";

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
    const [selections, written, users, stats] = await Promise.all([
      listSelections(),
      listContentByKind("article"),
      listUsers(),
      user && can.seeStats(user.role) ? listContentStats() : new Map(),
    ]);
    const feedArticles = await listNewsStudioByIds(
      selections.map((s) => s.articleId)
    );
    return { selections, written, users, feedArticles, stats };
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

  // The grid arrives already paged and searched; the feed and the drafts are
  // small enough to page in the browser. Approving can empty the last page of
  // those two, so clamp before slicing.
  const newsRows = news.rows;
  const newsPage = clampPage(page, news.total, newsSize);
  const feedPage = clampPage(page, selections.length, rowSize);
  const writtenPage = clampPage(page, written.length, rowSize);
  const feedRows = pageSlice(selections, page, rowSize);
  const writtenRows = pageSlice(written, page, rowSize);

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

      {/* tabs */}
      <div className="mb-5 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1 shadow-(--shadow-soft)">
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

      {/* ── NewsStudio ─────────────────────────────────────────── */}
      {tab === "newsstudio" && (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
            />
            <input
              className="field !rounded-full !bg-card pl-10 shadow-(--shadow-soft)"
              placeholder="Search title, category or source…"
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
                className="absolute top-1/2 right-3.5 -translate-y-1/2 text-faint hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

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
                <p className="text-[11px] text-muted">
                  Order follows approval — the first story approved leads the
                  feed.
                </p>
              </div>
            </div>
            <Pill tone="mint">{selections.length} approved</Pill>
          </div>

          {selections.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 p-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-tint text-mint">
                <Check size={20} />
              </span>
              <p className="font-bold">Nothing approved yet</p>
              <p className="max-w-xs text-sm text-muted">
                {approver
                  ? "Approve stories from the NewsStudio tab — they queue up here in the order you approve them."
                  : "QA approves stories into the feed."}
              </p>
              {approver && (
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
                          <button
                            onClick={() => unapprove(art)}
                            title="Remove from app feed"
                            className="btn-ghost flex h-9 w-9 items-center justify-center !p-0 hover:!text-rose"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          <Pager
            page={feedPage}
            total={selections.length}
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
            {written.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 p-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
                  <Plus size={20} />
                </span>
                <p className="font-bold">No articles written yet</p>
                <p className="max-w-xs text-sm text-muted">
                  Write an original 60-word story — it flows through QA before
                  it reaches the app.
                </p>
                <Link
                  href="/content/articles/editor"
                  className="btn-primary mt-3 px-5 py-2.5 text-xs"
                >
                  Write the first one
                </Link>
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
                          stats={data.stats.get(c.id)}
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
            total={written.length}
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
