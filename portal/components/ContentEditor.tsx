"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Save, Send, Sparkles } from "lucide-react";
import MediaDrop from "@/components/MediaDrop";
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
    <div className={`mx-auto pb-12 ${kind === "qix" ? "max-w-5xl" : "max-w-3xl"}`}>
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
        /* ── STANDARD SINGLE-COLUMN LAYOUT FOR ARTICLES / PIX / TRAX ──── */
        <div className="card space-y-5 p-7">
          <div>
            <div className="label mb-2">Title</div>
            <input
              className="field text-[15px] font-semibold"
              value={item.title}
              disabled={!editable}
              onChange={(e) => set("title", e.target.value)}
              placeholder={`A sharp ${meta.label.replace(/s$/, "").toLowerCase()} title…`}
            />
          </div>

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
              disabled={!item.title || !item.summary}
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
