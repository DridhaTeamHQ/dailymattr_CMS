export type Role = "super_admin" | "chief_editor" | "writer" | "qa";

/**
 * Character caps for article cards. Shared by the editor UI and the AI
 * summariser so both sides agree on what fits.
 *
 * These are not round numbers picked for tidiness — they are what the app's
 * reader card holds. The summary sets at 16.5/26 and is clamped to a line
 * count, so the real limit is `lines × characters per line` on the narrowest
 * phone still supported (320dp, ~30 characters per line after word-wrap
 * raggedness):
 *
 *   11 lines — a story with no reading modes, i.e. everything written here → 330
 *   10 lines — a pipeline story whose mode tabs take a line of the card → 300
 *
 * 330 is therefore exact rather than generous: it is the full height of the
 * card for CMS-authored articles. The one place it can still clip is a
 * `summary_override` written onto a pipeline story that carries reading modes,
 * on a 320dp screen — the last ~30 characters ellipsis rather than the layout
 * breaking. Anything above 330 truncates for real.
 */
export const ARTICLE_TITLE_MAX = 70;
export const ARTICLE_DESC_MAX = 330;

export type ContentKind = "article" | "pix" | "qix" | "trax";

export type ContentStatus =
  | "draft"
  | "in_review"
  | "rejected"
  | "approved"
  | "published"
  | "archived";

export interface CmsUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  languages: string[];
  states: string[];
  isActive: boolean;
  avatarHue: number;
}

export interface Category {
  slug: string;
  name: string;
  kind: ContentKind | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ContentItem {
  id: string;
  kind: ContentKind;
  title: string;
  slug: string;
  summary: string;
  body: Record<string, unknown>;
  categorySlug: string | null;
  tags: string[];
  language: string;
  state: string | null;
  /** Display copy — what grids and the app load. Kept small on purpose. */
  coverUrl: string | null;
  /** Lossless full-resolution original, when the composer made one. */
  coverMasterUrl: string | null;
  mediaUrl: string | null; // video (qix) / audio (trax) URL
  durationSec: number | null;
  sourceLinks: { title: string; url: string }[];
  factScore: number | null;
  factLabel: string | null;
  /** Editorial lead flag for CMS-authored content — the app shows a badge and
   *  leads with it. The pipeline equivalent is article_selections.isFeatured. */
  isFeatured: boolean;
  source: "cms" | "newsstudio";
  sourceArticleId: string | null;
  status: ContentStatus;
  reviewNote: string | null;
  createdBy: string;
  reviewedBy: string | null;
  publishedBy: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Read-only article coming from the NewsStudio pipeline DB (DB A). */
export interface NewsStudioArticle {
  id: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  imageUrl: string;
  factScore: number;
  factLabel: string;
  sourceCount: number;
  status: "approved" | "sent";
  publishedAt: string;
  /** True when the pipeline summariser already wrote reading modes for it. */
  hasModes: boolean;
}

/**
 * A NewsStudio article approved for the app feed. Feed order is the order of
 * approval — `position` is derived from `approvedAt`, never set by hand.
 */
export interface ArticleSelection {
  articleId: string;
  position: number;
  isFeatured: boolean;
  approvedBy: string;
  approvedAt: string;
  /** Editorial overrides live here — DB A (NewsStudio) is never written to. */
  titleOverride?: string | null;
  summaryOverride?: string | null;
  imageOverride?: string | null;
  /** Reading modes written by the desk. DB A owns articles.versions and is
   *  never written to, so these live here like the other overrides. */
  modesOverride?: { eli5: string; tldr: string[]; keyNumbers: string[] } | null;
}

/** One row of the user_performance view — aggregated in Postgres. */
export interface UserPerformance {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  avatarHue: number;
  createdTotal: number;
  createdArticles: number;
  createdPix: number;
  createdQix: number;
  createdTrax: number;
  inDraft: number;
  awaitingReview: number;
  sentBack: number;
  clearedReview: number;
  live: number;
  /** Work of other people's they approved or declined. */
  reviewed: number;
  publishedByThem: number;
  articlesApproved: number;
  lastTouched: string | null;
}

/** One row of `content_stats` — engagement counted by device, not by person. */
/** Which project an engaged-with id belongs to. See migration 11. */
export type StatsSource = "cms" | "pipeline";

export interface ContentStats {
  source: StatsSource;
  contentId: string;
  likes: number;
  dislikes: number;
  saves: number;
  shares: number;
  views: number;
  /** Panel opened. The denominator for `comments`. */
  commentOpens: number;
  /** Something actually said. See migration 12. */
  comments: number;
  /** Tapped through to the publisher. */
  sourceOpens: number;
  lastAt: string | null;
}

/** One comment on a story, from whichever project holds its thread. */
export interface ContentComment {
  id: string;
  parentId: string | null;
  deviceId: string;
  body: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityTitle: string;
  createdAt: string;
}

export const KIND_META: Record<
  ContentKind,
  { label: string; tagline: string; mode: string }
> = {
  article: { label: "Articles", tagline: "60-word stories", mode: "READ" },
  pix: { label: "Pix", tagline: "image stories", mode: "LOOK" },
  qix: { label: "Qix", tagline: "video explainers", mode: "WATCH" },
  trax: { label: "Trax", tagline: "audio explainers", mode: "LISTEN" },
};

export const ROLE_META: Record<Role, { label: string; blurb: string }> = {
  super_admin: { label: "Super Administrator", blurb: "Full system access" },
  chief_editor: {
    label: "Chief Editor",
    blurb: "Language & content management",
  },
  writer: { label: "Content Writer", blurb: "State-level content" },
  qa: { label: "QA", blurb: "Quality review and publish moderation" },
};

export const STATUS_META: Record<
  ContentStatus,
  { label: string; tone: "muted" | "accent" | "mint" | "amber" | "rose" | "violet" }
> = {
  draft: { label: "Draft", tone: "muted" },
  in_review: { label: "In review", tone: "amber" },
  rejected: { label: "Rejected", tone: "rose" },
  approved: { label: "Approved", tone: "violet" },
  published: { label: "Published", tone: "mint" },
  archived: { label: "Archived", tone: "muted" },
};
