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

import { newsstudio, supabase } from "./supabase";
import type {
  ArticleSelection,
  AuditEntry,
  Category,
  CmsUser,
  ContentItem,
  ContentKind,
  ContentStatus,
  NewsStudioArticle,
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
  mediaUrl: (r.media_url as string | null) ?? null,
  durationSec: (r.duration_sec as number | null) ?? null,
  sourceLinks: (r.source_links as { title: string; url: string }[]) ?? [],
  factScore: (r.fact_score as number | null) ?? null,
  factLabel: (r.fact_label as string | null) ?? null,
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
  put("media_url", c.mediaUrl);
  put("duration_sec", c.durationSec);
  put("source_links", c.sourceLinks);
  put("fact_score", c.factScore);
  put("fact_label", c.factLabel);
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
  const { error } = await supabase.from("content_items").delete().eq("id", id);
  fail("deleteContent", error);
  if (item) await logAudit(actor, "deleted", item.kind, item.title);
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
export async function setContentStatus(
  id: string,
  status: ContentStatus,
  actor: CmsUser,
  note?: string
) {
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
  const { error } = await supabase
    .from("article_selections")
    .update(row)
    .eq("article_id", articleId);
  fail("updateSelection", error);
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
    status: (r.status as "approved" | "sent") ?? "approved",
    publishedAt:
      (r.sent_at as string) ||
      (r.created_at as string) ||
      (r.scraped_at as string),
  };
};

/** Approved pipeline articles, newest first. Read-only by design. */
export async function listNewsStudio(limit = 60): Promise<NewsStudioArticle[]> {
  if (!newsstudio) return [];
  const { data, error } = await newsstudio
    .from("articles")
    .select(
      "id,title,edited_title,summary,edited_summary,category,topic,section,source,image_url,fact_score,fact_label,fact_notes,status,sent_at,created_at,scraped_at"
    )
    .in("status", ["approved", "sent"])
    .order("created_at", { ascending: false })
    .limit(limit);
  fail("listNewsStudio", error);
  return (data ?? []).map(toNewsStudio).filter((a) => a.title);
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
      "id,title,edited_title,summary,edited_summary,category,topic,section,source,image_url,fact_score,fact_label,fact_notes,status,sent_at,created_at,scraped_at"
    )
    .in("id", valid);
  fail("getNewsStudioByIds", error);
  return (data ?? []).map(toNewsStudio);
}
