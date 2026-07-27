"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Bookmark,
  Check,
  Headphones,
  Heart,
  LayoutGrid,
  MessageCircle,
  RotateCcw,
  Share2,
  Sparkles,
  Star,
  Wifi,
} from "lucide-react";
import NewsVisual from "./NewsVisual";
import { Modal, Pill } from "./ui";
import { timeAgo } from "@/lib/store";
import type { ArticleSelection, NewsStudioArticle } from "@/lib/types";

/** Stable brand-ish colour for a publisher badge. */
function sourceHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function StatusBar() {
  return (
    <div className="relative z-20 flex items-center justify-between px-5 pt-2.5 text-white">
      <span className="text-[11px] font-semibold">1:29</span>
      <div className="flex items-center gap-1">
        <Wifi size={11} />
        <span className="flex items-end gap-[1px]">
          {[3, 5, 7, 9].map((h) => (
            <span
              key={h}
              className="w-[2px] rounded-sm bg-white"
              style={{ height: h }}
            />
          ))}
        </span>
        <span className="ml-0.5 rounded-[4px] border border-white/70 px-1 text-[8px] font-bold">
          76
        </span>
      </div>
    </div>
  );
}

const glass =
  "rounded-full bg-white/20 backdrop-blur-md text-white border border-white/10";

/**
 * Phone-frame preview of a NewsStudio article exactly as the DailyMattr app
 * renders it, with editorial overrides. Overrides are stored on the CMS-side
 * selection row — the NewsStudio database is never written to.
 */
export default function ArticlePreview({
  article,
  selection,
  canEdit,
  onClose,
  onSave,
  onToggleFeed,
  onToggleFeature,
}: {
  article: NewsStudioArticle | null;
  selection: ArticleSelection | undefined;
  canEdit: boolean;
  onClose: () => void;
  onSave: (patch: {
    titleOverride: string | null;
    summaryOverride: string | null;
  }) => void;
  onToggleFeed: () => void;
  onToggleFeature: () => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (!article) return;
    setTitle(selection?.titleOverride ?? article.title);
    setSummary(selection?.summaryOverride ?? article.summary);
  }, [article, selection]);

  if (!article) return null;

  const words = summary.trim() ? summary.trim().split(/\s+/).length : 0;
  const edited = title !== article.title || summary !== article.summary;
  const inFeed = !!selection;
  const hue = sourceHue(article.source);
  const initials = article.source
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 3)
    .join("")
    .toUpperCase();

  const save = () => {
    onSave({
      titleOverride: title === article.title ? null : title,
      summaryOverride: summary === article.summary ? null : summary,
    });
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(0), 1600);
  };

  return (
    <Modal open={!!article} onClose={onClose} title="App preview" wide>
      <div className="grid gap-8 md:grid-cols-[300px_1fr]">
        {/* ── phone ───────────────────────────────────────── */}
        <div className="mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="w-[300px] rounded-[2.4rem] bg-black p-[7px] shadow-(--shadow-pop)"
          >
            <div className="relative h-[610px] overflow-hidden rounded-[2rem] bg-black">
              <NewsVisual src={article.imageUrl} imageHeight="52%" />

              <StatusBar />

              {/* chips */}
              <div className="relative z-20 mt-2.5 flex items-center justify-between px-4">
                <span
                  className={`${glass} px-3.5 py-1.5 text-[11px] font-semibold`}
                >
                  {article.category}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`${glass} px-3 py-1.5 text-[11px] font-semibold`}
                  >
                    {timeAgo(article.publishedAt)}
                  </span>
                  <span
                    className={`${glass} flex h-8 w-8 items-center justify-center`}
                  >
                    <LayoutGrid size={14} />
                  </span>
                </div>
              </div>

              {/* story */}
              <div className="absolute inset-x-0 bottom-0 z-20 px-5 pb-3">
                <h3 className="text-[20px] leading-[1.16] font-extrabold tracking-tight text-white">
                  {title || "Untitled story"}
                </h3>
                <p
                  className="mt-3 text-[13px] leading-[1.62] text-white/85"
                  style={{
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 9,
                    overflow: "hidden",
                  }}
                >
                  {summary}
                </p>

                {/* actions */}
                <div className="mt-4 flex items-center justify-between pb-1">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[8px] font-extrabold text-white"
                    style={{ background: `hsl(${hue} 72% 45%)` }}
                    title={article.source}
                  >
                    {initials}
                  </span>
                  <div className="flex items-center gap-2">
                    {[Headphones, Heart, Bookmark, Share2, MessageCircle].map(
                      (Icon, i) => (
                        <span
                          key={i}
                          className={`${glass} flex h-8 w-8 items-center justify-center`}
                        >
                          <Icon size={13} />
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* home indicator */}
                <div className="mx-auto mt-2 h-1 w-28 rounded-full bg-white/70" />
              </div>
            </div>
          </motion.div>
          <p className="mt-3 text-center text-[11px] text-faint">
            {article.source} · read view
          </p>
        </div>

        {/* ── editor ──────────────────────────────────────── */}
        <div className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone="accent">{article.category}</Pill>
            <Pill tone={article.factScore >= 93 ? "mint" : "amber"}>
              FACT {article.factScore}
            </Pill>
            <Pill tone="muted">{article.sourceCount} sources</Pill>
            {edited && <Pill tone="violet">Edited</Pill>}
            {selection && (
              <Pill tone="mint">Approved · #{selection.position} in feed</Pill>
            )}
          </div>

          {canEdit ? (
            <>
              <div className="label mb-2">Headline shown in the app</div>
              <input
                className="field mb-4 font-semibold"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <div className="mb-2 flex items-center justify-between">
                <span className="label">Story</span>
                <span
                  className={`text-[11px] font-bold ${
                    words > 60 ? "text-rose" : "text-faint"
                  }`}
                >
                  {words}/60 words
                </span>
              </div>
              <textarea
                className="field min-h-32 flex-1 resize-y leading-relaxed"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />

              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Edits are saved as CMS overrides — the NewsStudio pipeline
                database is never modified.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  onClick={onToggleFeed}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs ${
                    inFeed ? "btn-ghost hover:!text-rose" : "btn-accent"
                  }`}
                >
                  {inFeed ? (
                    "Remove from feed"
                  ) : (
                    <>
                      <Check size={13} strokeWidth={3} /> Approve for feed
                    </>
                  )}
                </button>
                {inFeed && (
                  <button
                    onClick={onToggleFeature}
                    className={`btn-ghost flex items-center gap-1.5 px-4 py-2.5 text-xs ${
                      selection?.isFeatured ? "!border-violet !text-violet" : ""
                    }`}
                  >
                    {selection?.isFeatured ? (
                      <Sparkles size={13} />
                    ) : (
                      <Star size={13} />
                    )}
                    {selection?.isFeatured ? "Featured" : "Feature"}
                  </button>
                )}
                {edited && (
                  <button
                    onClick={() => {
                      setTitle(article.title);
                      setSummary(article.summary);
                    }}
                    title="Revert to the original NewsStudio copy"
                    className="btn-ghost flex h-9 w-9 items-center justify-center !p-0"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={!inFeed}
                  title={inFeed ? "" : "Approve the story first"}
                  className="btn-primary ml-auto px-5 py-2.5 text-xs disabled:opacity-40"
                >
                  {savedAt ? "Saved ✓" : "Save overrides"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg leading-snug font-bold">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{summary}</p>
              <p className="mt-5 text-[11px] text-faint">
                QA approves and edits what appears in the app feed.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
