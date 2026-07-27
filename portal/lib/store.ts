"use client";

// LocalStorage-backed mock store. Mirrors the future Supabase data layer:
// every function here maps 1:1 to a table/query in MVP_PLAN.md, so swapping
// in Supabase later means reimplementing this module only.

import {
  SEED_AUDIT,
  SEED_CATEGORIES,
  SEED_CONTENT,
  SEED_NEWSSTUDIO,
  SEED_SELECTIONS,
  SEED_USERS,
} from "./mock";
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

const NS = "dailymattr-cms:v1:";

function read<T>(key: string, seed: T): T {
  if (typeof window === "undefined") return seed;
  const raw = window.localStorage.getItem(NS + key);
  if (!raw) {
    window.localStorage.setItem(NS + key, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return seed;
  }
}

function write<T>(key: string, value: T) {
  window.localStorage.setItem(NS + key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("cms-store-change", { detail: key }));
}

export const uid = () =>
  `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── users ───────────────────────────────────────────────────────────
export const getUsers = (): CmsUser[] => read("users", SEED_USERS);
export const saveUsers = (u: CmsUser[]) => write("users", u);

// ── categories ──────────────────────────────────────────────────────
export const getCategories = (): Category[] => read("categories", SEED_CATEGORIES);
export const saveCategories = (c: Category[]) => write("categories", c);

// ── newsstudio (DB A - read-only) ───────────────────────────────────
export const getNewsStudio = (): NewsStudioArticle[] =>
  read("newsstudio", SEED_NEWSSTUDIO);

// ── selections ──────────────────────────────────────────────────────
/** Feed order is approval order: earliest approval first. */
export const getSelections = (): ArticleSelection[] =>
  read("selections", SEED_SELECTIONS)
    .map(normalizeSelection)
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
    .map((sel, i) => ({ ...sel, position: i + 1 }));

/** Tolerates rows written before approval replaced manual selection. */
function normalizeSelection(sel: ArticleSelection): ArticleSelection {
  const legacy = sel as ArticleSelection & {
    selectedAt?: string;
    selectedBy?: string;
  };
  return {
    ...sel,
    approvedAt: sel.approvedAt ?? legacy.selectedAt ?? new Date(0).toISOString(),
    approvedBy: sel.approvedBy ?? legacy.selectedBy ?? "",
  };
}

export const saveSelections = (s: ArticleSelection[]) =>
  write(
    "selections",
    s
      .map(normalizeSelection)
      .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
      .map((sel, i) => ({ ...sel, position: i + 1 }))
  );

export function updateSelection(
  articleId: string,
  patch: Partial<ArticleSelection>
) {
  const all = getSelections();
  const i = all.findIndex((s) => s.articleId === articleId);
  if (i < 0) return;
  all[i] = { ...all[i], ...patch };
  saveSelections(all);
}

// ── content ─────────────────────────────────────────────────────────
export const getContent = (): ContentItem[] => read("content", SEED_CONTENT);
export const saveContent = (c: ContentItem[]) => write("content", c);

export function upsertContent(item: ContentItem) {
  const all = getContent();
  const i = all.findIndex((c) => c.id === item.id);
  if (i >= 0) all[i] = { ...item, updatedAt: new Date().toISOString() };
  else all.unshift(item);
  saveContent(all);
}

export function setStatus(
  id: string,
  status: ContentStatus,
  actor: CmsUser,
  note?: string
) {
  const all = getContent();
  const item = all.find((c) => c.id === id);
  if (!item) return;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  if (status === "in_review") item.reviewNote = null;
  if (status === "rejected") {
    item.reviewNote = note ?? null;
    item.reviewedBy = actor.id;
  }
  if (status === "approved") item.reviewedBy = actor.id;
  if (status === "published") {
    item.publishedBy = actor.id;
    item.publishedAt = new Date().toISOString();
  }
  saveContent(all);
  logAudit(actor, statusVerb(status), item.kind, item.title);
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

// ── audit ───────────────────────────────────────────────────────────
/** Newest first — callers slice the top N and group by day. */
export const getAudit = (): AuditEntry[] =>
  read("audit", SEED_AUDIT)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export function logAudit(
  actor: CmsUser,
  action: string,
  entity: string,
  entityTitle: string
) {
  const all = getAudit();
  all.unshift({
    id: uid(),
    actorId: actor.id,
    actorName: actor.fullName,
    action,
    entity,
    entityTitle,
    createdAt: new Date().toISOString(),
  });
  write("audit", all.slice(0, 80));
}

// ── helpers ─────────────────────────────────────────────────────────
export function contentByKind(kind: ContentKind): ContentItem[] {
  return getContent()
    .filter((c) => c.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export function resetDemoData() {
  Object.keys(window.localStorage)
    .filter((k) => k.startsWith(NS))
    .forEach((k) => window.localStorage.removeItem(k));
  window.dispatchEvent(new CustomEvent("cms-store-change", { detail: "reset" }));
}
