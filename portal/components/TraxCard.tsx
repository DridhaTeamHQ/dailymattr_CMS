"use client";

import { useState } from "react";
import Link from "next/link";
import { AudioLines, Eye, Pencil, Play } from "lucide-react";
import { StatusPill } from "@/components/ui";
import type { ContentItem } from "@/lib/types";
import { mediaBlocker } from "@/lib/media";
import { estimateDurationSec } from "@/lib/tts";

const fmtDur = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 1) return sec > 0 ? `${m}m ${sec}s` : `${m} min`;
  return `${s}s`;
};

/**
 * Music Player style 1:1 square album artwork frame with bottom-right play circle badge.
 * Inspired by mobile music app UI kits.
 */
export function TraxFrame({
  item,
  onClick,
}: {
  item: ContentItem;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={onClick ? `Listen to ${item.title}` : undefined}
      className={`group relative aspect-square w-full overflow-hidden rounded-2xl bg-ink shadow-md ${
        onClick
          ? "cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
          : ""
      }`}
    >
      {item.coverUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white/45 p-4 text-center">
          <AudioLines size={36} className="text-accent" />
          <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">
            Audio Explainer
          </span>
        </div>
      )}

      {/* Subtle bottom gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

      {/* Top Left Listen Badge */}
      <span className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full border border-white/10 bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white/90 backdrop-blur-md">
        <AudioLines size={10} className="text-accent" /> LISTEN
      </span>

      {/* Bottom Right Floating Play Circle Badge */}
      <div className="absolute right-2.5 bottom-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#d8f231] text-black shadow-lg transition-transform duration-200 group-hover:scale-110">
        <Play size={15} className="ml-0.5 fill-black" />
      </div>
    </div>
  );
}

/** Trax tile for the grid — styled in Music Player UI format with expandable title & summary. */
export function TraxCard({
  item,
  author,
  onView,
  actions,
}: {
  item: ContentItem;
  author?: string;
  onView: () => void;
  actions?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const realDurationSec =
    !item.mediaUrl || mediaBlocker("trax", item.mediaUrl)
      ? estimateDurationSec(item.summary || "")
      : item.durationSec;
  const duration = fmtDur(realDurationSec);

  return (
    <div className="mx-auto flex w-full max-w-[185px] flex-col gap-2">
      {/* 1:1 Square Album Cover */}
      <TraxFrame item={item} onClick={onView} />

      {/* Title & Subtitle */}
      <div className="mt-0.5 space-y-1">
        <h3
          onClick={() => setExpanded(!expanded)}
          className={`cursor-pointer text-[13px] font-extrabold leading-snug text-ink hover:text-accent transition-all ${
            expanded ? "" : "line-clamp-2"
          }`}
          title={expanded ? "Click to collapse" : "Click to view full title"}
        >
          {item.title || "Untitled Trax"}
        </h3>

        <p
          onClick={() => setExpanded(!expanded)}
          className={`cursor-pointer text-[11px] font-medium text-muted leading-relaxed transition-all ${
            expanded ? "" : "line-clamp-2"
          }`}
          title={expanded ? "Click to collapse" : "Click to view full summary"}
        >
          {item.summary || (duration ? `${duration} · Audio` : "Audio explainer")}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {actions ?? (
          <>
            <Link
              href={`/content/trax/editor?id=${item.id}`}
              className="btn-primary flex flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px]"
            >
              <Pencil size={11} /> Edit
            </Link>
            <button
              type="button"
              onClick={onView}
              className="btn-ghost flex flex-1 items-center justify-center gap-1 px-2 py-1 text-[11px]"
            >
              <Eye size={11} /> View
            </button>
          </>
        )}
      </div>

      {/* Status Pill & Author */}
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <StatusPill status={item.status} />
        <span className="truncate text-faint max-w-[85px]" title={author}>
          {author ?? "—"}
        </span>
      </div>
    </div>
  );
}
