"use client";

import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  Newspaper,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Avatar, Pill } from "@/components/ui";
import { timeAgo } from "@/lib/store";
import { ROLE_META, type UserPerformance } from "@/lib/types";

const FORMATS = [
  { key: "createdArticles", label: "Art", full: "Articles", icon: Newspaper },
  { key: "createdPix", label: "Pix", full: "Pix", icon: ImageIcon },
  { key: "createdQix", label: "Qix", full: "Qix", icon: Clapperboard },
  { key: "createdTrax", label: "Trax", full: "Trax", icon: AudioLines },
] as const;

const PLOT_H = 52;

/**
 * One person's contribution, drawn the same way for everyone.
 *
 * Every section renders whether or not it has data — a zero bar rather than a
 * missing block — so the cards line up in the grid and the eye can compare
 * across them instead of re-reading each layout.
 *
 * `formatMax` and `reviewMax` are the team-wide maxima, passed in rather than
 * computed per card: bars only mean something if the same height means the
 * same number on every card.
 */
export default function PerformanceCard({
  p,
  formatMax,
  reviewMax,
}: {
  p: UserPerformance;
  formatMax: number;
  reviewMax: number;
}) {
  const total = p.createdTotal;

  // Where their work got to. Ordered from finished to unstarted.
  const seg = [
    { label: "Live", value: p.live, cls: "bg-mint" },
    {
      label: "Cleared",
      value: Math.max(0, p.clearedReview - p.live),
      cls: "bg-violet",
    },
    { label: "In QA", value: p.awaitingReview, cls: "bg-amber" },
    { label: "Sent back", value: p.sentBack, cls: "bg-rose" },
    { label: "Draft", value: p.inDraft, cls: "bg-faint" },
  ];
  const shown = seg.filter((s) => s.value > 0);
  const liveRate = total ? Math.round((p.live / total) * 100) : 0;

  const review = [
    { icon: ShieldCheck, n: p.reviewed, label: "reviewed" },
    { icon: Radio, n: p.publishedByThem, label: "published" },
    { icon: Sparkles, n: p.articlesApproved, label: "to feed" },
  ];

  return (
    <div
      className={`card card-hover flex h-full flex-col p-5 ${
        p.isActive ? "" : "opacity-60"
      }`}
    >
      {/* ── who ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Avatar name={p.fullName} hue={p.avatarHue} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{p.fullName}</p>
          <p className="truncate text-[11px] text-muted">{p.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="accent">{ROLE_META[p.role].label}</Pill>
            {!p.isActive && <Pill tone="muted">Disabled</Pill>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl leading-none font-extrabold tabular-nums">
            {total}
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-wider text-faint uppercase">
            created
          </div>
        </div>
      </div>

      {/* ── output by format ────────────────────────────── */}
      <div className="mt-5">
        <div className="label mb-2">Output by format</div>
        <div className="flex items-end gap-2" style={{ height: PLOT_H }}>
          {FORMATS.map((f) => {
            const n = p[f.key];
            const h = Math.round((n / formatMax) * PLOT_H);
            return (
              <div
                key={f.key}
                title={`${n} ${f.full}`}
                className="flex flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] font-extrabold tabular-nums text-ink">
                  {n}
                </span>
                {/* A 3px stub keeps zero visible as "none", not "missing". */}
                <span
                  className={`w-full rounded-t-[5px] transition-[height] duration-500 ${
                    n > 0 ? "bg-accent" : "bg-line"
                  }`}
                  style={{ height: Math.max(3, h) }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-2">
          {FORMATS.map((f) => (
            <span
              key={f.key}
              className="flex-1 text-center text-[9.5px] font-semibold text-muted"
            >
              {f.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── pipeline ────────────────────────────────────── */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="label">Pipeline</span>
          <span
            className={`text-[11px] font-bold tabular-nums ${
              total ? "text-mint" : "text-faint"
            }`}
          >
            {total ? `${liveRate}% live` : "—"}
          </span>
        </div>
        <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
          {total ? (
            shown.map((s) => (
              <div
                key={s.label}
                className={s.cls}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))
          ) : (
            <div className="w-full bg-line" />
          )}
        </div>
        {/* Fixed two-line well, so a busy pipeline and an empty one occupy
            the same space and the cards below stay aligned. */}
        <div className="mt-2 flex h-8 flex-wrap content-start gap-x-3 gap-y-1 overflow-hidden">
          {total ? (
            shown.map((s) => (
              <span
                key={s.label}
                className="flex items-center gap-1.5 text-[10.5px] text-muted"
              >
                <span className={`h-2 w-2 rounded-[3px] ${s.cls}`} />
                {s.label}
                <span className="font-bold text-ink tabular-nums">{s.value}</span>
              </span>
            ))
          ) : (
            <span className="text-[10.5px] text-faint">
              Nothing created yet.
            </span>
          )}
        </div>
      </div>

      {/* ── review activity ─────────────────────────────── */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="label mb-2">Review activity</div>
        <div className="grid grid-cols-3 gap-2">
          {review.map((s) => (
            <div key={s.label}>
              <div className="flex items-baseline gap-1.5">
                <s.icon
                  size={12}
                  className={s.n > 0 ? "text-accent" : "text-faint"}
                />
                <span className="text-[13px] font-extrabold tabular-nums">
                  {s.n}
                </span>
              </div>
              {/* Horizontal bars here rather than another column chart — three
                  short labels read better beside the number than under it. */}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full ${
                    s.n > 0 ? "bg-accent" : ""
                  }`}
                  style={{ width: `${(s.n / reviewMax) * 100}%` }}
                />
              </div>
              <div className="mt-1 text-[9.5px] font-semibold text-muted">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* mt-auto pins this to the bottom so every card ends the same way */}
      <p className="mt-auto pt-3 text-[10.5px] text-faint">
        {p.lastTouched ? `Last active ${timeAgo(p.lastTouched)}` : "No activity yet"}
      </p>
    </div>
  );
}
