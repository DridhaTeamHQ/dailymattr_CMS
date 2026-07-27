"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, Reorder } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import ArticlePreview from "@/components/ArticlePreview";
import { Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  contentByKind,
  getNewsStudio,
  getSelections,
  logAudit,
  saveSelections,
  timeAgo,
  updateSelection,
} from "@/lib/store";
import { useStore } from "@/lib/useStore";
import type { ArticleSelection, NewsStudioArticle } from "@/lib/types";

type Tab = "newsstudio" | "cms";

export default function ArticlesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("newsstudio");
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const data = useStore(
    () => ({
      newsstudio: getNewsStudio(),
      selections: getSelections(),
      written: contentByKind("article"),
    }),
    [tick]
  );

  if (!user) return null;
  const curator = can.curate(user.role);
  const refresh = () => setTick((t) => t + 1);

  // ── curation actions ────────────────────────────────────────────
  const addToFeed = (art: NewsStudioArticle) => {
    if (!curator) return;
    const sel = getSelections();
    if (sel.some((s) => s.articleId === art.id)) return;
    saveSelections([
      ...sel,
      {
        articleId: art.id,
        position: sel.length + 1,
        isFeatured: false,
        selectedBy: user.id,
        selectedAt: new Date().toISOString(),
        titleOverride: null,
        summaryOverride: null,
      },
    ]);
    logAudit(user, "added to feed", "newsstudio article", art.title);
    refresh();
  };

  const removeFromFeed = (art: NewsStudioArticle) => {
    if (!curator) return;
    saveSelections(getSelections().filter((s) => s.articleId !== art.id));
    logAudit(user, "removed from feed", "newsstudio article", art.title);
    refresh();
  };

  const toggleFeed = (art: NewsStudioArticle) => {
    const inFeed = getSelections().some((s) => s.articleId === art.id);
    if (inFeed) removeFromFeed(art);
    else addToFeed(art);
  };

  const toggleFeature = (art: NewsStudioArticle) => {
    if (!curator) return;
    const sel = getSelections().find((s) => s.articleId === art.id);
    if (!sel) return addToFeed(art);
    updateSelection(art.id, { isFeatured: !sel.isFeatured });
    if (!sel.isFeatured) logAudit(user, "featured", "newsstudio article", art.title);
    refresh();
  };

  const reorder = (next: ArticleSelection[]) => {
    saveSelections(next);
    refresh();
  };

  /** Keyboard/click reordering — drag is the fast path, this is the reliable one. */
  const move = (index: number, dir: -1 | 1) => {
    if (!curator) return;
    const next = getSelections();
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    saveSelections(next);
    refresh();
  };

  const saveOverrides = (
    art: NewsStudioArticle,
    patch: { titleOverride: string | null; summaryOverride: string | null }
  ) => {
    updateSelection(art.id, patch);
    logAudit(user, "edited app copy for", "newsstudio article", art.title);
    refresh();
  };

  // ── derived ─────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const filtered =
    data?.newsstudio.filter(
      (n) =>
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q) ||
        n.source.toLowerCase().includes(q)
    ) ?? [];

  const selOf = (id: string) => data?.selections.find((s) => s.articleId === id);
  const previewArticle = data?.newsstudio.find((n) => n.id === previewId) ?? null;

  return (
    <div>
      <SectionHeader
        title="Articles"
        sub="Curate the NewsStudio pipeline, or write your own — both feed the app."
      >
        <Link
          href="/content/articles/editor"
          className="btn-primary flex items-center gap-1.5 px-5 py-2.5 text-sm"
        >
          <Plus size={15} /> Write article
        </Link>
      </SectionHeader>

      {/* tabs */}
      <div className="mb-5 flex w-fit items-center gap-1 rounded-full bg-white p-1 shadow-(--shadow-soft)">
        {(
          [
            ["newsstudio", "NewsStudio", data?.newsstudio.length],
            ["cms", "Written in Studio", data?.written.length],
          ] as [Tab, string, number | undefined][]
        ).map(([t, label, count]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${
              tab === t ? "text-white" : "text-muted hover:text-ink"
            }`}
          >
            {tab === t && (
              <motion.span
                layoutId="tab-active"
                className="absolute inset-0 rounded-full bg-ink"
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

      {tab === "newsstudio" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
          {/* ── browse column ──────────────────────────────── */}
          <div className="min-w-0">
            <div className="relative mb-4 max-w-sm">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
              />
              <input
                className="field !rounded-full !bg-white pl-10 shadow-(--shadow-soft)"
                placeholder="Search title, category or source…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-3.5 -translate-y-1/2 text-faint hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {!data ? (
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="card overflow-hidden">
                    <div className="h-36 w-full animate-pulse bg-canvas" />
                    <div className="space-y-2 p-4">
                      <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-canvas" />
                      <div className="h-3 w-full animate-pulse rounded-full bg-canvas" />
                      <div className="h-3 w-2/3 animate-pulse rounded-full bg-canvas" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="card flex flex-col items-center gap-2 p-14 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
                  <Search size={20} />
                </span>
                <p className="font-bold">No stories match “{query}”</p>
                <p className="text-sm text-muted">
                  Try a different title, category or source.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((n, i) => {
                  const sel = selOf(n.id);
                  const inFeed = !!sel;
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
                        inFeed ? "ring-2 ring-accent" : ""
                      }`}
                    >
                      <button
                        onClick={() => setPreviewId(n.id)}
                        className="text-left"
                        title="Preview in app"
                      >
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={n.imageUrl}
                            alt=""
                            className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
                          <div className="absolute top-3 left-3">
                            <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-ink uppercase backdrop-blur">
                              {n.category}
                            </span>
                          </div>
                          <div className="absolute top-3 right-3 flex gap-1.5">
                            {sel?.isFeatured && (
                              <span className="rounded-full bg-violet px-2.5 py-1 text-[10px] font-extrabold text-white">
                                ★
                              </span>
                            )}
                            {inFeed && (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                                <Check size={13} strokeWidth={3} />
                              </span>
                            )}
                          </div>
                          <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-bold text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                            <Smartphone size={11} /> Preview
                          </span>
                        </div>

                        <div className="p-4 pb-3">
                          <h3 className="line-clamp-2 text-[14px] leading-snug font-bold">
                            {sel?.titleOverride ?? n.title}
                          </h3>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                            {sel?.summaryOverride ?? n.summary}
                          </p>
                        </div>
                      </button>

                      <div className="mt-auto px-4 pb-4">
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
                          <span>{timeAgo(n.publishedAt)}</span>
                        </div>
                        <div className="mt-1 truncate text-[11px] font-semibold text-muted">
                          {n.source}
                        </div>

                        {curator && (
                          <div className="mt-3 flex gap-2 border-t border-line pt-3">
                            <button
                              onClick={() => toggleFeed(n)}
                              className={`flex-1 py-2 text-xs ${
                                inFeed ? "btn-ghost" : "btn-primary"
                              }`}
                            >
                              {inFeed ? "In app feed" : "Add to feed"}
                            </button>
                            <button
                              onClick={() => toggleFeature(n)}
                              title={sel?.isFeatured ? "Unfeature" : "Feature"}
                              className={`btn-ghost flex h-9 w-9 items-center justify-center !p-0 ${
                                sel?.isFeatured
                                  ? "!border-violet !text-violet"
                                  : ""
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
          </div>

          {/* ── app feed panel ─────────────────────────────── */}
          <aside className="xl:sticky xl:top-4 xl:self-start">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold">App feed</h3>
                  <p className="text-[11px] text-muted">
                    {curator
                      ? "Drag or use ↑ ↓ to set order"
                      : "Live in DailyMattr"}
                  </p>
                </div>
                <Pill tone="accent">{data?.selections.length ?? 0}</Pill>
              </div>

              {!data || data.selections.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-bold">Feed is empty</p>
                  <p className="mt-1 text-xs text-muted">
                    {curator
                      ? "Add stories from the left to build today's feed."
                      : "Chief editors curate this list."}
                  </p>
                </div>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={data.selections}
                  onReorder={reorder}
                  className="max-h-[62vh] space-y-1 overflow-y-auto p-2"
                >
                  {data.selections.map((sel, idx) => {
                    const art = data.newsstudio.find(
                      (n) => n.id === sel.articleId
                    );
                    if (!art) return null;
                    return (
                      <Reorder.Item
                        key={sel.articleId}
                        value={sel}
                        drag={curator ? "y" : false}
                        dragListener={curator}
                        whileDrag={{
                          scale: 1.03,
                          boxShadow: "0 18px 40px rgba(20,20,23,0.18)",
                          zIndex: 5,
                        }}
                        className="group flex cursor-default items-center gap-2 rounded-2xl bg-white p-2 transition-colors hover:bg-canvas"
                      >
                        {curator && (
                          <div className="flex shrink-0 flex-col items-center">
                            <button
                              onClick={() => move(idx, -1)}
                              disabled={idx === 0}
                              title="Move up"
                              className="flex h-4 w-5 items-center justify-center rounded text-faint transition-colors hover:text-accent disabled:opacity-25 disabled:hover:text-faint"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <GripVertical
                              size={13}
                              className="cursor-grab text-faint/70 active:cursor-grabbing"
                            />
                            <button
                              onClick={() => move(idx, 1)}
                              disabled={idx === data.selections.length - 1}
                              title="Move down"
                              className="flex h-4 w-5 items-center justify-center rounded text-faint transition-colors hover:text-accent disabled:opacity-25 disabled:hover:text-faint"
                            >
                              <ChevronDown size={13} />
                            </button>
                          </div>
                        )}
                        <span className="w-4 shrink-0 text-center text-[11px] font-extrabold text-faint">
                          {idx + 1}
                        </span>
                        <button
                          onClick={() => setPreviewId(art.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={art.imageUrl}
                            alt=""
                            className="h-10 w-14 shrink-0 rounded-lg object-cover"
                          />
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-[11.5px] leading-snug font-bold">
                              {sel.titleOverride ?? art.title}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-faint">
                              {art.category}
                              {(sel.titleOverride || sel.summaryOverride) &&
                                " · edited"}
                            </span>
                          </span>
                        </button>
                        {curator && (
                          <div className="flex shrink-0 flex-col gap-0.5">
                            <button
                              onClick={() => toggleFeature(art)}
                              title={sel.isFeatured ? "Unfeature" : "Feature"}
                              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
                                sel.isFeatured
                                  ? "text-violet"
                                  : "text-faint opacity-0 group-hover:opacity-100 hover:text-ink"
                              }`}
                            >
                              {sel.isFeatured ? (
                                <Sparkles size={12} />
                              ) : (
                                <Star size={12} />
                              )}
                            </button>
                            <button
                              onClick={() => removeFromFeed(art)}
                              title="Remove from feed"
                              className="flex h-6 w-6 items-center justify-center rounded-lg text-faint opacity-0 transition-colors group-hover:opacity-100 hover:text-rose"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </Reorder.Item>
                    );
                  })}
                </Reorder.Group>
              )}
            </div>

            {curator && (
              <p className="mt-3 px-2 text-[11px] leading-relaxed text-faint">
                Order here is the order readers swipe through. Featured stories
                open the feed.
              </p>
            )}
          </aside>
        </div>
      ) : (
        /* ── written in studio ───────────────────────────── */
        <div className="space-y-3">
          {!data ? (
            [0, 1].map((i) => (
              <div key={i} className="card h-24 animate-pulse" />
            ))
          ) : data.written.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 p-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
                <Plus size={20} />
              </span>
              <p className="font-bold">No articles written yet</p>
              <p className="max-w-xs text-sm text-muted">
                Write an original 60-word story — it flows through QA before it
                reaches the app.
              </p>
              <Link
                href="/content/articles/editor"
                className="btn-primary mt-3 px-5 py-2.5 text-xs"
              >
                Write the first one
              </Link>
            </div>
          ) : (
            <AnimatePresence>
              {data.written.map((c, i) => (
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
                    </div>
                    <StatusPill status={c.status} />
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      <ArticlePreview
        article={previewArticle}
        selection={previewArticle ? selOf(previewArticle.id) : undefined}
        canEdit={curator}
        onClose={() => setPreviewId(null)}
        onSave={(patch) => previewArticle && saveOverrides(previewArticle, patch)}
        onToggleFeed={() => previewArticle && toggleFeed(previewArticle)}
        onToggleFeature={() => previewArticle && toggleFeature(previewArticle)}
      />
    </div>
  );
}
