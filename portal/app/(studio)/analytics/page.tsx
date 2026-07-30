"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Bookmark,
  Eye,
  Heart,
  MessageCircle,
  Search,
  Share2,
  ThumbsDown,
} from "lucide-react";
import { Pager } from "@/components/Pager";
import { Pill, SectionHeader } from "@/components/ui";
import { fmt } from "@/components/StatsStrip";
import { can, useAuth } from "@/lib/auth";
import { useQuery } from "@/lib/useQuery";
import { listContentCovers } from "@/lib/db";
import { PAGE_SIZES, clampPage, pageSlice } from "@/lib/paginate";
import { usePageParam } from "@/lib/usePageParam";
import { timeAgo } from "@/lib/store";
import {
  KIND_LABEL,
  SORTS,
  loadAnalytics,
  sortRows,
  totals,
  type AnalyticsRow,
  type MetricKey,
  type RowKind,
  type SortKey,
} from "@/lib/analytics";

/* What readers did, across everything.
 *
 * The per-format pages each show their own half of the picture, which is fine
 * for editing and useless for judging: "did this land?" is a question about
 * one story against all the others, not against the four Qix next to it. This
 * is the one screen that puts a Pix, a Trax and a wire article in the same
 * ranking.
 *
 * Counted by device — the app has no accounts — so these are phones, not
 * people. Said once here in the header rather than in a tooltip per number.
 */

const FILTERS: { key: RowKind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "feed", label: "Feed" },
  { key: "article", label: "Articles" },
  { key: "pix", label: "Pix" },
  { key: "qix", label: "Qix" },
  { key: "trax", label: "Trax" },
];

const COLS: { key: MetricKey; icon: typeof Eye; label: string }[] = [
  { key: "views", icon: Eye, label: "Opened" },
  { key: "likes", icon: Heart, label: "Liked" },
  { key: "dislikes", icon: ThumbsDown, label: "Disliked" },
  { key: "comments", icon: MessageCircle, label: "Comments" },
  { key: "saves", icon: Bookmark, label: "Saved" },
  { key: "shares", icon: Share2, label: "Shared" },
];

/** The pager reads the query string — see the note on ArticlesPage. */
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <AnalyticsTable />
    </Suspense>
  );
}

function TableSkeleton() {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-canvas" />
      ))}
    </div>
  );
}

function AnalyticsTable() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<RowKind | "all">("all");
  const [sort, setSort] = useState<SortKey>("actions");
  const [term, setTerm] = useState("");
  const [page, setPage] = usePageParam();

  const { data, error } = useQuery(() => loadAnalytics());

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = term.trim().toLowerCase();
    const kept = all.filter(
      (r) =>
        (filter === "all" || r.kind === filter) &&
        (!q ||
          r.title.toLowerCase().includes(q) ||
          r.meta.toLowerCase().includes(q))
    );
    return sortRows(kept, sort);
  }, [data, filter, sort, term]);

  const sums = useMemo(() => totals(rows), [rows]);

  /* Totals above are deliberately computed from every filtered row, not from
     the page — a figure that counted only what happens to be on screen would
     be read as a total and be wrong. */
  const size = PAGE_SIZES.analyticsRows;
  const current = clampPage(page, rows.length, size);
  const pageRows = pageSlice(rows, page, size);

  /* Covers for the twenty rows on screen, not for the whole table. Some of
     them are inlined base64 and run to megabytes each, so fetching the set
     the table ranks over would dwarf everything else on the page. */
  const coverIds = pageRows
    .filter((r) => r.source === "cms")
    .map((r) => r.id)
    .join(",");
  const { data: covers } = useQuery(
    () => listContentCovers(coverIds ? coverIds.split(",") : []),
    [coverIds]
  );

  /** Narrowing the list invalidates the page number, so start over. */
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

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

  if (!data) return <TableSkeleton />;

  const headline: [string, number][] = [
    ["Opened", sums.views],
    ["Liked", sums.likes],
    ["Comments", sums.comments],
    ["Saved", sums.saves],
    ["Shared", sums.shares],
    ["Disliked", sums.dislikes],
  ];

  return (
    <>
      <SectionHeader
        title="Analytics"
        sub="Counted by device — the app has no accounts, so these are phones rather than people. Live content only."
      />

      {/* Totals follow the filter, not the whole library. A number that ignores
          the filter above it invites the wrong comparison. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {headline.map(([label, n]) => (
          <div key={label} className="card p-4">
            <div className="text-[11px] font-semibold tracking-wide text-faint uppercase">
              {label}
            </div>
            <div className="mt-1 text-2xl font-extrabold tabular-nums">
              {fmt(n)}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => reset(setFilter)(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
              filter === f.key
                ? "bg-accent text-white"
                : "border border-line text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <input
              value={term}
              onChange={(e) => reset(setTerm)(e.target.value)}
              placeholder="Search title or source…"
              className="w-56 rounded-full border border-line bg-transparent py-1.5 pr-3 pl-8 text-xs font-semibold outline-none focus:border-accent"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => reset(setSort)(e.target.value as SortKey)}
            className="rounded-full border border-line bg-transparent px-3 py-1.5 text-xs font-bold outline-none focus:border-accent"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          Nothing matches that.
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* The header doubles as the sort control — clicking a metric ranks
              by it, which is the thing you want the moment you read one. */}
          <div className="hidden items-center gap-4 border-b border-line px-4 py-2.5 md:flex">
            <span className="flex-1 text-[11px] font-bold tracking-wide text-faint uppercase">
              Story
            </span>
            {COLS.map((c) => (
              <button
                key={c.key}
                onClick={() => reset(setSort)(c.key)}
                title={`Sort by ${c.label.toLowerCase()}`}
                className={`w-14 text-center text-[11px] font-bold tracking-wide uppercase transition-colors ${
                  sort === c.key ? "text-accent" : "text-faint hover:text-ink"
                }`}
              >
                <c.icon size={12} className="mx-auto" />
              </button>
            ))}
            <span className="w-20 text-right text-[11px] font-bold tracking-wide text-faint uppercase">
              Live
            </span>
          </div>

          <div className="divide-y divide-line">
            {pageRows.map((r, i) => (
              <Row
                key={r.key}
                row={r}
                index={i}
                sort={sort}
                cover={r.coverUrl ?? covers?.get(r.id) ?? null}
              />
            ))}
          </div>
        </div>
      )}

      <Pager
        page={current}
        total={rows.length}
        size={size}
        onPage={setPage}
        label="stories"
      />
    </>
  );
}

function Row({
  row,
  index,
  sort,
  cover,
}: {
  row: AnalyticsRow;
  index: number;
  sort: SortKey;
  /** Resolved by the page: feed rows carry theirs, CMS rows are fetched. */
  cover: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.012, 0.2), duration: 0.28 }}
    >
      <Link
        href={`/analytics/${row.source}/${row.id}`}
        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas"
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-11 w-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="h-11 w-16 shrink-0 rounded-lg bg-canvas" />
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-1.5">
            <Pill tone={row.kind === "feed" ? "muted" : "accent"}>
              {KIND_LABEL[row.kind]}
            </Pill>
            <span className="truncate text-[11px] text-faint">{row.meta}</span>
          </div>
          <p className="truncate text-[13px] font-bold">{row.title}</p>
        </div>

        {COLS.map((c) => {
          const n = row.stats[c.key];
          return (
            <span
              key={c.key}
              title={c.label}
              className={`hidden w-14 text-center text-[13px] font-bold tabular-nums md:block ${
                sort === c.key
                  ? "text-accent"
                  : n > 0
                    ? "text-ink"
                    : "text-faint"
              }`}
            >
              {fmt(n)}
            </span>
          );
        })}

        <span className="hidden w-20 text-right text-[11px] text-faint md:block">
          {row.liveAt ? timeAgo(row.liveAt) : "—"}
        </span>
      </Link>
    </motion.div>
  );
}
