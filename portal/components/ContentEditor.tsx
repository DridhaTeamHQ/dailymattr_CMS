"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Save, Send, Sparkles } from "lucide-react";
import MediaDrop from "@/components/MediaDrop";
import { PixBezel } from "@/components/PixPoster";
import SourceImport, { type ImportedArticle } from "@/components/SourceImport";
import { SectionHeader, StatusPill } from "@/components/ui";
import { can, useAuth } from "@/lib/auth";
import {
  getCategories,
  getContent,
  logAudit,
  setStatus,
  slugify,
  uid,
  upsertContent,
} from "@/lib/store";
import {
  PIX_CHARS_PER_LINE,
  PIX_LINES,
  PIX_POINT_COUNT,
  PIX_POINT_MAX,
  PIX_TITLE_MAX,
  getPixPoints,
  pixLines,
  pixSummary,
  type PixPlacement,
} from "@/lib/pix";
import { markReport } from "@/lib/pixHighlight";
import { KIND_META, type ContentItem, type ContentKind } from "@/lib/types";

const emptyItem = (kind: ContentKind, userId: string): ContentItem => ({
  id: uid(),
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
  const categories = useMemo(() => getCategories(), []);

  const handleScrapeVideo = async () => {
    if (!ytUrl.trim()) return;
    setScraping(true);
    setScrapeErr(null);
    setScrapeMsg(null);

    try {
      const res = await fetch("/api/scrape-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim() }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.videoUrl) set("mediaUrl", data.videoUrl);
        if (data.coverUrl) set("coverUrl", data.coverUrl);
        if (data.durationSec) set("durationSec", data.durationSec);
        if (data.title) {
          set("title", data.title);
        }
        setScrapeMsg(data.isFallback ? "Video details imported!" : "Successfully scraped with yt-dlp!");
      } else {
        setScrapeErr(data.error || "Failed to scrape video URL.");
      }
    } catch (err: any) {
      setScrapeErr("Error connecting to scraper service.");
    } finally {
      setScraping(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    if (editId) {
      const found = getContent().find((c) => c.id === editId);
      if (found) {
        setItem(found);
        return;
      }
    }
    setItem(emptyItem(kind, user.id));
  }, [editId, kind, user]);

  useEffect(() => {
    if (
      item?.mediaUrl &&
      (item.mediaUrl.includes("commondatastorage.googleapis.com") ||
        item.mediaUrl.includes("gtv-videos-bucket") ||
        item.mediaUrl.includes("googlevideo.com"))
    ) {
      setItem((prev) =>
        prev
          ? {
              ...prev,
              mediaUrl:
                "https://assets.mixkit.co/videos/preview/mixkit-a-girl-blowing-a-bubble-gum-bubble-41537-large.mp4",
            }
          : prev
      );
    }
  }, [item?.mediaUrl]);

  if (!user || !item) return null;

  const meta = KIND_META[kind];
  const listHref = kind === "article" ? "/content/articles" : `/content/${kind}`;
  const set = <K extends keyof ContentItem>(k: K, v: ContentItem[K]) =>
    setItem((it) => (it ? { ...it, [k]: v } : it));

  const wordCount = item.summary.trim() ? item.summary.trim().split(/\s+/).length : 0;

  const isPix = kind === "pix";
  const points = getPixPoints(item);
  const filledPoints = points.filter((p) => p.trim()).length;
  const titleLines = {
    list: pixLines(item.title, PIX_CHARS_PER_LINE.headlineList),
    page: pixLines(item.title, PIX_CHARS_PER_LINE.headlinePage),
  };
  const blue = markReport(item.title);

  const setPoint = (idx: number, value: string) =>
    setItem((it) => {
      if (!it) return it;
      const next = getPixPoints(it);
      next[idx] = value.slice(0, PIX_POINT_MAX);
      return {
        ...it,
        body: { ...it.body, points: next },
        summary: pixSummary(next),
      };
    });

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

  const persist = (submit: boolean) => {
    const final: ContentItem = {
      ...item,
      slug: item.slug || slugify(item.title),
    };
    upsertContent(final);
    if (submit) {
      setStatus(final.id, "in_review", user);
      setSaved("review");
      setTimeout(() => router.push(listHref), 700);
    } else {
      logAudit(user, "saved draft", kind, final.title || "(untitled)");
      setSaved("draft");
      setTimeout(() => setSaved(null), 1600);
    }
  };

  const editable =
    item.status === "draft" ||
    item.status === "rejected" ||
    can.editAny(user.role);

  return (
    <div
      className={`mx-auto pb-12 ${
        kind === "qix" || isPix ? "max-w-5xl" : "max-w-3xl"
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

      {kind === "qix" ? (
        /* ── UNIFIED SINGLE CONTAINER FOR QIX (LEFT: VIDEO, RIGHT: FIELDS) ── */
        <div className="card space-y-6 p-7 bg-white">
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

              <div className="pt-1">
                <div className="label mb-1">Video Direct URL</div>
                <input
                  className="field text-xs !bg-white"
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
                    Scrape YouTube / Instagram
                  </div>
                  <span className="text-[10px] font-mono bg-tint px-2 py-0.5 rounded-full text-accent font-semibold">yt-dlp</span>
                </div>

                <div className="flex gap-2">
                  <input
                    className="field text-xs !bg-white flex-1"
                    value={ytUrl}
                    disabled={!editable || scraping}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="Paste YouTube Shorts or Reel link…"
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
              ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_252px]"
              : undefined
          }
        >
        <div className="card space-y-5 p-7">
          {kind === "article" && editable && (
            <SourceImport onImport={applyImport} disabled={!editable} />
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="label">{isPix ? "Headline" : "Title"}</div>
              {isPix && (
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    titleLines.list > PIX_LINES.headline
                      ? "text-rose"
                      : item.title.length > PIX_TITLE_MAX * 0.9
                        ? "text-amber"
                        : "text-faint"
                  }`}
                >
                  {item.title.length} / {PIX_TITLE_MAX} · {titleLines.list} of{" "}
                  {PIX_LINES.headline} lines
                </span>
              )}
            </div>
            <input
              className="field text-[15px] font-semibold"
              value={item.title}
              maxLength={isPix ? PIX_TITLE_MAX : undefined}
              disabled={!editable}
              onChange={(e) => set("title", e.target.value)}
              placeholder={`A sharp ${meta.label.replace(/s$/, "").toLowerCase()} title…`}
            />
            {isPix && (
              <p className="mt-2 text-[11px] text-faint">
                Four lines on both placements — about{" "}
                {PIX_CHARS_PER_LINE.headlineList} characters per line in the
                feed card, {PIX_CHARS_PER_LINE.headlinePage} on the reader page.
                Anything longer is truncated, not wrapped.
              </p>
            )}
          </div>

          {isPix ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="label">Key points</div>
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    filledPoints === PIX_POINT_COUNT ? "text-mint" : "text-faint"
                  }`}
                >
                  {filledPoints} / {PIX_POINT_COUNT}
                </span>
              </div>
              <div className="space-y-2">
                {points.map((p, i) => {
                  const lines = pixLines(p, PIX_CHARS_PER_LINE.point);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-[4px]"
                        style={{ background: "var(--color-accent)" }}
                      />
                      <input
                        className="field"
                        value={p}
                        maxLength={PIX_POINT_MAX}
                        disabled={!editable}
                        onChange={(e) => setPoint(i, e.target.value)}
                        placeholder={`Point ${i + 1} — one fact, up to ${PIX_LINES.point} lines…`}
                      />
                      <span
                        className={`w-20 shrink-0 text-right text-[11px] font-bold tabular-nums ${
                          lines > PIX_LINES.point
                            ? "text-rose"
                            : p.length > PIX_POINT_MAX * 0.9
                              ? "text-amber"
                              : "text-faint"
                        }`}
                      >
                        {p.length} / {PIX_POINT_MAX}
                        <span className="block font-medium text-faint">
                          {lines}/{PIX_LINES.point} lines
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-faint">
                Exactly {PIX_POINT_COUNT} points — slide two has three slots and
                all of them are required before submitting for review.
              </p>
            </div>
          ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="label">
                {kind === "article" ? "60-word story" : "Summary"}
              </div>
              {kind === "article" && (
                <span
                  className={`text-[11px] font-bold ${
                    wordCount > 60 ? "text-rose" : "text-faint"
                  }`}
                >
                  {wordCount}/60 words
                </span>
              )}
            </div>
            <textarea
              className="field min-h-28 resize-y leading-relaxed"
              value={item.summary}
              disabled={!editable}
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
          <aside className="h-fit lg:sticky lg:top-6">
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
                        ? "bg-ink text-white"
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
          className="sticky bottom-4 mt-5 flex items-center justify-between gap-3 rounded-full bg-ink p-2 pl-6 shadow-(--shadow-pop) z-30"
        >
          <span className="text-xs font-medium text-white/60">
            {saved === "draft"
              ? "Draft saved ✓"
              : saved === "review"
                ? "Sent to QA ✓"
                : item.status === "rejected"
                  ? "Revise and resubmit"
                  : "Autosaves locally in demo mode"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => persist(false)}
              disabled={!item.title}
              className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-white/20 active:scale-95 disabled:opacity-40"
            >
              <Save size={14} /> Save draft
            </button>
            <button
              onClick={() => persist(true)}
              disabled={
                !item.title ||
                (isPix ? filledPoints < PIX_POINT_COUNT : !item.summary)
              }
              className="btn-accent flex items-center gap-2 px-5 py-2.5 text-xs disabled:opacity-40"
            >
              <Send size={14} /> Submit for review
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
