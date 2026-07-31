"use client";

/**
 * Supabase data access for the CMS.
 *
 * The single place the portal talks to Postgres. Pages call these through
 * useQuery; nothing reads or writes browser storage.
 *
 * Column names are snake_case in Postgres and camelCase in the app; the row
 * mappers below are the only place that translation lives.
 */

import { localMediaPath, mediaBlocker, rehostable } from "./media";
import { COVERS, MEDIA, uploadBlob, uploadDataUrl } from "./storage";
import { newsstudio, supabase } from "./supabase";
import type {
  ArticleSelection,
  AuditEntry,
  Category,
  CmsUser,
  ContentItem,
  ContentKind,
  ContentComment,
  ContentStats,
  StatsSource,
  ContentStatus,
  NewsStudioArticle,
  UserPerformance,
} from "./types";

// ── row mappers ─────────────────────────────────────────────────────
type Row = Record<string, unknown>;

const toUser = (r: Row): CmsUser => ({
  id: r.id as string,
  email: r.email as string,
  fullName: r.full_name as string,
  role: r.role as CmsUser["role"],
  languages: (r.languages as string[]) ?? [],
  states: (r.states as string[]) ?? [],
  isActive: r.is_active as boolean,
  avatarHue: (r.avatar_hue as number) ?? 220,
});

const toCategory = (r: Row): Category => ({
  slug: r.slug as string,
  name: r.name as string,
  kind: (r.kind as ContentKind | null) ?? null,
  sortOrder: (r.sort_order as number) ?? 0,
  isActive: r.is_active as boolean,
});

const toContent = (r: Row): ContentItem => ({
  id: r.id as string,
  kind: r.kind as ContentKind,
  title: r.title as string,
  slug: r.slug as string,
  summary: (r.summary as string) ?? "",
  body: (r.body as Record<string, unknown>) ?? {},
  categorySlug: (r.category_slug as string | null) ?? null,
  tags: (r.tags as string[]) ?? [],
  language: (r.language as string) ?? "en",
  state: (r.state as string | null) ?? null,
  coverUrl: (r.cover_url as string | null) ?? null,
  coverMasterUrl: (r.cover_master_url as string | null) ?? null,
  mediaUrl: (r.media_url as string | null) ?? null,
  durationSec: (r.duration_sec as number | null) ?? null,
  sourceLinks: (r.source_links as { title: string; url: string }[]) ?? [],
  factScore: (r.fact_score as number | null) ?? null,
  factLabel: (r.fact_label as string | null) ?? null,
  isFeatured: !!r.is_featured,
  source: (r.source as "cms" | "newsstudio") ?? "cms",
  sourceArticleId: (r.source_article_id as string | null) ?? null,
  status: r.status as ContentStatus,
  reviewNote: (r.review_note as string | null) ?? null,
  createdBy: r.created_by as string,
  reviewedBy: (r.reviewed_by as string | null) ?? null,
  publishedBy: (r.published_by as string | null) ?? null,
  scheduledAt: (r.scheduled_at as string | null) ?? null,
  publishedAt: (r.published_at as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

/** App-shaped payload → snake_case row. Undefined keys are left untouched. */
const fromContent = (c: Partial<ContentItem>): Row => {
  const r: Row = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined) r[k] = v;
  };
  put("kind", c.kind);
  put("title", c.title);
  put("slug", c.slug);
  put("summary", c.summary);
  put("body", c.body);
  put("category_slug", c.categorySlug);
  put("tags", c.tags);
  put("language", c.language);
  put("state", c.state);
  put("cover_url", c.coverUrl);
  put("cover_master_url", c.coverMasterUrl);
  put("media_url", c.mediaUrl);
  put("duration_sec", c.durationSec);
  put("source_links", c.sourceLinks);
  put("fact_score", c.factScore);
  put("fact_label", c.factLabel);
  put("is_featured", c.isFeatured);
  put("source", c.source);
  put("source_article_id", c.sourceArticleId);
  put("status", c.status);
  put("review_note", c.reviewNote);
  put("created_by", c.createdBy);
  put("reviewed_by", c.reviewedBy);
  put("published_by", c.publishedBy);
  put("scheduled_at", c.scheduledAt);
  put("published_at", c.publishedAt);
  return r;
};

const toSelection = (r: Row, index: number): ArticleSelection => ({
  articleId: r.article_id as string,
  // Feed order is approval order, so position is derived on read — never stored.
  position: index + 1,
  isFeatured: r.is_featured as boolean,
  approvedBy: r.approved_by as string,
  approvedAt: r.approved_at as string,
  titleOverride: (r.title_override as string | null) ?? null,
  summaryOverride: (r.summary_override as string | null) ?? null,
  imageOverride: (r.image_override as string | null) ?? null,
  modesOverride:
    (r.modes_override as ArticleSelection["modesOverride"]) ?? null,
});

const toAudit = (r: Row): AuditEntry => ({
  id: String(r.id),
  actorId: (r.actor_id as string) ?? "",
  actorName: r.actor_name as string,
  action: r.action as string,
  entity: r.entity as string,
  entityTitle: r.entity_title as string,
  createdAt: r.created_at as string,
});

const fail = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

// ── users ───────────────────────────────────────────────────────────
export async function listUsers(): Promise<CmsUser[]> {
  const { data, error } = await supabase
    .from("cms_users")
    .select("*")
    .order("created_at");
  fail("listUsers", error);
  return (data ?? []).map(toUser);
}

export async function updateUser(id: string, patch: Partial<CmsUser>) {
  const row: Row = {};
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  const { error } = await supabase.from("cms_users").update(row).eq("id", id);
  fail("updateUser", error);
}

export async function inviteUser(u: Omit<CmsUser, "id">) {
  const { data, error } = await supabase
    .from("cms_users")
    .insert({
      email: u.email,
      full_name: u.fullName,
      role: u.role,
      languages: u.languages,
      states: u.states,
      is_active: u.isActive,
      avatar_hue: u.avatarHue,
    })
    .select()
    .single();
  fail("inviteUser", error);
  return toUser(data as Row);
}

/** Per-person performance, aggregated by the user_performance view. */
export async function listPerformance(): Promise<UserPerformance[]> {
  const { data, error } = await supabase
    .from("user_performance")
    .select("*")
    .order("created_total", { ascending: false });
  fail("listPerformance", error);
  return (data ?? []).map((r: Row) => ({
    id: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    role: r.role as CmsUser["role"],
    isActive: r.is_active as boolean,
    avatarHue: (r.avatar_hue as number) ?? 220,
    createdTotal: Number(r.created_total ?? 0),
    createdArticles: Number(r.created_articles ?? 0),
    createdPix: Number(r.created_pix ?? 0),
    createdQix: Number(r.created_qix ?? 0),
    createdTrax: Number(r.created_trax ?? 0),
    inDraft: Number(r.in_draft ?? 0),
    awaitingReview: Number(r.awaiting_review ?? 0),
    sentBack: Number(r.sent_back ?? 0),
    clearedReview: Number(r.cleared_review ?? 0),
    live: Number(r.live ?? 0),
    reviewed: Number(r.reviewed ?? 0),
    publishedByThem: Number(r.published_by_them ?? 0),
    articlesApproved: Number(r.articles_approved ?? 0),
    lastTouched: (r.last_touched as string | null) ?? null,
  }));
}

// ── categories ──────────────────────────────────────────────────────
export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order");
  fail("listCategories", error);
  return (data ?? []).map(toCategory);
}

export async function addCategory(c: Category) {
  const { error } = await supabase.from("categories").insert({
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    sort_order: c.sortOrder,
    is_active: c.isActive,
  });
  fail("addCategory", error);
}

export async function setCategoryActive(slug: string, isActive: boolean) {
  const { error } = await supabase
    .from("categories")
    .update({ is_active: isActive })
    .eq("slug", slug);
  fail("setCategoryActive", error);
}

export async function removeCategory(slug: string) {
  const { error } = await supabase.from("categories").delete().eq("slug", slug);
  fail("removeCategory", error);
}

// ── content ─────────────────────────────────────────────────────────
export async function listContent(kind?: ContentKind): Promise<ContentItem[]> {
  let q = supabase.from("content_items").select("*");
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q.order("updated_at", { ascending: false });
  fail("listContent", error);
  return (data ?? []).map(toContent);
}

/** A live item as a ranking table needs it: enough to label a row, no more. */
export type PublishedLite = {
  id: string;
  kind: ContentKind;
  title: string;
  categorySlug: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

/**
 * Every live CMS item, without the heavy columns.
 *
 * `cover_url` is left out deliberately. Fifteen of the rows currently hold
 * their cover inlined as a base64 data URL rather than a link to storage —
 * 4 MB between them, one of them 2 MB on its own. Selecting `*` to build a
 * table of 64-pixel thumbnails downloads every byte of that, and the numbers
 * the table actually ranks by are a few hundred bytes. So the list comes back
 * without covers and `listContentCovers` fetches them for the rows on screen.
 *
 * Ranged rather than limited, because PostgREST caps a response at its
 * max-rows setting and would otherwise truncate in silence.
 */
export async function listPublishedLite(): Promise<PublishedLite[]> {
  const rows: Row[] = [];
  const CHUNK = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from("content_items")
      .select("id,kind,title,category_slug,published_at,updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rows.length, rows.length + CHUNK - 1);
    fail("listPublishedLite", error);

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < CHUNK) break;
  }

  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as ContentKind,
    title: r.title as string,
    categorySlug: (r.category_slug as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    updatedAt: r.updated_at as string,
  }));
}

/**
 * Covers for specific items, so a list can pay for the ones it shows.
 *
 * Chunked small on purpose: these are the megabyte-sized values, so a URL
 * asking for fifty of them is already a big enough response.
 */
export async function listContentCovers(
  ids: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const CHUNK = 50;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("content_items")
      .select("id,cover_url")
      .in("id", ids.slice(i, i + CHUNK));
    fail("listContentCovers", error);
    for (const r of (data ?? []) as Row[]) {
      out.set(r.id as string, (r.cover_url as string | null) ?? null);
    }
  }

  return out;
}

export async function getContentItem(id: string): Promise<ContentItem | null> {
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  fail("getContentItem", error);
  return data ? toContent(data as Row) : null;
}

export async function createContent(item: Partial<ContentItem>) {
  const { data, error } = await supabase
    .from("content_items")
    .insert(fromContent(item))
    .select()
    .single();
  fail("createContent", error);
  return toContent(data as Row);
}

export async function deleteContent(id: string, actor: CmsUser) {
  const item = await getContentItem(id);

  /* `.select()` so the refusal is visible.
   *
   * A delete the row-level policy filters out is not an error — PostgREST
   * answers 204 with nothing deleted, `error` stays null, and the caller has
   * no way to tell success from "you are not allowed to". Asking for the
   * deleted rows back turns that into an empty array, which is checkable.
   *
   * The policy permits your own drafts, and anything at all for a super
   * admin; a writer aiming at someone else's published item lands here. */
  const { data, error } = await supabase
    .from("content_items")
    .delete()
    .eq("id", id)
    .select("id");
  fail("deleteContent", error);

  if (!data?.length) {
    throw new Error(
      item && item.status !== "draft"
        ? `"${item.title || "That item"}" is ${item.status.replace("_", " ")}, so only a super admin can delete it. Ask one, or send it back to draft first.`
        : "You can only delete your own drafts — ask a super admin to remove this one."
    );
  }

  if (item) await logAudit(actor, "deleted", item.kind, item.title);
}

/** One page of a library, plus how many rows are in the bucket. */
export type ContentPage = { rows: ContentItem[]; total: number };

/** The status buckets the library tabs page through. */
export type ContentBucket = "all" | "in_review" | "published";

/**
 * One page of a content library, filtered and counted by the database.
 *
 * The libraries used to load every item of a kind and slice in the browser,
 * which is fine at fifty rows and stops being fine long before it becomes
 * visibly slow. Paging here means the page stays the same size as the
 * library grows.
 *
 * Ordered by `updated_at` rather than the client's old
 * coalesce(published_at, updated_at, created_at): publishing writes both, and
 * `updated_at` lands last, so the resulting order matches — and unlike a
 * coalesce it can be paged consistently. `id` breaks ties, because two rows
 * sharing a timestamp have no inherent order, and an unstable order across
 * requests is how a row shows up on two pages or on neither.
 */
export async function listContentPage(
  kind: ContentKind,
  {
    page = 1,
    size = 10,
    bucket = "all",
    search = "",
  }: {
    page?: number;
    size?: number;
    bucket?: ContentBucket;
    search?: string;
  } = {}
): Promise<ContentPage> {
  let q = supabase
    .from("content_items")
    .select("*", { count: "exact" })
    .eq("kind", kind);
  if (bucket !== "all") q = q.eq("status", bucket);

  /* Searched in the database, like the NewsStudio grid, because the browser
     only ever holds one page — filtering here would search the page rather
     than the library, which is the opposite of what a search is for.

     Title and summary only: `tags` is an array column and ilike cannot reach
     into it, so a tag search would need a different operator and silently
     match nothing in the meantime. */
  const term = searchTerm(search);
  if (term) {
    q = q.or(["title", "summary"].map((c) => `${c}.ilike.*${term}*`).join(","));
  }

  const from = (Math.max(1, page) - 1) * size;
  const { data, error, count } = await q
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + size - 1);
  fail("listContentPage", error);

  return { rows: (data ?? []).map(toContent), total: count ?? 0 };
}

/** One row of the Topbar's jump-to list. */
export type QuickHit = {
  id: string;
  kind: ContentKind;
  title: string;
  status: ContentStatus;
};

/**
 * Everything the Studio holds, by name, for the search box in the Topbar.
 *
 * Across kinds on purpose — the point is to reach a story without first
 * remembering whether it was filed as a Pix or a Qix, which is exactly the
 * thing a section-by-section search cannot do for you.
 *
 * Two characters minimum: a single letter matches most of the library and
 * makes the request for nothing.
 */
export async function quickSearch(search: string, limit = 8): Promise<QuickHit[]> {
  const term = searchTerm(search);
  if (term.length < 2) return [];

  const { data, error } = await supabase
    .from("content_items")
    .select("id,kind,title,status")
    .or(["title", "summary"].map((c) => `${c}.ilike.*${term}*`).join(","))
    .order("updated_at", { ascending: false })
    .limit(limit);
  fail("quickSearch", error);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as ContentKind,
    title: r.title as string,
    status: r.status as ContentStatus,
  }));
}

/** Where a hit lives — articles are the one kind whose route is pluralised. */
export function editorHref(kind: ContentKind, id: string): string {
  const seg = kind === "article" ? "articles" : kind;
  return `/content/${seg}/editor?id=${id}`;
}

/**
 * How many items sit in each library tab.
 *
 * Head requests — the counts come back in the Content-Range header and no row
 * is transferred, which is the point: the tab labels need three numbers, not
 * three lists.
 */
export async function countContentByKind(kind: ContentKind) {
  const tally = async (status?: ContentStatus) => {
    let q = supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind);
    if (status) q = q.eq("status", status);
    const { error, count } = await q;
    fail("countContentByKind", error);
    return count ?? 0;
  };

  const [all, inReview, published] = await Promise.all([
    tally(),
    tally("in_review"),
    tally("published"),
  ]);
  return { all, inReview, published };
}

/** Newest-activity first, matching how the libraries list content. */
export async function listContentByKind(kind: ContentKind) {
  const items = await listContent(kind);
  return items.sort((a, b) => {
    const t = (c: ContentItem) =>
      new Date(c.publishedAt || c.updatedAt || c.createdAt).getTime();
    return t(b) - t(a);
  });
}

export async function updateContent(id: string, patch: Partial<ContentItem>) {
  const { data, error } = await supabase
    .from("content_items")
    .update(fromContent(patch))
    .eq("id", id)
    .select()
    .single();
  fail("updateContent", error);
  return toContent(data as Row);
}

/**
 * Moves an item through the workflow and records it. Publishing is additionally
 * gated by a database trigger, so a writer or QA cannot publish by calling the
 * API directly even if the UI let them.
 */
/**
 * Copies a clip still sitting in the CMS's own uploads folder into the media
 * bucket, and points the row at it. Returns the new public URL.
 *
 * A copy rather than a fresh download: the bytes are on this machine and the
 * browser can reach them, which also means it works for imports whose source
 * URL has long expired.
 */
export async function hostLocalMedia(item: ContentItem): Promise<string> {
  const path = localMediaPath(item.mediaUrl);
  if (!path) return item.mediaUrl ?? "";

  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "The video file is no longer in the CMS uploads folder — re-import it before publishing."
        : `Could not read the staged video file (HTTP ${res.status}).`,
    );
  }

  const url = await uploadBlob(MEDIA, await res.blob(), item.kind);
  // the cover pointed at the same local path on some rows
  const coverIsLocal = !!item.coverUrl && !!localMediaPath(item.coverUrl);
  await updateContent(item.id, {
    mediaUrl: url,
    ...(coverIsLocal ? { coverUrl: null } : {}),
  });
  return url;
}

/**
 * Feature a CMS-authored story, or stop featuring it.
 *
 * The app shows featured stories with a badge and leads with them, across both
 * halves of the feed. Only published items should carry it — featuring a draft
 * promises a lead nobody can read — so the caller gates on status and this
 * refuses anything else rather than trusting it to.
 */
export async function setContentFeatured(id: string, featured: boolean) {
  const { data, error } = await supabase
    .from("content_items")
    .update({ is_featured: featured })
    .eq("id", id)
    .eq("status", "published")
    .select("id");
  fail("setContentFeatured", error);
  if (!data?.length) {
    throw new Error("Only a published story can be featured.");
  }
}

export async function setContentStatus(
  id: string,
  status: ContentStatus,
  actor: CmsUser,
  note?: string
) {
  /* A Qix or Trax with nothing to play must not go live.
   *
   * Five published Qix currently have `media_url` null and three more point at
   * a page rather than a file. Nothing stopped any of them: publishing only
   * ever set a status. The reader gets a card that loads, renders its headline,
   * and plays nothing — which looks like the app is broken rather than like the
   * item is unfinished.
   *
   * Checked here rather than in the review screen because this function is the
   * one path every publish goes through, wherever the button lives. */
  if (status === "published") {
    let current = await getContentItem(id);

    /* Move a locally-staged clip into the bucket rather than refusing.
     *
     * There was a button for this, and a button is the wrong shape for it: the
     * editor is told their video is on the wrong machine and asked to fix an
     * infrastructure detail they had no part in creating. The bytes are
     * reachable, the destination is known, and the moment it matters is right
     * here — so it just happens. Only the failures they can actually act on
     * are worth interrupting for. */
    if (current && rehostable(current.mediaUrl)) {
      current = { ...current, mediaUrl: await hostLocalMedia(current) };
    }

    /* And the cover, for the same reason with a sharper edge.
     *
     * A cover pasted or composed as a data: URI is stored inline in the row,
     * so every reader downloads it as part of the feed JSON — not once, but on
     * every poll. Fifteen of them had reached 4.2MB between them, one alone at
     * 1.9MB, on a query the app repeats every thirty seconds. That is what a
     * statement timeout on the feed turned out to be. */
    if (current?.coverUrl?.startsWith("data:")) {
      const hosted = await uploadDataUrl(COVERS, current.coverUrl, "cover");
      await supabase.from("content_items").update({ cover_url: hosted }).eq("id", id);
      current = { ...current, coverUrl: hosted };
    }

    const blocker = current && mediaBlocker(current.kind, current.mediaUrl);
    if (blocker) throw new Error(blocker);
  }

  const patch: Partial<ContentItem> = { status };
  if (status === "rejected") {
    patch.reviewNote = note ?? null;
    patch.reviewedBy = actor.id;
  }
  if (status === "approved") patch.reviewedBy = actor.id;
  if (status === "in_review") patch.reviewNote = null;
  if (status === "published") {
    patch.publishedBy = actor.id;
    patch.publishedAt = new Date().toISOString();
  }
  const item = await updateContent(id, patch);
  await logAudit(actor, statusVerb(status), item.kind, item.title);
  return item;
}

const statusVerb = (s: ContentStatus) =>
  s === "in_review"
    ? "submitted for review"
    : s === "published"
      ? "published"
      : s === "approved"
        ? "approved"
        : s === "rejected"
          ? "rejected"
          : s === "archived"
            ? "archived"
            : "updated";

// ── app feed (approved NewsStudio articles) ─────────────────────────
export async function listSelections(): Promise<ArticleSelection[]> {
  const { data, error } = await supabase
    .from("article_selections")
    .select("*")
    .order("approved_at");
  fail("listSelections", error);
  return (data ?? []).map(toSelection);
}

export async function approveArticle(
  articleId: string,
  actor: CmsUser,
  title: string
) {
  const { error } = await supabase.from("article_selections").insert({
    article_id: articleId,
    approved_by: actor.id,
  });
  fail("approveArticle", error);
  await logAudit(actor, "approved for app feed", "newsstudio article", title);
}

export async function unapproveArticle(
  articleId: string,
  actor: CmsUser,
  title: string
) {
  const { error } = await supabase
    .from("article_selections")
    .delete()
    .eq("article_id", articleId);
  fail("unapproveArticle", error);
  await logAudit(actor, "removed from app feed", "newsstudio article", title);
}

export async function updateSelection(
  articleId: string,
  patch: Partial<ArticleSelection>
) {
  const row: Row = {};
  if (patch.isFeatured !== undefined) row.is_featured = patch.isFeatured;
  if (patch.titleOverride !== undefined) row.title_override = patch.titleOverride;
  if (patch.summaryOverride !== undefined)
    row.summary_override = patch.summaryOverride;
  if (patch.imageOverride !== undefined) row.image_override = patch.imageOverride;
  if (patch.modesOverride !== undefined) row.modes_override = patch.modesOverride;
  const { error } = await supabase
    .from("article_selections")
    .update(row)
    .eq("article_id", articleId);
  fail("updateSelection", error);
}

// ── engagement ──────────────────────────────────────────────────────

/**
 * The key a stats lookup uses.
 *
 * Ids come from two different Supabase projects, so an id alone is not a key —
 * `content_items` and NewsStudio `articles` mint uuids independently and
 * nothing stops them colliding. Cheap to disambiguate here; confusing to debug
 * if we ever didn't.
 */
export const statKey = (source: StatsSource, id: string) => `${source}:${id}`;

/**
 * Reader engagement, keyed by `statKey(source, id)`.
 *
 * Returns an empty map rather than throwing when the caller is not allowed to
 * see it, or when the migration has not been applied yet — the Studio worked
 * before these numbers existed and has to keep working if they are absent.
 * The permission itself is enforced by RLS; `can.seeStats` only decides
 * whether we bother asking.
 *
 * An item nobody has touched has no row at all, since the view is built from
 * the engagement tables rather than from the content. Callers render a missing
 * entry as zeros, which is the same answer with less to carry over the wire.
 */
export async function listContentStats(
  pipelineIds: string[] = [],
  cmsIds: string[] = []
): Promise<Map<string, ContentStats>> {
  const out = new Map<string, ContentStats>();
  try {
    const { data, error } = await supabase.from("content_stats").select("*");
    if (error) {
      // 42P01 is "relation does not exist" — the migration is not applied.
      if (!/does not exist|permission denied/i.test(error.message)) {
        console.warn("[stats]", error.message);
      }
      return out;
    }
    for (const r of (data ?? []) as Row[]) {
      const source = (r.source as StatsSource) ?? "cms";
      out.set(statKey(source, r.content_id as string), {
        source,
        contentId: r.content_id as string,
        likes: Number(r.likes ?? 0),
        dislikes: Number(r.dislikes ?? 0),
        saves: Number(r.saves ?? 0),
        shares: Number(r.shares ?? 0),
        views: Number(r.views ?? 0),
        commentOpens: Number(r.comment_opens ?? 0),
        comments: Number(r.comments ?? 0),
        sourceOpens: Number(r.source_opens ?? 0),
        lastAt: (r.last_at as string | null) ?? null,
      });
    }
  } catch (e) {
    console.warn("[stats] unreachable:", e instanceof Error ? e.message : e);
  }

  /* Comments come from the table that holds them, not from a tally we keep
     alongside it.

     They were briefly counted as an event the app emitted on each successful
     post, which meant the number only ever started at whenever the app build
     shipped — comments written before that were invisible, and a comment later
     deleted stayed counted forever. `app_comments` in DB A is the real answer
     and has been all along, so ask it. */
  /* Two threads tables, one per project, because each lives with the content
     it hangs off — DB A's `app_comments` for pipeline articles, DB B's
     `content_comments` for ours. Asked together; merged by source. */
  const [fromPipeline, fromCms] = await Promise.all([
    listCommentCounts(pipelineIds),
    listCmsCommentCounts(cmsIds),
  ]);

  for (const [source, counts] of [
    ["pipeline", fromPipeline],
    ["cms", fromCms],
  ] as const) {
    for (const [id, n] of counts) {
      const key = statKey(source, id);
      const row = out.get(key);
      if (row) {
        row.comments = n;
      } else {
        // Commented on but otherwise untouched: no engagement row exists, and
        // a comment is still something worth showing.
        out.set(key, { ...EMPTY_STATS, source, contentId: id, comments: n });
      }
    }
  }

  return out;
}

/**
 * No row means nothing has happened yet, which is a real answer and reads
 * better as zeros than as an absence. The view is built from the engagement
 * tables rather than from the content, so untouched items have no row at all —
 * the common case, not an error case.
 */
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

/**
 * How many comments each pipeline article has, straight from DB A.
 *
 * Resolves empty when DB A is not configured, rather than taking the page down
 * with it — the rest of the numbers are still worth showing.
 */
/* The Studio is not a device, but the thread RPCs take one — it decides the
   `liked_by_me` flag, which the desk has no use for. A constant, inside the
   8–64 length the functions check, keeps that honest: the desk never appears
   to have liked anything. */
const DESK_DEVICE = "cms-studio-desk";

/**
 * One story's comments, read from whichever project holds its thread.
 *
 * Wire articles keep theirs in DB A; ours live here (migration 13). Both RPCs
 * return the same columns in the same order, so one mapper covers both.
 *
 * Resolves empty rather than throwing: a thread that will not load should cost
 * the reader of an analytics page the thread, not the page.
 */
export async function listCommentsFor(
  source: StatsSource,
  id: string,
  limit = 200
): Promise<ContentComment[]> {
  const shape = (r: Row): ContentComment => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    deviceId: r.device_id as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    likeCount: Number(r.like_count ?? 0),
    replyCount: Number(r.reply_count ?? 0),
  });

  try {
    if (source === "pipeline") {
      if (!newsstudio || !UUID_RE.test(id)) return [];
      const { data, error } = await newsstudio.rpc("app_comments_for", {
        p_article: id,
        p_device: DESK_DEVICE,
        p_limit: limit,
      });
      if (error) {
        console.warn("[comments]", error.message);
        return [];
      }
      return ((data ?? []) as Row[]).map(shape);
    }

    const { data, error } = await supabase.rpc("app_content_comments_for", {
      p_content: id,
      p_device: DESK_DEVICE,
      p_limit: limit,
    });
    if (error) {
      // Absent until migration 13 is applied.
      if (!/does not exist/i.test(error.message)) {
        console.warn("[comments/cms]", error.message);
      }
      return [];
    }
    return ((data ?? []) as Row[]).map(shape);
  } catch (e) {
    console.warn("[comments] unreachable:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * The same pseudonym the reader sees in the app.
 *
 * There are no accounts, only a device id, and a thread reads badly when
 * everyone is "Anonymous". Copied from the app's `nameFor` character for
 * character — including the unsigned shifts, since a signed one turns any hash
 * past 2^31 negative and yields "Curious undefined" — so the desk and the
 * reader are looking at the same names.
 */
const ADJECTIVES = ["Quiet", "Curious", "Sharp", "Calm", "Bright", "Steady", "Keen", "Swift"];
const NOUNS = ["Reader", "Owl", "Falcon", "Otter", "Heron", "Fox", "Crane", "Lark"];

export function readerName(deviceId: string): string {
  let h = 0;
  for (let i = 0; i < deviceId.length; i++) {
    h = (h * 31 + deviceId.charCodeAt(i)) >>> 0;
  }
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 5) % NOUNS.length]}`;
}

/**
 * How many comments each CMS item has, from this project's own table.
 *
 * The sibling of `listCommentCounts`. Pix, Qix, Trax and desk-written articles
 * could not be commented on at all until migration 13 — `app_comments` in DB A
 * is keyed to the pipeline's articles table, so their ids were refused and the
 * comment silently discarded. `content_comments` is the other half.
 */
export async function listCmsCommentCounts(
  ids: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const valid = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return out;

  const CHUNK = 200;
  try {
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { data, error } = await supabase.rpc("app_content_comment_counts", {
        p_ids: valid.slice(i, i + CHUNK),
      });
      if (error) {
        // Absent until migration 13 is applied; the rest still renders.
        if (!/does not exist/i.test(error.message)) {
          console.warn("[comments/cms]", error.message);
        }
        return out;
      }
      for (const r of (data ?? []) as { content_id: string; n: number }[]) {
        out.set(r.content_id, Number(r.n ?? 0));
      }
    }
  } catch (e) {
    console.warn("[comments/cms] unreachable:", e instanceof Error ? e.message : e);
  }
  return out;
}

export async function listCommentCounts(
  ids: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const valid = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  if (!newsstudio || valid.length === 0) return out;

  const CHUNK = 200;
  try {
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { data, error } = await newsstudio.rpc("app_comment_counts", {
        p_ids: valid.slice(i, i + CHUNK),
      });
      if (error) {
        console.warn("[comments]", error.message);
        return out;
      }
      for (const r of (data ?? []) as { article_id: string; n: number }[]) {
        out.set(r.article_id, Number(r.n ?? 0));
      }
    }
  } catch (e) {
    console.warn("[comments] unreachable:", e instanceof Error ? e.message : e);
  }
  return out;
}

// ── push notifications ──────────────────────────────────────────────

/** How many phones a broadcast would reach right now. 0 when not allowed. */
export async function pushAudienceSize(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("app_push_audience_size");
    if (error) {
      // Absent until migration 15 is applied; the page still renders.
      if (!/does not exist/i.test(error.message)) console.warn("[push]", error.message);
      return 0;
    }
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}

/** Stories readers have already been told about, keyed by `statKey`. */
export async function listNotified(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { data, error } = await supabase
      .from("content_notifications")
      .select("source,content_id");
    if (error) {
      if (!/does not exist|permission denied/i.test(error.message)) {
        console.warn("[push]", error.message);
      }
      return out;
    }
    for (const r of (data ?? []) as { source: StatsSource; content_id: string }[]) {
      out.add(statKey(r.source, r.content_id));
    }
  } catch {
    /* the page is still useful without it */
  }
  return out;
}

/**
 * Send a push to every reader, about one story.
 *
 * Goes through the API route rather than straight to Expo: the token list must
 * not reach a browser. The route re-checks permission in the database using the
 * session forwarded here, so this cannot be talked into sending by anyone the
 * database would refuse.
 */
export async function notifyReaders(input: {
  source: StatsSource;
  contentId: string;
  title: string;
  body?: string;
  /** Cover image; Android shows it in the expanded notification. */
  image?: string;
}): Promise<{ sent: number; attempted: number; failed: number }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Your session expired — sign in again.");

  const res = await fetch("/api/notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? "Couldn't notify readers.");
  }
  return json as { sent: number; attempted: number; failed: number };
}

// ── audit ───────────────────────────────────────────────────────────
export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  fail("listAudit", error);
  return (data ?? []).map(toAudit);
}

export async function logAudit(
  actor: CmsUser,
  action: string,
  entity: string,
  entityTitle: string
) {
  const { error } = await supabase.from("audit_log").insert({
    actor_id: actor.id,
    actor_name: actor.fullName,
    action,
    entity,
    entity_title: entityTitle,
  });
  // The trail is useful, not critical — never fail a user action over it.
  if (error) console.warn("audit write failed:", error.message);
}

// ── NewsStudio (DB A, read-only) ────────────────────────────────────
/** Pipeline rows carry a sha1: placeholder when no image was captured. */
const usableImage = (v: unknown, seed: string) =>
  typeof v === "string" && /^https?:\/\//.test(v)
    ? v
    : `https://picsum.photos/seed/${encodeURIComponent(seed)}/640/400`;

const toNewsStudio = (r: Row): NewsStudioArticle => {
  const id = r.id as string;
  return {
    id,
    title: ((r.edited_title as string) || (r.title as string) || "").trim(),
    summary: ((r.edited_summary as string) || (r.summary as string) || "").trim(),
    category:
      ((r.category as string) ||
        (r.topic as string) ||
        (r.section as string) ||
        "General").trim(),
    source: ((r.source as string) || "NewsStudio").trim(),
    imageUrl: usableImage(r.image_url, id),
    factScore: Number(r.fact_score ?? 0),
    factLabel: (r.fact_label as string) ?? "",
    // The pipeline records corroborating sources in fact_notes when present.
    sourceCount: Array.isArray((r.fact_notes as { sources?: unknown[] })?.sources)
      ? ((r.fact_notes as { sources: unknown[] }).sources.length as number)
      : 1,
    /* Whether the pipeline summariser already wrote retellings for this
       story. It reaches only a fraction of the feed, so most are false — and
       false is what makes approval generate them. Mirrors mapModes in the
       app's lib/content: an empty array is not a mode. */
    hasModes: (() => {
      const v = r.versions as
        | { eli5?: unknown; tldr?: unknown; key_numbers?: unknown }
        | null;
      if (!v) return false;
      return (
        (typeof v.eli5 === "string" && v.eli5.trim().length > 0) ||
        (Array.isArray(v.tldr) && v.tldr.length > 0) ||
        (Array.isArray(v.key_numbers) && v.key_numbers.length > 0)
      );
    })(),
    status: (r.status as "approved" | "sent") ?? "approved",
    publishedAt:
      (r.sent_at as string) ||
      (r.created_at as string) ||
      (r.scraped_at as string),
  };
};

const NEWS_COLUMNS =
  "id,title,edited_title,summary,edited_summary,category,topic,section,source,image_url,fact_score,fact_label,fact_notes,status,sent_at,created_at,scraped_at,versions";

/** One page of pipeline articles, plus how many matched in total. */
export type NewsStudioPage = { rows: NewsStudioArticle[]; total: number };

/**
 * Inside an `or(...)` filter PostgREST reads commas as separators and
 * parentheses as grouping, so a search for "Delhi, Mumbai" would be parsed as
 * filter syntax rather than as text. Blank those out before interpolating.
 */
const searchTerm = (s: string) => s.replace(/[,()*%\\]/g, " ").trim();

/**
 * One page of approved pipeline articles, newest first. Read-only by design.
 *
 * Paged and searched on the server, so the size of the pipeline table stops
 * mattering to this screen: the browser holds one page, whether the table
 * holds three thousand rows or three million. `total` is the server's exact
 * count of everything matching, which is what the pager needs to know how
 * many pages there are without having seen them.
 *
 * Ordered by id as well as date, because two articles created in the same
 * second have no inherent order — and an unstable order across requests is
 * how a row appears twice on one page and never on the next.
 */
export async function listNewsStudio({
  page = 1,
  size = 12,
  search = "",
}: { page?: number; size?: number; search?: string } = {}): Promise<NewsStudioPage> {
  if (!newsstudio) return { rows: [], total: 0 };

  let q = newsstudio
    .from("articles")
    .select(NEWS_COLUMNS, { count: "exact" })
    .in("status", ["approved", "sent"]);

  // Matches the fields the card shows, so a hit is always visible on screen.
  const term = searchTerm(search);
  if (term) {
    q = q.or(
      ["title", "edited_title", "category", "topic", "section", "source"]
        .map((c) => `${c}.ilike.*${term}*`)
        .join(",")
    );
  }

  const from = (Math.max(1, page) - 1) * size;
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + size - 1);
  fail("listNewsStudio", error);

  return { rows: (data ?? []).map(toNewsStudio), total: count ?? 0 };
}

/**
 * Specific pipeline articles by id, for the app feed.
 *
 * A selection in DB B stores only the article id, so the feed needs the
 * articles themselves — and they are almost never on the page of the grid
 * currently being browsed. Chunked because a URL carrying a few hundred ids
 * is one PostgREST will refuse.
 */
export async function listNewsStudioByIds(
  ids: string[]
): Promise<NewsStudioArticle[]> {
  if (!newsstudio || ids.length === 0) return [];
  const CHUNK = 100;
  const out: NewsStudioArticle[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await newsstudio
      .from("articles")
      .select(NEWS_COLUMNS)
      .in("id", ids.slice(i, i + CHUNK));
    fail("listNewsStudioByIds", error);
    out.push(...(data ?? []).map(toNewsStudio));
  }

  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getNewsStudioByIds(
  ids: string[]
): Promise<NewsStudioArticle[]> {
  // article_selections can outlive the pipeline row it points at, and older
  // rows may hold non-uuid ids. Postgres errors on a malformed uuid, which
  // would take down the whole page — so only ask for ids it can parse.
  const valid = ids.filter((id) => UUID_RE.test(id));
  if (!newsstudio || valid.length === 0) return [];
  const { data, error } = await newsstudio
    .from("articles")
    .select(
      "id,title,edited_title,summary,edited_summary,category,topic,section,source,image_url,fact_score,fact_label,fact_notes,status,sent_at,created_at,scraped_at,versions"
    )
    .in("id", valid);
  fail("getNewsStudioByIds", error);
  return (data ?? []).map(toNewsStudio);
}
