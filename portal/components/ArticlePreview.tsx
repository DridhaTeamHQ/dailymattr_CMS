"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Sparkles, Star } from "lucide-react";
import { Modal, Pill } from "./ui";
import { timeAgo } from "@/lib/store";
import type { ArticleSelection, NewsStudioArticle } from "@/lib/types";

/**
 * Phone-frame preview of a NewsStudio article exactly as the DailyMattr app
 * renders it (image first, 60-word story, FACT badge), with editorial
 * overrides. Overrides are stored on the CMS-side selection row — the
 * NewsStudio database is never written to.
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
  onSave: (patch: { titleOverride: string | null; summaryOverride: string | null }) => void;
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
  const edited =
    title !== article.title || summary !== article.summary;
  const inFeed = !!selection;

  const save = () => {
    onSave({
      titleOverride: title === article.title ? null : title,
      summaryOverride: summary === article.summary ? null : summary,
    });
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(0), 1600);
  };

  const revert = () => {
    setTitle(article.title);
    setSummary(article.summary);
  };

  return (
    <Modal open={!!article} onClose={onClose} title="App preview" wide>
      <div className="grid gap-8 md:grid-cols-[268px_1fr]">
        {/* ── phone frame ─────────────────────────────── */}
        <div className="mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="w-[268px] rounded-[2.6rem] bg-ink p-2.5 shadow-(--shadow-pop)"
          >
            <div className="relative h-[532px] overflow-hidden rounded-[2.1rem] bg-white">
              {/* notch */}
              <div className="absolute top-2 left-1/2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-ink" />

              {/* image-first, like the app's swipe card */}
              <div className="relative h-[290px] w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={article.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute bottom-3 left-4 flex items-center gap-1.5">
                  <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-ink uppercase">
                    {article.category}
                  </span>
                  {selection?.isFeatured && (
                    <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-extrabold text-white">
                      FEATURED
                    </span>
                  )}
                </div>
              </div>

              {/* story */}
              <div className="flex h-[242px] flex-col p-4">
                <h3 className="text-[15px] leading-[1.25] font-extrabold tracking-tight">
                  {title || "Untitled story"}
                </h3>
                <p className="mt-2 flex-1 overflow-hidden text-[11.5px] leading-[1.55] text-muted">
                  {summary}
                </p>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-[9.5px] font-extrabold tracking-wider text-mint">
                    FACT {article.factScore} · {article.sourceCount} SRC
                  </span>
                  <span className="text-[9.5px] font-semibold text-faint">
                    {timeAgo(article.publishedAt)}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
          <p className="mt-3 text-center text-[11px] text-faint">
            {article.source} · read view
          </p>
        </div>

        {/* ── editor side ─────────────────────────────── */}
        <div className="flex flex-col">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone="accent">{article.category}</Pill>
            <Pill tone={article.factScore >= 93 ? "mint" : "amber"}>
              FACT {article.factScore}
            </Pill>
            <Pill tone="muted">{article.sourceCount} sources</Pill>
            {edited && <Pill tone="violet">Edited</Pill>}
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
                  className={`px-4 py-2.5 text-xs ${inFeed ? "btn-ghost" : "btn-accent"}`}
                >
                  {inFeed ? "Remove from feed" : "Add to app feed"}
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
                    onClick={revert}
                    title="Revert to the original NewsStudio copy"
                    className="btn-ghost flex h-9 w-9 items-center justify-center !p-0"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={!inFeed}
                  title={inFeed ? "" : "Add to the feed first"}
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
                Chief editors curate and edit what appears in the app feed.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
