"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Link2, Sparkles, Wand2 } from "lucide-react";
import type { ScrapeResult } from "@/app/api/scrape/route";

export interface ImportedArticle {
  title: string | null;
  summary: string | null;
  image: string | null;
  section: string | null;
  keywords: string[];
  sourceUrl: string;
  siteName: string | null;
}

/**
 * Paste a news URL and pull the headline, story and image off the page so the
 * writer edits rather than types from scratch. Scraping happens server-side
 * (browsers can't read cross-origin pages).
 */
export default function SourceImport({
  onImport,
  disabled,
}: {
  onImport: (data: ImportedArticle, overwrite: boolean) => string[];
  disabled?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<string[] | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  const run = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setFilled(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as ScrapeResult & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Couldn't import that link.");
        return;
      }
      const applied = onImport(
        {
          title: json.title,
          summary: json.summary,
          image: json.image,
          section: json.section,
          keywords: json.keywords ?? [],
          sourceUrl: json.url,
          siteName: json.siteName,
        },
        overwrite
      );
      setFilled(applied);
    } catch {
      setError("Network error while importing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-dashed border-accent/40 bg-tint/40 p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
          <Wand2 size={16} />
        </span>
        <div>
          <h3 className="text-sm font-bold">Start from a source link</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Paste a news URL — Studio pulls the headline, story and image so you
            can edit instead of writing from scratch. Optional.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Link2
            size={15}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
          />
          <input
            className="field !bg-card pl-10"
            value={url}
            disabled={disabled || busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), run())}
            placeholder="https://www.ndtv.com/india-news/…"
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={disabled || busy || !url.trim()}
          className="btn-accent flex items-center gap-2 px-5 py-2.5 text-xs disabled:opacity-40"
        >
          {busy ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Reading…
            </>
          ) : (
            <>
              <Sparkles size={14} /> Fetch story
            </>
          )}
        </button>
      </div>

      <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-[11px] font-semibold text-muted select-none">
        <input
          type="checkbox"
          checked={overwrite}
          onChange={(e) => setOverwrite(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        Replace fields I&apos;ve already filled in
      </label>

      {/* One keyed child: content swaps in place, so a new result always
          replaces the previous one (two sibling conditionals here would
          deadlock AnimatePresence and strand the old message). */}
      <AnimatePresence initial={false}>
        {(error || filled) && (
          <motion.p
            key="notice"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`mt-3 flex items-start gap-1.5 text-[12px] font-medium ${
              error ? "text-rose" : "text-mint"
            }`}
          >
            {error ? (
              <>
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                {error}
              </>
            ) : filled?.length ? (
              `Imported ${filled.join(", ")} — review and edit before submitting.`
            ) : (
              "Nothing new to fill — tick “Replace fields” to overwrite what you have."
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
