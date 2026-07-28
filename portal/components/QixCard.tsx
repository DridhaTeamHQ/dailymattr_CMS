"use client";

import Link from "next/link";
import { Clapperboard, Eye, Pencil, Play } from "lucide-react";
import { StatusPill } from "@/components/ui";
import type { ContentItem } from "@/lib/types";

/** Anything we can actually play inline. */
export const hasPlayableVideo = (url: string | null) =>
  !!url &&
  (url.endsWith(".mp4") ||
    url.endsWith(".webm") ||
    url.startsWith("data:video") ||
    url.startsWith("/api/media/"));

const fmtDur = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 1) return sec > 0 ? `${m}m ${sec}s` : `${m} min`;
  return `${s}s`;
};

/**
 * The Qix short as the app frames it — 9:16, poster-first, playing on hover.
 *
 * Deliberately the same shape as PixCard: frame, then the action row, then
 * status and byline underneath. Keeping the chrome outside the frame means the
 * tile shows the video the reader gets, not a CMS-decorated version of it.
 */
export function QixFrame({
  item,
  onClick,
}: {
  item: ContentItem;
  onClick?: () => void;
}) {
  const playable = hasPlayableVideo(item.mediaUrl);
  const duration = fmtDur(item.durationSec);

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
      aria-label={onClick ? `Play ${item.title}` : undefined}
      className={`group relative aspect-[9/16] w-full overflow-hidden rounded-[26px] bg-ink shadow-(--shadow-soft) ${
        onClick
          ? "cursor-pointer transition-transform duration-200 hover:-translate-y-1 hover:shadow-(--shadow-lift)"
          : ""
      }`}
    >
      {playable ? (
        <video
          src={item.mediaUrl!}
          poster={item.coverUrl ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
          className="h-full w-full object-cover"
        />
      ) : item.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.coverUrl}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/45">
          <Clapperboard size={30} />
          <span className="text-[11px] font-semibold">No video yet</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />

      {duration && (
        <span className="absolute top-3 right-3 rounded-full border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-md">
          {duration}
        </span>
      )}

      <span className="absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
        <Play size={17} className="ml-0.5 fill-white" />
      </span>

      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <p className="line-clamp-3 text-[13px] leading-[1.25] font-extrabold tracking-tight text-white">
          {item.title || "Untitled short"}
        </p>
      </div>
    </div>
  );
}

/** Qix tile for the grid — matches PixCard so the two libraries read alike. */
export function QixCard({
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
  return (
    <div className="mx-auto flex w-full max-w-[210px] flex-col gap-2">
      <QixFrame item={item} onClick={onView} />

      <div className="flex flex-wrap items-center gap-1.5">
        {actions ?? (
          <>
            <Link
              href={`/content/qix/editor?id=${item.id}`}
              className="btn-primary flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px]"
            >
              <Pencil size={11} /> Edit
            </Link>
            <button
              type="button"
              onClick={onView}
              className="btn-ghost flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px]"
            >
              <Eye size={11} /> View
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <StatusPill status={item.status} />
      </div>
      <p className="truncate text-center text-[10px] text-faint">
        {author ?? "—"}
        {item.state ? ` · ${item.state}` : ""}
      </p>
    </div>
  );
}
