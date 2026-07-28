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
  { key: "createdArticles", label: "Articles", icon: Newspaper },
  { key: "createdPix", label: "Pix", icon: ImageIcon },
  { key: "createdQix", label: "Qix", icon: Clapperboard },
  { key: "createdTrax", label: "Trax", icon: AudioLines },
] as const;

/**
 * One person's contribution at a glance.
 *
 * Writers are measured by what they made and how much of it reached readers;
 * reviewers by what they moved through. Both are shown for everyone rather
 * than branching on role — a chief editor writes too, and hiding the row would
 * make their output invisible.
 */
export default function PerformanceCard({ p }: { p: UserPerformance }) {
  // The pipeline as a part-to-whole: everything they made, and where it got to.
  const total = Math.max(1, p.createdTotal);
  const seg = [
    { label: "Live", value: p.live, cls: "bg-mint" },
    {
      label: "Cleared review",
      value: Math.max(0, p.clearedReview - p.live),
      cls: "bg-violet",
    },
    { label: "Awaiting QA", value: p.awaitingReview, cls: "bg-amber" },
    { label: "Sent back", value: p.sentBack, cls: "bg-rose" },
    { label: "Draft", value: p.inDraft, cls: "bg-line" },
  ].filter((s) => s.value > 0);

  const reviewerWork =
    p.reviewed + p.publishedByThem + p.articlesApproved > 0;
  const liveRate = p.createdTotal
    ? Math.round((p.live / p.createdTotal) * 100)
    : null;

  return (
    <div className={`card card-hover p-5 ${p.isActive ? "" : "opacity-60"}`}>
      {/* who */}
      <div className="flex items-start gap-3">
        <Avatar name={p.fullName} hue={p.avatarHue} size={44} />
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
            {p.createdTotal}
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-wider text-faint uppercase">
            created
          </div>
        </div>
      </div>

      {/* by format */}
      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {FORMATS.map((f) => {
          const n = p[f.key];
          return (
            <div
              key={f.key}
              title={`${n} ${f.label}`}
              className={`rounded-xl px-2 py-2 text-center ${
                n > 0 ? "bg-tint" : "bg-canvas"
              }`}
            >
              <f.icon
                size={13}
                className={`mx-auto ${n > 0 ? "text-accent" : "text-faint"}`}
              />
              <div
                className={`mt-1 text-[13px] font-extrabold tabular-nums ${
                  n > 0 ? "text-ink" : "text-faint"
                }`}
              >
                {n}
              </div>
              <div className="text-[9.5px] font-semibold text-muted">
                {f.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* where it got to */}
      {p.createdTotal > 0 ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="label">Pipeline</span>
            {liveRate !== null && (
              <span className="text-[11px] font-bold text-mint tabular-nums">
                {liveRate}% live
              </span>
            )}
          </div>
          {/* 2px gaps between segments, so adjacent fills stay readable */}
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
            {seg.map((s) => (
              <div
                key={s.label}
                className={s.cls}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {seg.map((s) => (
              <span
                key={s.label}
                className="flex items-center gap-1.5 text-[10.5px] text-muted"
              >
                <span className={`h-2 w-2 rounded-[3px] ${s.cls}`} />
                {s.label}
                <span className="font-bold text-ink tabular-nums">{s.value}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11.5px] text-faint">
          Hasn&apos;t created content yet.
        </p>
      )}

      {/* what they moved through */}
      {reviewerWork && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="label mb-2">Review activity</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: ShieldCheck, n: p.reviewed, label: "reviewed" },
              { icon: Radio, n: p.publishedByThem, label: "published" },
              { icon: Sparkles, n: p.articlesApproved, label: "to feed" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <s.icon size={13} className="mx-auto text-muted" />
                <div className="mt-1 text-[13px] font-extrabold tabular-nums">
                  {s.n}
                </div>
                <div className="text-[9.5px] font-semibold text-muted">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {p.lastTouched && (
        <p className="mt-3 text-[10.5px] text-faint">
          Last active {timeAgo(p.lastTouched)}
        </p>
      )}
    </div>
  );
}
