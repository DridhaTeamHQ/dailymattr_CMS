"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Radio, Save, Send, Sparkles } from "lucide-react";
import MediaDrop from "@/components/MediaDrop";
import PixComposer from "@/components/PixComposer";
import { PixBezel } from "@/components/PixPoster";
import SourceImport, { type ImportedArticle } from "@/components/SourceImport";
import { SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import { localMediaPath, mediaBlocker, rehostable } from "@/lib/media";
import { MEDIA, uploadBlob } from "@/lib/storage";
import {
  createContent,
  getContentItem,
  listCategories,
  logAudit,
  setContentStatus,
  updateContent,
} from "@/lib/db";
import { slugify } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import {
  PIX_POINT_COUNT,
  getPixPoints,
  pixSummary,
  type PixPlacement,
} from "@/lib/pix";
import { markReport } from "@/lib/pixHighlight";
import {
  ARTICLE_DESC_MAX,
  ARTICLE_TITLE_MAX,
  KIND_META,
  type Category,
  type ContentItem,
  type ContentKind,
} from "@/lib/types";

/** A blank item. Its id stays empty until the database assigns one on save. */
const emptyItem = (kind: ContentKind, userId: string): ContentItem => ({
  id: "",
  kind,
  title: "",
  slug: "",
  summary: "",
  body: {},
  categorySlug: null,
  tags: [],
  language: "en",
  state: null,
  coverUrl: null,
  coverMasterUrl: null,
  mediaUrl: null,
  durationSec: null,
  sourceLinks: [],
  factScore: 95,
  factLabel: null,
  source: "cms",
  sourceArticleId: null,
  status: "draft",
  reviewNote: null,
  createdBy: userId,
  reviewedBy: null,
  publishedBy: null,
  scheduledAt: null,
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function ContentEditor({ kind }: { kind: ContentKind }) {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("id");

  const [item, setItem] = useState<ContentItem | null>(null);
  const [saved, setSaved] = useState<null | "draft" | "review">(null);
  const [placement, setPlacement] = useState<PixPlacement>("list");
  const [ytUrl, setYtUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeErr, setScrapeErr] = useState<string | null>(null);
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [rehosting, setRehosting] = useState(false);
  const [rehostErr, setRehostErr] = useState<string | null>(null);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const handleScrapeVideo = async () => {
    if (!ytUrl.trim()) return;
    setScraping(true);
    setScrapeErr(null);
    setScrapeMsg(null);

    try {
      // The route stores the download in Supabase Storage as us, so it needs
      // our session — Storage RLS decides, not a service key.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setScrapeErr("Your session expired — sign in again to import video.");
        return;
      }

      const res = await fetch("/api/scrape-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ url: ytUrl.trim() }),
      });

      const data = await res.json();
      if (data.success) {
        // The route uploads to the media bucket itself, as us, and hands back
        // the public URL — so this is already an address the app can fetch.
        if (data.videoUrl) set("mediaUrl", data.videoUrl);
        if (data.coverUrl) set("coverUrl", data.coverUrl);
        if (data.durationSec) set("durationSec", data.durationSec);
        // Don't clobber a headline the writer has already typed.
        if (data.title && !item?.title) set("title", data.title);
        // Report what actually happened. This used to read data.isFallback,
        // which the route never sends, so it always claimed a full success —
        // including when no video had been fetched at all.
        if (data.isDownloaded) {
          const mb = data.sizeBytes
            ? (data.sizeBytes / 1_048_576).toFixed(1)
            : null;
          const shape = data.isVertical === false ? " — landscape, not 9:16" : "";
          setScrapeMsg(
            `Imported${data.uploader ? ` from ${data.uploader}` : ""}${mb ? ` · ${mb} MB` : ""}${shape}`
          );
        }
        else
          setScrapeErr(
            data.notice ?? "Only the title and thumbnail could be imported."
          );
      } else {
        setScrapeErr(data.error || "Failed to scrape video URL.");
      }
    } catch (err: any) {
      setScrapeErr("Error connecting to scraper service.");
    } finally {
      setScraping(false);
    }
  };

  /* Copy a locally-staged clip into the bucket.
   *
   * The bytes are already on this machine and the browser can reach them, so
   * this is a fetch-and-put rather than a fresh download from the source —
   * which also means it works for the Instagram imports, whose original URLs
   * are long expired. Saving is left to the editor: the field changes, they
   * see it, they press Save like any other edit. */
  const rehostMedia = async () => {
    const path = localMediaPath(item?.mediaUrl);
    if (!path || rehosting) return;
    setRehosting(true);
    setRehostErr(null);
    try {
      const res = await fetch(path);
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "That file is no longer in the CMS uploads folder — re-import it."
            : `Could not read the staged file (HTTP ${res.status}).`
        );
      }
      const blob = await res.blob();
      const url = await uploadBlob(MEDIA, blob, "qix");
      set("mediaUrl", url);
      // the cover pointed at the same local path on some rows
      if (item?.coverUrl && localMediaPath(item.coverUrl)) set("coverUrl", null);
    } catch (e) {
      setRehostErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRehosting(false);
    }
  };

  // Keyed on the id, not the user object. A token refresh hands back a fresh
  // profile object with identical values; depending on the object re-ran this
  // loader and reset the item, throwing away whatever was being edited.
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      if (editId) {
        const found = await getContentItem(editId);
        if (alive && found) {
          setItem(found);
          return;
        }
      }
      if (alive) setItem(emptyItem(kind, userId));
    })();
    return () => {
      alive = false;
    };
  }, [editId, kind, userId]);

  // Google's video URLs are signed and expire within hours, so a saved one is
  // dead by the time anyone opens the draft again. This used to quietly swap in
  // an unrelated stock clip; now it clears the field and says what happened, so
  // nobody publishes footage they didn't choose.
  useEffect(() => {
    if (
      item?.mediaUrl &&
      (item.mediaUrl.includes("commondatastorage.googleapis.com") ||
        item.mediaUrl.includes("gtv-videos-bucket") ||
        item.mediaUrl.includes("googlevideo.com"))
    ) {
      setItem((prev) => (prev ? { ...prev, mediaUrl: null } : prev));
      setScrapeErr(
        "The saved video link had expired and was cleared — re-import or upload the file."
      );
    }
  }, [item?.mediaUrl]);

  if (!user || !item) return null;

  const meta = KIND_META[kind];
  const listHref = kind === "article" ? "/content/articles" : `/content/${kind}`;
  const set = <K extends keyof ContentItem>(k: K, v: ContentItem[K]) =>
    setItem((it) => (it ? { ...it, [k]: v } : it));

  const titleChars = item.title.length;
  const descChars = item.summary.length;
  const overLimit =
    kind === "article" &&
    (titleChars > ARTICLE_TITLE_MAX || descChars > ARTICLE_DESC_MAX);

  const isPix = kind === "pix";
  const points = getPixPoints(item);
  const filledPoints = points.filter((p) => p.trim()).length;
  const blue = markReport(item.title);

  /** Key points live on the item; the summary is kept in step for other views. */
  const setPoints = (next: string[]) =>
    setItem((it) =>
      it
        ? {
            ...it,
            body: { ...it.body, points: next },
            summary: pixSummary(next),
          }
        : it
    );

  /** Fills the form from a scraped source. Returns the field names it touched. */
  const applyImport = (d: ImportedArticle, overwrite: boolean): string[] => {
    const filled: string[] = [];
    const next = { ...item };

    if (d.title && (overwrite || !next.title.trim())) {
      next.title = d.title;
      filled.push("headline");
    }
    if (d.summary && (overwrite || !next.summary.trim())) {
      next.summary = d.summary;
      filled.push("story");
    }
    if (d.image && (overwrite || !next.coverUrl)) {
      next.coverUrl = d.image;
      filled.push("cover image");
    }
    if (overwrite || next.sourceLinks.length === 0) {
      next.sourceLinks = [{ title: d.siteName ?? "Source", url: d.sourceUrl }];
      filled.push("source link");
    }
    const section = d.section?.trim().toLowerCase();
    const match = section
      ? categories.find(
          (c) => c.name.toLowerCase() === section || c.slug === slugify(section)
        )
      : undefined;
    if (match && (overwrite || !next.categorySlug)) {
      next.categorySlug = match.slug;
      filled.push("category");
    }
    if (d.keywords.length && (overwrite || next.tags.length === 0)) {
      next.tags = d.keywords;
      filled.push("tags");
    }
    if (!next.slug && next.title) next.slug = slugify(next.title);

    setItem(next);
    return filled;
  };

  const persist = async (submit: boolean) => {
    if (saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const draft: ContentItem = {
        ...item,
        slug: item.slug || slugify(item.title),
      };
      // No id yet means this is the first save — let the database mint one.
      const stored = draft.id
        ? await updateContent(draft.id, draft)
        : await createContent({ ...draft, id: undefined });
      setItem(stored);

      if (submit) {
        await setContentStatus(stored.id, "in_review", user);
        setSaved("review");
        setTimeout(() => router.push(listHref), 700);
      } else {
        // A correction to a live story is not "saved draft" — the trail has to
        // read clearly when someone asks who changed what readers saw.
        await logAudit(
          user,
          stored.status === "published" ? "updated the live" : "saved draft",
          kind,
          stored.title || "(untitled)"
        );
        setSaved("draft");
        setTimeout(() => setSaved(null), 1600);
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Anyone signed in can correct anything, at any status — matching the
  // content_update_any policy. Publishing is still gated separately, so this
  // widens who can fix a story, not who can push one live.
  const editable = true;
  // A live story has no second pair of eyes between the edit and the reader,
  // so the editor says so rather than letting it feel like any other save.
  const editingLive = item.status === "published";

  return (
    <div
      className={`mx-auto pb-12 ${
        // Pix fills the shell — the builder needs every pixel it can get, and
        // the portal layout already caps content at 1440.
        isPix ? "max-w-none" : kind === "qix" ? "max-w-5xl" : "max-w-3xl"
      }`}
    >
      <button
        onClick={() => router.push(listHref)}
        className="btn-ghost mb-5 flex items-center gap-2 px-4 py-2 text-xs"
      >
        <ArrowLeft size={14} /> Back to {meta.label}
      </button>

      <SectionHeader
        title={editId ? `Edit ${meta.label.replace(/s$/, "")}` : `New ${meta.label.replace(/s$/, "")}`}
        sub={`${meta.mode} · ${meta.tagline}`}
      >
        <StatusPill status={item.status} />
      </SectionHeader>

      {item.status === "rejected" && item.reviewNote && (
        <div className="card mb-5 border-l-4 !border-l-rose p-4 text-sm">
          <span className="font-bold text-rose">QA note: </span>
          {item.reviewNote}
        </div>
      )}

      {editingLive && (
        <div className="card mb-5 flex items-start gap-3 border-l-4 !border-l-amber p-4">
          <Radio size={16} className="mt-0.5 shrink-0 text-amber" />
          <p className="text-sm leading-relaxed">
            <span className="font-bold text-amber">This is live. </span>
            Readers see it now, and saving updates the app straight away without
            going back through review. Your name is recorded against the change.
          </p>
        </div>
      )}

      {kind === "qix" ? (
        /* ── UNIFIED SINGLE CONTAINER FOR QIX (LEFT: VIDEO, RIGHT: FIELDS) ── */
        <div className="card space-y-6 p-7 bg-card">
          <div className="grid gap-7 lg:grid-cols-[320px_1fr] items-start">
            {/* LEFT COLUMN: Shorts Video Upload & 9:16 Preview */}
            <div className="space-y-4 rounded-2xl border border-line bg-canvas p-4">
              <div className="flex items-center justify-between border-b border-line/60 pb-2.5">
                <div className="label">Shorts Video Media</div>
                <span className="text-[11px] font-bold text-accent">9:16 Vertical</span>
              </div>

              <MediaDrop
                value={item.mediaUrl || item.coverUrl}
                onChange={(v) => {
                  set("mediaUrl", v);
                  set("coverUrl", v);
                  if (!v) set("durationSec", null);
                }}
                onDurationChange={(dur) => set("durationSec", dur)}
                accept="video/*,image/*"
                hint="Drop MP4/WebM video file"
                aspectRatio="portrait"
              />

              {/* The clip is real, and on the wrong machine.
                  A dozen imports were staged into the CMS's own uploads folder
                  and saved with that path, so they play here and nowhere else.
                  The file is still fetchable from this browser, which makes
                  the repair a copy rather than a re-download. */}
              {rehostable(item.mediaUrl) && (
                <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-ink">
                    This video is stored on the CMS machine, so the app cannot
                    fetch it. Move it to storage to make it playable.
                  </p>
                  <button
                    type="button"
                    disabled={!editable || rehosting}
                    onClick={rehostMedia}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {rehosting ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Moving…
                      </>
                    ) : (
                      <>Move to storage</>
                    )}
                  </button>
                  {rehostErr && (
                    <p className="text-[11px] font-semibold text-rose">{rehostErr}</p>
                  )}
                </div>
              )}

              {/* Why it cannot be published, said here rather than at the end. */}
              {!rehostable(item.mediaUrl) && mediaBlocker("qix", item.mediaUrl) && (
                <p className="text-[11px] font-semibold text-rose">
                  {mediaBlocker("qix", item.mediaUrl)}
                </p>
              )}

              <div className="pt-1">
                <div className="label mb-1">Video Direct URL</div>
                <input
                  className="field text-xs !bg-card"
                  value={item.mediaUrl ?? ""}
                  disabled={!editable}
                  onChange={(e) => {
                    const url = e.target.value || null;
                    set("mediaUrl", url);
                    if (!url) {
                      set("coverUrl", null);
                      set("durationSec", null);
                    } else if (!item.coverUrl) {
                      set("coverUrl", url);
                    }
                  }}
                  placeholder="https://cdn…/shorts.mp4"
                />
              </div>

              {/* YT-DLP YOUTUBE & INSTAGRAM SCRAPER */}
              <div className="pt-3 border-t border-line/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="label font-bold text-ink text-[11px] flex items-center gap-1.5">
                    <Sparkles size={13} className="text-accent" />
                    Import from YouTube
                  </div>
                  <span className="text-[10px] font-mono bg-tint px-2 py-0.5 rounded-full text-accent font-semibold">beta</span>
                </div>

                <div className="flex gap-2">
                  <input
                    className="field text-xs !bg-card flex-1"
                    value={ytUrl}
                    disabled={!editable || scraping}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="Paste a YouTube Shorts link…"
                  />
                  <button
                    type="button"
                    onClick={handleScrapeVideo}
                    disabled={!editable || scraping || !ytUrl.trim()}
                    className="btn-primary text-xs px-3.5 py-2 shrink-0 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {scraping ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Scraping…
                      </>
                    ) : (
                      <>Import</>
                    )}
                  </button>
                </div>

                {scrapeMsg && (
                  <p className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                    ✓ {scrapeMsg}
                  </p>
                )}
                {scrapeErr && (
                  <p className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">
                    ⚠️ {scrapeErr}
                  </p>
                )}
              </div>

              {item.mediaUrl && (
                <div className="pt-2 border-t border-line/60">
                  <a
                    href={item.mediaUrl}
                    download="qix-video.mp4"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full btn-secondary text-xs py-2 flex items-center justify-center gap-2 border border-line rounded-xl hover:bg-canvas transition-colors font-bold text-accent"
                  >
                    <span>⬇️</span> Download MP4 Video File
                  </a>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Content Metadata Form Fields */}
            <div className="space-y-5">
              <div>
                <div className="label mb-2">Title</div>
                <input
                  className="field text-[15px] font-semibold"
                  value={item.title}
                  disabled={!editable}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="A sharp qix title…"
                />
              </div>

              <div>
                <div className="label mb-2">Summary & Script</div>
                <textarea
                  className="field min-h-36 resize-y leading-relaxed"
                  value={item.summary}
                  disabled={!editable}
                  onChange={(e) => set("summary", e.target.value)}
                  placeholder="Context to impact, no fluff…"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="label mb-2">Category</div>
                  <select
                    className="field"
                    value={item.categorySlug ?? ""}
                    disabled={!editable}
                    onChange={(e) => set("categorySlug", e.target.value || null)}
                  >
                    <option value="">— pick one —</option>
                    {categories
                      .filter((c) => c.isActive)
                      .map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <div className="label mb-2">Tags (comma separated)</div>
                  <input
                    className="field"
                    value={item.tags.join(", ")}
                    disabled={!editable}
                    onChange={(e) =>
                      set(
                        "tags",
                        e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean)
                      )
                    }
                    placeholder="economy, explainer"
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="label mb-2">Language</div>
                  <select
                    className="field"
                    value={item.language}
                    disabled={!editable}
                    onChange={(e) => set("language", e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="te">Telugu</option>
                  </select>
                </div>
                <div>
                  <div className="label mb-2">State (optional)</div>
                  <input
                    className="field"
                    value={item.state ?? ""}
                    disabled={!editable}
                    onChange={(e) => set("state", e.target.value || null)}
                    placeholder="e.g. Telangana"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── STANDARD LAYOUT FOR ARTICLES / PIX / TRAX ─────────────────── */
        /* Pix gets a second column for the live poster. */
        <div
          className={
            isPix
              ? "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"
              : undefined
          }
        >
        <div className="card space-y-5 p-7">
          {kind === "article" && editable && (
            <SourceImport onImport={applyImport} disabled={!editable} />
          )}

          {/* Pix types its headline and key points inside the builder, next to
              the poster they land on — see the Poster block below. */}
          {!isPix && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Title</div>
                {kind === "article" && (
                  <span
                    className={`text-[11px] font-bold ${
                      titleChars > ARTICLE_TITLE_MAX ? "text-rose" : "text-faint"
                    }`}
                  >
                    {titleChars}/{ARTICLE_TITLE_MAX}
                  </span>
                )}
              </div>
              <input
                className="field text-[15px] font-semibold"
                value={item.title}
                disabled={!editable}
                maxLength={kind === "article" ? ARTICLE_TITLE_MAX : undefined}
                onChange={(e) => set("title", e.target.value)}
                placeholder={`A sharp ${meta.label.replace(/s$/, "").toLowerCase()} title…`}
              />
            </div>
          )}

          {!isPix && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="label">
                {kind === "article" ? "Description" : "Summary"}
              </div>
              {kind === "article" && (
                <span
                  className={`text-[11px] font-bold ${
                    descChars > ARTICLE_DESC_MAX ? "text-rose" : "text-faint"
                  }`}
                >
                  {descChars}/{ARTICLE_DESC_MAX}
                </span>
          )}
            </div>
            <textarea
              className="field min-h-28 resize-y leading-relaxed"
              value={item.summary}
              disabled={!editable}
              maxLength={kind === "article" ? ARTICLE_DESC_MAX : undefined}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="Context to impact, no fluff…"
            />
          </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="label mb-2">Category</div>
              <select
                className="field"
                value={item.categorySlug ?? ""}
                disabled={!editable}
                onChange={(e) => set("categorySlug", e.target.value || null)}
              >
                <option value="">— pick one —</option>
                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <div className="label mb-2">Tags (comma separated)</div>
              <input
                className="field"
                value={item.tags.join(", ")}
                disabled={!editable}
                onChange={(e) =>
                  set(
                    "tags",
                    e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                  )
                }
                placeholder="economy, explainer"
              />
            </div>
          </div>

          {isPix ? (
            /* Pix builds its poster here rather than dropping a bare cover. */
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Poster</div>
                <span className="text-[11px] font-semibold text-faint">
                  Pix Post Builder
                </span>
              </div>
              <PixComposer
                headline={item.title}
                onHeadline={(v) => set("title", v)}
                points={points}
                onPoints={setPoints}
                source={item.sourceLinks[0] ?? null}
                onSource={(s) => set("sourceLinks", s ? [s] : [])}
                coverUrl={item.coverUrl}
                disabled={!editable}
                onCommit={(url, masterUrl) => {
                  set("coverUrl", url);
                  // Cleared when the cover is a bare source photograph, so the
                  // master never outlives the poster it belongs to.
                  set("coverMasterUrl", masterUrl);
                }}
              />
              <input
                className="field mt-3"
                value={
                  item.coverUrl && !item.coverUrl.startsWith("data:")
                    ? item.coverUrl
                    : ""
                }
                disabled={!editable}
                onChange={(e) => set("coverUrl", e.target.value || null)}
                placeholder="…or paste an image URL to build from"
              />
            </div>
          ) : (
          <div>
            <div className="label mb-2">Cover image</div>
            <MediaDrop
              value={item.coverUrl}
              onChange={(v) => set("coverUrl", v)}
            />
            <input
              className="field mt-2"
              value={
                item.coverUrl && !item.coverUrl.startsWith("data:")
                  ? item.coverUrl
                  : ""
              }
              disabled={!editable}
              onChange={(e) => set("coverUrl", e.target.value || null)}
              placeholder="…or paste an image URL"
            />
          </div>
          )}

          {kind === "trax" && (
            <div className="grid gap-5 sm:grid-cols-[1fr_140px]">
              <div>
                <div className="label mb-2">Audio URL</div>
                <input
                  className="field"
                  value={item.mediaUrl ?? ""}
                  disabled={!editable}
                  onChange={(e) => set("mediaUrl", e.target.value || null)}
                  placeholder="https://cdn…/episode.mp3"
                />
                {/* Trax had no validation and no preview: a URL was typed into
                    a box and believed. The one published episode points at
                    cdn.dailymattr.example — `.example` is a reserved TLD that
                    can never resolve — and nothing anywhere said so. Publishing
                    is blocked on this now (lib/media), but being told at the
                    point of typing is worth more than being told at the end. */}
                {item.mediaUrl?.trim() ? (
                  mediaBlocker("trax", item.mediaUrl) ? (
                    <p className="mt-2 text-[11px] font-semibold text-rose">
                      {mediaBlocker("trax", item.mediaUrl)}
                    </p>
                  ) : (
                    <audio
                      src={item.mediaUrl}
                      controls
                      preload="none"
                      className="mt-3 w-full"
                    />
                  )
                ) : null}
              </div>
              <div>
                <div className="label mb-2">Duration (sec)</div>
                <input
                  className="field"
                  type="number"
                  min={0}
                  value={item.durationSec ?? ""}
                  disabled={!editable}
                  onChange={(e) =>
                    set(
                      "durationSec",
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </div>
            </div>
          )}

          {kind === "article" && (
            <div>
              <div className="label mb-2">Primary source link</div>
              <input
                className="field"
                value={item.sourceLinks[0]?.url ?? ""}
                disabled={!editable}
                onChange={(e) =>
                  set(
                    "sourceLinks",
                    e.target.value
                      ? [{ title: "Source", url: e.target.value }]
                      : []
                  )
                }
                placeholder="https://…"
              />
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="label mb-2">Language</div>
              <select
                className="field"
                value={item.language}
                disabled={!editable}
                onChange={(e) => set("language", e.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
              </select>
            </div>
            <div>
              <div className="label mb-2">State (optional)</div>
              <input
                className="field"
                value={item.state ?? ""}
                disabled={!editable}
                onChange={(e) => set("state", e.target.value || null)}
                placeholder="e.g. Telangana"
              />
            </div>
          </div>
        </div>

        {isPix && (
          <aside className="h-fit xl:sticky xl:top-4">
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-1 rounded-full bg-canvas p-1">
                {(
                  [
                    ["list", "Feed card"],
                    ["page", "Reader page"],
                  ] as [PixPlacement, string][]
                ).map(([p, label]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlacement(p)}
                    className={`flex-1 rounded-full px-2 py-1.5 text-[11px] font-bold transition-colors ${
                      placement === p
                        ? "bg-shell text-white"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="shadow-(--shadow-soft)">
                <PixBezel item={item} placement={placement} />
              </div>

              <p className="mt-2 text-center text-[10px] text-faint">
                Tap the dots to see slide two
              </p>

              <div className="mt-4 border-t border-line pt-3">
                <p className="label mb-1.5">Marked words</p>
                <p className="text-[11px] leading-relaxed text-muted">
                  Figures, months, acronyms and proper nouns turn blue on device
                  — never the first word.{" "}
                  {item.title.trim() ? (
                    <span
                      className={`font-bold ${
                        blue.cappedBack ? "text-amber" : "text-mint"
                      }`}
                    >
                      {Math.round(blue.share * 100)}% of this headline marks
                      {blue.cappedBack
                        ? " — over the 45% ceiling, so proper nouns were dropped and only figures and acronyms stay blue."
                        : "."}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </aside>
        )}
        </div>
      )}

      {editable && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          // A compact pill hugged to the right, rather than a full-width bar —
          // it only holds two buttons and a status line.
          className="sticky bottom-4 z-30 mt-5 ml-auto flex w-fit max-w-full items-center gap-2 rounded-full bg-shell p-1.5 pl-4 shadow-(--shadow-pop)"
        >
          {/* There is no autosave — Draft and Submit are the only writes — so
              this says what happened rather than promising anything. Errors
              stay visible at every width; the rest is a small-screen luxury. */}
          {saveErr ? (
            <span className="max-w-[15rem] truncate text-[11px] font-medium text-rose">
              {saveErr}
            </span>
          ) : (
            <span className="hidden text-[11px] font-medium whitespace-nowrap text-white/55 sm:block">
              {saved === "draft"
                ? editingLive
                  ? "Updated in the app ✓"
                  : "Draft saved ✓"
                : saved === "review"
                  ? "Sent to QA ✓"
                  : overLimit
                    ? "Trim to the character limits to save"
                    : item.status === "rejected"
                      ? "Revise and resubmit"
                      : saving
                        ? "Saving…"
                        : ""}
            </span>
          )}

          {editingLive ? (
            /* Submitting a live story would pull it out of the app, which is
               never what "edit" means here — so it saves in place instead. */
            <button
              onClick={() => persist(false)}
              disabled={!item.title || saving || overLimit}
              title={
                overLimit
                  ? "Trim to the character limits first"
                  : "Update the live story"
              }
              className="btn-accent flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] whitespace-nowrap disabled:opacity-40"
            >
              <Save size={12} /> Update live
            </button>
          ) : (
            <>
              <button
                onClick={() => persist(false)}
                disabled={!item.title || saving}
                title="Save draft"
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold whitespace-nowrap text-white transition-all hover:bg-white/20 active:scale-95 disabled:opacity-40"
              >
                <Save size={12} /> Draft
              </button>
              <button
                onClick={() => persist(true)}
                disabled={
                  !item.title ||
                  saving ||
                  overLimit ||
                  (isPix ? filledPoints < PIX_POINT_COUNT : !item.summary)
                }
                title={
                  isPix && filledPoints < PIX_POINT_COUNT
                    ? `All ${PIX_POINT_COUNT} key points are needed before review`
                    : !item.summary && !isPix
                      ? "Add a summary before submitting"
                      : "Submit for review"
                }
                className="btn-accent flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] whitespace-nowrap disabled:opacity-40"
              >
                <Send size={12} /> Submit
              </button>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
