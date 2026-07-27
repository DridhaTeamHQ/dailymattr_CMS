export type Role = "super_admin" | "chief_editor" | "writer" | "qa";

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
  coverUrl: string | null; // data URL or remote URL (mock for media_assets)
  mediaUrl: string | null; // video (qix) / audio (trax) URL
  durationSec: number | null;
  sourceLinks: { title: string; url: string }[];
  factScore: number | null;
  factLabel: string | null;
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
}

export interface ArticleSelection {
  articleId: string;
  position: number;
  isFeatured: boolean;
  selectedBy: string;
  selectedAt: string;
  /** Editorial overrides live here — DB A (NewsStudio) is never written to. */
  titleOverride?: string | null;
  summaryOverride?: string | null;
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
