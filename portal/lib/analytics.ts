import {
  EMPTY_STATS,
  getNewsStudioByIds,
  listContentStats,
  listPublishedLite,
  listSelections,
  statKey,
} from "@/lib/db";
import type { ContentKind, ContentStats, StatsSource } from "@/lib/types";

/* One list of everything readers can reach, with what they did to it.
 *
 * The Studio's content lives in two Supabase projects — Pix, Qix, Trax and
 * desk-written articles in `content_items`, the NewsStudio feed in DB A — and
 * until now each page only knew about its own half. Analytics is the one place
 * that has to see all of it at once, so the joining happens here rather than
 * being repeated by every screen that wants to rank something.
 *
 * Only live content is included. A draft has no readers, so a row of zeros on
 * one is not a weak result, it is a category error — and mixing the two makes
 * every average wrong.
 */

/** `feed` is a NewsStudio article approved into the app; the rest are ours. */
export type RowKind = ContentKind | "feed";

export interface AnalyticsRow {
  /** `statKey(source, id)` — unique across both projects. */
  key: string;
  source: StatsSource;
  id: string;
  kind: RowKind;
  title: string;
  coverUrl: string | null;
  /** Publisher for feed rows, category for ours. Whatever identifies it fast. */
  meta: string;
  /** When it reached readers. Null when the row never recorded one. */
  liveAt: string | null;
  /**
   * The same instant as a number, which is what every sort here uses.
   *
   * These were ordered by localeCompare on the ISO strings. That is not
   * codepoint order — ICU collation deprioritises punctuation — so a timestamp
   * Postgres renders without a fractional part, because it landed exactly on a
   * second, compares as *later* than one with a fraction in the same second.
   *
   * Nothing is misordered today: every row in both databases currently carries
   * a fraction, and 200,000 random pairs of that shape agree with chronological
   * order. It waits for one seeded, backfilled or literal timestamp to land on
   * a whole second, and then quietly puts a story in the wrong place with
   * nothing to indicate it.
   *
   * Computed once per row rather than parsed inside the comparator, which would
   * parse the same string on the order of n log n times.
   */
  liveAtMs: number;
  stats: ContentStats;
  /** Everything that took a deliberate tap. Views are not a decision. */
  actions: number;
}

export const KIND_LABEL: Record<RowKind, string> = {
  article: "Article",
  pix: "Pix",
  qix: "Qix",
  trax: "Trax",
  feed: "Feed",
};

const actionsOf = (s: ContentStats) =>
  s.likes + s.dislikes + s.comments + s.saves + s.shares;

/**
 * An instant as a number, or -Infinity when there is not one.
 *
 * A row with no date sorts to the bottom under every ordering rather than
 * landing wherever an empty string happens to fall.
 */
const msOf = (iso: string | null): number => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/**
 * Everything live, newest first, each with its numbers.
 *
 * Resolves to an empty list rather than throwing when the caller cannot read
 * stats — the page is gated on the same permission, so this is belt and braces
 * for a role that reaches the route some other way.
 */
export async function loadAnalytics(): Promise<AnalyticsRow[]> {
  const [content, selections] = await Promise.all([
    listPublishedLite(),
    listSelections(),
  ]);

  /* Both of these need the selection ids, so they wait on that one call and
     then run together — comment counts live in DB A and are asked for by id. */
  const feedIds = selections.map((s) => s.articleId);
  const liveCmsIds = content.map((c) => c.id);
  const [feedArticles, stats] = await Promise.all([
    getNewsStudioByIds(feedIds),
    listContentStats(feedIds, liveCmsIds),
  ]);
  const bySelection = new Map(selections.map((s) => [s.articleId, s]));

  const rows: AnalyticsRow[] = [];

  for (const c of content) {
    const key = statKey("cms", c.id);
    const s = stats.get(key) ?? EMPTY_STATS;
    rows.push({
      key,
      source: "cms",
      id: c.id,
      kind: c.kind,
      title: c.title,
      // Filled in for the visible page only — see listPublishedLite.
      coverUrl: null,
      meta: c.categorySlug ?? "Uncategorised",
      liveAt: c.publishedAt ?? c.updatedAt,
      liveAtMs: msOf(c.publishedAt ?? c.updatedAt),
      stats: s,
      actions: actionsOf(s),
    });
  }

  for (const a of feedArticles) {
    const key = statKey("pipeline", a.id);
    const s = stats.get(key) ?? EMPTY_STATS;
    rows.push({
      key,
      source: "pipeline",
      id: a.id,
      kind: "feed",
      title: a.title,
      coverUrl: a.imageUrl || null,
      meta: a.source,
      // Approval is when it reached the app, which is later than publication
      // by the wire and is the date the desk actually acted on.
      liveAt: bySelection.get(a.id)?.approvedAt ?? a.publishedAt,
      liveAtMs: msOf(bySelection.get(a.id)?.approvedAt ?? a.publishedAt),
      stats: s,
      actions: actionsOf(s),
    });
  }

  rows.sort((x, y) => y.liveAtMs - x.liveAtMs);
  return rows;
}

/* The metrics that are literally columns on a stats row. Separate from
   SortKey because "recent" and "actions" are derived — indexing ContentStats
   with either would be a lie the compiler is right to reject. */
export type MetricKey =
  | "views"
  | "likes"
  | "dislikes"
  | "comments"
  | "saves"
  | "shares";

export type SortKey =
  | "recent"
  | "views"
  | "likes"
  | "dislikes"
  | "comments"
  | "saves"
  | "shares"
  | "actions";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Newest" },
  { key: "actions", label: "Most engaged" },
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "dislikes", label: "Dislikes" },
  { key: "comments", label: "Comments" },
  { key: "saves", label: "Saves" },
  { key: "shares", label: "Shares" },
];

export function sortRows(rows: AnalyticsRow[], by: SortKey): AnalyticsRow[] {
  const out = [...rows];
  if (by === "recent") {
    out.sort((x, y) => y.liveAtMs - x.liveAtMs);
    return out;
  }
  const val = (r: AnalyticsRow) =>
    by === "actions" ? r.actions : r.stats[by as MetricKey];
  /* Ties broken by recency rather than left in whatever order the two fetches
     happened to interleave — otherwise the long tail of zeros reshuffles on
     every refetch and the page looks like it is churning. */
  out.sort((x, y) => val(y) - val(x) || y.liveAtMs - x.liveAtMs);
  return out;
}

/** Totals across whatever is currently in view, for the header. */
export function totals(rows: AnalyticsRow[]) {
  return rows.reduce(
    (t, r) => ({
      views: t.views + r.stats.views,
      likes: t.likes + r.stats.likes,
      dislikes: t.dislikes + r.stats.dislikes,
      comments: t.comments + r.stats.comments,
      saves: t.saves + r.stats.saves,
      shares: t.shares + r.stats.shares,
    }),
    { views: 0, likes: 0, dislikes: 0, comments: 0, saves: 0, shares: 0 }
  );
}
