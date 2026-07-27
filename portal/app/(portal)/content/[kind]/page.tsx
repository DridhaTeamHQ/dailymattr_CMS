"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AudioLines,
  Calendar,
  Clapperboard,
  Clock3,
  Edit3,
  Image as ImageIcon,
  Play,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Pill, SectionHeader, StatusPill } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { contentByKind, formatDateTime, getUsers, timeAgo } from "@/lib/store";
import { useStore } from "@/lib/useStore";
import { KIND_META, type ContentItem, type ContentKind } from "@/lib/types";

const VALID: ContentKind[] = ["pix", "qix", "trax"];

const ICONS = { pix: ImageIcon, qix: Clapperboard, trax: AudioLines } as const;

const fmtDur = (s: number | null) => {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 1) {
    return sec > 0 ? `${m}m ${sec}s` : `${m} min`;
  }
  return `${s}s`;
};

const getYoutubeId = (url: string | null) => {
  if (!url) return null;
  const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const beMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) return shortsMatch[1];
  if (watchMatch) return watchMatch[1];
  if (beMatch) return beMatch[1];
  return null;
};

export default function KindListPage() {
  const { kind: raw } = useParams<{ kind: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const kind = VALID.includes(raw as ContentKind) ? (raw as ContentKind) : null;

  const [activeVideo, setActiveVideo] = useState<ContentItem | null>(null);

  useEffect(() => {
    if (!kind) router.replace("/dashboard");
  }, [kind, router]);

  useEffect(() => {
    if (activeVideo) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeVideo]);

  const items = useStore(() => (kind ? contentByKind(kind) : []), [kind]);
  const users = useStore(() => getUsers());

  if (!user || !kind || !items || !users) return null;
  const meta = KIND_META[kind];
  const Icon = ICONS[kind as keyof typeof ICONS];

  const isQix = kind === "qix";

  return (
    <div className="pb-10">
      <SectionHeader
        title={isQix ? "Qix Shorts Videos" : meta.label}
        sub={
          isQix
            ? "Short-form vertical video explainers for DailyMattr app."
            : `${meta.mode} · ${meta.tagline} for the DailyMattr app.`
        }
      >
        <div className="flex items-center gap-3">
          <Link
            href={`/content/${kind}/editor`}
            className="btn-primary px-5 py-2.5 text-sm shadow-md transition-all hover:scale-[1.02]"
          >
            + New {meta.label.replace(/s$/, "")}
          </Link>
        </div>
      </SectionHeader>

      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-accent">
            <Icon size={22} />
          </span>
          <p className="font-bold">No {meta.label.toLowerCase()} yet</p>
          <p className="max-w-xs text-sm text-muted">
            Create the first one — it starts as a draft and flows through QA
            before publishing.
          </p>
        </div>
      ) : isQix ? (
        /* ── QIX SHORTS VIDEO GRID (PROMINENT 9:16 SHORTS TILES) ──────── */
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {items.map((c, i) => {
            const author = users.find((u) => u.id === c.createdBy);
            const dateStr = formatDateTime(c.publishedAt || c.updatedAt || c.createdAt);
            const relTime = timeAgo(c.publishedAt || c.updatedAt || c.createdAt);
            const hasVideo =
              c.mediaUrl &&
              (c.mediaUrl.endsWith(".mp4") ||
                c.mediaUrl.endsWith(".webm") ||
                c.mediaUrl.startsWith("data:video") ||
                c.mediaUrl.includes("gtv-videos") ||
                c.mediaUrl.includes("mixkit"));

            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.2), duration: 0.35 }}
                className="group relative aspect-[9/16] min-h-[430px] max-h-[470px] w-full overflow-hidden rounded-3xl border border-line bg-ink shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lift cursor-pointer"
                onClick={() => setActiveVideo(c)}
              >
                {/* Full-bleed Video / Image Background */}
                {hasVideo ? (
                  <video
                    src={c.mediaUrl!}
                    poster={c.coverUrl ?? undefined}
                    muted
                    loop
                    playsInline
                    onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                    onMouseLeave={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      v.pause();
                      v.currentTime = 0;
                    }}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : c.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={c.coverUrl}
                    alt={c.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-ink via-ink-2 to-black text-white/50">
                    <Clapperboard size={36} />
                    <span className="text-xs font-semibold">Shorts Video</span>
                  </div>
                )}

                {/* Top Overlay: Status & Duration */}
                <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
                  <div className="pointer-events-auto">
                    <StatusPill status={c.status} />
                  </div>
                  {c.durationSec && (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md border border-white/10">
                      {fmtDur(c.durationSec)}
                    </span>
                  )}
                </div>

                {/* Center Hover Play Icon */}
                <div
                  className="absolute inset-0 flex items-center justify-center z-10 opacity-90 group-hover:opacity-100 transition-opacity"
                  title="Play Short"
                >
                  <div className="flex h-13 w-13 items-center justify-center rounded-full bg-accent/90 text-white shadow-xl backdrop-blur-md transition-transform duration-300 group-hover:scale-110">
                    <Play size={20} className="ml-0.5 fill-white" />
                  </div>
                </div>

                {/* Bottom Overlaid Gradient Content */}
                <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/75 to-transparent p-4 pt-12 text-white">
                  {/* Timestamp & Date */}
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/85">
                    <Calendar size={12} className="text-accent shrink-0" />
                    <span className="truncate">{dateStr}</span>
                    <span className="text-white/40">•</span>
                    <span className="text-white/70 truncate">{relTime}</span>
                  </div>

                  {/* Title */}
                  <p className="line-clamp-2 text-sm font-bold leading-snug text-white drop-shadow-md">
                    {c.title}
                  </p>

                  {/* Summary / Tag */}
                  <p className="mt-1 line-clamp-1 text-xs text-white/70">
                    {c.summary}
                  </p>

                  {/* Footer & Quick Actions */}
                  <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-white/15 text-xs">
                    <span className="truncate text-white/80 font-medium max-w-[100px]">
                      {author?.fullName ?? "DailyMattr"}
                    </span>

                    <div className="flex items-center gap-2">
                      {/* Stats Badge */}
                      <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 backdrop-blur border border-emerald-500/30 shadow-sm">
                        <ShieldCheck size={12} />
                        <span>{c.factScore ? `FACT ${c.factScore}` : "FACT 95"}</span>
                      </span>

                      <Link
                        href={`/content/qix/editor?id=${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white hover:text-ink transition-all"
                        title="Edit Qix"
                      >
                        <Edit3 size={12} />
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        /* ── STANDARD GRID (PIX / TRAX) ──────────────────────────────── */
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c, i) => {
            const author = users.find((u) => u.id === c.createdBy);
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.4 }}
              >
                <Link
                  href={`/content/${kind}/editor?id=${c.id}`}
                  className="card card-hover block overflow-hidden"
                >
                  <div className="relative">
                    {c.coverUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.coverUrl}
                        alt=""
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center bg-canvas text-faint">
                        <Icon size={28} />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <StatusPill status={c.status} />
                    </div>
                    {c.durationSec && (
                      <span className="absolute right-3 bottom-3 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                        {fmtDur(c.durationSec)}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-2 text-[14px] leading-snug font-bold">
                      {c.title}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
                      {c.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
                      <span>{author?.fullName ?? "—"}</span>
                      <span className="flex items-center gap-1">
                        <Clock3 size={11} /> {timeAgo(c.updatedAt)}
                      </span>
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <Pill key={t} tone="muted">
                            #{t}
                          </Pill>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── QUICK SHORTS VIDEO MODAL ───────────────────────────────────── */}
      <AnimatePresence>
        {activeVideo && (
          <div
            onClick={() => setActiveVideo(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="relative flex flex-col md:flex-row w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-pop max-h-[90vh]"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-white backdrop-blur hover:bg-rose transition-colors"
              >
                <X size={18} />
              </button>

              {/* 9:16 Video Player Column */}
              <div className="relative flex items-center justify-center bg-black md:w-1/2 aspect-[9/16] max-h-[70vh] md:max-h-[85vh] mx-auto overflow-hidden">
                {activeVideo.mediaUrl && getYoutubeId(activeVideo.mediaUrl) ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${getYoutubeId(activeVideo.mediaUrl)}?autoplay=1&mute=0&controls=1&loop=1`}
                    className="h-full w-full object-cover border-0"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                ) : activeVideo.mediaUrl ? (
                  <video
                    src={activeVideo.mediaUrl}
                    poster={activeVideo.coverUrl ?? undefined}
                    controls
                    autoPlay
                    loop
                    className="h-full w-full object-cover"
                  />
                ) : activeVideo.coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={activeVideo.coverUrl}
                    alt={activeVideo.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-white/50">
                    <Clapperboard size={48} />
                    <span>No Video File Attached</span>
                  </div>
                )}
              </div>

              {/* Video Info Details Column */}
              <div className="flex flex-1 flex-col justify-between p-6 md:p-8 bg-white overflow-y-auto">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill status={activeVideo.status} />
                    {activeVideo.durationSec && (
                      <span className="rounded-full bg-tint px-3 py-1 text-xs font-bold text-accent">
                        ⏱️ {fmtDur(activeVideo.durationSec)}
                      </span>
                    )}
                  </div>

                  <h2 className="text-xl font-bold text-ink leading-snug">
                    {activeVideo.title}
                  </h2>

                  {/* Date & Time Metadata */}
                  <div className="rounded-2xl bg-canvas p-3.5 text-xs text-muted space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-ink">
                      <Calendar size={14} className="text-accent" />
                      <span>
                        Created: {formatDateTime(activeVideo.publishedAt || activeVideo.updatedAt || activeVideo.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-faint">
                      <Clock3 size={14} />
                      <span>Updated {timeAgo(activeVideo.updatedAt)}</span>
                    </div>
                  </div>

                  <p className="text-sm leading-relaxed text-muted">
                    {activeVideo.summary}
                  </p>

                  {activeVideo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {activeVideo.tags.map((t) => (
                        <Pill key={t} tone="accent">
                          #{t}
                        </Pill>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center gap-3 pt-4 border-t border-line">
                  <Link
                    href={`/content/qix/editor?id=${activeVideo.id}`}
                    onClick={() => setActiveVideo(null)}
                    className="btn-accent flex-1 flex items-center justify-center gap-2 py-3 text-sm"
                  >
                    <Edit3 size={15} /> Edit in CMS Editor
                  </Link>
                  <button
                    type="button"
                    onClick={() => setActiveVideo(null)}
                    className="btn-ghost px-5 py-3 text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
