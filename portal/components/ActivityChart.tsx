"use client";

import { useMemo, useState } from "react";
import type { ContentKind } from "@/lib/types";
import { KIND_META } from "@/lib/types";

/* Only the three fields a bar is made of.
 *
 * Narrower than ContentItem on purpose: this chart plots when something was
 * made and what kind it was, so asking for a whole item would let a caller
 * fetch an article's body to draw a 3-pixel rectangle — which is exactly what
 * the dashboard used to do. A ContentItem still satisfies it. */
export type Plotted = {
  kind: ContentKind;
  publishedAt: string | null;
  createdAt: string;
};

/**
 * What the newsroom actually shipped, day by day.
 *
 * Replaces a static four-bar snapshot: the totals were already on the stat
 * tiles, so the chart repeated them. Time is the thing the dashboard could not
 * show — whether output is climbing or has stalled.
 *
 * Stacked bars rather than an area: with a handful of items a day, an area
 * chart interpolates between points and invents activity that never happened.
 *
 * Palette validated for both themes (lightness band, chroma floor, CVD
 * separation, contrast) — the same four hues pass on light and dark surfaces,
 * so the series keep their identity when the theme flips.
 */
const SERIES: { kind: ContentKind; color: string }[] = [
  { kind: "article", color: "#378ADD" },
  { kind: "pix", color: "#1D9E75" },
  { kind: "qix", color: "#D85A30" },
  { kind: "trax", color: "#7F77DD" },
];

const RANGES = [
  { days: 14, label: "14d", bucket: "day" as const },
  { days: 30, label: "30d", bucket: "week" as const },
  { days: 90, label: "90d", bucket: "week" as const },
];

const PLOT_H = 148;

const startOfDay = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

export default function ActivityChart({ items }: { items: Plotted[] }) {
  const [rangeIdx, setRangeIdx] = useState(0);
  const [hidden, setHidden] = useState<Set<ContentKind>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const range = RANGES[rangeIdx];

  const buckets = useMemo(() => {
    const now = startOfDay(new Date());
    const step = range.bucket === "day" ? 1 : 7;
    const count = Math.ceil(range.days / step);

    const list = Array.from({ length: count }, (_, i) => {
      const end = new Date(now);
      end.setDate(end.getDate() - (count - 1 - i) * step);
      const start = new Date(end);
      start.setDate(start.getDate() - (step - 1));
      return {
        start,
        end,
        counts: { article: 0, pix: 0, qix: 0, trax: 0 } as Record<
          ContentKind,
          number
        >,
      };
    });

    const first = list[0].start.getTime();
    for (const it of items) {
      // Published date where it exists, otherwise when the work was made —
      // a draft still represents effort on that day.
      const when = startOfDay(new Date(it.publishedAt ?? it.createdAt));
      const t = when.getTime();
      if (isNaN(t) || t < first) continue;
      const idx = Math.min(
        list.length - 1,
        Math.floor((t - first) / (step * 86_400_000))
      );
      if (idx >= 0) list[idx].counts[it.kind]++;
    }
    return list;
  }, [items, range]);

  const visible = SERIES.filter((s) => !hidden.has(s.kind));
  const totalOf = (b: (typeof buckets)[number]) =>
    visible.reduce((a, s) => a + b.counts[s.kind], 0);
  const max = Math.max(1, ...buckets.map(totalOf));
  const grandTotal = buckets.reduce((a, b) => a + totalOf(b), 0);

  const toggle = (k: ContentKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      // Never let the last series be hidden — an empty plot reads as broken.
      if (next.has(k)) next.delete(k);
      else if (next.size < SERIES.length - 1) next.add(k);
      return next;
    });

  const fmt = (b: (typeof buckets)[number]) =>
    range.bucket === "day"
      ? b.end.toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : `${b.start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${b.end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

  const active = hover !== null ? buckets[hover] : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Publishing activity</h3>
          <p className="text-xs text-muted">
            {grandTotal} item{grandTotal === 1 ? "" : "s"} in the last{" "}
            {range.days} days
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-canvas p-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => {
                setRangeIdx(i);
                setHover(null);
              }}
              className={`rounded-full px-3 py-1 text-[11px] font-bold transition-colors ${
                i === rangeIdx
                  ? "bg-shell text-white"
                  : "text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend doubles as the filter — identity is never colour alone, each
          swatch carries its label and running total. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SERIES.map((s) => {
          const off = hidden.has(s.kind);
          const n = buckets.reduce((a, b) => a + b.counts[s.kind], 0);
          return (
            <button
              key={s.kind}
              onClick={() => toggle(s.kind)}
              title={off ? "Show" : "Hide"}
              className={`flex items-center gap-1.5 text-[11px] font-semibold transition-opacity ${
                off ? "opacity-40" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{
                  background: off ? "var(--color-line)" : s.color,
                }}
              />
              <span className={off ? "text-muted line-through" : "text-ink"}>
                {KIND_META[s.kind].label}
              </span>
              <span className="text-faint tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        {/* readout */}
        {active && (
          <div
            className="pointer-events-none absolute -top-1 z-20 -translate-y-full rounded-xl bg-shell px-3 py-2 shadow-(--shadow-lift)"
            style={{
              left: `${((hover! + 0.5) / buckets.length) * 100}%`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="text-[10px] font-bold whitespace-nowrap text-white/60">
              {fmt(active)}
            </div>
            {visible.map((s) => (
              <div
                key={s.kind}
                className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="text-[10px] text-white/70">
                  {KIND_META[s.kind].label}
                </span>
                <span className="ml-auto text-[10px] font-bold text-white tabular-nums">
                  {active.counts[s.kind]}
                </span>
              </div>
            ))}
            <div className="mt-1 border-t border-white/15 pt-1 text-[10px] font-bold text-white">
              {totalOf(active)} total
            </div>
          </div>
        )}

        <div
          className="flex items-end gap-[3px]"
          style={{ height: PLOT_H }}
          onMouseLeave={() => setHover(null)}
        >
          {buckets.map((b, i) => {
            const total = totalOf(b);
            const isHot = hover === i;
            return (
              <button
                key={i}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fmt(b)}: ${total} items`}
                // The hit area is the full column height, so a day with one
                // item is as easy to hover as a busy one.
                className="group flex h-full flex-1 flex-col justify-end rounded-t-md outline-none"
                style={{ background: isHot ? "var(--color-tint)" : undefined }}
              >
                <span className="flex w-full flex-col-reverse gap-[2px]">
                  {visible.map((s) => {
                    const n = b.counts[s.kind];
                    if (!n) return null;
                    return (
                      <span
                        key={s.kind}
                        className="w-full rounded-[3px] transition-opacity"
                        style={{
                          background: s.color,
                          height: Math.max(3, (n / max) * (PLOT_H - 16)),
                          opacity: hover === null || isHot ? 1 : 0.45,
                        }}
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-1 h-px w-full bg-line" />

        {/* Only the ends are labelled — a tick under every bar is noise, and
            the exact date is a hover away. */}
        <div className="mt-1.5 flex justify-between text-[10px] text-faint">
          <span>{fmt(buckets[0])}</span>
          <span>{fmt(buckets[buckets.length - 1])}</span>
        </div>
      </div>
    </div>
  );
}
