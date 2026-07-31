"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, Calendar, Check, Clapperboard, Clock3, Edit3, Eye, Image as ImageIcon, Rocket, Sparkles, Star, Trash2, Undo2, X } from "lucide-react";
import { Pager } from "@/components/Pager";
import { PixCard, PixPreviewModal } from "@/components/PixCard";
import { QixCard } from "@/components/QixCard";
import { StatsStrip } from "@/components/StatsStrip";
import { TraxCard } from "@/components/TraxCard";
import { TraxAudioPlayer } from "@/components/TraxAudioPlayer";
import { Modal, Pill, SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { PAGE_SIZES, clampPage, pageCount } from "@/lib/paginate";
import { usePageParam } from "@/lib/usePageParam";
import {
  countContentByKind,
  deleteContent,
  listContentStats,
  setContentFeatured,
  statKey,
  listContentPage,
  listUsers,
  setContentStatus,
  type ContentBucket,
} from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/store";
import { useQuery } from "@/lib/useQuery";
import { mediaBlocker } from "@/lib/media";
import { estimateDurationSec } from "@/lib/tts";
import { ContentListSkeleton } from "@/components/PageSkeleton";
import {
  KIND_META,
  type ContentItem,
  type ContentKind,
  type ContentStats,
  type ContentStatus,
} from "@/lib/types";

const VALID: ContentKind[] = ["pix", "qix", "trax"];

type PixTab = "all" | "queue" | "feed";

const ICONS = { pix: ImageIcon, qix: Clapperboard, trax: AudioLines } as const;

const fmtDur = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 1) {
    return sec > 0 ? `${m}m ${sec}s` : `${m} min`;
  }
  return `${s}s`;
};

const getYoutubeId = (url: string | null) => {
  if (!url) return null;
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const beMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) return shortsMatch[1];
  if (watchMatch) return watchMatch[1];
  if (beMatch) return beMatch[1];
  return null;
};

/** The grid pager reads the query string — see the note on ArticlesPage. */
export default function KindListPage() {
  return (
    <Suspense fallback={<ContentListSkeleton />}>
      <KindList />
    </Suspense>
  );
}

function KindList() {
  const { kind: raw } = useParams<{ kind: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const kind = VALID.includes(raw as ContentKind) ? (raw as ContentKind) : null;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<PixTab>("all");
  const [page, setPage] = usePageParam();
  const [activeVideo, setActiveVideo] = useState<ContentItem | null>(null);

  useEffect(() => {
    if (!kind) router.replace("/dashboard");
  }, [kind, router]);

  useEffect(() => {
    if (activeVideo) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeVideo]);

  const size = PAGE_SIZES.pixGrid;

  /*
   * Every library is paged by the database — the tab filter, the slice, and
   * the three tab counts all resolve there, so the browser holds a page
   * rather than a library however large the table gets.
   */
  const { data, error, refetch } = useQuery(async () => {
    if (!kind) return null;
    const users = await listUsers();

    const bucket: ContentBucket =
      tab === "queue" ? "in_review" : tab === "feed" ? "published" : "all";
    const [slice, counts] = await Promise.all([
      listContentPage(kind, { page, size, bucket }),
      countContentByKind(kind),
    ]);
    const base = { rows: slice.rows, total: slice.total, counts };

    /* After the rows, not before: comment counts are asked for by id, so this
       needs to know what is on screen. Only for the roles allowed to see it —
       RLS would refuse anyone else anyway, and this avoids both a pointless
       round trip and a logged permission error for a request we knew would
       fail. Just the published ones, since only those carry a strip. */
    const stats =
      user && can.seeStats(user.role)
        ? await listContentStats(
            [],
            base.rows.filter((c) => c.status === "published").map((c) => c.id)
          )
        : new Map<string, ContentStats>();

    return { users, stats, ...base };
  }, [kind, page, size, tab]);

  const lastPage = data ? pageCount(data.total, size) : 1;
  // Approving the last item on a page — or a hand-typed ?page=99 — leaves the
  // URL pointing past the end. Walk it back rather than showing an empty grid.
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage, setPage]);

  if (error)
    return (
      <div className="card p-8 text-sm text-rose">
        Couldn&apos;t load content: {error}
      </div>
    );
  if (!user || !kind || !data) return <ContentListSkeleton />;
  const { users, counts, rows, stats } = data;
  const meta = KIND_META[kind];
  const Icon = ICONS[kind as keyof typeof ICONS];

  const isQix = kind === "qix";
  const isTrax = kind === "trax";
  const reviewer = can.review(user.role);
  const showStats = can.seeStats(user.role);
  const publisher = can.publish(user.role);

  /* Featuring is a publish-time decision, so it lives on the card rather than
     in the editor: the desk decides what leads while looking at what else is
     live, not while writing. */
  const feature = async (c: ContentItem) => {
    const next = !c.isFeatured;
    await toast.run(() => setContentFeatured(c.id, next), {
      success: next ? "Featured in the app" : "No longer featured",
      error: "Couldn't change that",
    });
    refetch();
  };

  const act = async (id: string, status: ContentStatus, n?: string) => {
    const item = rows.find((c) => c.id === id);
    const what = item ? `"${item.title}"` : "That item";
    const said: Record<string, string> = {
      draft: `${what} moved back to drafts`,
      in_review: `${what} sent for review`,
      approved: `${what} cleared review`,
      published: `${what} is live in the app`,
      rejected: `${what} sent back to the writer`,
    };

    // The publish trigger can refuse, and its message names the rule. That used
    // to arrive as a browser alert(), which blocks the page and reads like a
    // crash rather than a decision.
    await toast.run(() => setContentStatus(id, status, user, n), {
      success: said[status] ?? `${what} updated`,
      error: `Couldn't update ${what}`,
    });
    // A status change moves an item between tabs, so the counts move too.
    refetch();
  };

  // Every modal opens from a card that is on screen, so the page is enough.
  const preview = rows.find((c) => c.id === previewId) ?? null;
  const current = clampPage(page, data.total, size);
  // Pix, Qix, and Trax share the 9:16 poster-tile library grid UI.
  const cardGrid = kind === "pix" || kind === "qix" || kind === "trax";

  const GRID_TABS: [PixTab, string, number][] = [
    ["all", `All ${meta.label}`, counts.all],
    ...(reviewer
      ? ([["queue", "Awaiting QA", counts.inReview]] as [
          PixTab,
          string,
          number,
        ][])
      : []),
    ["feed", "App feed", counts.published],
  ];

  /**
   * QA / chief-editor controls. Edit leads, because anyone can now correct
   * anything — the decision buttons follow it rather than replacing it.
   */
  const reviewActions = (c: ContentItem) => (
    <>
      <Link
        href={`/content/${kind}/editor?id=${c.id}`}
        title={c.status === "published" ? "Edit the live story" : "Edit"}
        className="btn-ghost flex h-[26px] w-full items-center justify-center gap-1 py-1.5 text-[11px]"
      >
        <Edit3 size={11} /> Edit
      </Link>
      {c.status === "in_review" ? (
        <>
          <button
            onClick={() => act(c.id, "approved")}
            className="btn-primary flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 text-[11px]"
          >
            <Check size={11} strokeWidth={3} /> Approve
          </button>
          <button
            onClick={() => {
              setRejectId(c.id);
              setNote("");
            }}
            className="btn-ghost flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 text-[11px] !text-rose hover:!border-rose/40 hover:!bg-rose-tint"
          >
            <X size={11} strokeWidth={3} /> Decline
          </button>
        </>
      ) : c.status === "approved" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-mint-tint py-1.5 text-[11px] font-bold text-mint">
            <Check size={11} strokeWidth={3} /> Approved
          </span>
          <button
            onClick={() => act(c.id, "in_review")}
            title="Undo — send back to the queue"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0 hover:!text-rose"
          >
            <X size={11} />
          </button>
          {publisher && (
            <button
              onClick={() => act(c.id, "published")}
              className="btn-accent flex w-full items-center justify-center gap-1 py-1.5 text-[11px]"
            >
              <Rocket size={11} /> Publish to app
            </button>
          )}
        </>
      ) : c.status === "rejected" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-rose-tint py-1.5 text-[11px] font-bold text-rose">
            <X size={11} strokeWidth={3} /> Declined
          </span>
          <button
            onClick={() => act(c.id, "in_review")}
            title="Undo — put back in the queue"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0"
          >
            <Undo2 size={11} />
          </button>
        </>
      ) : c.status === "published" ? (
        <>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-canvas py-1.5 text-[11px] font-bold text-faint">
            Live in app
          </span>
          {/* Pulling a live Pix out of the app feed — QA only. */}
          <button
            onClick={() => setDeleteId(c.id)}
            aria-label={`Remove ${c.title} from the app feed`}
            title="Remove from app feed"
            className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0 text-rose hover:!border-rose/40 hover:!bg-rose-tint hover:text-rose"
          >
            <Trash2 size={11} />
          </button>
        </>
      ) : (
        <span className="flex flex-1 items-center justify-center gap-1 rounded-full bg-canvas py-1.5 text-[11px] font-bold text-faint">
          Not submitted
        </span>
      )}
      <button
        onClick={() => setPreviewId(c.id)}
        title="Preview"
        className="btn-ghost flex h-[26px] w-[26px] shrink-0 items-center justify-center !p-0"
      >
        <Eye size={11} />
      </button>
    </>
  );

  return (
    <div className="pb-10">
      <SectionHeader
        title={isQix ? "Qix Shorts Videos" : meta.label}
        sub={
          isQix
            ? "Short-form vertical video explainers for DailyMattr app."
            : `${meta.mode} · ${meta.tagline} for the DailyMattr app.`
        }
      >
        <div className="flex items-center gap-3">
          <Link
            href={`/content/${kind}/editor`}
            className="btn-primary px-5 py-2.5 text-sm shadow-md transition-all hover:scale-[1.02]"
          >
            + New {meta.label.replace(/s$/, "")}
          </Link>
        </div>
      </SectionHeader>

      {cardGrid && counts.all > 0 && (
        <div className="mb-5 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1 shadow-(--shadow-soft)">
          {GRID_TABS.map(([t, label, count]) => (
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
                  layoutId="pix-tab-active"
                  className="absolute inset-0 rounded-full bg-shell"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <span className="relative z-10">
                {label}
                <span className={tab === t ? "text-white/50" : "text-faint"}>
                  {" "}
                  · {count}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {counts.all === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
            <Icon size={22} />
          </span>
          <p className="font-bold">No {meta.label.toLowerCase()} yet</p>
          <p className="max-w-xs text-sm text-muted">
            Create the first one — it starts as a draft and flows through QA
            before publishing.
          </p>
        </div>
      ) : cardGrid ? (
        rows.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 p-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-tint text-mint">
              <Check size={20} />
            </span>
            <p className="font-bold">
              {tab === "queue" ? "Queue is clear" : "Nothing live yet"}
            </p>
            <p className="max-w-xs text-sm text-muted">
              {tab === "queue"
                ? `${meta.label} submitted by writers land here for review.`
                : `Approved ${meta.label} appear here once the chief editor publishes them.`}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {rows.map((c, i) => {
                const author = users.find((u) => u.id === c.createdBy)?.fullName;
                const actions = reviewer ? reviewActions(c) : undefined;
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4 }}
                  >
                    {isQix ? (
                      <QixCard
                        item={c}
                        author={author}
                        onView={() => setActiveVideo(c)}
                        actions={actions}
                      />
                    ) : isTrax ? (
                      <TraxCard
                        item={c}
                        author={author}
                        onView={() => setActiveVideo(c)}
                        actions={actions}
                      />
                    ) : (
                      <PixCard
                        item={c}
                        author={author}
                        onView={() => setPreviewId(c.id)}
                        actions={actions}
                      />
                    )}
                    {/* Under the tile rather than on it: these are numbers to
                        scan down a column, and laid over the poster they would
                        be one more thing competing with the artwork. Live
                        content only — a draft has no readers, so a row of
                        zeros would say nothing. */}
                    {showStats && c.status === "published" && (
                      <StatsStrip
                        stats={stats.get(statKey("cms", c.id))}
                        className="mt-1.5 justify-center px-1"
                      />
                    )}
                  </motion.div>
                );
              })}
            </div>
            <Pager
              page={current}
              total={data.total}
              size={size}
              onPage={setPage}
              label={meta.label}
            />
          </>
        )
      ) : (
        /* ── STANDARD LIST (TRAX) ────────────────────────────────────── */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c, i) => {
            const author = users.find((u) => u.id === c.createdBy);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4 }}
                className="relative"
              >
                {/* Outside the Link on purpose — the whole card is one, and a
                    button nested in an anchor is both invalid and unclickable. */}
                {publisher && c.status === "published" && (
                  <button
                    onClick={() => feature(c)}
                    title={c.isFeatured ? "Remove from featured" : "Feature in the app"}
                    className={`absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors ${
                      c.isFeatured
                        ? "bg-accent text-white"
                        : "bg-shell/70 text-white/70 hover:text-white"
                    }`}
                  >
                    {c.isFeatured ? <Sparkles size={14} /> : <Star size={14} />}
                  </button>
                )}
                <Link
                  href={`/content/${kind}/editor?id=${c.id}`}
                  className="card card-hover block overflow-hidden"
                >
                  <div className="relative">
                    {c.coverUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.coverUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-canvas text-faint">
                        <Icon size={28} />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <StatusPill status={c.status} />
                    </div>
                    {c.durationSec && (
                      <span className="absolute right-3 bottom-3 rounded-full bg-shell/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                        {fmtDur(c.durationSec)}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 text-[14px] leading-snug font-bold">
                      {c.title}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                      {c.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
                      <span>{author?.fullName ?? "—"}</span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={11} /> {timeAgo(c.updatedAt)}
                      </span>
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <Pill key={t} tone="muted">
                            #{t}
                          </Pill>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── QUICK SHORTS VIDEO MODAL ───────────────────────────────────── */}
      <AnimatePresence>
        {activeVideo && (
          <div
            onClick={() => setActiveVideo(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shell/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="relative flex flex-col md:flex-row w-full max-w-3xl overflow-hidden rounded-3xl bg-card shadow-pop max-h-[90vh]"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-shell/70 text-white backdrop-blur hover:bg-rose transition-colors"
              >
                <X size={18} />
              </button>

              {/* Media Player Column */}
              <div className="relative flex items-center justify-center bg-black md:w-1/2 aspect-[9/16] max-h-[70vh] md:max-h-[85vh] mx-auto overflow-hidden">
                {activeVideo.kind === "trax" || kind === "trax" ? (
                  <TraxAudioPlayer
                    item={activeVideo}
                    author={users.find((u) => u.id === activeVideo.createdBy)?.fullName}
                    onClose={() => setActiveVideo(null)}
                    onNext={() => {
                      const traxList = rows.filter((i) => i.kind === "trax");
                      const idx = traxList.findIndex((i) => i.id === activeVideo.id);
                      if (traxList.length > 0) {
                        const nextIdx = (idx + 1) % traxList.length;
                        setActiveVideo(traxList[nextIdx]);
                      }
                    }}
                    onPrevious={() => {
                      const traxList = rows.filter((i) => i.kind === "trax");
                      const idx = traxList.findIndex((i) => i.id === activeVideo.id);
                      if (traxList.length > 0) {
                        const prevIdx = (idx - 1 + traxList.length) % traxList.length;
                        setActiveVideo(traxList[prevIdx]);
                      }
                    }}
                  />
                ) : activeVideo.mediaUrl && getYoutubeId(activeVideo.mediaUrl) ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${getYoutubeId(activeVideo.mediaUrl)}?autoplay=1&mute=0&controls=1&loop=1`}
                    className="h-full w-full object-cover border-0"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : activeVideo.mediaUrl ? (
                  <video
                    src={activeVideo.mediaUrl}
                    poster={activeVideo.coverUrl ?? undefined}
                    controls
                    autoPlay
                    loop
                    className="h-full w-full object-cover"
                  />
                ) : activeVideo.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={activeVideo.coverUrl}
                    alt={activeVideo.title}
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/50">
                    <Clapperboard size={48} />
                    <span>No Video File Attached</span>
                  </div>
                )}
              </div>

              {/* Video Info Details Column */}
              <div className="flex flex-1 flex-col justify-between p-6 md:p-8 bg-card overflow-y-auto">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill status={activeVideo.status} />
                    {(() => {
                      const realSec =
                        activeVideo.kind === "trax" &&
                        (!activeVideo.mediaUrl || mediaBlocker("trax", activeVideo.mediaUrl))
                          ? estimateDurationSec(activeVideo.summary || "")
                          : activeVideo.durationSec;
                      return realSec ? (
                        <span className="rounded-full bg-tint px-3 py-1 text-xs font-bold text-accent">
                          ⏱️ {fmtDur(realSec)}
                        </span>
                      ) : null;
                    })()}
                  </div>

                  <h2 className="text-xl font-bold text-ink leading-snug">
                    {activeVideo.title}
                  </h2>

                  {/* Date & Time Metadata */}
                  <div className="rounded-2xl bg-canvas p-3.5 text-xs text-muted space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-ink">
                      <Calendar size={14} className="text-accent" />
                      <span>
                        Created: {formatDateTime(activeVideo.publishedAt || activeVideo.updatedAt || activeVideo.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-faint">
                      <Clock3 size={14} />
                      <span>Updated {timeAgo(activeVideo.updatedAt)}</span>
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-muted">
                    {activeVideo.summary}
                  </p>

                  {activeVideo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {activeVideo.tags.map((t) => (
                        <Pill key={t} tone="accent">
                          #{t}
                        </Pill>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center gap-3 pt-4 border-t border-line">
                  <Link
                    href={`/content/${activeVideo.kind || kind}/editor?id=${activeVideo.id}`}
                    onClick={() => setActiveVideo(null)}
                    className="btn-accent flex-1 flex items-center justify-center gap-2 py-3 text-sm"
                  >
                    <Edit3 size={15} /> Edit in CMS Editor
                  </Link>
                  <button
                    type="button"
                    onClick={() => setActiveVideo(null)}
                    className="btn-ghost px-5 py-3 text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {kind === "pix" && (
        <>
          <PixPreviewModal
            item={preview}
            onClose={() => setPreviewId(null)}
            actions={
              reviewer && preview?.status === "in_review" ? (
                <>
                  <button
                    onClick={() => {
                      setRejectId(preview.id);
                      setNote("");
                      setPreviewId(null);
                    }}
                    className="btn-ghost flex items-center gap-1.5 px-4 py-2.5 text-sm !text-rose"
                  >
                    <X size={14} /> Decline
                  </button>
                  <button
                    onClick={() => {
                      act(preview.id, "approved");
                      setPreviewId(null);
                    }}
                    className="btn-primary flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
                  >
                    <Check size={14} strokeWidth={3} /> Approve
                  </button>
                </>
              ) : reviewer && preview?.status === "approved" && publisher ? (
                <button
                  onClick={() => {
                    act(preview.id, "published");
                    setPreviewId(null);
                  }}
                  className="btn-accent flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
                >
                  <Rocket size={14} /> Publish to app
                </button>
              ) : reviewer ? null : (
                <Link
                  href={`/content/pix/editor?id=${previewId}`}
                  className="btn-primary flex-1 px-4 py-2.5 text-center text-sm"
                >
                  Edit this Pix
                </Link>
              )
            }
          />
        </>
      )}

      {/* Declining and deleting are not Pix features.
          These two sat inside the `kind === "pix"` block along with the Pix
          poster preview, which is genuinely Pix-only. So on Qix and Trax the
          trash button set `deleteId` and nothing rendered it: no dialog, no
          error, no delete — a button that did nothing at all, on the two
          libraries where the junk rows actually accumulated. */}
      <RejectWithNote
        item={rows.find((c) => c.id === rejectId) ?? null}
        note={note}
        onNote={setNote}
        onClose={() => setRejectId(null)}
        onConfirm={(id) => {
          act(id, "rejected", note || undefined);
          setRejectId(null);
        }}
      />
      <ConfirmDelete
        kind={kind}
        item={rows.find((c) => c.id === deleteId) ?? null}
        onClose={() => setDeleteId(null)}
        onConfirm={async (id) => {
          /* Surface a refusal rather than closing as though it worked.
             RLS lets a writer delete only their own drafts; anything else is
             an admin's to remove. PostgREST answers a filtered-out delete with
             success and zero rows, so without this the dialog would close on a
             row that is still there. */
          const item = rows.find((c) => c.id === id);
          const what = item ? `"${item.title}"` : "That item";
          const ok = await toast.run(() => deleteContent(id, user), {
            success: `${what} deleted`,
            error: `Couldn't delete ${what}`,
          });
          if (!ok) return;
          setDeleteId(null);
          setPreviewId((p) => (p === id ? null : p));
          refetch();
        }}
      />
    </div>
  );
}

function RejectWithNote({
  item,
  note,
  onNote,
  onClose,
  onConfirm,
}: {
  item: ContentItem | null;
  note: string;
  onNote: (v: string) => void;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Modal open={!!item} onClose={onClose} title="Decline with a note">
      {item && (
        <div>
          <p className="mb-3 text-sm text-muted">
            Tell the writer what to fix on{" "}
            <span className="font-bold text-ink">{item.title}</span>
            {" — they'll see this on the draft."}
          </p>
          <textarea
            className="field min-h-24"
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="e.g. Point 2 needs a source — confirm the fare cap with the metro press note."
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost px-4 py-2 text-xs">
              Cancel
            </button>
            <button
              onClick={() => onConfirm(item.id)}
              className="btn-primary px-4 py-2 text-xs !bg-rose hover:!bg-rose"
            >
              Decline Pix
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ConfirmDelete({
  kind,
  item,
  onClose,
  onConfirm,
}: {
  kind: ContentKind;
  item: ContentItem | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  // "Delete Pix?" over a video was a leftover from when this dialog was only
  // ever reachable from the Pix library.
  const noun = KIND_META[kind].label.replace(/s$/, "");
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={
        item?.status === "published"
          ? "Remove from the app feed?"
          : `Delete this ${noun}?`
      }
    >
      {item && (
        <div>
          <p className="text-sm text-muted">
            <span className="font-bold text-ink">{item.title}</span>{" "}
            {item.status === "published"
              ? "is live in the app. Deleting pulls it from the feed for every reader and removes it here too. This can't be undone."
              : "will be removed permanently. This can't be undone."}
          </p>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => onConfirm(item.id)}
              className="flex-1 rounded-full bg-rose px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 active:scale-[0.97]"
            >
              {item.status === "published"
                ? "Remove from the feed"
                : "Delete permanently"}
            </button>
            <button onClick={onClose} className="btn-ghost px-5 py-2.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

