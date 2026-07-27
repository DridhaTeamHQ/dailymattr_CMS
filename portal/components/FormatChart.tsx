"use client";

import { useState } from "react";
import Link from "next/link";
import { KIND_META, type ContentKind } from "@/lib/types";

export interface FormatDatum {
  kind: ContentKind;
  total: number;
  published: number;
}

const PLOT_H = 148; // px of plot area, excluding value + axis labels

/**
 * Published-within-total by format.
 *
 * Published is a subset of total, so it's drawn as a fill inside a recessive
 * track rather than a second adjacent bar — adjacent bars let "published" look
 * taller than "total", which is impossible. The track is chrome, not a series,
 * so the chart carries a single validated brand hue.
 */
export default function FormatChart({ data }: { data: FormatDatum[] }) {
  const [hover, setHover] = useState<ContentKind | null>(null);
  const max = Math.max(1, ...data.map((d) => d.total));

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Library by format</h3>
          <p className="text-xs text-muted">published of total</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" /> Published
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-canvas ring-1 ring-line ring-inset" />
            Not yet live
          </span>
        </div>
      </div>

      <div className="relative flex items-end gap-2">
        {data.map((d) => {
          const trackH = Math.max(6, Math.round((d.total / max) * PLOT_H));
          const fillH =
            d.total === 0 ? 0 : Math.round((d.published / d.total) * trackH);
          const partial = d.published > 0 && d.published < d.total;
          const active = hover === d.kind;

          return (
            <Link
              key={d.kind}
              href={`/content/${d.kind === "article" ? "articles" : d.kind}`}
              onMouseEnter={() => setHover(d.kind)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d.kind)}
              onBlur={() => setHover(null)}
              aria-label={`${KIND_META[d.kind].label}: ${d.published} published of ${d.total} total`}
              className="group relative flex flex-1 flex-col items-center gap-2 rounded-xl pt-7 pb-1 outline-none"
            >
              {/* direct label — values are never tooltip-only */}
              <span className="absolute top-0 text-[11px] font-bold text-ink tabular-nums">
                {d.published}
                <span className="text-faint">/{d.total}</span>
              </span>

              {/* track = total */}
              <span
                className="relative flex w-full max-w-[46px] justify-center rounded-t-lg bg-canvas transition-colors"
                style={{ height: trackH }}
              >
                {/* fill = published, inset inside the track */}
                {fillH > 0 && (
                  // The real height is the base style, not an animation target,
                  // so the fill can never be left invisible if the animation
                  // fails to run. The transition is purely a nicety on top.
                  <span
                    className="absolute inset-x-0 bottom-0 rounded-t-lg bg-accent transition-[height] duration-500 ease-out"
                    style={{
                      height: fillH,
                      // 2px surface gap where published meets the remainder
                      boxShadow: partial
                        ? "0 -2px 0 0 var(--color-card)"
                        : undefined,
                    }}
                  />
                )}
              </span>

              <span
                className={`text-xs font-bold transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                {KIND_META[d.kind].label}
              </span>

              {/* hover / focus detail */}
              {active && (
                <span className="pointer-events-none absolute -top-1 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3 py-2 text-left whitespace-nowrap shadow-(--shadow-lift)">
                  <span className="block text-[11px] font-bold text-white">
                    {KIND_META[d.kind].label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-white/70 tabular-nums">
                    {d.published} published · {d.total - d.published} not live
                  </span>
                  <span className="mt-0.5 block text-[10px] text-white/70 tabular-nums">
                    {d.total} total
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* baseline */}
      <div className="mt-1 h-px w-full bg-line" />
    </div>
  );
}
